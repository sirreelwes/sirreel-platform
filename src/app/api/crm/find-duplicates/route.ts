import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Normalize company name for matching
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\b(llc|inc|llp|ltd|corp|co|corporation|company|productions?|films?|studios?|media|entertainment|group)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  // Get non-RW companies (manually created)
  const manual = await prisma.company.findMany({
    where: { rentalworksCustomerId: null },
    select: { id: true, name: true, tier: true, totalSpend: true, totalBookings: true, createdAt: true },
  });

  // Get RW-imported companies
  const imported = await prisma.company.findMany({
    where: { rentalworksCustomerId: { not: null } },
    select: { id: true, name: true, rentalworksCustomerId: true },
  });

  // Build index
  const rwByNorm = new Map<string, typeof imported[0][]>();
  for (const co of imported) {
    const key = normalize(co.name);
    if (!key) continue;
    if (!rwByNorm.has(key)) rwByNorm.set(key, []);
    rwByNorm.get(key)!.push(co);
  }

  // Find matches
  const duplicates = [];
  for (const co of manual) {
    const key = normalize(co.name);
    const matches = rwByNorm.get(key);
    if (matches && matches.length > 0) {
      duplicates.push({
        manual: co,
        matches: matches,
      });
    }
  }

  return NextResponse.json({ duplicates, manualCount: manual.length, importedCount: imported.length });
}

export async function POST(req: NextRequest) {
  // Merge manual company into RW company
  // Move all orders, affiliations, activities from manual to rw
  const body = await req.json();
  const { manualId, rwId } = body;

  if (!manualId || !rwId) {
    return NextResponse.json({ error: "manualId and rwId required" }, { status: 400 });
  }

  // Move all relations
  await prisma.order.updateMany({ where: { companyId: manualId }, data: { companyId: rwId } });
  await prisma.affiliation.updateMany({ where: { companyId: manualId }, data: { companyId: rwId } });
  await prisma.activity.updateMany({ where: { companyId: manualId }, data: { companyId: rwId } });

  // Preserve stats: add manual spend/bookings to RW record
  const manual = await prisma.company.findUnique({ where: { id: manualId } });
  const rw = await prisma.company.findUnique({ where: { id: rwId } });

  if (manual && rw) {
    await prisma.company.update({
      where: { id: rwId },
      data: {
        totalSpend: { increment: manual.totalSpend },
        totalBookings: { increment: manual.totalBookings },
        // Preserve better tier
        tier: (["VIP", "PREFERRED"].indexOf(manual.tier) < ["VIP", "PREFERRED"].indexOf(rw.tier))
          ? manual.tier : rw.tier,
        // Keep any billing email from manual if RW lacks one
        billingEmail: rw.billingEmail || manual.billingEmail,
      },
    });
  }

  // Delete the manual duplicate
  await prisma.company.delete({ where: { id: manualId } });

  return NextResponse.json({ success: true });
}
