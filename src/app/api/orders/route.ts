import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber, recalcOrderTotals } from "@/lib/orders";
import { getServerSession } from "next-auth";
import type { JobRole, ProductionType } from "@prisma/client";
import { recomputeMostCommonProductionTypeProfile } from "@/lib/companies/recomputeMostCommonProductionTypeProfile";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "25");

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (agentId) where.agentId = agentId;
  if (companyId) where.companyId = companyId;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { company: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        booking: { select: { id: true, bookingNumber: true, jobName: true } },
        _count: { select: { lineItems: true, invoices: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, limit });
}

// Inline-Job payload accepted when the new-quote flow wants to create
// a Job *and* its first Order in one shot. Mirrors POST /api/jobs but
// drops companyId/agentId (taken from the order body) and id-generation
// fields. When this is set, jobId must NOT be set — they're mutually
// exclusive. Job+Order land in a single Prisma transaction so an
// abandoned mid-write leaves nothing behind.
interface InlineJobInput {
  name: string;
  productionType?: ProductionType;
  productionTypeProfileId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  estimatedValue?: number | string | null;
  contacts?: { personId: string; role: JobRole; isPrimary?: boolean }[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companyId, jobId, bookingId, description, startDate, endDate, taxRate } = body;
    const inlineJob: InlineJobInput | undefined = body.job;
    let { agentId } = body;

    // Fall back to logged-in user for agentId if not supplied
    if (!agentId) {
      const session = await getServerSession();
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (user) agentId = user.id;
      }
    }

    if (!companyId || !agentId) {
      return NextResponse.json(
        {
          error: "companyId and agentId are required",
          gotCompanyId: !!companyId,
          gotAgentId: !!agentId,
        },
        { status: 400 }
      );
    }

    if (!jobId && !inlineJob) {
      return NextResponse.json(
        { error: "Either jobId (existing) or job (inline create) is required" },
        { status: 400 }
      );
    }
    if (jobId && inlineJob) {
      return NextResponse.json(
        { error: "Pass either jobId or job, not both" },
        { status: 400 }
      );
    }
    if (inlineJob && !inlineJob.name) {
      return NextResponse.json(
        { error: "job.name is required when creating an inline Job" },
        { status: 400 }
      );
    }

    const orderNumber = await nextOrderNumber();

    const { order, createdJobId } = await prisma.$transaction(async (tx) => {
      let resolvedJobId = jobId as string | undefined;
      let createdId: string | null = null;

      if (inlineJob) {
        // Same jobCode-bump pattern as POST /api/jobs — race-prone today
        // but no worse than the existing path. Lives inside the tx so
        // the Job is rolled back on Order failure.
        const lastJob = await tx.job.findFirst({
          orderBy: { createdAt: "desc" },
          select: { jobCode: true },
        });
        const nextNum = lastJob
          ? parseInt(lastJob.jobCode.replace("SR-JOB-", ""), 10) + 1
          : 1;
        const jobCode = `SR-JOB-${String(nextNum).padStart(4, "0")}`;

        const created = await tx.job.create({
          data: {
            jobCode,
            name: inlineJob.name,
            companyId,
            agentId,
            productionType: inlineJob.productionType || "OTHER",
            // Optional FK to the new ProductionTypeProfile lookup;
            // empty string → null defensive against form defaults.
            productionTypeProfileId:
              typeof inlineJob.productionTypeProfileId === "string" &&
              inlineJob.productionTypeProfileId
                ? inlineJob.productionTypeProfileId
                : null,
            status: "QUOTED",
            startDate: inlineJob.startDate ? new Date(inlineJob.startDate) : null,
            endDate: inlineJob.endDate ? new Date(inlineJob.endDate) : null,
            notes: inlineJob.notes || null,
            estimatedValue:
              inlineJob.estimatedValue == null || inlineJob.estimatedValue === ""
                ? null
                : Number(inlineJob.estimatedValue),
            ...(inlineJob.contacts && inlineJob.contacts.length > 0 && {
              jobContacts: {
                create: inlineJob.contacts.map((c) => ({
                  personId: c.personId,
                  role: c.role,
                  isPrimary: !!c.isPrimary,
                })),
              },
            }),
          },
        });
        resolvedJobId = created.id;
        createdId = created.id;
      }

      const created = await tx.order.create({
        data: {
          orderNumber,
          companyId,
          agentId,
          jobId: resolvedJobId!,
          bookingId: bookingId || null,
          description: description || null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          taxRate: taxRate ?? 0,
        },
        include: {
          company: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
      });
      return { order: created, createdJobId: createdId };
    });

    // If we created an inline Job, refresh the Company's most-common-
    // profile cache OUTSIDE the tx so the new row is visible to the
    // helper's findMany. Order-only creates (no inlineJob) skip — they
    // don't change the company's profile distribution.
    if (createdJobId) {
      try {
        await recomputeMostCommonProductionTypeProfile(companyId);
      } catch (err) {
        console.warn("[orders POST] recompute most-common profile failed:", err);
      }
    }

    return NextResponse.json({ ...order, createdJobId }, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
