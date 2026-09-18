import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  activeStandingDepartmentDiscounts,
  applyStandingDiscounts,
} from '@/lib/orders/applyStandingDiscounts'
import { isMoneyEditable } from '@/lib/orders/editability'
import { recalcOrderTotals } from '@/lib/orders'

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
 *
 * Standing discounts follow the move (2026-09-18). They did not until now:
 * the orders changed hands but kept whatever the OLD account's deals had
 * seeded at create, so a job corrected onto a client with "50% off supply
 * orders" quoted them full price and nothing said so. The new company's
 * DEPARTMENT-scoped deals are seeded onto every order still money-editable,
 * through the same applyStandingDiscounts the create paths use.
 *
 * What it will NOT do is REMOVE the old account's rows. OrderDiscount has no
 * provenance column — a seeded row and a rep's hand-typed "Repeat-client
 * courtesy" are the same shape — so deleting by label or value would
 * eventually delete somebody's deliberate concession. applyStandingDiscounts
 * skips a department that already carries a row, which means an old 50% can
 * silently sit where the new account's 30% belongs. Those are returned as
 * `discountConflicts` for a person to settle, the same posture this route
 * already takes with a signature it invalidated.
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
          // Money edits are gated on status, and re-seeding a discount is
          // a money edit — an INVOICED or CLOSED order is a document the
          // client already has.
          status: true,
          discounts: {
            where: { scope: 'DEPARTMENT' },
            select: { departmentKey: true, type: true, value: true, label: true },
          },
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

  // Job, orders, bookings and job-scoped paperwork move together — a row
  // billing or papering a different company than the job it belongs to is
  // the drift this whole change exists to prevent. One transaction so a
  // partial move can't happen.
  //
  // Bookings and CoiChecks were NOT moved until 2026-09-10. The client's
  // paperwork link hangs off the BOOKING (PaperworkRequest → Booking →
  // Company), so after MNX moved Folio Studios → Chaotic Neutral LTD the
  // portal, the contract download, the driver invite and the COI review
  // email all still said Folio — and the COI's named insured, which was
  // correct, was flagged as a mismatch against the ghost (Wes 2026-09-10).
  // CoiChecks and ContractReviews move only when they sat under the OLD
  // company (or none): a certificate deliberately filed under a third
  // company is not this job's drift to fix.
  const orderIds = job.orders.map((o) => o.id)
  const priorCompanyScope = job.companyId
    ? { OR: [{ companyId: job.companyId }, { companyId: null }] }
    : { companyId: null }
  //
  // Interactive rather than the array form because the discount re-seed
  // below has to roll back WITH the move: a job that landed on the new
  // account without its deals, and cannot be moved again (this route 409s
  // on a no-op move), would need a hand-written fix to money.
  const moveTarget = target
  const { bookingsMoved, coisMoved, discountsSeeded, discountConflicts } =
    await prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: job.id }, data: { companyId: moveTarget.id } })
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { companyId: moveTarget.id } })
      const bookings = await tx.booking.updateMany({
        where: { jobId: job.id },
        data: { companyId: moveTarget.id },
      })
      const cois = await tx.coiCheck.updateMany({
        where: { jobId: job.id, ...priorCompanyScope },
        data: { companyId: moveTarget.id },
      })
      await tx.contractReview.updateMany({
        where: { jobId: job.id, ...priorCompanyScope },
        data: { companyId: moveTarget.id },
      })

      // The new account's deals, onto the orders that can still take them.
      // An INVOICED or CLOSED order is a document the client already has;
      // re-pricing it here would move money behind a PDF in their inbox.
      const deals = await activeStandingDepartmentDiscounts(moveTarget.id, tx)
      const seeded: {
        orderId: string
        orderNumber: string
        departmentKey: string
        percentOff: number
        label: string
      }[] = []
      const conflicts: {
        orderId: string
        orderNumber: string
        departmentKey: string
        deal: string
        onOrder: string
      }[] = []

      if (deals.length > 0) {
        for (const o of job.orders) {
          if (!isMoneyEditable(o.status)) continue
          for (const row of await applyStandingDiscounts(o.id, moveTarget.id, tx)) {
            seeded.push({ orderId: o.id, orderNumber: o.orderNumber, ...row })
          }
          // Whatever the seed SKIPPED because a row was already sitting in
          // that department — the old account's, or a rep's own. Named, not
          // overwritten: nothing here can tell those two apart.
          const seenDepts = new Set<string>()
          for (const deal of deals) {
            if (!deal.departmentKey || seenDepts.has(deal.departmentKey)) continue
            seenDepts.add(deal.departmentKey)
            const existing = o.discounts.find((d) => d.departmentKey === deal.departmentKey)
            if (!existing) continue
            const same = existing.type === 'PERCENT' && Number(existing.value) === deal.percentOff
            if (same) continue
            conflicts.push({
              orderId: o.id,
              orderNumber: o.orderNumber,
              departmentKey: deal.departmentKey,
              deal: `${deal.percentOff}% off ${deal.label}`,
              onOrder: existing.type === 'PERCENT'
                ? `${Number(existing.value)}% — ${existing.label}`
                : `$${Number(existing.value).toFixed(2)} — ${existing.label}`,
            })
          }
        }
      }

      return {
        bookingsMoved: bookings,
        coisMoved: cois,
        discountsSeeded: seeded,
        discountConflicts: conflicts,
      }
    // The seed walks every order on the job, so the default 5s interactive
    // budget is tight on a job carrying several. A timeout here rolls the
    // whole move back, and this route 409s on a retry of a move that partly
    // happened — so buy the headroom rather than find out.
    }, { timeout: 15_000 })

  // Persisted totals are a cache of the discount-aware math, and a seeded
  // row has just changed it — without this the order keeps showing the
  // undiscounted total until somebody edits a line. Deliberately AFTER the
  // commit: recalcOrderTotals reads through the singleton client, so inside
  // the transaction it could not see the rows that were just written. A
  // failure here does not fail the move — the discount rows are real and
  // the next line edit recalculates — so it must not turn a committed move
  // into an error the caller will try to repeat.
  for (const orderId of new Set(discountsSeeded.map((d) => d.orderId))) {
    try {
      await recalcOrderTotals(orderId)
    } catch {
      // Left stale on purpose; see above.
    }
  }

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
    bookingsMoved: bookingsMoved.count,
    coisMoved: coisMoved.count,
    staleAgreements,
    // The new account's department deals that landed, and the ones a row
    // already in that department blocked. A conflict is a person's call.
    discountsSeeded,
    discountConflicts,
  })
}
