import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const booking = await prisma.booking.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!booking) { console.log('No bookings'); process.exit(1); }
  const req = await prisma.paperworkRequest.create({ data: { bookingId: booking.id, sentTo: 'test@test.com' } });
  console.log('https://sirreel-fleet.vercel.app/portal/' + req.token);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
