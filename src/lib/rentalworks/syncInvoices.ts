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

/*
 * There is deliberately no rwTokenExpiry()/rwTokenDaysLeft() here any more.
 *
 * They decoded the JWT `exp` claim to predict rotation. RentalWorks stamps
 * every token with a 300-second `exp` and then honours it for weeks, so the
 * number they returned was always "expired" — it drove a pre-flight guard that
 * blocked the sync entirely and an "expires soon" alert that could never be
 * satisfied by rotating.
 *
 * A token's health is knowable only by using it. The sync reports 401/403 from
 * the gateway; that is the signal. See docs/runbooks/rentalworks-token-rotation.md.
 */

export async function syncRwInvoices(): Promise<RwInvoiceSyncResult> {
  const token = process.env.RENTALWORKS_TOKEN
  if (!token) return { ok: false, pulled: 0, pages: 0, error: 'RENTALWORKS_TOKEN not set' }

  // NO pre-flight expiry check. There used to be one here, refusing to run
  // when the token's `exp` claim was in the past, on the reasonable-sounding
  // theory that a doomed request is worth skipping.
  //
  // RentalWorks stamps every token with a 300-SECOND `exp` and then honours it
  // for weeks — the server tracks its own session and the claim is not what it
  // enforces. Measured 2026-08-16: the token rotated that day had `exp` five
  // minutes after issue, and the same token authenticated fine (HTTP 200
  // against /api/v1/item and /api/v1/invoice/browse).
  //
  // So the guard was permanently true. The sync could not run with ANY token,
  // however fresh, and emailed a "token expired, get a new one" alert nightly
  // that no rotation could ever satisfy. The invoice mirror sat 21 days stale
  // while Collections and Receivables served balances from it.
  //
  // The gateway is the only authority on whether a token works. Ask it.

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
      // Do NOT touch the mirror on any failure — a partial pull would look
      // like a real balance set.
      //
      // 401/403 is the ONLY signal that the token needs rotating, now that the
      // `exp` claim is known to be meaningless. It carries the instruction,
      // because "RW HTTP 401" in an inbox tells a reader nothing about what to
      // do next, and this alert is read by whoever is on call rather than by
      // whoever wrote it.
      const actionable =
        res.status === 401 || res.status === 403
          ? `RentalWorks rejected the token (HTTP ${res.status}) — rotate it: docs/runbooks/rentalworks-token-rotation.md`
          : `RW HTTP ${res.status}`
      return { ok: false, pulled: 0, pages: page - 1, error: actionable }
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

  // Record payment EVENTS the mirror itself cannot keep: the first sync that
  // sees an invoice fully received writes one observation row, and that date
  // is the payment date at sync granularity. Feeds days-to-pay per client.
  // Never blocks the sync — the mirror is the product, observations are the
  // byproduct. Paid = received the full total, and not VOID: a voided
  // invoice's balance going to zero is a cancellation, not a payment.
  try {
    const paidNow = rows.filter(
      (r) =>
        Number(r.remainingTotal) <= 0 &&
        Number(r.receivedTotal) > 0 &&
        r.status !== 'VOID',
    )
    if (paidNow.length > 0) {
      const seen = new Set(
        (
          await prisma.rwInvoicePaidObservation.findMany({
            where: { rwInvoiceId: { in: paidNow.map((r) => r.rwInvoiceId as string) } },
            select: { rwInvoiceId: true },
          })
        ).map((o) => o.rwInvoiceId),
      )
      const fresh = paidNow.filter((r) => !seen.has(r.rwInvoiceId as string))
      if (fresh.length > 0) {
        await prisma.rwInvoicePaidObservation.createMany({
          data: fresh.map((r) => ({
            rwInvoiceId: r.rwInvoiceId as string,
            invoiceNumber: (r.invoiceNumber as string | null) ?? null,
            customerName: (r.customerName as string | null) ?? null,
            rwCustomerId: (r.rwCustomerId as string | null) ?? null,
            invoiceDate: (r.invoiceDate as Date | null) ?? null,
            dueDate: (r.dueDate as Date | null) ?? null,
            invoiceTotal: Number(r.invoiceTotal ?? 0),
            observedPaidAt: syncedAt,
          })),
          skipDuplicates: true,
        })
        console.log(`[rw-sync] recorded ${fresh.length} new paid observation(s)`)
      }
    }
  } catch (err) {
    console.error('[rw-sync] paid-observation capture failed (sync unaffected):', err)
  }

  return {
    ok: true,
    pulled: rows.length,
    pages: page,
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
