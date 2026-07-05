/**
 * GET /api/public/reorder/history — the signed-in visitor's recent
 * orders for the public order form's reorder toggles.
 *
 * SECURITY: renders NOTHING without a valid person-session cookie
 * (the 30-day HMAC cookie minted by the magic-link verify endpoint).
 * Orders are scoped to the session's Person via JobContact → Job →
 * Order — the same linkage the portal account page uses — so one
 * person's session can never surface another person's orders.
 *
 * Pricing: rates come FRESH from the current catalog (standing
 * pricing rules), never copied from the old order's lines. An
 * archived item (or a vehicle class that no longer maps to a public
 * vehicle category) comes back available:false so the form can show
 * "no longer available" without adding it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  PERSON_SESSION_COOKIE,
  verifyPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

interface ReorderLine {
  itemKind: 'SUPPLY' | 'VEHICLE'
  itemId: string
  name: string
  qty: number
  available: boolean
  /** CURRENT daily rate (0 = price-on-quote), never the old order's. */
  price: number
  type: string
  category: string
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(PERSON_SESSION_COOKIE)?.value
  const verified = cookie ? verifyPersonSessionCookieValue(cookie) : null
  if (!verified) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: {
      revokedAt: true,
      person: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          phone: true, rawTitle: true, isActive: true,
        },
      },
    },
  })
  if (!session || session.revokedAt || !session.person.isActive) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const person = session.person

  // Person → jobs → most recent 5 orders (portal-account linkage).
  const jobContacts = await prisma.jobContact.findMany({
    where: { personId: person.id },
    select: { jobId: true },
  })
  const jobIds = [...new Set(jobContacts.map((jc) => jc.jobId))]
  const orders = jobIds.length === 0 ? [] : await prisma.order.findMany({
    where: { jobId: { in: jobIds } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      job: { select: { name: true } },
      lineItems: {
        orderBy: { sortOrder: 'asc' },
        select: {
          type: true,
          description: true,
          quantity: true,
          isPackageHeader: true,
          inventoryItem: {
            select: {
              id: true, description: true, dailyRate: true, includedFree: true,
              isActive: true, type: true, category: { select: { name: true, slug: true } },
            },
          },
          assetCategory: { select: { id: true, name: true } },
        },
      },
    },
  })

  // Vehicle mapping: order lines hold AssetCategory; the public cart
  // keys vehicles by VehicleCategory. Resolve in one query.
  const acIds = [...new Set(orders.flatMap((o) => o.lineItems.map((l) => l.assetCategory?.id)).filter(Boolean))] as string[]
  const vcs = acIds.length === 0 ? [] : await prisma.vehicleCategory.findMany({
    where: { assetCategoryId: { in: acIds } },
    select: { id: true, name: true, assetCategoryId: true, dailyRate: true, assetCategory: { select: { dailyRate: true } } },
  })
  const vcByAc = new Map(vcs.map((v) => [v.assetCategoryId as string, v]))

  const payload = orders.map((o) => {
    const lines: ReorderLine[] = []
    for (const li of o.lineItems) {
      // Money-only / structural lines never reorder.
      if (li.type === 'FEE' || li.type === 'DISCOUNT' || li.type === 'LABOR') continue
      if (li.isPackageHeader) continue
      if (li.inventoryItem) {
        const inv = li.inventoryItem
        lines.push({
          itemKind: 'SUPPLY',
          itemId: inv.id,
          name: inv.description ?? li.description,
          qty: li.quantity,
          available: inv.isActive,
          price: inv.isActive ? Number(inv.dailyRate) : 0,
          type: inv.type,
          category: inv.category?.slug ?? 'other',
        })
      } else if (li.assetCategory) {
        const vc = vcByAc.get(li.assetCategory.id)
        lines.push({
          itemKind: 'VEHICLE',
          itemId: vc?.id ?? li.assetCategory.id,
          name: vc?.name ?? li.assetCategory.name,
          qty: li.quantity,
          available: !!vc,
          price: vc ? Number(vc.assetCategory?.dailyRate ?? vc.dailyRate ?? 0) : 0,
          type: 'VEHICLE',
          category: 'Vehicle',
        })
      }
      // free-text lines (no catalog binding) are skipped — nothing to re-add
    }
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      jobName: o.job?.name ?? o.orderNumber,
      startDate: o.startDate ? o.startDate.toISOString().slice(0, 10) : null,
      endDate: o.endDate ? o.endDate.toISOString().slice(0, 10) : null,
      itemCount: lines.length,
      lines,
    }
  }).filter((o) => o.itemCount > 0)

  return NextResponse.json({
    person: {
      name: `${person.firstName} ${person.lastName}`.trim(),
      email: person.email,
      phone: person.phone,
      role: person.rawTitle,
    },
    orders: payload,
  })
}
