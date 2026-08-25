import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/jobs/[id]/company — move a job to a different production company.
 *
 * Split out of the general job PATCH deliberately. Changing the production
 * company is not an edit like renaming a job: it re-points the account every
 * order, invoice and agreement on the job bills and papers against, so it
 * gets its own route, its own transaction, and its own answer about what it
 * just invalidated.
 *
 * Origin (Wes, 2026-08-25): the COI's named insured did not match the
 * production name on the job, and there was no way in HQ to correct the
 * production company at all — let alone to learn that an agreement had
 * already been signed under the wrong one.
 *
 * Body: { companyId } to move to an existing company, or { companyName } to
 * create one and move to it. Returns the agreements that were signed under
 * the OLD company so the caller can offer to re-issue them
 * (POST /api/orders/[id]/agreement/reissue) — this route never touches a
 * signature itself.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    companyId?: unknown
    companyName?: unknown
  }
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : ''
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim().slice(0, 200) : ''

  if (!companyId && !companyName) {
    return NextResponse.json({ error: 'Pass companyId or companyName.' }, { status: 400 })
  }

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      companyId: true,
      company: { select: { id: true, name: true } },
      orders: {
        select: {
          id: true,
          orderNumber: true,
          signedAgreements: {
            select: { contractType: true, status: true, signedAt: true, signerName: true },
          },
        },
      },
    },
  })
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Resolve the target company. An exact (case-insensitive) name match wins
  // over creating a duplicate — the whole point of this route is to stop the
  // same production existing twice under slightly different spellings.
  let target: { id: string; name: string } | null = null
  if (companyId) {
    target = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } })
    if (!target) {
      return NextResponse.json({ error: 'That company no longer exists.' }, { status: 404 })
    }
  } else {
    target = await prisma.company.findFirst({
      where: { name: { equals: companyName, mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    if (!target) {
      target = await prisma.company.create({
        data: { name: companyName },
        select: { id: true, name: true },
      })
    }
  }

  if (target.id === job.companyId) {
    return NextResponse.json(
      { error: `This job is already under ${target.name}.` },
      { status: 409 },
    )
  }

  const previousName = job.company?.name ?? null

  // Job and its orders move together — an order billing a different company
  // than the job it belongs to is the drift this whole change exists to
  // prevent. One transaction so a partial move can't happen.
  const orderIds = job.orders.map((o) => o.id)
  await prisma.$transaction([
    prisma.job.update({ where: { id: job.id }, data: { companyId: target.id } }),
    ...(orderIds.length
      ? [prisma.order.updateMany({ where: { id: { in: orderIds } }, data: { companyId: target.id } })]
      : []),
  ])

  // What the move just invalidated: any agreement a client already signed
  // named the OLD company. The caller decides whether to re-issue.
  const staleAgreements = job.orders.flatMap((o) =>
    o.signedAgreements
      .filter((a) => !!a.signedAt)
      .map((a) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        contractType: a.contractType,
        status: a.status,
        signedAt: a.signedAt,
        signerName: a.signerName,
      })),
  )

  return NextResponse.json({
    ok: true,
    company: target,
    previousCompanyName: previousName,
    ordersMoved: orderIds.length,
    staleAgreements,
  })
}
