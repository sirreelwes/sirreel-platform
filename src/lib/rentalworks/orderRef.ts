import { prisma } from '@/lib/prisma'

/**
 * RW order NUMBER → internal OrderId resolution, with header caching.
 *
 * Why this exists: opening "RW order #304486" needs the internal id
 * (GET /api/v1/order/{OrderId} — the number 404s), RW's SPA has no
 * per-record URLs to deep-link (records open from in-memory state),
 * and every server-side filter shape on the browse endpoints 400s —
 * the same vendor defect the invoice and quote syncs document. So:
 * page the full order/browse (~4k rows, 500/page), upsert every
 * (number, id, header) into RwOrderRef, and serve lookups from the
 * mirror. One cache miss warms the entire table; subsequent misses
 * only rescan when the number is genuinely unknown (e.g. an order
 * created in RW minutes ago).
 *
 * Columns note: browse `Columns` are OBJECTS ({ Name, DataField, … }),
 * not strings — index by `Name`. Getting this wrong reads every field
 * as undefined and looks like an empty result set (verified live
 * 2026-08-22).
 */

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const PAGE_SIZE = 500
const MAX_PAGES = 40 // 20k orders — generous backstop

interface BrowsePayload {
  Columns?: Array<{ Name: string }>
  Rows?: unknown[][]
}

export interface RwOrderRefRow {
  rwOrderId: string
  orderNumber: string
  description: string | null
  customerName: string | null
  dealName: string | null
  status: string | null
  total: number | null
  orderDate: Date | null
}

function token(): string {
  const t = process.env.RENTALWORKS_TOKEN
  if (!t) throw new Error('RENTALWORKS_TOKEN env var not set')
  return t
}

async function scanAllOrders(): Promise<RwOrderRefRow[]> {
  const out: RwOrderRefRow[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${BASE_URL}/api/v1/order/browse`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageNo: page, pageSize: PAGE_SIZE }),
    })
    if (!res.ok) throw new Error(`order/browse p${page} → ${res.status}`)
    const j = (await res.json()) as BrowsePayload
    const names = (j.Columns ?? []).map((c) => c.Name)
    const idx = (n: string) => names.indexOf(n)
    const iId = idx('OrderId'), iNum = idx('OrderNumber'), iDesc = idx('Description'),
      iDeal = idx('Deal'), iCust = idx('Customer'), iStatus = idx('Status'),
      iTotal = idx('Total'), iDate = idx('OrderDate')
    const rows = j.Rows ?? []
    for (const r of rows) {
      const rwOrderId = String(r[iId] ?? '')
      const orderNumber = String(r[iNum] ?? '')
      if (!rwOrderId || !orderNumber) continue
      const totalRaw = iTotal >= 0 ? Number(r[iTotal]) : NaN
      const dateRaw = iDate >= 0 && r[iDate] ? new Date(String(r[iDate])) : null
      out.push({
        rwOrderId,
        orderNumber,
        description: iDesc >= 0 ? (r[iDesc] as string | null) : null,
        customerName: iCust >= 0 ? (r[iCust] as string | null) : null,
        dealName: iDeal >= 0 ? (r[iDeal] as string | null) : null,
        status: iStatus >= 0 ? (r[iStatus] as string | null) : null,
        total: Number.isFinite(totalRaw) ? totalRaw : null,
        orderDate: dateRaw && !Number.isNaN(dateRaw.getTime()) ? dateRaw : null,
      })
    }
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

async function upsertRefs(rows: RwOrderRefRow[]): Promise<void> {
  const now = new Date()
  // Bulk, not per-row: 3771 sequential upserts measured at ~8 MINUTES
  // against Neon (2026-08-22) — unacceptable inside a request. createMany
  // with skipDuplicates lands the whole set in seconds; the follow-up
  // updateMany refreshes headers for numbers we already knew. Chunked so
  // no single statement gets unwieldy.
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    await prisma.rwOrderRef.createMany({
      data: slice.map((r) => ({ ...r, syncedAt: now })),
      skipDuplicates: true,
    })
  }
  // NO per-row header refresh here. It would reintroduce the same
  // thousands-of-statements cost this function exists to avoid, and it
  // is not needed: the page renders the LIVE order (this mirror is only
  // the RW-is-down fallback, and the UI says so). Existing rows keep
  // their last-known header; the mapping itself — number → OrderId —
  // never changes.
}

/** Mirror-only lookup. Always fast (indexed); null when unknown locally. */
export async function lookupRwOrderByNumber(orderNumber: string) {
  return prisma.rwOrderRef.findFirst({ where: { orderNumber } })
}

/**
 * Full rescan + upsert. SLOW BY NATURE — measured 294s against the live
 * tenant (8 pages × 500, RW's own latency; the DB writes are a rounded
 * rounding error next to it). NEVER call this inside a request the user
 * is waiting on: a mistyped order number would cost them five minutes
 * to reach a 404. Fire-and-forget it on a miss, or run it from a cron.
 */
export async function warmRwOrderRefs(): Promise<number> {
  const all = await scanAllOrders()
  await upsertRefs(all)
  return all.length
}

/** In-flight guard so concurrent misses don't stack full rescans. */
let warming: Promise<number> | null = null
export function warmRwOrderRefsInBackground(): void {
  if (warming) return
  warming = warmRwOrderRefs()
    .catch((err) => {
      console.error('[rw-order-refs] background warm failed:', err)
      return 0
    })
    .finally(() => {
      warming = null
    }) as Promise<number>
}
