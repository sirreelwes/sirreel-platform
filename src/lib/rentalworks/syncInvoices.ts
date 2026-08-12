import { prisma } from '@/lib/prisma'

/**
 * Bulk-pull RentalWorks invoices into the HQ mirror (sr_rw_invoices).
 *
 * WHY a mirror rather than a live fetch:
 *  - RW's invoice/browse supports NO server-side filtering. Every
 *    searchFields query 400s (verified, even on Status), so we cannot ask
 *    for "invoices for customer X" — it's all-or-nothing paging.
 *  - Live-fetching on page load is also how the existing RW dashboards
 *    silently render $0 when the token expires. Reading a mirror with a
 *    visible syncedAt is honest: stale data announces itself.
 *
 * Safety: the full pull is completed IN MEMORY first. Only if every page
 * succeeded do we replace the table, so a mid-pull failure can never wipe
 * the mirror.
 */

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const PAGE_SIZE = 200
const MAX_PAGES = 60 // 12k invoices — generous backstop against a runaway loop

export interface RwInvoiceSyncResult {
  ok: boolean
  pulled: number
  pages: number
  error?: string
  /** Days until RENTALWORKS_TOKEN expires — negative once lapsed, null when
   *  the token carries no readable `exp`. Drives the early warning. */
  tokenDaysLeft?: number | null
}

type BrowseResponse = {
  ColumnIndex?: Record<string, number>
  Rows?: unknown[][]
  TotalRows?: number
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
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

/**
 * How long the RentalWorks token has left, read from its own JWT `exp` claim.
 *
 * The token is a bearer JWT that expires on a fixed date with no refresh
 * mechanism, so the sync dies the moment it lapses. It expired 2026-06-13 and
 * the mirror silently served stale balances for weeks, because the only
 * symptom of a failed sync is numbers that are quietly wrong.
 *
 * Decoding locally, never by calling RW: this must work even when the token
 * is already dead, and it turns a two-week outage into a week's notice.
 *
 * Returns null when there is no readable `exp` — a token we cannot reason
 * about should not produce false reassurance.
 */
export function rwTokenExpiry(token: string | undefined): Date | null {
  if (!token) return null
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString())
    return typeof payload?.exp === 'number' ? new Date(payload.exp * 1000) : null
  } catch {
    return null
  }
}

/** Days until the token expires; negative once it has. */
export function rwTokenDaysLeft(token: string | undefined): number | null {
  const exp = rwTokenExpiry(token)
  if (!exp) return null
  return Math.floor((exp.getTime() - Date.now()) / 86_400_000)
}

export async function syncRwInvoices(): Promise<RwInvoiceSyncResult> {
  const token = process.env.RENTALWORKS_TOKEN
  if (!token) return { ok: false, pulled: 0, pages: 0, error: 'RENTALWORKS_TOKEN not set' }

  // Named before the request so the failure says WHY rather than "HTTP 401",
  // which is what sent this one undiagnosed for weeks.
  const daysLeft = rwTokenDaysLeft(token)
  if (daysLeft != null && daysLeft < 0) {
    return {
      ok: false,
      pulled: 0,
      pages: 0,
      error: `RENTALWORKS_TOKEN expired ${Math.abs(daysLeft)} days ago (${rwTokenExpiry(token)?.toISOString().slice(0, 10)}) — a new token is needed from RentalWorks.`,
    }
  }

  const rows: Array<Record<string, unknown>> = []
  let page = 1

  while (page <= MAX_PAGES) {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}/api/v1/invoice/browse`, {
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
      // 401/403 => token expired. Do NOT touch the mirror.
      return { ok: false, pulled: 0, pages: page - 1, error: `RW HTTP ${res.status}` }
    }
    const body = (await res.json().catch(() => ({}))) as BrowseResponse
    const ci = body.ColumnIndex
    const pageRows = body.Rows ?? []
    if (!ci) return { ok: false, pulled: 0, pages: page - 1, error: 'unexpected RW response shape' }

    const get = (r: unknown[], col: string) => (ci[col] == null ? null : r[ci[col]])
    for (const r of pageRows) {
      const rwInvoiceId = str(get(r, 'InvoiceId'))
      if (!rwInvoiceId) continue
      rows.push({
        rwInvoiceId,
        invoiceNumber: str(get(r, 'InvoiceNumber')),
        invoiceType: str(get(r, 'InvoiceType')),
        status: str(get(r, 'Status')),
        invoiceDate: date(get(r, 'InvoiceDate')),
        dueDate: date(get(r, 'InvoiceDueDate')),
        rwOrderId: str(get(r, 'OrderId')),
        orderNumber: str(get(r, 'OrderNumber')),
        rwCustomerId: str(get(r, 'CustomerId')),
        customerName: str(get(r, 'Customer')),
        poNumber: str(get(r, 'PurchaseOrderNumber')),
        dealName: str(get(r, 'Deal')),
        dealNumber: str(get(r, 'DealNumber')),
        orderDescription: str(get(r, 'OrderDescription')),
        invoiceDescription: str(get(r, 'InvoiceDescription')),
        agent: str(get(r, 'Agent')),
        billingStartDate: date(get(r, 'BillingStartDate')),
        billingEndDate: date(get(r, 'BillingEndDate')),
        orderDate: date(get(r, 'OrderDate')),
        invoiceTotal: num(get(r, 'InvoiceTotal')),
        receivedTotal: num(get(r, 'ReceivedTotal')),
        remainingTotal: num(get(r, 'RemainingTotal')),
      })
    }
    if (pageRows.length < PAGE_SIZE) break
    page++
  }

  // Whole pull succeeded — swap the mirror atomically.
  const syncedAt = new Date()
  const data = rows.map((r) => ({ ...r, syncedAt }))
  await prisma.$transaction([
    prisma.rwInvoice.deleteMany({}),
    ...chunk(data, 1000).map((c) =>
      prisma.rwInvoice.createMany({ data: c as never, skipDuplicates: true }),
    ),
  ])

  return {
    ok: true,
    pulled: rows.length,
    pages: page,
    // Passed up so the caller can warn BEFORE the token lapses rather than
    // discovering it from a fortnight of wrong balances.
    tokenDaysLeft: daysLeft,
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
