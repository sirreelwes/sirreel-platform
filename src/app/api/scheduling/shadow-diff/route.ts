/**
 * Shadow-mode availability diff — pulls Planyo's current answer and
 * the native engine's answer for the same category + window and
 * returns them side-by-side per unit name.
 *
 * Purpose (native-scheduling-v1-brief.md §"shadow mode"): eyeball the
 * native engine against Planyo across a couple of real weeks before
 * trusting it. Don't proceed to native-write chunks until the two
 * sides agree.
 *
 * Query params:
 *   categoryId  — UUID of AssetCategory (required)
 *   start       — YYYY-MM-DD            (required, inclusive)
 *   end         — YYYY-MM-DD            (required, inclusive)
 *   bufferDays  — int                    (optional, default 1)
 *
 * Notes:
 *   - Planyo doesn't model a buffer state. So native='buffer' and
 *     Planyo='available' are treated as AGREE (both renterable, just
 *     different colors of green).
 *   - Unit names are matched exactly between Planyo's
 *     `unit_assignment` and `Asset.unitName`. A mismatch in either
 *     direction is flagged as `name-only-on-X` so we know which side
 *     has data the other doesn't.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

const PLANYO_BASE = 'https://www.planyo.com/rest/'
const PLANYO_API_KEY = process.env.PLANYO_API_KEY || ''
const PLANYO_SITE_ID = process.env.PLANYO_SITE_ID || '36171'

function parseISODate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

async function planyoFetch(params: Record<string, string>) {
  const url = new URL(PLANYO_BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_key', PLANYO_API_KEY)
  url.searchParams.set('site_id', PLANYO_SITE_ID)
  url.searchParams.set('format', 'json')
  const res = await fetch(url.toString())
  return res.json()
}

interface PlanyoUnit {
  unitName: string
  available: boolean
  bookedBy: string | null
}

/**
 * Reproduces the relevant slice of /api/planyo/available-units: pulls
 * 6 months of historical reservations to discover unit names, then
 * the requested-window reservations to flag conflicts. Returns the
 * unit-level availability map keyed by `unit_assignment` string.
 */
async function fetchPlanyoUnits(
  planyoResourceId: number,
  startISO: string,
  endISO: string,
): Promise<{ units: PlanyoUnit[]; error?: string }> {
  if (!PLANYO_API_KEY) return { units: [], error: 'PLANYO_API_KEY not configured' }
  const historyFrom = new Date(); historyFrom.setMonth(historyFrom.getMonth() - 6)
  const historyTo = new Date(); historyTo.setMonth(historyTo.getMonth() + 3)
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

  const [historyData, requestedData] = await Promise.all([
    planyoFetch({
      method: 'list_reservations',
      resource_id: String(planyoResourceId),
      start_time: fmt(historyFrom),
      end_time: fmt(historyTo),
      results_per_page: '500',
      detail_level: '1',
    }),
    planyoFetch({
      method: 'list_reservations',
      resource_id: String(planyoResourceId),
      start_time: startISO + ' 00:00:00',
      end_time: endISO + ' 23:59:00',
      results_per_page: '500',
      detail_level: '1',
    }),
  ])

  const allHistorical = (historyData?.data?.results ?? []) as Array<{ unit_assignment?: string }>
  const inRange = (requestedData?.data?.results ?? []) as Array<{
    unit_assignment?: string
    start_time?: string
    end_time?: string
    first_name?: string
    last_name?: string
    properties?: { Company_Name?: string }
  }>

  const allUnitNames = new Set<string>()
  for (const r of allHistorical) if (r.unit_assignment) allUnitNames.add(r.unit_assignment)

  const bookedInRange = new Set<string>()
  const bookedByMap = new Map<string, string>()
  for (const r of inRange) {
    if (!r.unit_assignment) continue
    const rStart = (r.start_time || '').slice(0, 10)
    const rEnd = (r.end_time || '').slice(0, 10)
    if (rStart <= endISO && rEnd >= startISO) {
      bookedInRange.add(r.unit_assignment)
      const by = r.properties?.Company_Name || `${r.first_name || ''} ${r.last_name || ''}`.trim()
      if (by) bookedByMap.set(r.unit_assignment, by)
    }
  }

  const units: PlanyoUnit[] = [...allUnitNames].map((name) => ({
    unitName: name,
    available: !bookedInRange.has(name),
    bookedBy: bookedByMap.get(name) ?? null,
  }))
  return { units }
}

