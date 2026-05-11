import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

// Load the SirReel logo once at module load (server-only — the QuoteDocument
// is rendered exclusively via renderToBuffer in the API route). Passing the
// raw Buffer to React-PDF's Image is the most reliable path on Vercel
// serverless: no network round-trip, no host-detection for absolute URLs.
const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch (err) {
  console.warn('[QuoteDocument] failed to load sirreel-logo.png, falling back to text brand:', err)
}

// SirReel Quote PDF — spirit-of the RentalWorks quote layout, modernized
// typography and palette. Mirrors the contract-review counter-PDF
// pattern: rendered server-side via @react-pdf/renderer, uploaded to
// Vercel Blob, URL stored on Order.
//
// Field coverage matches the RentalWorks samples: top band with logo +
// title (and optional dominant-department category), customer/agent/
// billing/usage info-box row, three-column issued-to / outgoing /
// incoming row, line items grouped by department with subtotals,
// grand total, footer with page numbers.

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type Department =
  | 'VEHICLES'
  | 'COMMUNICATIONS'
  | 'STAGES'
  | 'PRO_SUPPLIES'
  | 'EXPENDABLES'
  | 'GE'
  | 'ART'

export interface QuoteLineItem {
  department: Department
  description: string
  qualifier: string | null
  inventoryCode: string | null   // "I-Code" column — InventoryItem.code if matched
  quantity: number
  rate: number                   // numeric (Decimal converted)
  rateType: 'DAILY' | 'WEEKLY' | 'FLAT'
  pickupDate: Date | string
  returnDate: Date | string
  billableDays: number
  lineTotal: number
  isDiscount?: boolean
}

export interface QuoteCompanyForRender {
  name: string
  billingAddress: string | null
  billingEmail: string | null
}

export interface QuoteContactForRender {
  fullName: string | null
  email: string | null
  phone: string | null
}

export interface QuoteAgentForRender {
  name: string
  email: string
  phone: string | null
}

export interface QuoteJobForRender {
  jobCode: string | null
  name: string | null
}

export interface QuoteDocumentProps {
  orderNumber: string
  description: string | null
  startDate: Date | string | null
  endDate: Date | string | null
  notes: string | null
  subtotal: number
  taxRate: number      // decimal, e.g. 0.0875
  taxAmount: number
  total: number
  quoteExpDays: number
  lineItems: QuoteLineItem[]
  company: QuoteCompanyForRender
  jobContact: QuoteContactForRender | null
  agent: QuoteAgentForRender
  job: QuoteJobForRender | null
  generatedAt?: Date
}

// ─────────────────────────────────────────────────────────────────────
// Department labels & dominant-category detection
// ─────────────────────────────────────────────────────────────────────

const DEPT_LABELS: Record<Department, string> = {
  VEHICLES: 'Trucking',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Studios',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'Grip & Electric',
  ART: 'Art Department',
}

// Section ordering — mirrors the new-quote builder grouping so the PDF
// flows in the same order the agent saw on screen.
const DEPT_ORDER: Department[] = [
  'VEHICLES',
  'GE',
  'COMMUNICATIONS',
  'STAGES',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'ART',
]

