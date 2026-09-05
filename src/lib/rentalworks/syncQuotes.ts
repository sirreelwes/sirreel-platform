import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { rwFetch } from '@/lib/rentalworks/rwClient'
import { runPagedSync } from '@/lib/rentalworks/pagedSync'

/**
 * Bulk-pull RentalWorks QUOTES into the HQ mirror (sr_rw_quotes).
 *
 * WHY (Wes, 2026-08-22): a quote made in RW was invisible to HQ until it
 * produced its first invoice — usually after the job already ran — so the
 * reconcile queue couldn't connect the money to the HQ job until weeks
 * late. RW quotes share the order-number sequence and keep their number
 * on conversion (verified live 2026-08-22: quote 304485 → order 304485,
 * `ConvertedToOrderNumber` === `QuoteNumber`), so a quote-time JobRwOrder
 * link is future-proof.
 *
 * ENDPOINT: GET /api/v1/quote (paginated Items[]), the same style as
 * /api/v1/item. NOT the browse POST — /api/v1/quote/browse 500s
 * server-side with RW's own SQL error ("Invalid column name 'orderid'",
 * verified 2026-08-22), so it is unusable regardless of the request.
 * Field names below are verified against the live response.
 *
 * PAGING (rewritten 2026-09-03): resumable, via lib/rentalworks/pagedSync.
 * The previous shape — pull everything into memory, then replace the table
 * — could not finish. RW's quote endpoint degrades with depth (4.8s for
 * page 1, 31s by page 14; 331.9s for the full 15 pages, measured), against
 * a 300s function ceiling. The run was killed mid-await every night, so
 * nothing committed and nothing was logged, and the mirror sat frozen from
 * 2026-08-22 until someone went looking. Each page now commits as it lands
 * and the next run resumes where this one stopped.
 */

const PAGE_SIZE = 200
const MAX_PAGES = 40 // 8k quotes — backstop; ~2.8k exist as of 2026-08-22

export interface RwQuoteSyncResult {
  ok: boolean
  /** Rows committed by THIS run (a resumed cycle spans several). */
  pulled: number
  pages: number
  /** True when this run reached the last page and closed the cycle. */
  complete: boolean
  /** True when this run continued an unfinished cycle. */
  resumed: boolean
  nextPage: number
  swept: number
  error?: string
}

/** The slice of RW's ~400-field quote object that we read. */
interface RwQuoteItem {
  QuoteId?: string
  QuoteNumber?: string
  QuoteDate?: string
  Status?: string
  ConvertedToOrder?: boolean
  ConvertedToOrderNumber?: string
  CustomerId?: string
  Customer?: string
  Deal?: string
  DealNumber?: string
  Description?: string
  JobName?: string
  DealType?: string
  Agent?: string
  EstimatedStartDate?: string
  EstimatedStopDate?: string
  Total?: number | string
  InvoicedAmount?: number | string
}

type ItemsResponse = { Items?: RwQuoteItem[]; TotalItems?: number }

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim()
  return s.length ? s.slice(0, 300) : null
}

