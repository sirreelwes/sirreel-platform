import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { attachInquiryThreadToJob } from '@/lib/jobs/attachThreadToJob'
import type { InquiryStatus } from '@prisma/client'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTo: { select: { id: true, name: true } },
      convertedJob: { select: { id: true, jobCode: true, name: true } },
    },
  })
  if (!inquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Enrich the order-form cart so the new-quote prefill can bind each line to a
  // real catalog target (additive — other consumers ignore the extra fields):
  //   - VEHICLE lines carry only a VehicleCategory id; resolve the linked
  //     AssetCategory id (quotes bind vehicles as catalogType=ASSET_CATEGORY).
  //   - SUPPLY lines resolve the InventoryItem's department (the cart snapshot
  //     only stores the display category name, not the line department).
  // Covers BOTH metadata kinds ('production-order' written by the form today,
  // and the legacy 'supply-order').
  let sourceMetadata = inquiry.sourceMetadata as Record<string, unknown> | null
  const cart = (sourceMetadata?.cart ?? null) as Array<Record<string, unknown>> | null
  const kind = sourceMetadata?.kind
  if ((kind === 'production-order' || kind === 'supply-order') && Array.isArray(cart) && cart.length > 0) {
    const vehicleIds = cart.filter((l) => l.itemKind === 'VEHICLE').map((l) => String(l.itemId))
    const supplyIds = cart.filter((l) => l.itemKind === 'SUPPLY').map((l) => String(l.itemId))
    const [vehicles, supplies] = await Promise.all([
      vehicleIds.length
        ? prisma.vehicleCategory.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, assetCategoryId: true } })
        : Promise.resolve([]),
      supplyIds.length
        ? prisma.inventoryItem.findMany({ where: { id: { in: supplyIds } }, select: { id: true, department: true } })
        : Promise.resolve([]),
    ])
    const acById = new Map(vehicles.map((v) => [v.id, v.assetCategoryId]))
    const deptById = new Map(supplies.map((s) => [s.id, s.department]))
    const enrichedCart = cart.map((l) =>
      l.itemKind === 'VEHICLE'
        ? { ...l, assetCategoryId: acById.get(String(l.itemId)) ?? null }
        : { ...l, department: deptById.get(String(l.itemId)) ?? null },
    )
    sourceMetadata = { ...sourceMetadata, cart: enrichedCart }
  }

  return NextResponse.json({
    inquiry: {
      ...inquiry,
      sourceMetadata,
      estimatedValue: inquiry.estimatedValue == null ? null : Number(inquiry.estimatedValue),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  try {
    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data.status = body.status as InquiryStatus
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.companyId !== undefined) data.companyId = body.companyId || null
    if (body.personId !== undefined) data.personId = body.personId || null
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId || null
    // `assignToMe: true` — resolve the logged-in user server-side so
    // the triage UI doesn't need to know its own user.id. Wins over
    // assignedToId if both are passed.
    if (body.assignToMe === true) {
      const session = await getServerSession()
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 })
      }
      const me = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      })
      if (!me) {
        return NextResponse.json({ error: 'session user not found' }, { status: 401 })
      }
      data.assignedToId = me.id
    }
    if (body.estimatedValue !== undefined) {
      data.estimatedValue =
        body.estimatedValue == null || body.estimatedValue === ''
          ? null
          : Number(body.estimatedValue)
    }
    if (body.preferredStartDate !== undefined) {
      data.preferredStartDate = body.preferredStartDate ? new Date(body.preferredStartDate) : null
    }
    if (body.preferredEndDate !== undefined) {
      data.preferredEndDate = body.preferredEndDate ? new Date(body.preferredEndDate) : null
    }
    if (body.convertedJobId !== undefined) data.convertedJobId = body.convertedJobId || null

    const inquiry = await prisma.inquiry.update({
      where: { id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
        convertedJob: { select: { id: true, jobCode: true, name: true } },
      },
    })

    // Email-in-Job (step 6): conversion is where the agent explicitly
    // resolved the Job — file the inquiry's source email thread in it
    // (fill-only, best-effort).
    if (typeof body.convertedJobId === 'string' && body.convertedJobId) {
      await attachInquiryThreadToJob(id, body.convertedJobId)
    }

    return NextResponse.json({
      inquiry: {
        ...inquiry,
        estimatedValue: inquiry.estimatedValue == null ? null : Number(inquiry.estimatedValue),
      },
    })
  } catch (error) {
    console.error(`PATCH /api/inquiries/${id} error:`, error)
    return NextResponse.json({ error: 'Failed to update inquiry' }, { status: 500 })
  }
}
