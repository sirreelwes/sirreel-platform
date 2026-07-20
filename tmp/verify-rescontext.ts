import { prisma } from '../src/lib/prisma'
async function main() {
  const targets = await prisma.booking.findMany({
    where: { archivedAt: null, bookingNumber: { in: ['SR-2026-0063', 'SR-PB-2026-8827'] } },
    select: { id: true, bookingNumber: true },
  })
  for (const t of targets) {
    const booking = await prisma.booking.findUnique({
      where: { id: t.id },
      select: {
        rentalAgreement: true, coiReceived: true, unionStatus: true,
        paperworkRequests: { select: { rentalAgreement: true, coiReceived: true, lcdwAccepted: true, creditCardAuth: true, wcReceived: true } },
        job: {
          select: {
            coiChecks: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { humanDecision: true, policyExpiryDate: true, coverageVerified: true } },
            orders: { where: { status: { not: 'CANCELLED' } }, select: { signedAgreements: { select: { contractType: true, status: true } }, invoices: { select: { status: true, balanceDue: true } } } },
          },
        },
      },
    })
    const agr = (booking!.job?.orders ?? []).flatMap(o => o.signedAgreements).filter(a => a.contractType === 'RENTAL_AGREEMENT')
    console.log(`${t.bookingNumber}: prRequests=${booking!.paperworkRequests.length} rentalRows=${agr.length} coiCheck=${booking!.job?.coiChecks.length} legacy(rental=${booking!.rentalAgreement}, coi=${booking!.coiReceived}) union=${booking!.unionStatus}`)
  }
  const checkouts = await prisma.checkoutRecord.count()
  console.log('checkout records in DB:', checkouts)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
