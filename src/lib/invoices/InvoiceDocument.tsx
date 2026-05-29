import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, Font, StyleSheet } from '@react-pdf/renderer'

/**
 * SirReel Invoice PDF. Companion to QuoteDocument; deliberately simpler
 * since the totals are final by the time we issue. Rendered server-side
 * via renderToBuffer, uploaded to private Vercel Blob, key/url stored
 * on Invoice. Mirrors the established contracts pattern.
 *
 * Layout: header band with logo + INVOICE title + invoice number;
 * Bill-to + For columns; line-item table fed by Invoice.lineSnapshot
 * (RENTAL_LINE | ADJUSTMENT | DAMAGE); totals block; payment
 * instructions footer signed by Ana.
 *
 * Type-discriminated header: RENTAL shows "INVOICE", LD shows
 * "LOSS & DAMAGE INVOICE". One template covers both. (The LD code
 * path lands in Phase 5 commit 4 but the template is type-aware now
 * so commit 4 doesn't touch this file.)
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
  subtotal: number
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
// Style
// ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: '#1f1d18',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  logo: { width: 110, height: 28, objectFit: 'contain' },
  titleBlock: { textAlign: 'right' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
  subtitle: { fontSize: 9, color: '#6b675e', marginTop: 2 },
  meta: { fontSize: 9, color: '#1f1d18', marginTop: 6, lineHeight: 1.35 },

  hRule: { borderBottomWidth: 0.6, borderBottomColor: '#cdc7b9', marginVertical: 10 },

  twoCol: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  colHalf: { flex: 1 },
  smallLabel: {
    fontSize: 7.5,
    color: '#6b675e',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  blockBody: { fontSize: 10, lineHeight: 1.35 },
  blockBodyBold: { fontSize: 10, fontFamily: 'Helvetica-Bold' },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3eedf',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.6,
    borderBottomColor: '#cdc7b9',
    marginTop: 6,
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#3e3a32',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3.5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.4,
    borderBottomColor: '#e6dfca',
  },
  cellDesc:   { width: '55%' },
  cellQty:    { width: '10%', textAlign: 'right' },
  cellRate:   { width: '17%', textAlign: 'right' },
  cellAmount: { width: '18%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  kindBadge: {
    fontSize: 6.5,
    color: '#a3743a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 1.5,
  },

  totalsBlock: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
  totalsCol: { width: '40%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsLabel: { fontSize: 9 },
  totalsValue: { fontSize: 9, textAlign: 'right' },
  grandLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  balanceRule: { borderTopWidth: 0.6, borderTopColor: '#cdc7b9', marginTop: 4, paddingTop: 4 },

  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: '#6b675e',
  },
  paymentBox: {
    marginTop: 16,
    padding: 8,
    backgroundColor: '#fbf8ee',
    borderWidth: 0.6,
    borderColor: '#e6dfca',
    borderRadius: 4,
  },
  paymentTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
})

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const fmtUsd = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '—'

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function InvoiceDocument({
  invoiceNumber,
  invoiceType,
  orderNumber,
  issuedAt,
  dueDate,
  subtotal,
  taxAmount,
  total,
  amountPaid,
  balanceDue,
  lines,
  company,
  job,
  agent,
  notes,
}: InvoiceDocumentProps) {
  const titleText = invoiceType === 'LD' ? 'LOSS & DAMAGE INVOICE' : 'INVOICE'

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {LOGO_BUFFER ? (
              <Image src={LOGO_BUFFER} style={styles.logo} />
            ) : (
              <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold' }}>SirReel</Text>
            )}
            <Text style={{ fontSize: 8, marginTop: 4, color: '#6b675e' }}>
              SirReel Studio Services{'\n'}
              8500 Lankershim Blvd, Sun Valley, CA 91352{'\n'}
              info@sirreel.com · 888.477.7335
            </Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{titleText}</Text>
            <Text style={styles.subtitle}>Order {orderNumber}</Text>
            <View style={styles.meta}>
              <Text>Invoice {invoiceNumber}</Text>
              <Text>Issued {fmtDate(issuedAt)}</Text>
              <Text>Due {fmtDate(dueDate)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.hRule} />

        {/* Bill-to + For */}
        <View style={styles.twoCol}>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Bill To</Text>
            <Text style={styles.blockBodyBold}>{company.name}</Text>
            {company.billingAddress && <Text style={styles.blockBody}>{company.billingAddress}</Text>}
            {company.billingEmail && <Text style={styles.blockBody}>{company.billingEmail}</Text>}
          </View>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>For</Text>
            {job?.name ? (
              <Text style={styles.blockBodyBold}>
                {job.name}{job.jobCode ? `  (${job.jobCode})` : ''}
              </Text>
            ) : (
              <Text style={styles.blockBodyBold}>—</Text>
            )}
            <Text style={styles.blockBody}>Rep: {agent.name}</Text>
            <Text style={styles.blockBody}>{agent.email}</Text>
            {agent.phone && <Text style={styles.blockBody}>{agent.phone}</Text>}
          </View>
        </View>

        {/* Line items */}
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.tableHeaderText, styles.cellDesc]}>Description</Text>
          <Text style={[styles.tableHeaderText, styles.cellQty]}>Qty</Text>
          <Text style={[styles.tableHeaderText, styles.cellRate]}>Rate</Text>
          <Text style={[styles.tableHeaderText, styles.cellAmount]}>Amount</Text>
        </View>
        {lines.map((line, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <View style={styles.cellDesc}>
              <Text>{line.description}</Text>
              {line.category && (
                <Text style={{ fontSize: 7.5, color: '#6b675e', marginTop: 1 }}>{line.category}</Text>
              )}
              {line.kind !== 'RENTAL_LINE' && (
                <Text style={styles.kindBadge}>{line.kind.replace('_', ' ')}</Text>
              )}
            </View>
            <Text style={styles.cellQty}>{line.qty}</Text>
            <Text style={styles.cellRate}>{fmtUsd(line.unitPrice)}</Text>
            <Text style={styles.cellAmount}>{fmtUsd(line.amount)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsCol}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{fmtUsd(subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax</Text>
              <Text style={styles.totalsValue}>{fmtUsd(taxAmount)}</Text>
            </View>
            <View style={[styles.totalsRow, { marginTop: 4 }]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>{fmtUsd(total)}</Text>
            </View>
            <View style={styles.balanceRule}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Amount Paid</Text>
                <Text style={styles.totalsValue}>{fmtUsd(amountPaid)}</Text>
              </View>
              <View style={[styles.totalsRow, { marginTop: 2 }]}>
                <Text style={styles.grandLabel}>Balance Due</Text>
                <Text style={styles.grandValue}>{fmtUsd(balanceDue)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Notes (optional) */}
        {notes && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.smallLabel}>Notes</Text>
            <Text style={styles.blockBody}>{notes}</Text>
          </View>
        )}

        {/* Payment instructions */}
        <View style={styles.paymentBox}>
          <Text style={styles.paymentTitle}>Payment</Text>
          <Text style={styles.blockBody}>
            Pay online through your job portal, or contact Ana DeAngelis for wire details.
            Mail checks to SirReel Studio Services, 8500 Lankershim Blvd, Sun Valley, CA 91352.
          </Text>
        </View>

        {/* Footer */}
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
