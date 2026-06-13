import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { portalTokenUrl, clientTokenUrl } from '@/lib/portal/portalUrl';
import { randomUUID } from 'crypto';
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email';

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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

    // Get or create person. When the picker passed an existing personId,
    // we also accept an edited phone value — if the rep typed over the
    // CRM-supplied number, the new value lands on Person.phone. We
    // normalise to digits-only before comparing so a UI-formatted
    // "(760) 672-5522" matches a stored "7606725522" without a write.
    const normalizedPhone = (personPhone || '').replace(/\D/g, '');
    let pId = personId;
    if (pId) {
      const current = await prisma.person.findUnique({
        where: { id: pId },
        select: { phone: true, mobile: true },
      });
      if (current && normalizedPhone) {
        const currentDigits = (current.phone || '').replace(/\D/g, '');
        const mobileDigits = (current.mobile || '').replace(/\D/g, '');
        // Only update if the typed value differs from BOTH stored fields —
        // otherwise the rep just kept what CRM showed and nothing changed.
        if (normalizedPhone !== currentDigits && normalizedPhone !== mobileDigits) {
          await prisma.person.update({
            where: { id: pId },
            data: { phone: normalizedPhone },
          });
        }
      }
    } else {
      const normalizedEmail = normalizeEmail(personEmail);
      // Alias-aware lookup — a merged loser's email resolves to the
      // survivor rather than re-minting a fresh Person here.
      const existingPerson = await resolvePersonByEmail(normalizedEmail, {
        select: { id: true },
      }) as { id: string } | null;
      if (existingPerson) {
        pId = existingPerson.id;
      } else {
        const nameParts = (personName || normalizedEmail).split(' ');
        const person = await prisma.person.create({
          data: {
            firstName: nameParts[0] || normalizedEmail,
            lastName: nameParts.slice(1).join(' ') || '',
            email: normalizedEmail,
            phone: normalizedPhone || null,
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

    const portalUrl = portalTokenUrl(request.token);
    const clientUrl = clientTokenUrl(request.token);

    return NextResponse.json({ ok: true, token: request.token, portalUrl, clientUrl, bookingId: booking.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
