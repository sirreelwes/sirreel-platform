import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/people/email";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // Pulls the four Person→Company paths so the detail page can
  // derive "Company & Production History" without auto-creating
  // Affiliation rows: jobContacts (Job grain), orderContacts
  // (Order grain — relation OrderJobContact), bookings (Booking
  // contact), and referredBookings (Booking referrer). The detail
  // page collapses these into one company-keyed list and merges
  // with explicit affiliations.
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      affiliations: {
        include: { company: { select: { id: true, name: true, tier: true } } },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
      },
      activities: {
        include: {
          agent: { select: { id: true, name: true } },
          company: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          job: {
            select: {
              id: true,
              jobCode: true,
              name: true,
              status: true,
              startDate: true,
              company: { select: { id: true, name: true, tier: true } },
            },
          },
        },
      },
      orderContacts: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          startDate: true,
          company: { select: { id: true, name: true, tier: true } },
          job: { select: { id: true, jobCode: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      bookings: {
        select: {
          id: true,
          bookingNumber: true,
          jobName: true,
          startDate: true,
          status: true,
          company: { select: { id: true, name: true, tier: true } },
          job: { select: { id: true, jobCode: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      referredBookings: {
        select: {
          id: true,
          bookingNumber: true,
          jobName: true,
          startDate: true,
          status: true,
          company: { select: { id: true, name: true, tier: true } },
          job: { select: { id: true, jobCode: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      outreachActivities: {
        select: {
          id: true,
          type: true,
          notes: true,
          occurredAt: true,
          followUpAt: true,
          followUpDone: true,
          createdBy: { select: { id: true, name: true } },
          company: { select: { id: true, name: true } },
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      },
    },
  });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Outbound emails this contact has been part of — surfaces "we
  // emailed this client on X" on the timeline without anyone having
  // to log it manually. Match is intentionally broad because the
  // Pub/Sub sync stores toAddresses=[inboxEmail] (the agent's own
  // mailbox) instead of the real recipient — so a literal recipient
  // match alone would miss most rows. Union of three signals:
  //   (a) toAddresses hasSome [person.email] — catches gmail/fetch
  //       rows where the real To: header was parsed
  //   (b) threadId in (threads with an inbound from person.email) —
  //       catches Pub/Sub-synced outbound replies on a client thread
  //   (c) personId match — future-proof if the column gets populated
  const personEmailLower = person.email.toLowerCase();
  const inboundFromPerson = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      threadId: { not: null },
      fromAddress: { contains: personEmailLower, mode: 'insensitive' },
    },
    select: { threadId: true },
    distinct: ['threadId'],
    take: 200,
  });
  const threadIds = inboundFromPerson
    .map((r) => r.threadId)
    .filter((t): t is string => !!t);

  const outboundEmails = await prisma.emailMessage.findMany({
    where: {
      direction: 'outbound',
      duplicateOfId: null,
      OR: [
        ...(threadIds.length > 0 ? [{ threadId: { in: threadIds } }] : []),
        { toAddresses: { hasSome: [person.email, personEmailLower] } },
        { personId: id },
      ],
    },
    select: {
      id: true,
      subject: true,
      snippet: true,
      sentAt: true,
      fromAddress: true,
      toAddresses: true,
      threadId: true,
    },
    orderBy: { sentAt: 'desc' },
    take: 50,
  });

  // Capture provenance — when this Person was auto-captured or
  // enriched from a sales-inbox email, surface the originating
  // message so the detail page can render "Captured from <inbox> on
  // <date>". Stays null for legacy / manually-added contacts.
  const sourceMessage = person.sourceMessageId
    ? await prisma.emailMessage.findUnique({
        where: { id: person.sourceMessageId },
        select: {
          id: true,
          subject: true,
          sentAt: true,
          fromAddress: true,
          emailAccount: { select: { emailAddress: true } },
        },
      })
    : null;

  return NextResponse.json({ ...person, outboundEmails, sourceMessage });
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Session-required for mutations. Matches the guard added to the
  // orders PUT in 1755d70. All in-app callers run from the
  // (dashboard) shell so they already have a session; this hardens
  // a pre-existing gap.
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId, notes } = body;

  const data: Record<string, unknown> = {};
  if (firstName !== undefined) data.firstName = firstName;
  if (lastName !== undefined) data.lastName = lastName;
  if (email !== undefined) data.email = normalizeEmail(email);
  if (phone !== undefined) data.phone = phone || null;
  if (mobile !== undefined) data.mobile = mobile || null;
  if (role !== undefined) data.role = role;
  if (tier !== undefined) data.tier = tier;
  if (assignedAgentId !== undefined) data.assignedAgentId = assignedAgentId || null;
  if (notes !== undefined) data.notes = notes;

  const person = await prisma.person.update({ where: { id }, data });
  return NextResponse.json(person);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // Delete affiliations first
  await prisma.affiliation.deleteMany({ where: { personId: id } });
  await prisma.activity.deleteMany({ where: { personId: id } });
  await prisma.person.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
