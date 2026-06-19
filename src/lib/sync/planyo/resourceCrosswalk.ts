/**
 * Build the planyoResourceId → AssetCategory map once per run.
 * Lines whose resource_id is missing here are flagged FLAG_UNMAPPED,
 * never silently dropped or auto-mapped.
 */

import type { PrismaClient } from '@prisma/client'

export interface CrosswalkEntry {
  id: string
  name: string
  dailyRate: number
}

export async function buildResourceCrosswalk(
  prisma: PrismaClient,
): Promise<Map<number, CrosswalkEntry>> {
  const rows = await prisma.assetCategory.findMany({
    select: { id: true, name: true, dailyRate: true, planyoResourceId: true },
  })
  const m = new Map<number, CrosswalkEntry>()
  for (const r of rows) {
    if (r.planyoResourceId == null) continue
    m.set(r.planyoResourceId, {
      id: r.id,
      name: r.name,
      dailyRate: Number(r.dailyRate),
    })
  }
  return m
}
