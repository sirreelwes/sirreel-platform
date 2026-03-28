import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const company = await prisma.company.findFirst();
  const person = await prisma.person.findFirst();
  const user = await prisma.user.findFirst();
  if (!company || !person || !user) { console.log('Missing seed data:', { company: !!company, person: !!person, user: !!user }); process.exit(1); }
  
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: 'SR-TEST-001',
      jobName: 'Test Production',
      productionName: 'Test Film',
      companyId: company.id,
      personId: person.id,
      agentId: user.id,
      startDate: new Date('2026-03-25'),
      endDate: new Date('2026-03-27'),
    }
  });

  const req = await prisma.paperworkRequest.create({
    data: { bookingId: booking.id, sentTo: 'test@test.com' }
  });

  console.log('Portal URL: https://sirreel-fleet.vercel.app/portal/' + req.token);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
