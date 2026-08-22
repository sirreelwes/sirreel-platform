import { prisma } from '@/lib/prisma'

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
 * Same safety model as syncInvoices: the full pull completes IN MEMORY
 * first; only a fully-successful pull replaces the table.
 */

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const PAGE_SIZE = 200
const MAX_PAGES = 40 // 8k quotes — backstop; ~2.8k exist as of 2026-08-22

export interface RwQuoteSyncResult {
  ok: boolean
  pulled: number
  pages: number
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

export async function syncRwQuotes(): Promise<RwQuoteSyncResult> {
  const token = process.env.RENTALWORKS_TOKEN
  if (!token) return { ok: false, pulled: 0, pages: 0, error: 'RENTALWORKS_TOKEN not set' }

  const rows: Array<Record<string, unknown>> = []
  let page = 1

  while (page <= MAX_PAGES) {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}/api/v1/quote?pageNo=${page}&pageSize=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
    } catch (e) {
      return { ok: false, pulled: 0, pages: page - 1, error: `network: ${(e as Error).message}` }
    }
    if (!res.ok) {
      const actionable =
        res.status === 401 || res.status === 403
          ? `RentalWorks rejected the token (HTTP ${res.status}) — rotate it: docs/runbooks/rentalworks-token-rotation.md`
          : `RW HTTP ${res.status} on GET /api/v1/quote`
      return { ok: false, pulled: 0, pages: page - 1, error: actionable }
    }

    const body = (await res.json().catch(() => ({}))) as ItemsResponse
    const items = body.Items ?? []

    for (const q of items) {
      const rwQuoteId = str(q.QuoteId)
      if (!rwQuoteId) continue
      const quoteNumber = str(q.QuoteNumber)
      rows.push({
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
      })
    }
    if (items.length < PAGE_SIZE) break
    page++
  }

  const syncedAt = new Date()
  const data = rows.map((r) => ({ ...r, syncedAt }))
  const chunks: Array<typeof data> = []
  for (let i = 0; i < data.length; i += 1000) chunks.push(data.slice(i, i + 1000))
  await prisma.$transaction([
    prisma.rwQuote.deleteMany({}),
    ...chunks.map((c) => prisma.rwQuote.createMany({ data: c as never, skipDuplicates: true })),
  ])

  return { ok: true, pulled: rows.length, pages: page }
}
