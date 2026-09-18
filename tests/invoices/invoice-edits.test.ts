/**
 * What a biller may change ON an invoice.
 *
 *   npm run test:invoice-edits
 *
 * Ana 2026-09-17: "how do I update an invoice from my side?" The answer for
 * figures is and stays "fix the order" — these are the two facts the order
 * cannot say. Pinned here, since both surfaces (the collections desk and the
 * job's Invoices panel) and the route all read this one module:
 *   - a VOID invoice is never edited
 *   - a no-op edit is refused, not reported as saved
 *   - a date has to be a date; a bad one refuses rather than dropping
 *   - a PAID invoice needs no blob rewrite (it renders on demand)
 *   - anything else DOES, and a pre-snapshot invoice is refused for it
 *   - clearing works and reads as clearing
 */
import {
  planInvoiceEdit,
  invoiceEditLock,
  parseInvoiceDueDate,
  dueDateInputValue,
  INVOICE_NOTE_MAX,
  type InvoiceEditCurrent,
} from '../../src/lib/invoices/invoiceEdits'

let failed = 0
function check(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`)
  if (!ok) {
    failed++
    if (extra !== undefined) console.log('        ', JSON.stringify(extra))
  }
}

const SENT: InvoiceEditCurrent = {
  status: 'SENT',
  dueDate: new Date('2026-09-01T00:00:00.000Z'),
  notes: 'Thanks for the work.',
  hasSnapshot: true,
}

function main() {
  console.log('the lock')
  check('a voided invoice is locked', invoiceEditLock({ status: 'VOID' }) !== null)
  check('a sent invoice is not', invoiceEditLock({ status: 'SENT' }) === null)
  check('a paid invoice is not — A/P still asks for a PO number', invoiceEditLock({ status: 'PAID' }) === null)
  let r = planInvoiceEdit({ ...SENT, status: 'VOID' }, { dueDate: '2026-10-01' })
  check('and the plan refuses it with 409', !r.ok && r.status === 409, r)

  console.log('\nthe due date')
  r = planInvoiceEdit(SENT, { dueDate: '2026-10-01' })
  check('a real date is taken', r.ok && r.plan.dueDate?.toISOString().slice(0, 10) === '2026-10-01', r)
  check('and reads as a move', r.ok && r.plan.summary === 'due 2026-09-01 → 2026-10-01', r)
  r = planInvoiceEdit(SENT, { dueDate: '2026-09-01' })
  check('the SAME date is not a change', !r.ok && r.status === 400, r)
  r = planInvoiceEdit(SENT, { dueDate: 'next friday' })
  check('a non-date refuses rather than being dropped', !r.ok && r.status === 400, r)
  r = planInvoiceEdit(SENT, { dueDate: 42 })
  check('so does a non-string', !r.ok && r.status === 400, r)
  r = planInvoiceEdit(SENT, { dueDate: null })
  check('null clears it', r.ok && r.plan.dueDate === null && /cleared/.test(r.plan.summary), r)
  check('a bad ymd parses to null', parseInvoiceDueDate('2026-13-99') === null)
  check('round-trips through the input value', dueDateInputValue(parseInvoiceDueDate('2026-10-01')) === '2026-10-01')

  console.log('\nthe note')
  r = planInvoiceEdit(SENT, { notes: 'PO 44821' })
  check('a new note is taken', r.ok && r.plan.notes === 'PO 44821', r)
  r = planInvoiceEdit(SENT, { notes: '  Thanks for the work.  ' })
  check('the same note, differently spaced, is not a change', !r.ok, r)
  r = planInvoiceEdit(SENT, { notes: '' })
  check('empty clears it', r.ok && r.plan.notes === null && /cleared/.test(r.plan.summary), r)
  r = planInvoiceEdit({ ...SENT, notes: null }, { notes: 'x'.repeat(INVOICE_NOTE_MAX + 500) })
  check('an absurd note is cut to the max, not refused', r.ok && r.plan.notes?.length === INVOICE_NOTE_MAX, r)

  console.log('\nnothing at all')
  r = planInvoiceEdit(SENT, {})
  check('an empty body is refused, never a cheerful no-op', !r.ok && r.status === 400, r)

  console.log('\nwhether the PDF has to be rewritten')
  r = planInvoiceEdit({ ...SENT, status: 'PAID' }, { notes: 'PO 44821' })
  check('a PAID invoice renders on demand — no blob rewrite', r.ok && r.plan.needsRerender === false, r)
  r = planInvoiceEdit(SENT, { notes: 'PO 44821' })
  check('a SENT one is served from the blob — rewrite it', r.ok && r.plan.needsRerender === true, r)
  r = planInvoiceEdit({ ...SENT, status: 'DRAFT' }, { notes: 'PO 44821' })
  check('so is a DRAFT', r.ok && r.plan.needsRerender === true, r)

  console.log('\nan invoice with nothing to render from')
  r = planInvoiceEdit({ ...SENT, hasSnapshot: false }, { dueDate: '2026-10-01' })
  check(
    'refuses rather than leaving the row and the PDF disagreeing',
    !r.ok && r.status === 409 && /Update figures from the order/.test(r.reason),
    r,
  )
  r = planInvoiceEdit({ ...SENT, status: 'PAID', hasSnapshot: false }, { dueDate: '2026-10-01' })
  check('and a PAID one with no snapshot is refused too — it also falls back to the blob', !r.ok, r)

  console.log('\nboth at once')
  r = planInvoiceEdit(SENT, { dueDate: '2026-10-15', notes: 'PO 44821' })
  check('one summary names both', r.ok && r.plan.summary === 'due 2026-09-01 → 2026-10-15 · note rewritten', r)

  if (failed) {
    console.log(`\n${failed} failing`)
    process.exit(1)
  }
  console.log('\nall passing')
}
main()
