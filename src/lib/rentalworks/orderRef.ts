import { prisma } from '@/lib/prisma'
import { rwFetch } from '@/lib/rentalworks/rwClient'
import { runPagedSync } from '@/lib/rentalworks/pagedSync'

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

/** One browse page → mirror rows. Columns are OBJECTS keyed by `Name`. */
function rowsFromPage(j: BrowsePayload): RwOrderRefRow[] {
  const out: RwOrderRefRow[] = []
  const names = (j.Columns ?? []).map((c) => c.Name)
  const idx = (n: string) => names.indexOf(n)
  const iId = idx('OrderId'), iNum = idx('OrderNumber'), iDesc = idx('Description'),
    iDeal = idx('Deal'), iCust = idx('Customer'), iStatus = idx('Status'),
    iTotal = idx('Total'), iDate = idx('OrderDate')
  for (const r of j.Rows ?? []) {
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
  return out
}

export interface RwOrderRefSyncResult {
  ok: boolean
  pulled: number
  pages: number
  complete: boolean
  resumed: boolean
  nextPage: number
  swept: number
  error?: string
}

/**
 * Refresh the whole order mirror, resumably.
 *
 * Before 2026-09-03 the ONLY caller of this was a fire-and-forget
 * `warmRwOrderRefsInBackground()` fired from the by-number route — and
 * Vercel freezes a function once its response is sent, so a scan this
 * file's own comment measures at ~294s could not finish. There was no
 * cron either. The mirror therefore only moved when someone ran it by
 * hand, and sat 12 days stale by the time anyone looked (2026-09-03).
 *
 * It now runs on its own schedule (/api/cron/rw-order-refs) through the
 * resumable pager, so a run that exceeds its budget continues next time
 * instead of losing everything it pulled.
 */
export async function syncRwOrderRefs(opts?: { budgetMs?: number }): Promise<RwOrderRefSyncResult> {
  const r = await runPagedSync<RwOrderRefRow>({
    mirror: 'orderRef',
    maxPages: MAX_PAGES,
    budgetMs: opts?.budgetMs ?? 210_000,

    async fetchPage(page) {
      const res = await rwFetch('/api/v1/order/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNo: page, pageSize: PAGE_SIZE }),
      })
      if (!res.ok) throw new Error(`order/browse p${page} → ${res.status}`)
      const j = (await res.json()) as BrowsePayload
      const raw = j.Rows ?? []
      return { rows: rowsFromPage(j), last: raw.length < PAGE_SIZE }
    },

    async commitPage(rows, cycleStartedAt) {
      if (!rows.length) return
      // Bulk create for the new ones, then a per-row header refresh for
      // the rest. Sequential upserts were measured at ~8 MINUTES for
      // 3,771 rows against Neon (2026-08-22) — createMany lands the set
      // in seconds and the updates only touch what already existed.
      await prisma.rwOrderRef.createMany({
        data: rows.map((r) => ({ ...r, syncedAt: cycleStartedAt })),
        skipDuplicates: true,
      })
      await Promise.all(
        rows.map((r) =>
          prisma.rwOrderRef.updateMany({
            where: { rwOrderId: r.rwOrderId },
            data: {
              orderNumber: r.orderNumber,
              description: r.description,
              customerName: r.customerName,
              dealName: r.dealName,
              status: r.status,
              total: r.total,
              orderDate: r.orderDate,
              syncedAt: cycleStartedAt,
            },
          }),
        ),
      )
    },

    async sweep(cycleStartedAt) {
      const res = await prisma.rwOrderRef.deleteMany({ where: { syncedAt: { lt: cycleStartedAt } } })
      return res.count
    },

    countExisting: () => prisma.rwOrderRef.count(),
  })

  return {
    ok: r.ok, pulled: r.rowsThisRun, pages: r.pagesThisRun, complete: r.complete,
    resumed: r.resumed, nextPage: r.nextPage, swept: r.swept, error: r.error,
  }
}

/** Mirror-only lookup. Always fast (indexed); null when unknown locally. */
export async function lookupRwOrderByNumber(orderNumber: string) {
  return prisma.rwOrderRef.findFirst({ where: { orderNumber } })
}

/*
 * warmRwOrderRefs() / warmRwOrderRefsInBackground() lived here until
 * 2026-09-03.
 *
 * The background variant was fired from the by-number route on a cache
 * miss and never awaited. Vercel freezes a function the moment its
 * response is sent, so a ~294s full scan started that way is killed
 * within milliseconds of the user getting their 200 — it did not warm
 * anything, and its `catch` never ran either, so it also never said so.
 * That is why the order mirror was 12 days stale on 2026-09-03 while
 * looking like it had a refresh path.
 *
 * The scan is now a scheduled, resumable job: syncRwOrderRefs() above,
 * driven by /api/cron/rw-order-refs. A number missing from the mirror is
 * reported to the user as missing rather than silently "warming".
 */
