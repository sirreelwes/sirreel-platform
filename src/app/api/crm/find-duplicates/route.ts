import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Scan only. The merge that used to live here (POST) moved Order,
 * Affiliation and Activity and then deleted the duplicate Company —
 * which silently cascaded away that client's cards, negotiated rates,
 * annual agreements and portal logins, and stranded every booking, COI
 * and job it never looked at. /crm/duplicates now posts to
 * /api/crm/companies/[id]/merge, which sweeps every Company foreign key
 * from the Prisma schema and audits what it moved.
 */

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
