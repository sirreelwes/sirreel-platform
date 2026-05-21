/**
 * Native availability — single-category. Thin HTTP wrapper around
 * `getCategoryAvailability` from `src/lib/scheduling/availability.ts`.
 *
 * Query params:
 *   categoryId  — UUID of AssetCategory  (required)
 *   start       — YYYY-MM-DD              (required, inclusive)
 *   end         — YYYY-MM-DD              (required, inclusive)
 *   bufferDays  — integer                 (optional, default 1)
 *
 * Shadow-mode read-only — does NOT create holds or assignments. The
 * frontend uses this to ask "what would native say right now?"
 * alongside Planyo's answer.
 */
import { NextResponse } from 'next/server'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

function parseISODate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const categoryId = url.searchParams.get('categoryId')
  const start = parseISODate(url.searchParams.get('start'))
  const end = parseISODate(url.searchParams.get('end'))
  const bufferDays = parseInt(url.searchParams.get('bufferDays') ?? '1', 10)

  if (!categoryId) return NextResponse.json({ error: 'categoryId required' }, { status: 400 })
  if (!start || !end) return NextResponse.json({ error: 'start and end (YYYY-MM-DD) required' }, { status: 400 })
  if (end < start) return NextResponse.json({ error: 'end must be >= start' }, { status: 400 })

  const result = await getCategoryAvailability(categoryId, start, end, Number.isFinite(bufferDays) ? bufferDays : 1)
  return NextResponse.json({ ok: true, ...result })
}
