import React from 'react'
import { PDF_BRAND } from '@/lib/pdf/brand'
import type { BookingTerm } from '@/lib/sales/bookingTerms'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { ZellePayBlock } from './ZellePayBlock'
import { BRAND_NAME, BRAND_QUALIFIER, REMIT_TO_DBA_LINE, REMIT_TO_NAME } from '@/lib/brand/payee'

/**
 * SirReel Invoice PDF. Shell mirrors the QuoteDocument / contracts
 * pattern (single muted ink palette, centered title, 3-section info
 * card, section-headed charges table). Invoice-specific fields layered
 * in: payment terms, tax breakdown with rate, explicit Bill To /
 * Remit To columns, amount paid + balance due.
 *
 * Rendered server-side via renderToBuffer; private blob upload + auth-
 * gated GET — same plumbing as quote-pdf.
 *
 * Type-discriminated header: RENTAL → INVOICE, LD → LOSS & DAMAGE
 * INVOICE. Same template covers both.
 */

// Hyphenation is registered ONCE in lib/pdf/hyphenation (global,
// last-registration-wins — this file's old `(word) => [word]` silently
// disabled code-wrapping on QUOTES too whenever it loaded last).
import '@/lib/pdf/hyphenation'

const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch (err) {
  console.warn('[InvoiceDocument] failed to load sirreel-logo.png, falling back to text brand:', err)
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type InvoiceLineKind = 'RENTAL_LINE' | 'ADJUSTMENT' | 'DAMAGE'

export interface InvoiceLineSnapshotEntry {
  description: string
  category: string | null
  qty: number
  unitPrice: number
  amount: number
  kind: InvoiceLineKind
  /** Package grouping (optional). Header rows render normally with
   *  their unitPrice + amount; member rows are indented and render
   *  "included" in the unit-price + amount columns. */
  isPackageHeader?: boolean
  isPackageMember?: boolean
  /** Client-facing small-print under the description — seeded from
   *  OrderLineItem.notes at issue time (which itself defaults from
   *  InventoryItem.clientNote when the line was added). Prints as
   *  italic muted text below the description, matching the existing
   *  qualifier style. */
  notes?: string | null
  /**
   * Billed days — what the line is actually charged for
   * (OrderLineItem.billableDays), and the calendar span it covers.
   *
   * Ana, 2026-09-09: "is there a way to make billed days per week show?
   * I don't see it on invoices currently." The quote PDF has carried a
   * Days column since it shipped; the invoice had Qty / Rate / Amount
   * and nothing else, so a client on a weekly rate — a vehicle week
   * bills 5 days of 7, supplies 3 — got a line whose amount could not
   * be reconstructed from the figures printed next to it, and neither
   * could Ana when they called about it.
   *
   * `days` null means the concept does not apply (a purchase, a
   * discount, an adjustment, a damage charge) OR the snapshot predates
   * this field — invoices issued before 2026-09-09 carry neither, and
   * the column is dropped entirely when no line has a value, so those
   * re-render exactly as they were sent.
   *
   * `spanDays` is only printed when it differs from `days`; that
   * difference IS the weekly-rate concession, and printing it is the
   * point.
   */
  days?: number | null
  spanDays?: number | null
  /** What the rate in the Rate column buys — "/day" or "/wk". A weekly
   *  rate must SAY weekly (Wes 2026-09-05) rather than print a derived
   *  per-day number that reads as the client's day rate. */
  rateUnit?: 'DAY' | 'WEEK' | null
}

export interface InvoiceCompanyForRender {
  name: string
  billingAddress: string | null
  billingEmail: string | null
}

export interface InvoiceJobForRender {
  jobCode: string | null
  name: string | null
}

export interface InvoiceAgentForRender {
  name: string
  email: string
  phone: string | null
}

export interface InvoiceDocumentProps {
  invoiceNumber: string
  invoiceType: 'RENTAL' | 'LD'
  /** PRE-INVOICE round: this document is a DRAFT sent to the client for
   *  review, not a demand for payment (Wes 2026-09-01). Retitles the
   *  document and states plainly that it is not yet payable — a client
   *  who receives something headed "INVOICE" will reasonably pay it, and
   *  the whole point of the round is that the figure might still change. */
  isPreInvoice?: boolean
  orderNumber: string
  issuedAt: Date
  dueDate: Date | null
  /** Optional service period (order startDate → endDate). When provided,
   *  surfaced on the Production info-card section as "Service Period". */
  servicePeriodStart?: Date | null
  servicePeriodEnd?: Date | null
  subtotal: number
  /** Decimal rate (e.g. 0.0875 = 8.75%). Surfaced inline on the tax
   *  totals row. When null/0, the tax row reads "Tax (—)" → 0.00. */
  taxRate?: number | null
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  lines: InvoiceLineSnapshotEntry[]
  /** Optional structured discount lines rendered between Subtotal and
   *  Tax. Each entry is one row (negative amount, label). Used by the
   *  OrderDiscount surface — RENTAL invoice generator passes current
   *  order discounts; LD invoice never sets this. Omitting or passing
   *  [] preserves the original 3-row totals layout (Subtotal/Tax/Total)
   *  for invoices generated before discounts shipped. */
  discountLines?: { label: string; amount: number }[]
  company: InvoiceCompanyForRender
  job: InvoiceJobForRender | null
  agent: InvoiceAgentForRender
  notes: string | null
  /**
   * The charge-explaining booking terms — refueling, mileage, trash, card
   * fees. Built by buildInvoiceBookingTerms(), which FILTERS the same
   * builder the quote PDF uses, so a client cannot be quoted one mileage
   * rate and billed against a different sentence.
   *
   * Absent/empty renders nothing, keeping every pre-2026-09-03 invoice
   * byte-identical.
   */
  bookingTerms?: BookingTerm[]
}

// ─────────────────────────────────────────────────────────────────
// Palette + style (mirrors QuoteDocument)
// ─────────────────────────────────────────────────────────────────

/** Shared brand palette — see lib/pdf/brand.ts. Quote and Invoice must
 *  not drift apart; a client sees both. */
const C = PDF_BRAND

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.35,
    color: C.ink,
  },

  // ── Top band ────────────────────────────────────────────────
  topBand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  brand: { flexDirection: 'column' },
  brandLogo: { width: 140, height: 'auto', marginBottom: 6 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 20, letterSpacing: 0.5 },
  brandSub: { fontSize: 8, color: C.muted, marginTop: 3 },
  brandAddress: { fontSize: 8, color: C.muted, marginTop: 1 },
  titleColumn: { flex: 1, alignItems: 'center' },
  preNote: { fontSize: 8, marginTop: 6, textAlign: 'center', lineHeight: 1.2 },
  docTitle: {
    lineHeight: 1,
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    letterSpacing: 2,
    color: C.accent,
  },
  meta: { flexDirection: 'column', alignItems: 'flex-end', minWidth: 150 },
  metaNum: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: C.accent,
    backgroundColor: C.accentFill,
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  metaLine: { fontSize: 9, color: C.muted, marginTop: 2 },
  hrThick: {
    borderBottomWidth: 1.5,
    borderBottomColor: C.accentDeep,
    marginTop: 5,
    marginBottom: 9,
  },

  // ── Info card (Bill To / Order / Remit To) ──────────────────
  infoCard: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 3,
    marginBottom: 9,
    backgroundColor: C.accentFillSoft,
  },
  infoSection: { padding: 6 },
  infoSectionBillTo:  { width: '34%' },
  infoSectionOrder:   { width: '36%', borderLeftWidth: 0.5, borderLeftColor: C.accentEdge },
  infoSectionRemitTo: { width: '30%', borderLeftWidth: 0.5, borderLeftColor: C.accentEdge },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.accent,
    marginBottom: 4,
  },
  infoLine: { flexDirection: 'row', marginBottom: 1.5 },
  infoLabel: { width: '46%', fontSize: 9, color: C.muted },
  infoValue: { width: '54%', fontSize: 9 },
  infoStrong: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 1 },
  // The dba line under the Remit To name — smaller than the address
  // lines so it reads as a qualifier on the payee, not another
  // address row. See src/lib/brand/payee.ts for why it is there.
  infoDba: { fontSize: 7.5, color: C.muted, marginTop: 1, marginBottom: 1 },

  // ── Charges table ───────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 6,
    marginBottom: 0,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 6,
    backgroundColor: C.accentFill,
    borderBottomWidth: 1,
    borderBottomColor: C.accentDeep,
  },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: C.accent,
  },
  sectionSub: { fontSize: 8, color: C.muted },
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: C.accentFillSoft,
    borderBottomWidth: 0.5,
    borderBottomColor: C.accentEdge,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: C.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 2.6,
    borderBottomWidth: 0.25,
    borderBottomColor: C.ruleSoft,
  },
  rowAlt: { backgroundColor: C.zebra },
  // Column widths sum to 100. Two sets: the Days column exists only on
  // invoices whose lines carry billable days (see `showDays`), so an
  // invoice issued before that field existed keeps its original layout
  // instead of gaining a column of dashes.
  colDesc: { width: '55%', fontSize: 9, paddingRight: 4 },
  colQty:  { width: '8%',  fontSize: 9, textAlign: 'right' },
  colRate: { width: '17%', fontSize: 9, textAlign: 'right' },
  colAmt:  { width: '20%', fontSize: 9, textAlign: 'right' },
  // With Days: the description gives up the width the column needs.
  colDescD: { width: '47%', fontSize: 9, paddingRight: 4 },
  colQtyD:  { width: '7%',  fontSize: 9, textAlign: 'right' },
  colDaysD: { width: '9%',  fontSize: 9, textAlign: 'right' },
  colRateD: { width: '17%', fontSize: 9, textAlign: 'right' },
  colAmtD:  { width: '20%', fontSize: 9, textAlign: 'right' },
  /** The calendar span beside the billed days — "5 / 7". Same treatment
   *  as the quote's Days cell so the two documents reconcile by eye. */
  daysSpan: { fontSize: 7, color: C.faint },
  /** "/day" / "/wk" beside the rate — small, so it reads as a unit
   *  rather than as part of the number. */
  rateUnitText: { fontSize: 7, color: C.faint },
  /** The one-sentence key under the table, printed only when some line
   *  actually shows a concession. */
  daysKey: { fontSize: 7.5, color: C.muted, marginTop: 5, lineHeight: 1.35 },
  cellCat: { fontSize: 8, color: C.faint, marginTop: 1 },
  cellNote: { fontSize: 8, color: C.muted, fontStyle: 'italic', marginTop: 1, lineHeight: 1.3 },
  cellKindBadge: {
    fontSize: 7,
    color: C.amber,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1.5,
  },

  // ── Totals block ────────────────────────────────────────────
  totals: {
    marginTop: 9,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.accentDeep,
    alignItems: 'flex-end',
  },
  totalsRow: { flexDirection: 'row', marginBottom: 2, alignItems: 'stretch' },
  totalsLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 130,
    textAlign: 'right',
    backgroundColor: C.accentFill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  totalsValue: {
    fontSize: 10,
    width: 100,
    textAlign: 'right',
    backgroundColor: C.moneyFill,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  grandLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    width: 130,
    textAlign: 'right',
    color: C.accent,
    backgroundColor: C.accentFill,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  grandValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    width: 100,
    textAlign: 'right',
    backgroundColor: C.moneyFill,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  grandRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 5,
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: C.accentDeep,
  },
  balanceRow: {
    flexDirection: 'row',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1.25,
    borderTopColor: C.ink,
  },
  balanceLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginRight: 16,
    width: 130,
    textAlign: 'right',
  },
  balanceValue: { fontFamily: 'Helvetica-Bold', fontSize: 14, width: 100, textAlign: 'right' },

  // ── Payment terms + instructions ────────────────────────────
  termsBox: {
    marginTop: 18,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
  },
  termsRow: { flexDirection: 'row', marginBottom: 3 },
  termsLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 110,
  },
  termsValue: { fontSize: 10 },
  // The pre-invoice's next-step sentence is a paragraph, not a label —
  // without flex:1 it overflows the row and the tail is clipped rather
  // than wrapped (caught in the first render: "you confirm" vanished).
  termsValueWrap: { fontSize: 10, flex: 1 },
  paymentBox: {
    marginTop: 10,
    padding: 10,
    borderWidth: 0.5,
    borderColor: C.rule,
    borderRadius: 3,
  },
  paymentTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.muted,
    marginBottom: 4,
  },
  paymentLine: { fontSize: 9.5, marginTop: 1.5 },

  notesBlock: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
  },
  notesLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 4,
  },
  notesBody: { fontSize: 9, lineHeight: 1.4 },

  // Charge terms. Two columns like the quote's Booking Details, and the
  // same type sizes, so the block a client already read on the quote is
  // visually the same block here rather than a new document to parse.
  //
  // chargeTerms* prefix, NOT terms*: termsBox / termsRow / termsLabel /
  // termsValue above are the PAYMENT-terms box in the header, and
  // `termsLabel` collided outright.
  chargeTermsBlock: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
  },
  chargeTermsLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.accent,
    marginBottom: 5,
  },
  chargeTermsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  chargeTermCell: { width: '50%', paddingRight: 10, marginBottom: 5 },
  chargeTermTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8, marginBottom: 1 },
  chargeTermBody: { fontSize: 7.5, lineHeight: 1.35, color: C.muted },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: C.faint,
  },
})

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const fmtUsd = (n: number): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: Date | null | undefined): string =>
  d
    ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '—'

