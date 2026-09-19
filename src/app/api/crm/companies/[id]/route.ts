import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { RW_VOID } from "@/lib/rentalworks/arStatus";
import { getServerSession } from "next-auth";
import {
  clientMatchAddresses,
  fromAddressMatches,
  scopeEmailsToCompany,
} from "@/lib/crm/companyEmailScope";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      affiliations: {
        include: { person: true },
        orderBy: { isCurrent: "desc" },
      },
      orders: {
        select: { id: true, orderNumber: true, status: true, total: true, description: true, startDate: true, endDate: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      activities: {
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
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
          person: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      },
    },
  });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Outbound emails this company has been part of — see the matching
  // notes on /api/crm/people/[id]; same union-of-signals approach,
  // fanned out across every affiliated person's email. Limited to
  // currentish + historical affiliations to be inclusive.
  //
  // SCOPED, because a person is not (Wes 2026-09-19: the Party Giraffes
  // feed was carrying two other productions' invoices). The rules live
  // in lib/crm/companyEmailScope.ts — read the header there before
  // widening any of this:
  //   · @sirreel.com addresses are never match keys. Outbound
  //     toAddresses carries the Cc: header, and every job-thread send
  //     Cc's jobs+<code>@ plus the team copy, so one internal address
  //     among a company's contacts matches every client email HQ has
  //     ever sent.
  //   · a thread filed to ANOTHER company's Job is that company's, and
  //     a contact match never outranks it.
  //   · a thread filed to THIS company's Job belongs here whoever it
  //     was addressed to — that is the quote/invoice case.
  const matchAddresses = clientMatchAddresses(
    company.affiliations.map((a) => a.person?.email),
  );

  // Threads this company's own Jobs own. Phase 1 (2026-09-17) files an
  // anchored thread to its Job at ingest, so this is the strong signal.
  const companyJobIds = (
    await prisma.job.findMany({ where: { companyId: id }, select: { id: true } })
  ).map((j) => j.id);
  const ownJobThreadIds =
    companyJobIds.length > 0
      ? (
          await prisma.emailThread.findMany({
            where: { jobId: { in: companyJobIds } },
            select: { id: true },
            orderBy: { lastMessageAt: 'desc' },
            take: 400,
          })
        ).map((t) => t.id)
      : [];

  // Threads a contact of this company started. `contains` is a
  // substring test over a display-name From: header, so the rows come
  // back and are re-checked exactly before their thread ids are used.
  let contactThreadIds: string[] = [];
  if (matchAddresses.length > 0) {
    const inboundFromAnyone = await prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        duplicateOfId: null,
        threadId: { not: null },
        OR: matchAddresses.map((e) => ({
          fromAddress: { contains: e, mode: 'insensitive' as const },
        })),
      },
      // Not `distinct: ['threadId']` — the exact re-check below needs
      // the From: header, and a distinct pick could hand back the one
      // row on a thread whose address only matched as a substring.
      select: { threadId: true, fromAddress: true },
      orderBy: { sentAt: 'desc' },
      take: 600,
    });
    contactThreadIds = Array.from(
      new Set(
        inboundFromAnyone
          .filter((r) => fromAddressMatches(r.fromAddress, matchAddresses))
          .map((r) => r.threadId)
          .filter((t): t is string => !!t),
      ),
    );
  }

  const threadIds = Array.from(new Set([...ownJobThreadIds, ...contactThreadIds]));

  // Over-fetch: the scope pass below drops the rows that turn out to
  // belong to another company's job, and the feed still wants 50.
  const outboundCandidates = await prisma.emailMessage.findMany({
    where: {
      direction: 'outbound',
      duplicateOfId: null,
      OR: [
        ...(threadIds.length > 0 ? [{ threadId: { in: threadIds } }] : []),
        ...(matchAddresses.length > 0
          ? [{ toAddresses: { hasSome: matchAddresses } }]
          : []),
        { companyId: id },
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
      companyId: true,
    },
    orderBy: { sentAt: 'desc' },
    take: 200,
  });

  // Whose job is each of those threads on? Resolved only for the
  // threads that actually came back, so this stays two bounded reads.
  const candidateThreadIds = Array.from(
    new Set(outboundCandidates.map((m) => m.threadId).filter((t): t is string => !!t)),
  );
  const threadCompanyId = new Map<string, string | null>();
  if (candidateThreadIds.length > 0) {
    const threads = await prisma.emailThread.findMany({
      where: { id: { in: candidateThreadIds } },
      select: { id: true, jobId: true },
    });
    const jobIds = Array.from(
      new Set(threads.map((t) => t.jobId).filter((j): j is string => !!j)),
    );
    const jobs =
      jobIds.length > 0
        ? await prisma.job.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, companyId: true },
          })
        : [];
    const jobCompany = new Map(jobs.map((j) => [j.id, j.companyId]));
    for (const t of threads) {
      threadCompanyId.set(t.id, t.jobId ? jobCompany.get(t.jobId) ?? null : null);
    }
  }

  const outboundEmails = scopeEmailsToCompany(outboundCandidates, {
    companyId: id,
    threadCompanyId,
  }).slice(0, 50);

  // RW rollup so the client header doesn't read "0 orders" for clients
  // whose history lives in RentalWorks.
  let rwStats: { orderCount: number; invoicedTotal: number } | null = null;
  if (company.rentalworksCustomerId) {
    const [orderGroups, agg] = await Promise.all([
      prisma.rwInvoice.groupBy({
        by: ["orderNumber"],
        where: { rwCustomerId: company.rentalworksCustomerId, status: { not: RW_VOID }, orderNumber: { not: null } },
      }),
      prisma.rwInvoice.aggregate({
        where: { rwCustomerId: company.rentalworksCustomerId, status: { not: RW_VOID } },
        _sum: { invoiceTotal: true },
      }),
    ]);
    rwStats = { orderCount: orderGroups.length, invoicedTotal: Number(agg._sum.invoiceTotal ?? 0) };
  }

  return NextResponse.json({ ...company, outboundEmails, rwStats });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const {
    name, website, industry, tier, billingEmail, defaultAgentId,
    coiOnFile, coiExpiry, notes,
    discountTendency, typicalDiscountPct, discountNotes,
  } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (website !== undefined) data.website = website;
  if (industry !== undefined) data.industry = industry;
  if (tier !== undefined) data.tier = tier;
  if (billingEmail !== undefined) data.billingEmail = billingEmail;
  if (defaultAgentId !== undefined) data.defaultAgentId = defaultAgentId || null;
  if (coiOnFile !== undefined) data.coiOnFile = coiOnFile;
  if (coiExpiry !== undefined) data.coiExpiry = coiExpiry ? new Date(coiExpiry) : null;
  if (notes !== undefined) data.notes = notes;
  // Discount profile — agent-edited from the client file. typicalDiscountPct
  // accepts null/empty to clear; non-empty values are coerced via Number().
  if (discountTendency !== undefined) data.discountTendency = discountTendency;
  if (typicalDiscountPct !== undefined) {
    data.typicalDiscountPct =
      typicalDiscountPct === null || typicalDiscountPct === '' ? null : Number(typicalDiscountPct);
  }
  if (discountNotes !== undefined) data.discountNotes = discountNotes || null;

  const company = await prisma.company.update({ where: { id }, data });
  return NextResponse.json(company);
}
