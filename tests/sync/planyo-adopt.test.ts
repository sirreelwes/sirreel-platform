/**
 * Cart adoption matching — the guard against merging two real rentals.
 *
 * findAdoptableNativeBooking decides whether a Planyo cart is the SAME
 * rental as one already entered in HQ. Getting it wrong in one direction
 * leaves a duplicate (two vehicles held for one rental — the bug). Getting
 * it wrong in the other silently merges two genuine reservations into one,
 * which is worse and much harder to notice.
 *
 * So the matcher is strict — same company, identical start AND end, an
 * identical category SET — and these are the cases that pin that down.
 * The DB is stubbed; this tests the decision, not Prisma.
 *
 * Run: npm run test:planyo-adopt
 */
import { findAdoptableNativeBooking } from '@/lib/sync/planyo/adoptNativeBooking'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

/** Minimal prisma stub: records the where-clause, returns canned natives. */
const stub = (natives: any[]) => {
  const calls: any[] = []
  return {
    calls,
    prisma: {
      booking: {
        findMany: async (args: any) => { calls.push(args); return natives },
      },
    } as any,
  }
}

const plan = (over: any = {}): any => ({
  cart: '5769209',
  status: 'AUTO',
  resolvedCompany: { id: 'co-1', name: 'Peacoat Productions LLC' },
  bookingDraft: { startLA: '2026-08-27', endLA: '2026-08-31' },
  bookingItemDrafts: [{ categoryId: 'cat-cargo' }],
  reservationDrafts: [],
  ...over,
})

const native = (id: string, cats: string[]) => ({
  id, bookingNumber: id, items: cats.map((c) => ({ categoryId: c })),
})

async function main() {
  // ── Adopts: the real Peacoat case ──
  let s = stub([native('SR-2026-0205', ['cat-cargo'])])
  let r = await findAdoptableNativeBooking(s.prisma, plan())
  eq('adopts an exact match', r?.bookingNumber, 'SR-2026-0205')
  eq('reason names the evidence', typeof r?.reason === 'string' && r!.reason.includes('2026-08-27'), true)

  // The query itself must never consider a booking that already has a cart,
  // or a dead one — that scoping is the matcher's first line of defence.
  eq('queries native-only', s.calls[0].where.planyoCartId, null)
  eq('queries the resolved company', s.calls[0].where.companyId, 'co-1')
  eq('excludes dead bookings', s.calls[0].where.status.in.includes('CANCELLED'), false)

  // ── Refuses ──
  s = stub([native('N', ['cat-cargo', 'cat-cube'])])
  eq('refuses a superset of categories', await findAdoptableNativeBooking(s.prisma, plan()), null)

  s = stub([native('N', ['cat-cube'])])
  eq('refuses a different category', await findAdoptableNativeBooking(s.prisma, plan()), null)

  s = stub([native('N', [])])
  eq('refuses a native with no equipment', await findAdoptableNativeBooking(s.prisma, plan()), null)

  s = stub([])
  eq('refuses when nothing matches', await findAdoptableNativeBooking(s.prisma, plan()), null)

  eq('refuses a company that would be created',
    await findAdoptableNativeBooking(stub([native('N', ['cat-cargo'])]).prisma,
      plan({ resolvedCompany: { create: { name: 'New Co' } } })), null)

  eq('refuses with no company at all',
    await findAdoptableNativeBooking(stub([native('N', ['cat-cargo'])]).prisma,
      plan({ resolvedCompany: null })), null)

  eq('refuses a cart with no equipment',
    await findAdoptableNativeBooking(stub([native('N', ['cat-cargo'])]).prisma,
      plan({ bookingItemDrafts: [] })), null)

  // ── Multi-category carts must match as a SET, order-independently ──
  s = stub([native('N', ['cat-cube', 'cat-cargo'])])
  r = await findAdoptableNativeBooking(s.prisma, plan({
    bookingItemDrafts: [{ categoryId: 'cat-cargo' }, { categoryId: 'cat-cube' }],
}))
  eq('category order does not matter', r?.bookingNumber, 'N')

  // Duplicate categoryIds on either side collapse to the same set.
  s = stub([native('N', ['cat-cargo', 'cat-cargo'])])
  r = await findAdoptableNativeBooking(s.prisma, plan({
    bookingItemDrafts: [{ categoryId: 'cat-cargo' }, { categoryId: 'cat-cargo' }],
}))
  eq('repeated categories collapse', r?.bookingNumber, 'N')

  // ── Two eligible natives: the OLDEST wins, and only one is claimed ──
  s = stub([native('SR-2026-0063', ['cat-cube']), native('SR-2026-0064', ['cat-cube'])])
  r = await findAdoptableNativeBooking(s.prisma, plan({ bookingItemDrafts: [{ categoryId: 'cat-cube' }] }))
  eq('oldest native claims the cart', r?.bookingNumber, 'SR-2026-0063')
  eq('ordered by createdAt asc', s.calls[0].orderBy, { createdAt: 'asc' })

}

main().then(() => {
console.log(fail === 0 ? '\nall adoption checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
})
