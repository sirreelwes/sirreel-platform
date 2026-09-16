/**
 * Why haven't any thank-you emails gone out? — READ-ONLY diagnostic.
 *
 * Wes 2026-09-16: "I haven't seen any emails going out yet." The queue mints
 * on RETURNED and NOTHING auto-sends, so there are four different places this
 * can stall and they need different fixes. This counts all four, in order,
 * against the live DB.
 *
 * WRITES NOTHING. No create, update, upsert or delete anywhere in this file —
 * every call is a count / findMany / groupBy. Safe to run against production,
 * which is the only database there is.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/thank-you-queue-report.ts
 *
 * Read it top to bottom; the first line that reads ZERO is the blockage.
 */
import { prisma } from '../src/lib/prisma'

const DAYS = 90
const since = new Date(Date.now() - DAYS * 86_400_000)

function head(s: string) {
  console.log(`\n${s}\n${'─'.repeat(s.length)}`)
}

async function main() {
  console.log(`Thank-you queue — last ${DAYS} days (read-only)`)

  // ── 1. Has an order ever reached RETURNED? ───────────────────────────
  // Nothing mints without this. Both triggers key on the transition.
  head('1 · Orders that reached RETURNED')
  const returnedTotal = await prisma.order.count({ where: { status: 'RETURNED' } })
  const returnedRecent = await prisma.order.count({
    where: { status: 'RETURNED', updatedAt: { gte: since } },
  })
  console.log(`RETURNED right now:            ${returnedTotal}`)
  console.log(`…touched in the last ${DAYS}d:    ${returnedRecent}`)
  const returnedByCheckIn = await prisma.auditLog.count({
    where: { action: 'order.returned_by_check_in', createdAt: { gte: since } },
  })
  console.log(`advanced by a check-in sheet:  ${returnedByCheckIn}`)
  if (returnedTotal === 0) {
    console.log('→ BLOCKAGE: no order has ever been marked RETURNED, so nothing can mint.')
  }

  // ── 2. Did a suggestion get minted? ──────────────────────────────────
  // Both triggers mint only when the order MOVES to RETURNED. An order
  // already sitting at RETURNED when a sheet is filed mints nothing.
  head('2 · Suggestions minted')
  const byStatus = await prisma.thankYouSuggestion.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  if (byStatus.length === 0) console.log('none at all')
  for (const r of byStatus) console.log(`${r.status.padEnd(12)} ${r._count._all}`)

  const returnedOrders = await prisma.order.findMany({
    where: { status: 'RETURNED' },
    select: { id: true, orderNumber: true, updatedAt: true, thankYouSuggestion: { select: { id: true } } },
    orderBy: { updatedAt: 'desc' },
  })
  const missing = returnedOrders.filter((o) => !o.thankYouSuggestion)
  console.log(`\nRETURNED orders with NO suggestion row: ${missing.length} of ${returnedOrders.length}`)
  if (missing.length) {
    console.log('(both triggers fire only on the TRANSITION to RETURNED — an order')
    console.log(' already RETURNED when its sheet is filed mints nothing)')
    for (const o of missing.slice(0, 10)) {
      console.log(`  ${o.orderNumber}  touched ${o.updatedAt.toISOString().slice(0, 10)}`)
    }
    if (missing.length > 10) console.log(`  …and ${missing.length - 10} more`)
  }

  // ── 3. Is anyone working the queue? ──────────────────────────────────
  // Nothing auto-sends, by design. A pile of SUGGESTED rows and no sends
  // means the queue is being seen and skipped, or never opened.
  head('3 · Sends (the actual question)')
  const sentRows = await prisma.auditLog.findMany({
    where: { action: 'order.thank_you_sent' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { createdAt: true, entityId: true },
  })
  const sentTotal = await prisma.auditLog.count({ where: { action: 'order.thank_you_sent' } })
  console.log(`thank-you emails ever sent:    ${sentTotal}`)
  if (sentTotal === 0) {
    console.log('→ Nothing has ever been sent. The send is MANUAL — the queue mints a')
    console.log('  SUGGESTED row and a human opens /orders/<id>/thank-you and presses Send.')
    console.log('  Note the template still says PLACEHOLDER COPY — NEEDS WES REVIEW')
    console.log('  BEFORE FIRST REAL SEND (src/lib/email/templates/thankYouTemplate.ts).')
  } else {
    for (const r of sentRows) {
      console.log(`  ${r.createdAt.toISOString().slice(0, 16)}  order ${r.entityId}`)
    }
  }
  const dismissed = await prisma.thankYouSuggestion.findMany({
    where: { status: 'DISMISSED' },
    select: { dismissedReason: true },
    take: 10,
  })
  if (dismissed.length) {
    console.log('\ndismissed, with reasons:')
    for (const d of dismissed) console.log(`  ${d.dismissedReason || '(no reason given)'}`)
  }

  // ── 4. Will the photo be there when someone does send? ───────────────
  head('4 · Candids on file (the picture the mail carries)')
  const agents = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['AGENT', 'ADMIN', 'MANAGER'] } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const candids = await prisma.agentWeeklyCandid.findMany({
    where: { userId: { in: agents.map((a) => a.id) } },
    orderBy: { capturedAt: 'desc' },
    select: { userId: true, capturedAt: true },
  })
  const newest = new Map<string, Date>()
  for (const c of candids) if (!newest.has(c.userId)) newest.set(c.userId, c.capturedAt)
  for (const a of agents) {
    const at = newest.get(a.id)
    const age = at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : null
    console.log(`  ${a.name.padEnd(22)} ${at ? `candid ${age}d old` : 'NO CANDID'}`)
  }

  head('Summary')
  console.log(`RETURNED ${returnedTotal} · suggestions ${returnedOrders.length - missing.length} · sent ${sentTotal}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
