import { prisma } from '@/lib/prisma'

/**
 * Bulk-pull RentalWorks QUOTES into the HQ mirror (sr_rw_quotes).
 *
 * WHY (Wes, 2026-08-22): a quote made in RW was invisible to HQ until it
 * produced its first invoice — usually after the job already ran — so the
 * reconcile queue couldn't connect the money to the HQ job until weeks
 * late. RW quotes share the order-number sequence (the number survives
 * conversion to an order), so a quote-time JobRwOrder link is future-proof.
 *
 * Same safety model as syncInvoices: full pull completes IN MEMORY first;
 * only a fully-successful pull replaces the table. Same browse envelope
 * ({ColumnIndex, Rows}); no server-side filtering exists.
 *
 * DEFENSIVE COLUMN MAPPING: this endpoint's exact column set could not be
 * verified from a dev token (local token stale; see the rotation runbook),
 * so each field tries several candidate column names, and `raw` stores the
 * complete named row — nothing is lost if RW names a column differently,
 * and the mapping can be tightened from real rows after the first prod
 * sync. A completely unmapped response still syncs (raw-only rows).
 */

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const PAGE_SIZE = 200
const MAX_PAGES = 40

export interface RwQuoteSyncResult {
  ok: boolean
  pulled: number
  pages: number
  error?: string
}

type BrowseResponse = {
  ColumnIndex?: Record<string, number>
  Rows?: unknown[][]
  TotalRows?: number
}

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
      res = await fetch(`${BASE_URL}/api/v1/quote/browse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ pageNo: page, pageSize: PAGE_SIZE, searchFields: [] }),
      })
    } catch (e) {
      return { ok: false, pulled: 0, pages: page - 1, error: `network: ${(e as Error).message}` }
    }
    if (!res.ok) {
      const actionable =
        res.status === 401 || res.status === 403
          ? `RentalWorks rejected the token (HTTP ${res.status}) — rotate it: docs/runbooks/rentalworks-token-rotation.md`
          : `RW HTTP ${res.status} on quote/browse`
      return { ok: false, pulled: 0, pages: page - 1, error: actionable }
    }

    const body = (await res.json().catch(() => ({}))) as BrowseResponse
    const ci = body.ColumnIndex
    const pageRows = body.Rows ?? []
    if (!ci) return { ok: false, pulled: 0, pages: page - 1, error: 'unexpected RW response shape (no ColumnIndex)' }

    // First matching candidate column wins; `raw` keeps everything.
    const pick = (r: unknown[], candidates: string[]) => {
      for (const c of candidates) {
        if (ci[c] != null) return r[ci[c]]
      }
      return null
    }
    const named = (r: unknown[]) =>
      Object.fromEntries(Object.entries(ci).map(([col, idx]) => [col, r[idx as number]]))

    for (const r of pageRows) {
      const rwQuoteId = str(pick(r, ['QuoteId', 'OrderId', 'Id']))
      if (!rwQuoteId) continue
      rows.push({
        rwQuoteId,
        quoteNumber: str(pick(r, ['QuoteNumber', 'OrderNumber'])),
        orderNumber: str(pick(r, ['OrderNumber', 'QuoteNumber'])),
        status: str(pick(r, ['Status', 'QuoteStatus'])),
        quoteDate: date(pick(r, ['QuoteDate', 'OrderDate'])),
        rwCustomerId: str(pick(r, ['CustomerId'])),
        customerName: str(pick(r, ['Customer', 'CustomerName'])),
        dealName: str(pick(r, ['Deal', 'DealName'])),
        dealNumber: str(pick(r, ['DealNumber'])),
        description: str(pick(r, ['OrderDescription', 'QuoteDescription', 'Description'])),
        agent: str(pick(r, ['Agent'])),
        startDate: date(pick(r, ['EstimatedStartDate', 'BillingStartDate', 'StartDate'])),
        endDate: date(pick(r, ['EstimatedStopDate', 'BillingEndDate', 'StopDate', 'EndDate'])),
        total: num(pick(r, ['Total', 'OrderTotal', 'QuoteTotal', 'EstimatedTotal'])),
        raw: named(r),
      })
    }
    if (pageRows.length < PAGE_SIZE) break
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