type Agreement =
  | 'agree-free'        // both renterable (planyo available + native free/buffer)
  | 'agree-booked'      // both say booked
  | 'planyo-says-booked-native-free'
  | 'native-says-booked-planyo-free'
  | 'name-only-planyo'  // unit known to Planyo but no matching Asset.unitName
  | 'name-only-native'  // Asset exists but no Planyo unit_assignment match

interface DiffRow {
  unitName: string
  planyo: { state: 'available' | 'booked' | 'unknown'; bookedBy: string | null }
  native: { state: 'free' | 'buffer' | 'booked' | 'unknown'; assetId: string | null; tier: string | null }
  agreement: Agreement
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

  const category = await prisma.assetCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, slug: true, planyoResourceId: true, totalUnits: true },
  })
  if (!category) return NextResponse.json({ error: 'category not found' }, { status: 404 })

  const startISO = start.toISOString().slice(0, 10)
  const endISO = end.toISOString().slice(0, 10)
  const effectiveBuffer = Number.isFinite(bufferDays) ? bufferDays : 1

  const [native, planyoResult] = await Promise.all([
    getCategoryAvailability(categoryId, start, end, effectiveBuffer),
    category.planyoResourceId
      ? fetchPlanyoUnits(category.planyoResourceId, startISO, endISO)
      : Promise.resolve({ units: [] as PlanyoUnit[], error: 'no planyoResourceId on category' as string | undefined }),
  ])

  // Build the union of unit names from both sides.
  const planyoByName = new Map<string, PlanyoUnit>()
  for (const u of planyoResult.units) planyoByName.set(u.unitName, u)

  const nativeByName = new Map<string, (typeof native.units)[number]>()
  for (const u of native.units) nativeByName.set(u.unitName, u)

  const allNames = new Set<string>([...planyoByName.keys(), ...nativeByName.keys()])

  const rows: DiffRow[] = [...allNames]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((unitName) => {
      const p = planyoByName.get(unitName)
      const n = nativeByName.get(unitName)
      const planyoState: DiffRow['planyo']['state'] = p ? (p.available ? 'available' : 'booked') : 'unknown'
      const nativeState: DiffRow['native']['state'] = n ? n.state : 'unknown'

      let agreement: Agreement
      if (!p && n) agreement = 'name-only-native'
      else if (p && !n) agreement = 'name-only-planyo'
      else if (planyoState === 'booked' && nativeState === 'booked') agreement = 'agree-booked'
      else if (planyoState === 'available' && (nativeState === 'free' || nativeState === 'buffer')) agreement = 'agree-free'
      else if (planyoState === 'booked' && (nativeState === 'free' || nativeState === 'buffer')) agreement = 'planyo-says-booked-native-free'
      else if (planyoState === 'available' && nativeState === 'booked') agreement = 'native-says-booked-planyo-free'
      else agreement = 'name-only-planyo' // fallthrough; shouldn't reach here

      return {
        unitName,
        planyo: { state: planyoState, bookedBy: p?.bookedBy ?? null },
        native: { state: nativeState, assetId: n?.assetId ?? null, tier: n?.tier ?? null },
        agreement,
      }
    })

  const counts = rows.reduce<Record<Agreement, number>>(
    (acc, r) => {
      acc[r.agreement] = (acc[r.agreement] ?? 0) + 1
      return acc
    },
    {
      'agree-free': 0,
      'agree-booked': 0,
      'planyo-says-booked-native-free': 0,
      'native-says-booked-planyo-free': 0,
      'name-only-planyo': 0,
      'name-only-native': 0,
    },
  )

  return NextResponse.json({
    ok: true,
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      planyoResourceId: category.planyoResourceId,
      totalUnits: category.totalUnits,
    },
    window: { start: startISO, end: endISO, bufferDays: effectiveBuffer },
    nativeSummary: {
      serviceableCount: native.serviceableCount,
      freeCount: native.freeCount,
      bufferCount: native.bufferCount,
      bookedCount: native.bookedCount,
      availableToHold: native.availableToHold,
    },
    planyoError: planyoResult.error ?? null,
    counts,
    rows,
  })
}
