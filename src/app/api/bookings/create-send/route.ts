import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      companyId, companyName, personId, personEmail, personName, personPhone,
      agentId, jobName, startDate, endDate, vehicleTypes, notes,
      contractType, stageDetails,
    } = body;

    if (!jobName || !startDate || !personEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get or create company
    let coId = companyId;
    if (!coId && companyName) {
      const existing = await prisma.company.findFirst({ where: { name: companyName } });
      if (existing) {
        coId = existing.id;
      } else {
        const co = await prisma.company.create({ data: { name: companyName } });
        coId = co.id;
      }
    }
    if (!coId) return NextResponse.json({ error: 'Company required' }, { status: 400 });

    // Get or create person
    let pId = personId;
    if (!pId) {
      const existingPerson = await prisma.person.findFirst({ where: { email: personEmail } });
      if (existingPerson) {
        pId = existingPerson.id;
      } else {
        const nameParts = (personName || personEmail).split(' ');
        const person = await prisma.person.create({
          data: {
            firstName: nameParts[0] || personEmail,
            lastName: nameParts.slice(1).join(' ') || '',
            email: personEmail,
            phone: personPhone || null,
          },
        });
        pId = person.id;
      }
    }

    // Get agent - use provided or fall back to first admin
    let aId = agentId;
    if (!aId) {
      const agent = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (agent) aId = agent.id;
    }
    if (!aId) return NextResponse.json({ error: 'No agent found' }, { status: 400 });

    // Create booking
    const bookingNumber = `SR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const booking = await prisma.booking.create({
      data: {
        bookingNumber,
        companyId: coId,
        personId: pId,
        agentId: aId,
        jobName,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : new Date(startDate),
        status: 'REQUEST',
        notes: notes || null,
      },
    });

    // Create paperwork request
    const request = await prisma.paperworkRequest.create({
      data: {
        bookingId: booking.id,
        sentTo: personEmail,
        sentAt: new Date(),
        contractType: contractType || 'vehicles',
        stageDetails: stageDetails ? JSON.stringify(stageDetails) : null,
      },
    });

    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com';
    const portalUrl = `${base}/portal/${request.token}`;
    const clientUrl = `${base}/client/${request.token}`;

    return NextResponse.json({ ok: true, token: request.token, portalUrl, clientUrl, bookingId: booking.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