// 70% by line-item dollar value triggers a category label above QUOTE.
// Below that, omit the label entirely (mixed department quote).
export function deriveDominantCategory(items: QuoteLineItem[]): string | null {
  const nonDiscount = items.filter((l) => !l.isDiscount)
  const totalValue = nonDiscount.reduce((sum, l) => sum + Math.abs(computeLineTotal(l)), 0)
  if (totalValue <= 0) return null
  const byDept = new Map<Department, number>()
  for (const l of nonDiscount) {
    byDept.set(l.department, (byDept.get(l.department) ?? 0) + Math.abs(computeLineTotal(l)))
  }
  for (const [dept, value] of byDept) {
    if (value / totalValue >= 0.7) return DEPT_LABELS[dept]
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateRange(start: Date | string | null, end: Date | string | null): string {
  if (!start && !end) return '—'
  if (start && end) return `${fmtDate(start)} – ${fmtDate(end)}`
  return fmtDate(start || end)
}

function fmtTimestamp(d: Date): string {
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(n)
}

function rateUnit(rateType: QuoteLineItem['rateType']): string {
  if (rateType === 'WEEKLY') return '/wk'
  if (rateType === 'DAILY') return '/day'
  return ''
}

// Compute the line total inline rather than trusting the persisted
// lineTotal column. The OrderLineItem write path doesn't always populate
// it, so renders pulled stale $0s — and the cascade zeroed the subtotal
// and grand total too. Rule: quantity × days × rate for time-based
// rentals; quantity × rate for FLAT and discount lines (where days is
// meaningless / defaults to 1 but could be anything).
function computeLineTotal(item: QuoteLineItem): number {
  if (item.isDiscount || item.rateType === 'FLAT') {
    return item.quantity * item.rate
  }
  return item.quantity * item.billableDays * item.rate
}

function groupByDepartment(items: QuoteLineItem[]): Array<{ dept: Department; items: QuoteLineItem[]; subtotal: number }> {
  const lineItems = items.filter((l) => !l.isDiscount)
  const buckets = new Map<Department, QuoteLineItem[]>()
  for (const it of lineItems) {
    const list = buckets.get(it.department) ?? []
    list.push(it)
    buckets.set(it.department, list)
  }
  // Order departments per DEPT_ORDER; any unexpected departments fall to the end.
  const ordered: Array<{ dept: Department; items: QuoteLineItem[]; subtotal: number }> = []
  for (const dept of DEPT_ORDER) {
    const list = buckets.get(dept)
    if (list && list.length > 0) {
      const subtotal = list.reduce((s, l) => s + computeLineTotal(l), 0)
      ordered.push({ dept, items: list, subtotal })
      buckets.delete(dept)
    }
  }
  for (const [dept, list] of buckets) {
    const subtotal = list.reduce((s, l) => s + computeLineTotal(l), 0)
    ordered.push({ dept, items: list, subtotal })
  }
  return ordered
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

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
  // Top band
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
  category: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: C.muted,
    marginBottom: 2,
  },
  docTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    letterSpacing: 2,
  },
  meta: { flexDirection: 'column', alignItems: 'flex-end' },
  metaNum: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  metaLine: { fontSize: 9, color: C.muted, marginTop: 2 },
  hrThick: {
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    marginTop: 6,
    marginBottom: 12,
  },
  // Info boxes
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  infoBlock: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: C.rule,
    borderRadius: 3,
    padding: 7,
  },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.muted,
    marginBottom: 4,
  },
  infoLine: { flexDirection: 'row', marginBottom: 1.5 },
  infoLabel: { width: '42%', fontSize: 9, color: C.muted },
  infoValue: { width: '58%', fontSize: 9 },
  // Line items table
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
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
  colCode: { width: '11%', fontSize: 9 },
  colDesc: { width: '40%', fontSize: 9, paddingRight: 4 },
  colQty: { width: '7%', fontSize: 9, textAlign: 'right' },
  colDays: { width: '8%', fontSize: 9, textAlign: 'right' },
  colRate: { width: '15%', fontSize: 9, textAlign: 'right' },
  colTotal: { width: '19%', fontSize: 9, textAlign: 'right' },
  qualifier: { fontSize: 8, color: C.muted, fontStyle: 'italic', marginTop: 1 },
  dateNote: { fontSize: 8, color: C.faint, marginTop: 1 },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    marginTop: 1,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
  },
  subtotalLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 16,
  },
  subtotalValue: { fontFamily: 'Helvetica-Bold', fontSize: 9, width: '19%', textAlign: 'right' },
  // Discount row
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginTop: 6,
  },
  discountLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.amber },
  discountValue: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.amber, width: '19%', textAlign: 'right' },
  // Totals
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
    width: 110,
    textAlign: 'right',
  },
  totalsValue: { fontSize: 10, width: 100, textAlign: 'right' },
  grandLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginRight: 16,
    width: 110,
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
  notesBlock: {
    marginTop: 16,
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
  // Footer
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

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function QuoteDocument(props: QuoteDocumentProps): React.ReactElement {
  const generatedAt = props.generatedAt ?? new Date()
  const category = deriveDominantCategory(props.lineItems)
  const grouped = groupByDepartment(props.lineItems)
  const discountItems = props.lineItems.filter((l) => l.isDiscount)
  const usagePeriod = fmtDateRange(props.startDate, props.endDate)

  // Expiration line — "Valid for X days from <date>"
  const expiresAt = (() => {
    const days = props.quoteExpDays ?? 7
    const d = new Date(generatedAt)
    d.setDate(d.getDate() + days)
    return d
  })()

  // Customer block info (Customer + Contact)
  const contactFullName = props.jobContact?.fullName || null
  const contactEmail = props.jobContact?.email || props.company.billingEmail || null
  const contactPhone = props.jobContact?.phone || null

  return (
    <Document
      title={`SirReel Quote ${props.orderNumber}`}
      author="SirReel Production Vehicles"
      subject={props.description || 'Rental Quote'}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Top band: brand left, title center, doc meta right */}
        <View style={styles.topBand}>
          <View style={styles.brand}>
            {LOGO_BUFFER ? (
              <Image src={LOGO_BUFFER} style={styles.brandLogo} />
            ) : (
              <Text style={styles.brandName}>SirReel</Text>
            )}
            <Text style={styles.brandSub}>Production Vehicles, Inc.</Text>
            <Text style={styles.brandAddress}>8500 Lankershim Blvd</Text>
            <Text style={styles.brandAddress}>Sun Valley, CA 91352</Text>
            <Text style={styles.brandAddress}>(888) 477-7335</Text>
          </View>
          <View style={styles.titleColumn}>
            {category && <Text style={styles.category}>{category}</Text>}
            <Text style={styles.docTitle}>QUOTE</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaNum}>{props.orderNumber}</Text>
            <Text style={styles.metaLine}>Issued: {fmtDate(generatedAt)}</Text>
            <Text style={styles.metaLine}>Valid until: {fmtDate(expiresAt)}</Text>
          </View>
        </View>
        <View style={styles.hrThick} />

        {/* Info-box row */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoTitle}>Customer</Text>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Company</Text>
              <Text style={styles.infoValue}>{props.company.name}</Text>
            </View>
            {props.company.billingAddress && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Address</Text>
                <Text style={styles.infoValue}>{props.company.billingAddress}</Text>
              </View>
            )}
            {contactFullName && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Contact</Text>
                <Text style={styles.infoValue}>{contactFullName}</Text>
              </View>
            )}
            {contactEmail && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{contactEmail}</Text>
              </View>
            )}
            {contactPhone && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{contactPhone}</Text>
              </View>
            )}
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoTitle}>Production</Text>
            {props.job?.name && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Job</Text>
                <Text style={styles.infoValue}>{props.job.name}</Text>
              </View>
            )}
            {props.job?.jobCode && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Job Code</Text>
                <Text style={styles.infoValue}>{props.job.jobCode}</Text>
              </View>
            )}
            {props.description && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Description</Text>
                <Text style={styles.infoValue}>{props.description}</Text>
              </View>
            )}
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Usage Period</Text>
              <Text style={styles.infoValue}>{usagePeriod}</Text>
            </View>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoTitle}>SirReel Agent</Text>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{props.agent.name}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{props.agent.email}</Text>
            </View>
            {props.agent.phone && (
              <View style={styles.infoLine}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{props.agent.phone}</Text>
              </View>
            )}
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Quote #</Text>
              <Text style={styles.infoValue}>{props.orderNumber}</Text>
            </View>
          </View>
        </View>

        {/* Line items per department */}
        {grouped.map(({ dept, items, subtotal }) => (
          <View key={dept} wrap={false}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{DEPT_LABELS[dept]}</Text>
              <Text style={styles.sectionSub}>{items.length} {items.length === 1 ? 'item' : 'items'}</Text>
            </View>
            <View style={styles.tableHead}>
              <Text style={styles.colCode}>I-Code</Text>
              <Text style={styles.colDesc}>Description</Text>
              <Text style={styles.colQty}>Qty</Text>
              <Text style={styles.colDays}>Days</Text>
              <Text style={styles.colRate}>Rate</Text>
              <Text style={styles.colTotal}>Total</Text>
            </View>
            {items.map((item, idx) => {
              const sameAsHeaderRange =
                props.startDate &&
                props.endDate &&
                fmtDate(item.pickupDate) === fmtDate(props.startDate) &&
                fmtDate(item.returnDate) === fmtDate(props.endDate)
              return (
                <View key={idx} style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]}>
                  <Text style={styles.colCode}>{item.inventoryCode || '—'}</Text>
                  <View style={styles.colDesc}>
                    <Text>{item.description}</Text>
                    {item.qualifier && <Text style={styles.qualifier}>{item.qualifier}</Text>}
                    {!sameAsHeaderRange && (
                      <Text style={styles.dateNote}>
                        {fmtDate(item.pickupDate)} – {fmtDate(item.returnDate)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.colQty}>{item.quantity}</Text>
                  <Text style={styles.colDays}>{item.billableDays}</Text>
                  <Text style={styles.colRate}>{fmtMoney(item.rate)}{rateUnit(item.rateType)}</Text>
                  <Text style={styles.colTotal}>{fmtMoney(computeLineTotal(item))}</Text>
                </View>
              )
            })}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>{DEPT_LABELS[dept]} Subtotal</Text>
              <Text style={styles.subtotalValue}>{fmtMoney(subtotal)}</Text>
            </View>
          </View>
        ))}

        {/* Discount line items */}
        {discountItems.map((item, idx) => (
          <View key={`disc-${idx}`} style={styles.discountRow}>
            <Text style={styles.discountLabel}>{item.description || 'Discount'}</Text>
            <Text style={styles.discountValue}>{fmtMoney(computeLineTotal(item))}</Text>
          </View>
        ))}

        {/* Totals — derived from computed line totals, NOT the stored
            Order.subtotal/taxAmount/total fields. Those were summed
            from a stale OrderLineItem.lineTotal column at save time
            and routinely read as $0 (see fix in commit history). */}
        {(() => {
          const computedSubtotal = props.lineItems.reduce(
            (s, l) => s + computeLineTotal(l),
            0,
          )
          const computedTaxAmount = computedSubtotal > 0 ? computedSubtotal * props.taxRate : 0
          const computedGrandTotal = computedSubtotal + computedTaxAmount
          return (
            <View style={styles.totals}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>{fmtMoney(computedSubtotal)}</Text>
              </View>
              {computedTaxAmount > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>
                    Tax {props.taxRate > 0 ? `(${(props.taxRate * 100).toFixed(3)}%)` : ''}
                  </Text>
                  <Text style={styles.totalsValue}>{fmtMoney(computedTaxAmount)}</Text>
                </View>
              )}
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandValue}>{fmtMoney(computedGrandTotal)}</Text>
              </View>
            </View>
          )
        })()}

        {/* Notes (only if present) */}
        {props.notes && (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesBody}>{props.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Generated {fmtTimestamp(generatedAt)} · SirReel HQ</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
