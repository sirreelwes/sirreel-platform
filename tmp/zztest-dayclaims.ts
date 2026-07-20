import { prisma } from '../src/lib/prisma'
import { computeDays, isClaimEligible, sanitizeClaimedDays } from '../src/lib/orders/days'
import { findPendingDayClaims } from '../src/lib/orders/dayClaimGate'
import { computeLineTotal } from '../src/lib/orders/billing'

async function main() {
  // Formula checks
  console.log('computeDays same-day:', computeDays('2026-07-20', '2026-07-20'), '(expect 1)')
  console.log('computeDays 5-day span:', computeDays('2026-07-20', '2026-07-25'), '(expect 5)')
  console.log('eligible VEHICLE:', isClaimEligible({ type: 'VEHICLE', department: 'VEHICLES' }), '(expect true)')
  console.log('eligible STAGES:', isClaimEligible({ type: 'EQUIPMENT', department: 'STAGES' }), '(expect false)')
  console.log('sanitize "3":', sanitizeClaimedDays('3'), '| sanitize 0:', sanitizeClaimedDays(0), '| sanitize 400:', sanitizeClaimedDays(400))

  // Self-owned fixture: order + claimed line → gate → resolve → gate clears.
  const company = await prisma.company.findFirst({ select: { id: true } })
  const agent = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
  const job = await prisma.job.create({
    data: { jobCode: `ZZTEST-DAYS-${process.pid}`, name: 'ZZTEST day claims', companyId: company!.id, agentId: agent!.id },
    select: { id: true },
  })
  const order = await prisma.order.create({
    data: { orderNumber: `ZZTEST-DC-${process.pid}`, companyId: company!.id, agentId: agent!.id, jobId: job.id },
    select: { id: true },
  })
  const pickup = new Date('2026-08-01T00:00:00Z'); const ret = new Date('2026-08-06T00:00:00Z')
  const line = await prisma.orderLineItem.create({
    data: {
      orderId: order.id, type: 'VEHICLE', department: 'VEHICLES', description: 'ZZTEST cube',
      pickupDate: pickup, returnDate: ret, rate: 100, rateType: 'DAILY', quantity: 1,
      billableDays: computeDays(pickup, ret), computedDays: computeDays(pickup, ret),
      claimedDays: 3, claimStatus: 'PENDING',
      lineTotal: computeLineTotal({ quantity: 1, rate: 100, billableDays: computeDays(pickup, ret), rateType: 'DAILY', department: 'VEHICLES' }),
    },
    select: { id: true, computedDays: true, lineTotal: true },
  })
  console.log(`\nline created: computedDays=${line.computedDays} lineTotal=${Number(line.lineTotal)} (expect 5 / 500 — claim does NOT price)`)

  const pending = await findPendingDayClaims(order.id)
  console.log('gate finds pending:', pending.length, '(expect 1)')

  // Resolve as the endpoint would: approve the 3-day claim
  await prisma.orderLineItem.update({
    where: { id: line.id },
    data: { billableDays: 3, claimStatus: 'APPROVED', lineTotal: computeLineTotal({ quantity: 1, rate: 100, billableDays: 3, rateType: 'DAILY', department: 'VEHICLES' }) },
  })
  const after = await findPendingDayClaims(order.id)
  const resolved = await prisma.orderLineItem.findUnique({ where: { id: line.id }, select: { billableDays: true, claimStatus: true, lineTotal: true } })
  console.log(`after approve: pending=${after.length} (expect 0) billable=${resolved!.billableDays} total=${Number(resolved!.lineTotal)} (expect 3 / 300)`)

  // Cleanup by captured IDs
  await prisma.orderLineItem.delete({ where: { id: line.id } })
  await prisma.order.delete({ where: { id: order.id } })
  await prisma.job.delete({ where: { id: job.id } })
  console.log('fixture cleaned by captured IDs')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
