/**
 * HQ-minted units — the DB half of printing our own SR labels.
 * The numbering rule and label geometry are pure, in ./unitLabels.
 *
 * A minted unit is a real `InventoryUnit` row, so every reader that
 * already exists — the scan resolver, the check-out desk, Find a Unit,
 * the "barcoded line" rule — sees it with no change. What marks it as
 * ours: `source = 'HQ'`, `rwItemId = 'HQ:<barcode>'` (the column is
 * required and unique; no RW ItemId looks like that), a number from the
 * SR900000+ block. The RW sync never gets it back from RW's feed and is
 * taught not to count it stale.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeScan } from './resolveScan'
import {
  HQ_LABEL_FLOOR, HQ_RW_ITEM_PREFIX, MAX_MINT_PER_BATCH, formatBarcode, nextHqBarcodes,
} from './unitLabels'

export const HQ_COLUMNS_SCRIPT = 'npx tsx scripts/add-hq-unit-columns.ts'
export const MAX_LABELS_PER_SHEET_REQUEST = 300

export type MintedUnit = { id: string; barcode: string; serialNumber: string | null }

export type MintResult =
  | { ok: true; units: MintedUnit[]; item: { id: string; code: string; description: string } }
  | { ok: false; status: number; reason: string }

function isMissingColumn(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2022' || err.code === 'P2021')
}

function isUniqueClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** Every register row inside HQ's block, tagged by who issued it. */
async function unitsInHqBlock(): Promise<Array<{ barcode: string; source: 'RW' | 'HQ' }>> {
  // Read by the rwItemId prefix rather than the `source` column so the
  // guard works before the column exists — and stays true if a row were
  // ever written with the prefix but not the column.
  const rows = await prisma.inventoryUnit.findMany({
    where: { barcode: { gte: formatBarcode(HQ_LABEL_FLOOR) } },
    select: { barcode: true, rwItemId: true },
  })
  return rows.map((r) => ({ barcode: r.barcode, source: r.rwItemId.startsWith(HQ_RW_ITEM_PREFIX) ? 'HQ' : 'RW' }))
}

export async function mintUnits(args: {
  inventoryItemId: string
  count: number
  /** Optional, positional: serialNumbers[i] goes on the i-th new unit. */
  serialNumbers?: Array<string | null>
  userId: string
}): Promise<MintResult> {
  const count = Math.floor(args.count)
  if (!Number.isFinite(count) || count < 1) return { ok: false, status: 400, reason: 'count must be 1 or more' }
  if (count > MAX_MINT_PER_BATCH) return { ok: false, status: 400, reason: `at most ${MAX_MINT_PER_BATCH} labels per batch` }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: args.inventoryItemId },
    select: { id: true, code: true, description: true, rwICode: true, isActive: true },
  })
  if (!item) return { ok: false, status: 404, reason: 'catalog item not found' }
  if (!item.isActive) return { ok: false, status: 409, reason: `${item.code} is inactive in the catalog` }

  const serials = (args.serialNumbers ?? []).map((s) => (s ?? '').trim() || null)

  // Two attempts: a concurrent mint can take the same numbers between
  // our read and our write; the unique index refuses, and we re-read.
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = nextHqBarcodes(await unitsInHqBlock(), count)
    if (!next.ok) return { ok: false, status: 409, reason: next.reason }

    try {
      const now = new Date()
      const units = await prisma.$transaction(async (tx) => {
        const created: MintedUnit[] = []
        for (let i = 0; i < next.barcodes.length; i++) {
          const barcode = next.barcodes[i]
          const row = await tx.inventoryUnit.create({
            data: {
              rwItemId: `${HQ_RW_ITEM_PREFIX}${barcode}`,
              barcode,
              barcodeForScanning: `*${barcode}*`,
              serialNumber: serials[i] ?? null,
              rwICode: item.rwICode ?? '',
              inventoryItemId: item.id,
              description: item.description,
              source: 'HQ',
              mintedById: args.userId,
              lastSeenAt: now,
            },
            select: { id: true, barcode: true, serialNumber: true },
          })
          created.push(row)
        }
        await tx.auditLog.create({
          data: {
            userId: args.userId,
            action: 'inventory.units_minted',
            entityType: 'InventoryUnit',
            entityId: item.id,
            newValues: {
              inventoryItemId: item.id,
              code: item.code,
              count: created.length,
              barcodes: created.map((u) => u.barcode),
              unitIds: created.map((u) => u.id),
            },
          },
        })
        return created
      })
      return { ok: true, units, item: { id: item.id, code: item.code, description: item.description ?? item.code } }
    } catch (err) {
      if (isMissingColumn(err)) {
        return {
          ok: false, status: 503,
          reason: `The label columns are not on the register yet — run ${HQ_COLUMNS_SCRIPT} first.`,
        }
      }
      if (isUniqueClash(err) && attempt === 0) continue
      throw err
    }
  }
  return { ok: false, status: 409, reason: 'another mint took those numbers twice in a row — try again' }
}

export type LabelUnit = {
  id: string
  barcode: string
  serialNumber: string | null
  /** Catalog code, or the RW item code when the unit is unmatched. */
  itemCode: string
  /** Catalog description, else RW's description, else the code. */
  name: string
}

export type LabelLookup = { units: LabelUnit[]; missing: string[] }

/** The register rows behind a list of scanned/typed barcodes, in the
 *  order asked for, deduplicated; the codes with no row come back as
 *  `missing` so the sheet never quietly prints fewer labels than asked. */
export async function unitsForLabels(rawCodes: string[]): Promise<LabelLookup> {
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of rawCodes) {
    const code = normalizeScan(raw)
    if (!code || seen.has(code)) continue
    seen.add(code)
    wanted.push(code)
    if (wanted.length >= MAX_LABELS_PER_SHEET_REQUEST) break
  }
  if (!wanted.length) return { units: [], missing: [] }

  const rows = await prisma.inventoryUnit.findMany({
    where: { barcode: { in: wanted } },
    select: {
      id: true, barcode: true, serialNumber: true, description: true, rwICode: true,
      inventoryItem: { select: { code: true, description: true } },
    },
  })
  const byCode = new Map(rows.map((r) => [r.barcode.toUpperCase(), r]))
  const units: LabelUnit[] = []
  const missing: string[] = []
  for (const code of wanted) {
    const r = byCode.get(code)
    if (!r) { missing.push(code); continue }
    units.push({
      id: r.id,
      barcode: r.barcode,
      serialNumber: r.serialNumber,
      itemCode: r.inventoryItem?.code ?? r.rwICode ?? '',
      name: r.inventoryItem?.description ?? r.description ?? r.barcode,
    })
  }
  return { units, missing }
}

/** Best effort — a sheet that printed is a sheet that printed. */
export async function markLabelsPrinted(unitIds: string[]): Promise<void> {
  if (!unitIds.length) return
  try {
    await prisma.inventoryUnit.updateMany({ where: { id: { in: unitIds } }, data: { labelPrintedAt: new Date() } })
  } catch (err) {
    if (!isMissingColumn(err)) console.warn('[unit-labels] could not stamp labelPrintedAt:', err)
  }
}
