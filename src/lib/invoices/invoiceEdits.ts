/**
 * What a biller may change ON an invoice, as opposed to on the order it
 * bills.
 *
 * Ana, 2026-09-17: "how do I update an invoice from my side?"
 *
 * Most corrections are not invoice edits at all. The figures on an invoice
 * are a snapshot of the order, so a wrong rate, a missing line or a discount
 * that landed late is fixed on the ORDER and then pulled through with
 * "Update figures from the order" (the regenerate route), which keeps the
 * number the client already has. That path existed; it just lived on the job
 * page, two screens from the collections desk.
 *
 * What had NO path anywhere is the handful of facts that live on the invoice
 * and nowhere else, because no order edit can produce them:
 *
 *   · the DUE DATE — SirReel bills due-on-receipt, so the generator stamps
 *     the issue date. A client with negotiated terms, or one given an
 *     extension on the phone, needs a different date on the document, and
 *     that date is what every aging figure in HQ counts from.
 *   · the NOTE that prints on the invoice — the client's PO number, a remit
 *     instruction, "corrected 9/17 per Ana". This is the field a disputed
 *     invoice actually needs.
 *
 * Deliberately NOT editable here: subtotal, tax, total, line items, status,
 * amount paid. Those are either the order's to say or a payment's to say,
 * and an invoice whose total can be typed over is not a document anyone can
 * reconcile. If the money is wrong, fix the order or void and re-cut.
 *
 * Pure — no prisma, no I/O — so the route, the audit line and the test all
 * read the same rules. `npm run test:invoice-edits`.
 */

/** Longest note we will print on the document. Past this it is not a note. */
export const INVOICE_NOTE_MAX = 2000

export interface InvoiceEditCurrent {
  status: string
  dueDate: Date | null
  notes: string | null
  /** Whether the invoice carries the stored line snapshot the PDF is
   *  re-rendered from. Invoices cut before snapshots existed have none. */
  hasSnapshot: boolean
}

export interface InvoiceEditInput {
  /** 'YYYY-MM-DD', or null/'' to clear. Absent = leave alone. */
  dueDate?: unknown
  /** The printed note, or null/'' to clear. Absent = leave alone. */
  notes?: unknown
}

export interface InvoiceEditPlan {
  dueDate?: Date | null
  notes?: string | null
  /** True when at least one field actually moves. */
  changed: boolean
  /**
   * Whether the stored PDF has to be re-rendered and replaced.
   *
   * A PAID invoice is rendered ON DEMAND from its snapshot every time it is
   * opened (the PAID stamp), so an edit reaches the document without
   * touching the blob. Everything else is served from the stored blob, and
   * a row that disagrees with the PDF the client downloads is worse than no
   * edit at all.
   */
  needsRerender: boolean
  /** One line for the toast and the audit row. */
  summary: string
}

export type InvoiceEditResult =
  | { ok: true; plan: InvoiceEditPlan }
  | { ok: false; status: number; reason: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' → the UTC midnight Prisma stores in a @db.Date column, the
 *  same way every other invoice route parses a date off the wire. */
export function parseInvoiceDueDate(raw: string): Date | null {
  if (!YMD.test(raw)) return null
  const d = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The stored due date as the date input wants it. */
export function dueDateInputValue(due: Date | null): string {
  return due ? due.toISOString().slice(0, 10) : ''
}

/**
 * Why this invoice cannot be edited at all, or null when it can.
 *
 * VOID is the only hard stop: a withdrawn document is a historical record,
 * and re-dating one is how a void comes back to life in somebody's ledger.
 * PAID is deliberately NOT blocked — a settled invoice still gets asked for
 * a PO number by the client's A/P department.
 */
export function invoiceEditLock(current: Pick<InvoiceEditCurrent, 'status'>): string | null {
  if (current.status === 'VOID') {
    return 'This invoice was voided. A withdrawn document stays as it was — cut a new one instead.'
  }
  return null
}

function cleanNote(raw: string): string | null {
  const t = raw.replace(/\r\n/g, '\n').trim().slice(0, INVOICE_NOTE_MAX)
  return t ? t : null
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a == null || b == null) return a == b
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

/**
 * Validate an edit against the invoice as it stands and say exactly what it
 * does. Refuses rather than silently dropping a field — a biller who typed a
 * date and got a cheerful "saved" with nothing changed has been lied to.
 */
export function planInvoiceEdit(
  current: InvoiceEditCurrent,
  input: InvoiceEditInput,
): InvoiceEditResult {
  const locked = invoiceEditLock(current)
  if (locked) return { ok: false, status: 409, reason: locked }

  const plan: InvoiceEditPlan = { changed: false, needsRerender: false, summary: '' }
  const parts: string[] = []

  if (input.dueDate !== undefined) {
    let next: Date | null
    if (input.dueDate === null || input.dueDate === '') {
      next = null
    } else if (typeof input.dueDate !== 'string') {
      return { ok: false, status: 400, reason: 'Due date must be a date.' }
    } else {
      next = parseInvoiceDueDate(input.dueDate)
      if (!next) {
        return { ok: false, status: 400, reason: `"${input.dueDate}" is not a date (YYYY-MM-DD).` }
      }
    }
    if (!sameDay(next, current.dueDate)) {
      plan.dueDate = next
      plan.changed = true
      parts.push(
        next
          ? `due ${dueDateInputValue(current.dueDate) || 'unset'} → ${dueDateInputValue(next)}`
          : `due ${dueDateInputValue(current.dueDate)} → cleared`,
      )
    }
  }

  if (input.notes !== undefined) {
    let next: string | null
    if (input.notes === null) {
      next = null
    } else if (typeof input.notes !== 'string') {
      return { ok: false, status: 400, reason: 'The note must be text.' }
    } else {
      next = cleanNote(input.notes)
    }
    const before = current.notes?.trim() || null
    if (next !== before) {
      plan.notes = next
      plan.changed = true
      parts.push(next ? (before ? 'note rewritten' : 'note added') : 'note cleared')
    }
  }

  if (!plan.changed) {
    return { ok: false, status: 400, reason: 'Nothing was changed.' }
  }

  // The snapshot is what ANY presentation of this invoice is drawn from —
  // the on-demand PAID render as much as the stored blob. Without one there
  // is no way for an edit to reach the document, and a row saying one due
  // date while the client's PDF says another is worse than refusing. So the
  // check is UNCONDITIONAL, not gated on needsRerender: a PAID invoice with
  // no snapshot falls back to its blob too.
  if (!current.hasSnapshot) {
    return {
      ok: false,
      status: 409,
      reason:
        'This invoice predates line snapshots, so its PDF cannot be re-rendered and the document ' +
        'would still show the old due date. Use "Update figures from the order" first — that cuts a ' +
        'fresh PDF — or void it and re-cut.',
    }
  }

  // A PAID invoice re-renders from its snapshot on every open (the PAID
  // stamp), so an edit reaches the document without touching the blob.
  // Everything else is served from the stored blob and has to be rewritten.
  plan.needsRerender = current.status !== 'PAID'

  plan.summary = parts.join(' · ')
  return { ok: true, plan }
}