const fmtPct = (rate: number): string => {
  // Rate is decimal: 0.0875 → "8.75%". Trim trailing zeros for readability.
  const pct = rate * 100
  const s = pct.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s + '%'
}

// SirReel does not use Net terms — all invoices are due on receipt.
// Kept as a constant (not a derived label) so the rendered document
// never claims a future due date and the wording is uniform across
// rental and L&D invoices.
const PAYMENT_TERMS_LABEL = 'Due on receipt'

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function InvoiceDocument({
  invoiceNumber,
  invoiceType,
  orderNumber,
  issuedAt,
  // dueDate kept in the interface so generators can persist it on the
  // Invoice row (downstream aging math depends on it), but not surfaced
  // anywhere on the rendered PDF — SirReel does not use Net terms, so
  // the document never claims a future due date.
  dueDate: _dueDate,
  servicePeriodStart,
  servicePeriodEnd,
  subtotal,
  taxRate,
  taxAmount,
  total,
  amountPaid,
  balanceDue,
  lines,
  discountLines,
  company,
  job,
  agent,
  notes,
  bookingTerms,
  isPreInvoice = false,
}: InvoiceDocumentProps): React.ReactElement {
  const docTitle = isPreInvoice
    ? 'PRE-INVOICE'
    : invoiceType === 'LD'
      ? 'LOSS & DAMAGE INVOICE'
      : 'INVOICE'

  // Days column: present only when some line has days to show. An L&D
  // invoice (damage charges) and every invoice issued before the field
  // existed have none, and re-render byte-for-byte as they were sent.
  const showDays = lines.some((l) => l.days != null)
  const cDesc = showDays ? styles.colDescD : styles.colDesc
  const cQty = showDays ? styles.colQtyD : styles.colQty
  const cRate = showDays ? styles.colRateD : styles.colRate
  const cAmt = showDays ? styles.colAmtD : styles.colAmt
  // The "5 / 7" key is only worth printing when a line actually shows
  // one — on an all-daily invoice it would explain a column that never
  // varies.
  const showDaysKey = lines.some(
    (l) => l.days != null && l.spanDays != null && l.spanDays !== l.days,
  )

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* ── Top band ─────────────────────────────────────────── */}
        <View style={styles.topBand}>
          <View style={styles.brand}>
            {LOGO_BUFFER ? (
              <Image src={LOGO_BUFFER} style={styles.brandLogo} />
            ) : (
              <Text style={styles.brandName}>SirReel</Text>
            )}
            {/* The logo already reads "SirReel / STUDIO SERVICES"; a sub
                line under it only repeats the wordmark. The text fallback
                is the one path that still needs the qualifier spelled out.

                This line used to read "SirReel Production Vehicles, Inc."
                while Remit To, on the same page, said "SirReel Studio
                Services" — one document naming two companies, on the one
                document where the client is deciding who to pay. */}
            {!LOGO_BUFFER && <Text style={styles.brandSub}>{BRAND_QUALIFIER}</Text>}
            <Text style={styles.brandAddress}>8500 Lankershim Blvd, Sun Valley, CA 91352</Text>
            <Text style={styles.brandAddress}>(888) 477-7335 · info@sirreel.com</Text>
          </View>
          <View style={styles.titleColumn}>
            <Text style={styles.docTitle}>{docTitle}</Text>
            {isPreInvoice && (
              <Text style={styles.preNote}>For your review — not yet payable</Text>
            )}
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaNum}>{invoiceNumber}</Text>
            <Text style={styles.metaLine}>Order {orderNumber}</Text>
            <Text style={styles.metaLine}>
              {isPreInvoice ? 'Prepared' : 'Invoice Date'} · {fmtDate(issuedAt)}
            </Text>
            {/* Payment terms are a promise about a payable document —
                suppressed until this one actually is. */}
            {!isPreInvoice && <Text style={styles.metaLine}>Terms · {PAYMENT_TERMS_LABEL}</Text>}
          </View>
        </View>
        <View style={styles.hrThick} />

        {/* ── Info card ────────────────────────────────────────── */}
        <View style={styles.infoCard}>
          {/* Bill To */}
          <View style={[styles.infoSection, styles.infoSectionBillTo]}>
            <Text style={styles.infoTitle}>Bill To</Text>
            <Text style={styles.infoStrong}>{company.name}</Text>
            {company.billingAddress && (
              <Text style={styles.infoSub}>{company.billingAddress}</Text>
            )}
            {company.billingEmail && (
              <Text style={styles.infoSub}>{company.billingEmail}</Text>
            )}
          </View>

          {/* Order / Production */}
          <View style={[styles.infoSection, styles.infoSectionOrder]}>
            <Text style={styles.infoTitle}>Order</Text>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Order #</Text>
              <Text style={styles.infoValue}>{orderNumber}</Text>
            </View>
            {job?.name && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Production</Text>
                <Text style={styles.infoValue}>{job.name}</Text>
              </View>
            )}
            {job?.jobCode && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Job Code</Text>
                <Text style={styles.infoValue}>{job.jobCode}</Text>
              </View>
            )}
            {(servicePeriodStart || servicePeriodEnd) && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Service Period</Text>
                <Text style={styles.infoValue}>
                  {servicePeriodStart ? fmtDate(servicePeriodStart) : '—'}
                  {' to '}
                  {servicePeriodEnd ? fmtDate(servicePeriodEnd) : '—'}
                </Text>
              </View>
            )}
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Rep</Text>
              <Text style={styles.infoValue}>{agent.name}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Rep Email</Text>
              <Text style={styles.infoValue}>{agent.email}</Text>
            </View>
            {agent.phone && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Rep Phone</Text>
                <Text style={styles.infoValue}>{agent.phone}</Text>
              </View>
            )}
          </View>

          {/* Remit To */}
          <View style={[styles.infoSection, styles.infoSectionRemitTo]}>
            <Text style={styles.infoTitle}>Remit To</Text>
            <Text style={styles.infoStrong}>{BRAND_NAME}</Text>
            <Text style={styles.infoDba}>{REMIT_TO_DBA_LINE}</Text>
            <Text style={styles.infoSub}>8500 Lankershim Blvd</Text>
            <Text style={styles.infoSub}>Sun Valley, CA 91352</Text>
            <Text style={styles.infoSub}>billing@sirreel.com</Text>
            <Text style={styles.infoSub}>(888) 477-7335</Text>
          </View>
        </View>

        {/* ── Charges section header ────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Charges</Text>
          <Text style={styles.sectionSub}>{lines.length} line{lines.length === 1 ? '' : 's'}</Text>
        </View>

        {/* ── Table head ───────────────────────────────────────── */}
        <View style={styles.tableHead} fixed>
          <Text style={cDesc}>Description</Text>
          <Text style={cQty}>Qty</Text>
          {showDays && <Text style={styles.colDaysD}>Days</Text>}
          <Text style={cRate}>Rate</Text>
          <Text style={cAmt}>Amount</Text>
        </View>

        {/* ── Line items ───────────────────────────────────────── */}
        {lines.map((line, i) => {
          const isMember = !!line.isPackageMember
          return (
            <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
              <View style={cDesc}>
                <Text style={isMember ? { paddingLeft: 14, color: '#555' } : undefined}>
                  {isMember ? `· ${line.description}` : line.description}
                </Text>
                {line.category && <Text style={styles.cellCat}>{line.category}</Text>}
                {line.notes && line.notes.trim().length > 0 && (
                  <Text style={styles.cellNote}>{line.notes}</Text>
                )}
                {line.kind !== 'RENTAL_LINE' && (
                  <Text style={styles.cellKindBadge}>{line.kind.replace('_', ' ')}</Text>
                )}
              </View>
              <Text style={cQty}>{line.qty}</Text>
              {showDays && (
                <Text style={styles.colDaysD}>
                  {line.days == null ? (
                    '—'
                  ) : (
                    <>
                      {line.days}
                      {line.spanDays != null && line.spanDays !== line.days && (
                        <Text style={styles.daysSpan}> / {line.spanDays}</Text>
                      )}
                    </>
                  )}
                </Text>
              )}
              <Text style={isMember ? [cRate, { color: '#888', fontStyle: 'italic' }] : cRate}>
                {isMember ? (
                  'included'
                ) : (
                  <>
                    {fmtUsd(line.unitPrice)}
                    {line.rateUnit && (
                      <Text style={styles.rateUnitText}>
                        {line.rateUnit === 'WEEK' ? '/wk' : '/day'}
                      </Text>
                    )}
                  </>
                )}
              </Text>
              <Text style={isMember ? [cAmt, { color: '#888', fontStyle: 'italic' }] : cAmt}>
                {isMember ? '—' : fmtUsd(line.amount)}
              </Text>
            </View>
          )
        })}

        {/* The Days key. Two numbers in that column is the weekly-rate
            concession, and a client who cannot tell what the second one
            means calls Ana to ask — which is where this whole column
            came from. Wording carries no department figures on purpose:
            the cap is 5 days for vehicles and 3 for supplies, and a
            sentence naming one would be wrong on the other. */}
        {showDaysKey && (
          <Text style={styles.daysKey}>
            Days is what each line bills. Where two numbers appear (5 / 7), the
            line is on a weekly rate: the first is the days charged, the second
            the days you had it.
          </Text>
        )}

        {/* ── Totals (kept together; never split across pages) ── */}
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{fmtUsd(subtotal)}</Text>
          </View>
          {/* Structured discounts (OrderDiscount surface) render between
              Subtotal and Tax. The label carries dept or order context
              ("Discount — Vehicles" / "Repeat client") so the client
              sees what they got. When the array is empty or omitted —
              true for invoices generated before discounts shipped — the
              original 3-row layout is preserved bit-identically. */}
          {discountLines?.filter((d) => d.amount > 0).map((d, i) => (
            <View key={i} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{d.label}</Text>
              <Text style={styles.totalsValue}>-{fmtUsd(d.amount)}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              Tax {taxRate != null && taxRate > 0 ? `(${fmtPct(taxRate)})` : '(-)'}
            </Text>
            <Text style={styles.totalsValue}>{fmtUsd(taxAmount)}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>{fmtUsd(total)}</Text>
          </View>
          {(amountPaid > 0 || balanceDue !== total) && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Amount Paid</Text>
              <Text style={styles.totalsValue}>-{fmtUsd(amountPaid)}</Text>
            </View>
          )}
          {/* Everything below is a demand for money. On a PRE-invoice
              it is all suppressed — "Balance Due", a Zelle QR, payment
              terms and cheque instructions under a heading that says
              "not yet payable" is a document that gets paid. The
              client sees the figure and approves it; the payable
              version follows. */}
          {!isPreInvoice && (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Balance Due</Text>
              <Text style={styles.balanceValue}>{fmtUsd(balanceDue)}</Text>
            </View>
          )}
        </View>

        {!isPreInvoice && <ZellePayBlock />}

        {isPreInvoice ? (
          <View style={styles.termsBox}>
            <View style={styles.termsRow}>
              <Text style={styles.termsLabel}>Next step</Text>
              <Text style={styles.termsValueWrap}>
                Review these charges in your SirReel portal and approve them. Nothing is due yet —
                we issue the invoice once you confirm the figures are right.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.termsBox}>
            <View style={styles.termsRow}>
              <Text style={styles.termsLabel}>Payment Terms</Text>
              <Text style={styles.termsValueWrap}>
                {PAYMENT_TERMS_LABEL} · payable to {REMIT_TO_NAME}
              </Text>
            </View>
          </View>
        )}

        {!isPreInvoice && (
        <View style={styles.paymentBox}>
          <Text style={styles.paymentTitle}>Payment Instructions</Text>
          <Text style={styles.paymentLine}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Online:</Text>{' '}
            Pay through your job portal — link in the invoice email or contact your rep.
          </Text>
          <Text style={styles.paymentLine}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Wire / ACH:</Text>{' '}
            Contact billing@sirreel.com for wire instructions.
          </Text>
          <Text style={styles.paymentLine}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Check:</Text>{' '}
            Make payable to <Text style={{ fontFamily: 'Helvetica-Bold' }}>{REMIT_TO_NAME}</Text>,
            mail to 8500 Lankershim Blvd, Sun Valley, CA 91352. Include invoice number on the memo line.
          </Text>
        </View>
        )}

        {/* ── Notes (optional) ─────────────────────────────────── */}
        {notes && (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesBody}>{notes}</Text>
          </View>
        )}

        {/* ── How these charges are calculated ─────────────────── */}
        {/* The rates behind the metered lines above (mileage, refuel,
            disposal) and the card fee. Named for what a client is actually
            looking for when they scan an invoice for it: not "terms", but
            where a number came from. */}
        {bookingTerms && bookingTerms.length > 0 && (
          <View style={styles.chargeTermsBlock}>
            <Text style={styles.chargeTermsLabel} minPresenceAhead={40}>
              How these charges are calculated
            </Text>
            <View style={styles.chargeTermsGrid}>
              {bookingTerms.map((t) => (
                <View key={t.key} style={styles.chargeTermCell} wrap={false}>
                  <Text style={styles.chargeTermTitle}>{t.title}</Text>
                  <Text style={styles.chargeTermBody}>{t.body}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Footer ───────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text>{BRAND_NAME} · {invoiceNumber}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