function date(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export interface RwQuoteRow {
  rwQuoteId: string
  [k: string]: unknown
}

/** One RW quote object → the mirror row we keep. */
function toRow(q: RwQuoteItem): RwQuoteRow | null {
  const rwQuoteId = str(q.QuoteId)
  if (!rwQuoteId) return null
  const quoteNumber = str(q.QuoteNumber)
  return {
    rwQuoteId,
    quoteNumber,
    // The number the invoices will eventually carry. Conversion keeps
    // the quote's number, so pre-conversion the QuoteNumber IS the
    // future order number.
    orderNumber: str(q.ConvertedToOrderNumber) ?? quoteNumber,
    status: str(q.Status),
    quoteDate: date(q.QuoteDate),
    rwCustomerId: str(q.CustomerId),
    customerName: str(q.Customer),
    dealName: str(q.Deal),
    dealNumber: str(q.DealNumber),
    description: str(q.Description),
    agent: str(q.Agent),
    startDate: date(q.EstimatedStartDate),
    endDate: date(q.EstimatedStopDate),
    total: num(q.Total),
    // Curated extras — the full RW object is ~400 fields; keep only
    // the ones with obvious future use.
    raw: {
      ConvertedToOrder: q.ConvertedToOrder ?? null,
      ConvertedToOrderNumber: q.ConvertedToOrderNumber ?? null,
      JobName: q.JobName ?? null,
      DealType: q.DealType ?? null,
      InvoicedAmount: q.InvoicedAmount ?? null,
    },
  }
}

/**
 * Pull RW quotes into the mirror, resuming an unfinished cycle if there
 * is one. Safe to call repeatedly: a run that hits its budget simply
 * advances the cursor.
 *
 * `budgetMs` defaults below the 300s route ceiling with room for RW's
 * slowest observed page (~47s) plus the sweep.
 */
export async function syncRwQuotes(opts?: { budgetMs?: number }): Promise<RwQuoteSyncResult> {
  const r = await runPagedSync<RwQuoteRow>({
    mirror: 'quote',
    maxPages: MAX_PAGES,
    budgetMs: opts?.budgetMs ?? 210_000,

    async fetchPage(page) {
      const res = await rwFetch(`/api/v1/quote?pageNo=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) {
        // 401/403 never reaches here — rwFetch raises RwAuthError first.
        throw new Error(`RW HTTP ${res.status} on GET /api/v1/quote`)
      }
      const body = (await res.json().catch(() => ({}))) as ItemsResponse
      const items = body.Items ?? []
      const rows = items.map(toRow).filter((x): x is RwQuoteRow => x !== null)
      return { rows, last: items.length < PAGE_SIZE }
    },

    async commitPage(rows, cycleStartedAt) {
      if (!rows.length) return
      // ONE statement per page, idempotent by rwQuoteId: a resumed cycle
      // re-fetches the page it stopped on, and RW can hand the same
      // record back on two pages as rows shift underneath the paging.
      //
      // NOT a loop of upserts, and no longer createMany + N parallel
      // updateMany either. Sequential per-row upserts were ~8 MINUTES for
      // 3,771 rows against Neon (2026-08-22). The parallel-update shape
      // that replaced them looked fine locally and was the reason the
      // ORDER mirror silently froze for two days on Vercel — 500 parallel
      // statements never finished inside the function ceiling, and a
      // killed function runs no catch (2026-09-05, see orderRef.ts). One
      // upsert is a single round trip whatever the page size.
      const values = rows.map(
        (r) => Prisma.sql`(gen_random_uuid(), ${r.rwQuoteId}, ${r.quoteNumber as string | null}, ${r.orderNumber as string | null}, ${r.status as string | null}, ${r.quoteDate as Date | null}, ${r.rwCustomerId as string | null}, ${r.customerName as string | null}, ${r.dealName as string | null}, ${r.dealNumber as string | null}, ${r.description as string | null}, ${r.agent as string | null}, ${r.startDate as Date | null}, ${r.endDate as Date | null}, ${r.total as number | null}, ${r.raw == null ? null : JSON.stringify(r.raw)}::jsonb, ${cycleStartedAt})`,
      )
      await prisma.$executeRaw`
        INSERT INTO sr_rw_quotes
          (id, rw_quote_id, quote_number, order_number, status, quote_date, rw_customer_id,
           customer_name, deal_name, deal_number, description, agent, start_date, end_date,
           total, raw, synced_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (rw_quote_id) DO UPDATE SET
          quote_number   = EXCLUDED.quote_number,
          order_number   = EXCLUDED.order_number,
          status         = EXCLUDED.status,
          quote_date     = EXCLUDED.quote_date,
          rw_customer_id = EXCLUDED.rw_customer_id,
          customer_name  = EXCLUDED.customer_name,
          deal_name      = EXCLUDED.deal_name,
          deal_number    = EXCLUDED.deal_number,
          description    = EXCLUDED.description,
          agent          = EXCLUDED.agent,
          start_date     = EXCLUDED.start_date,
          end_date       = EXCLUDED.end_date,
          total          = EXCLUDED.total,
          raw            = EXCLUDED.raw,
          synced_at      = EXCLUDED.synced_at
      `
    },

    async sweep(cycleStartedAt) {
      const res = await prisma.rwQuote.deleteMany({ where: { syncedAt: { lt: cycleStartedAt } } })
      return res.count
    },

    countExisting: () => prisma.rwQuote.count(),
  })

  return {
    ok: r.ok,
    pulled: r.rowsThisRun,
    pages: r.pagesThisRun,
    complete: r.complete,
    resumed: r.resumed,
    nextPage: r.nextPage,
    swept: r.swept,
    error: r.error,
  }
}
