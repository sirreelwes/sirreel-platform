import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, Font, StyleSheet } from '@react-pdf/renderer'
import { ZellePayBlock } from './ZellePayBlock'

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

Font.registerHyphenationCallback((word) => [word])

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
  company: InvoiceCompanyForRender
  job: InvoiceJobForRender | null
  agent: InvoiceAgentForRender
  notes: string | null
}

// ─────────────────────────────────────────────────────────────────
// Palette + style (mirrors QuoteDocument)
// ─────────────────────────────────────────────────────────────────

const C = {
  ink: '#111111',
  muted: '#555555',
  faint: '#888888',
  rule: '#cccccc',
  ruleSoft: '#e5e5e5',
  zebra: '#fafafa',
  amber: '#b45309',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
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
  docTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    letterSpacing: 2,
  },
  meta: { flexDirection: 'column', alignItems: 'flex-end', minWidth: 150 },
  metaNum: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  metaLine: { fontSize: 9, color: C.muted, marginTop: 2 },
  hrThick: {
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    marginTop: 6,
    marginBottom: 12,
  },

  // ── Info card (Bill To / Order / Remit To) ──────────────────
  infoCard: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: C.rule,
    borderRadius: 3,
    marginBottom: 12,
  },
  infoSection: { padding: 8 },
  infoSectionBillTo:  { width: '34%' },
  infoSectionOrder:   { width: '36%', borderLeftWidth: 0.5, borderLeftColor: C.rule },
  infoSectionRemitTo: { width: '30%', borderLeftWidth: 0.5, borderLeftColor: C.rule },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.muted,
    marginBottom: 4,
  },
  infoLine: { flexDirection: 'row', marginBottom: 1.5 },
  infoLabel: { width: '46%', fontSize: 9, color: C.muted },
  infoValue: { width: '54%', fontSize: 9 },
  infoStrong: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  infoSub: { fontSize: 9, color: C.muted, marginTop: 1 },

  // ── Charges table ───────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 6,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: C.ink,
  },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionSub: { fontSize: 8, color: C.muted },
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3.5,
    borderBottomWidth: 0.25,
    borderBottomColor: C.ruleSoft,
  },
  rowAlt: { backgroundColor: C.zebra },
  // Column widths sum to 100
  colDesc: { width: '55%', fontSize: 9, paddingRight: 4 },
  colQty:  { width: '8%',  fontSize: 9, textAlign: 'right' },
  colRate: { width: '17%', fontSize: 9, textAlign: 'right' },
  colAmt:  { width: '20%', fontSize: 9, textAlign: 'right' },
  cellCat: { fontSize: 8, color: C.faint, marginTop: 1 },
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
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.ink,
    alignItems: 'flex-end',
  },
  totalsRow: { flexDirection: 'row', marginBottom: 2 },
  totalsLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 16,
    width: 130,
    textAlign: 'right',
  },
  totalsValue: { fontSize: 10, width: 100, textAlign: 'right' },
  grandLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginRight: 16,
    width: 130,
    textAlign: 'right',
  },
  grandValue: { fontFamily: 'Helvetica-Bold', fontSize: 13, width: 100, textAlign: 'right' },
  grandRow: {
    flexDirection: 'row',
    marginTop: 5,
    paddingTop: 5,
    borderTopWidth: 0.5,
    borderTopColor: C.ink,
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
  company,
  job,
  agent,
  notes,
}: InvoiceDocumentProps): React.ReactElement {
  const docTitle = invoiceType === 'LD' ? 'LOSS & DAMAGE INVOICE' : 'INVOICE'

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
            <Text style={styles.brandSub}>SirReel Production Vehicles, Inc.</Text>
            <Text style={styles.brandAddress}>8500 Lankershim Blvd, Sun Valley, CA 91352</Text>
            <Text style={styles.brandAddress}>888.477.7335 · info@sirreel.com</Text>
          </View>
          <View style={styles.titleColumn}>
            <Text style={styles.docTitle}>{docTitle}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaNum}>{invoiceNumber}</Text>
            <Text style={styles.metaLine}>Order {orderNumber}</Text>
            <Text style={styles.metaLine}>Invoice Date · {fmtDate(issuedAt)}</Text>
            <Text style={styles.metaLine}>Terms · {PAYMENT_TERMS_LABEL}</Text>
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
            <Text style={styles.infoStrong}>SirReel Studio Services</Text>
            <Text style={styles.infoSub}>8500 Lankershim Blvd</Text>
            <Text style={styles.infoSub}>Sun Valley, CA 91352</Text>
            <Text style={styles.infoSub}>billing@sirreel.com</Text>
            <Text style={styles.infoSub}>888.477.7335</Text>
          </View>
        </View>

        {/* ── Charges section header ────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Charges</Text>
          <Text style={styles.sectionSub}>{lines.length} line{lines.length === 1 ? '' : 's'}</Text>
        </View>

        {/* ── Table head ───────────────────────────────────────── */}
        <View style={styles.tableHead} fixed>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colRate}>Rate</Text>
          <Text style={styles.colAmt}>Amount</Text>
        </View>

        {/* ── Line items ───────────────────────────────────────── */}
        {lines.map((line, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
            <View style={styles.colDesc}>
              <Text>{line.description}</Text>
              {line.category && <Text style={styles.cellCat}>{line.category}</Text>}
              {line.kind !== 'RENTAL_LINE' && (
                <Text style={styles.cellKindBadge}>{line.kind.replace('_', ' ')}</Text>
              )}
            </View>
            <Text style={styles.colQty}>{line.qty}</Text>
            <Text style={styles.colRate}>{fmtUsd(line.unitPrice)}</Text>
            <Text style={styles.colAmt}>{fmtUsd(line.amount)}</Text>
          </View>
        ))}

        {/* ── Totals (kept together; never split across pages) ── */}
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{fmtUsd(subtotal)}</Text>
          </View>
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
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Balance Due</Text>
            <Text style={styles.balanceValue}>{fmtUsd(balanceDue)}</Text>
          </View>
        </View>

        {/* ── Zelle pay-by block — right-aligned with the totals,
            kept on the same page so the client sees the QR + handle
            the instant their eye lands on Balance Due. ───────── */}
        <ZellePayBlock />

        {/* ── Payment terms + instructions ────────────────────── */}
        <View style={styles.termsBox}>
          <View style={styles.termsRow}>
            <Text style={styles.termsLabel}>Payment Terms</Text>
            <Text style={styles.termsValue}>{PAYMENT_TERMS_LABEL} · payable to SirReel Studio Services</Text>
          </View>
        </View>

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
            Make payable to <Text style={{ fontFamily: 'Helvetica-Bold' }}>SirReel Studio Services</Text>,
            mail to 8500 Lankershim Blvd, Sun Valley, CA 91352. Include invoice number on the memo line.
          </Text>
        </View>

        {/* ── Notes (optional) ─────────────────────────────────── */}
        {notes && (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesBody}>{notes}</Text>
          </View>
        )}

        {/* ── Footer ───────────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text>SirReel Studio Services · {invoiceNumber}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
