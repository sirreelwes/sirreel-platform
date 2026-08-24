/**
 * Included accessories for one inventory item.
 *
 *   GET  /api/inventory/items/[id]/kit-pieces  → the item's kit
 *   PUT  /api/inventory/items/[id]/kit-pieces  → replace the whole kit
 *
 * Replace-all semantics (like the aliases field on the item itself):
 * the drawer edits a small list in place and sends the result, so a
 * removed row is an absent row. Diffed inside one transaction against
 * the stored set — rows that survive are UPDATEd rather than dropped
 * and recreated, so ids stay stable for anything referencing them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

const INCLUDE = {
  piece: {
    select: {
      id: true,
      code: true,
      description: true,
      dailyRate: true,
      qtyOwned: true,
      isActive: true,
    },
  },
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const kitPieces = await prisma.inventoryKitPiece.findMany({
    where: { parentItemId: id },
    include: INCLUDE,
    orderBy: [{ sortOrder: 'asc' }],
  })
  return NextResponse.json({ kitPieces })
}

interface KitPieceInput {
  pieceItemId?: unknown
  qtyPer?: unknown
  perUnits?: unknown
  rounding?: unknown
  minQty?: unknown
  billing?: unknown
  clientVisible?: unknown
  suppressIfOrdered?: unknown
  note?: unknown
  isActive?: unknown
}

const ROUNDINGS = ['CEIL', 'FLOOR'] as const
const BILLINGS = ['FREE', 'CHARGED'] as const

export async function PUT(req: NextRequest, { params }: Params) {
  // Same gate as the item PUT — inventory is a daily-touch ops surface,
  // not an admin-only one.
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const raw = Array.isArray(body?.kitPieces) ? (body.kitPieces as KitPieceInput[]) : null
  if (!raw) {
    return NextResponse.json({ error: 'kitPieces array is required' }, { status: 400 })
  }

  const parent = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!parent) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 })
  }

  // Normalize + validate before touching anything, so a bad row rejects
  // the request instead of half-applying the kit.
  const rows: {
    pieceItemId: string
    qtyPer: Prisma.Decimal
    perUnits: number
    rounding: (typeof ROUNDINGS)[number]
    minQty: number
    billing: (typeof BILLINGS)[number]
    clientVisible: boolean
    suppressIfOrdered: boolean
    note: string | null
    isActive: boolean
    sortOrder: number
  }[] = []

  for (const [i, r] of raw.entries()) {
    const pieceItemId = typeof r.pieceItemId === 'string' ? r.pieceItemId.trim() : ''
    if (!pieceItemId) {
      return NextResponse.json({ error: `row ${i + 1}: pick an item` }, { status: 400 })
    }
    // An item that includes itself would recurse the moment expansion
    // runs, and means nothing physically.
    if (pieceItemId === id) {
      return NextResponse.json(
        { error: 'an item cannot be its own included accessory' },
        { status: 400 },
      )
    }
    const qtyPerNum = Number(r.qtyPer ?? 1)
    if (!Number.isFinite(qtyPerNum) || qtyPerNum <= 0) {
      return NextResponse.json(
        { error: `row ${i + 1}: qty per must be greater than zero` },
        { status: 400 },
      )
    }
    const perUnitsNum = Math.floor(Number(r.perUnits ?? 1))
    if (!Number.isFinite(perUnitsNum) || perUnitsNum < 1) {
      return NextResponse.json(
        { error: `row ${i + 1}: "per" must be at least 1` },
        { status: 400 },
      )
    }
    const rounding = ROUNDINGS.includes(r.rounding as never)
      ? (r.rounding as (typeof ROUNDINGS)[number])
      : 'CEIL'
    const billing = BILLINGS.includes(r.billing as never)
      ? (r.billing as (typeof BILLINGS)[number])
      : 'FREE'
    const minQty = Math.max(0, Math.floor(Number(r.minQty ?? 0)) || 0)
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null

    rows.push({
      pieceItemId,
      // 4dp matches the column; 0.5-per-1 and 1-per-12 both land exact.
      qtyPer: new Prisma.Decimal(qtyPerNum.toFixed(4)),
      perUnits: perUnitsNum,
      rounding,
      minQty,
      billing,
      clientVisible: r.clientVisible !== false,
      suppressIfOrdered: r.suppressIfOrdered !== false,
      note,
      isActive: r.isActive !== false,
      sortOrder: i,
    })
  }

  const dupe = rows.find((r, i) => rows.findIndex((o) => o.pieceItemId === r.pieceItemId) !== i)
  if (dupe) {
    return NextResponse.json(
      { error: 'the same accessory is listed twice — combine them into one row' },
      { status: 400 },
    )
  }

  // Every referenced piece must exist and be active: a kit promising an
  // archived row would silently expand to nothing at quote time.
  const pieceIds = rows.map((r) => r.pieceItemId)
  if (pieceIds.length > 0) {
    const found = await prisma.inventoryItem.findMany({
      where: { id: { in: pieceIds } },
      select: { id: true, isActive: true, code: true },
    })
    const byId = new Map(found.map((f) => [f.id, f]))
    for (const pid of pieceIds) {
      const f = byId.get(pid)
      if (!f) {
        return NextResponse.json({ error: 'accessory item not found' }, { status: 404 })
      }
      if (!f.isActive) {
        return NextResponse.json(
          { error: `${f.code} is archived — pick an active item` },
          { status: 400 },
        )
      }
    }
  }

  try {
    const kitPieces = await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryKitPiece.findMany({
        where: { parentItemId: id },
        select: { id: true, pieceItemId: true },
      })
      const keep = new Set(rows.map((r) => r.pieceItemId))
      const gone = existing.filter((e) => !keep.has(e.pieceItemId)).map((e) => e.id)
      if (gone.length > 0) {
        await tx.inventoryKitPiece.deleteMany({ where: { id: { in: gone } } })
      }
      for (const r of rows) {
        await tx.inventoryKitPiece.upsert({
          where: { parentItemId_pieceItemId: { parentItemId: id, pieceItemId: r.pieceItemId } },
          create: { parentItemId: id, ...r },
          update: r,
        })
      }
      return tx.inventoryKitPiece.findMany({
        where: { parentItemId: id },
        include: INCLUDE,
        orderBy: [{ sortOrder: 'asc' }],
      })
    })
    return NextResponse.json({ kitPieces })
  } catch (err) {
    console.error('[kit-pieces PUT] failed:', err)
    const message = err instanceof Error ? err.message : 'Save failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
