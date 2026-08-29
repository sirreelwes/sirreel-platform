import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { computeOrderTotals } from '@/lib/orders/discountedTotals'
import { LINE_ITEM_DEPARTMENT_ORDER } from '@/lib/orders/lineItemDepartments'
import { PDF_BRAND } from '@/lib/pdf/brand'
import { discountDisplayLabel } from '@/lib/orders/discountLabel'

// Hyphenation is registered ONCE in lib/pdf/hyphenation (it's a global,
// last-registration-wins setting — see that module for the policy and
// the load-order bug this replaces). Do not register a callback here.
import '@/lib/pdf/hyphenation'

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
// "QUOTE" title, customer/agent/
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
  | 'WARDROBE_MAKEUP'

export interface QuoteLineItem {
  id?: string
  /** Partner ancillaries hang under their unit — see groupByDepartment. */
  parentLineItemId?: string | null
  /** Set during grouping, not by the caller: render this row indented. */
  isChild?: boolean
  /** An included accessory (InventoryKitPiece) — gear that rides along
   *  with the line above it at no charge. Rendered as "Included" rather
   *  than "$0.00": the client is accountable for returning it, and a
   *  column of zeroes reads as a pricing mistake, not as a promise. */
  isIncludedAccessory?: boolean
  department: Department
  description: string
  qualifier: string | null
  inventoryCode: string | null   // "Item" column — InventoryItem.code if matched
  quantity: number
  rate: number                   // numeric (Decimal converted)
  rateType: 'DAILY' | 'WEEKLY' | 'FLAT'
  pickupDate: Date | string
  returnDate: Date | string
  /** NULL = explicitly undated (STEP 1C). The PDF renders the days
   *  cell as "TBD" and the line total as the per-day rate prefixed
   *  with "/day"; the per-line and order-level totals reflect $0 for
   *  this line. The Send Quote validator should block firm-total
   *  sends when any non-EXPENDABLE line carries null. */
  billableDays: number | null
  /** Server-derived rental-period day count (pickup→return). When
   *  billableDays differs, the PDF prints the concession explicitly —
   *  "Billable days: N (rental period X–Y)" — never a silent lower
   *  number. */
  computedDays?: number | null
  lineTotal: number
  isDiscount?: boolean
  /** type=FEE lines (fee catalog) — rendered in their own "Fees"
   *  section after the department groups instead of inside
   *  PRO_SUPPLIES, so charges never mingle with gear. */
  isFee?: boolean
  /** Client-facing small-print rendered below the description. Seeded
   *  at line-add time from InventoryItem.clientNote (e.g. LED Wall
   *  A/V Tech requirement); same italic style as the qualifier. */
  notes?: string | null
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

export interface QuoteDiscountInput {
  scope: 'ORDER' | 'DEPARTMENT'
  departmentKey: Department | null
  /** FLAT_TOTAL is ORDER-scope only — `value` is the target grand total,
   *  not a derived discount. The renderer feeds this straight through
   *  to computeOrderTotals, which does the live derivation. */
  type: 'PERCENT' | 'FIXED' | 'FLAT_TOTAL'
  value: number
  label: string
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
  /** Structured discounts (OrderDiscount rows). Dept discounts render
   *  UNDER each affected section's subtotal; the order-scope discount
   *  renders between Subtotal and Tax in the totals block. Empty/absent
   *  → original layout, byte-identical to pre-discount quotes. */
  discounts?: QuoteDiscountInput[]
  company: QuoteCompanyForRender
  jobContact: QuoteContactForRender | null
  agent: QuoteAgentForRender
  job: QuoteJobForRender | null
  generatedAt?: Date
}

// ─────────────────────────────────────────────────────────────────────
// Department labels & ordering
// ─────────────────────────────────────────────────────────────────────

const DEPT_LABELS: Record<Department, string> = {
  VEHICLES: 'Vehicles',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Studios',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'Grip & Electric',
  ART: 'Art Department',
  WARDROBE_MAKEUP: 'Wardrobe & Makeup',
}

// Section ordering — shared with the internal order-detail table so the
// PDF the client commented on and the page the rep edits flow in the
// same order. Single source: src/lib/orders/lineItemDepartments.ts.
const DEPT_ORDER: readonly Department[] = LINE_ITEM_DEPARTMENT_ORDER

// ─────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────


/**
 * Calendar dates (pickup, return, due) — UTC, never local.
 *
 * Separate from fmtDate() on purpose: that one also renders INSTANTS
 * (createdAt, signedAt, …) where local time is correct. Pinning it to UTC
 * would fix the rental dates and break the timestamps. See
 * src/lib/dates/calendarDate.ts.
 */
function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { ...{ year: 'numeric', month: 'short', day: 'numeric' }, timeZone: 'UTC' })
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Rental usage period — calendar dates, so fmtDay (UTC), not fmtDate. */
function fmtDateRange(start: Date | string | null, end: Date | string | null): string {
  if (!start && !end) return '—'
  if (start && end) return `${fmtDay(start)} – ${fmtDay(end)}`
  return fmtDay(start || end)
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

/**
 * The item code as a CLIENT should see it, or nothing.
 *
 * `InventoryItem.code` is two populations wearing one field. RentalWorks
 * rows carry a real catalog number a client can quote back at us
 * ("104387"); HQ-native rows carry an internal slug
 * ("COM--SURVEILLANCE-KIT", "TAB--DIRECTORS-CHAIRS-LOW") that means
 * nothing outside this database. The slugs are also long enough to
 * truncate, and a code shown as "TAB-DIRECTOR-..." is worse than no code
 * - it looks like the document is broken.
 *
 * So: collapse the doubled separators, and print it only if it fits
 * whole. The description already names the item.
 */
function clientItemCode(code: string | null | undefined): string {
  const compact = (code ?? '').replace(/-{2,}/g, '-').trim()
  if (!compact) return '\u2014'
  return compact.length <= 14 ? compact : '\u2014'
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
  // (STEP 1C) NULL = undated rate-card line — contributes $0 to the
  // PDF's per-line and order totals. The cell shows the per-day rate
  // instead; the Send Quote validator ensures we never emit a firm
  // total off this state.
  if (item.billableDays == null) return 0
  return item.quantity * item.billableDays * item.rate
}

// Section key: a real department, or the synthetic FEES bucket that
// collects type=FEE lines regardless of their storage department.
type SectionKey = Department | 'FEES'

function sectionLabel(key: SectionKey): string {
  return key === 'FEES' ? 'Fees' : DEPT_LABELS[key]
}

function groupByDepartment(items: QuoteLineItem[]): Array<{ dept: SectionKey; items: QuoteLineItem[]; subtotal: number }> {
  const lineItems = items.filter((l) => !l.isDiscount)
  const buckets = new Map<Department, QuoteLineItem[]>()
  const feeLines: QuoteLineItem[] = []

  // Children first: a fee that belongs to a unit renders directly beneath
  // that unit, inside ITS section, not hoisted into "Fees" at the end of the
  // document. Two coaches each carry their own mileage and hours, and a
  // reader has to be able to tell whose is whose — which a single pooled
  // Fees section cannot show.
  const childrenOf = new Map<string, QuoteLineItem[]>()
  for (const it of lineItems) {
    const parent = it.parentLineItemId
    if (!parent) continue
    const list = childrenOf.get(parent) ?? []
    list.push({ ...it, isChild: true })
    childrenOf.set(parent, list)
  }

  for (const it of lineItems) {
    if (it.parentLineItemId) continue // placed under its parent below
    const kids = (it.id && childrenOf.get(it.id)) || []
    // A standalone fee (no parent) keeps the old behaviour.
    if (it.isFee && kids.length === 0) { feeLines.push(it); continue }
    const list = buckets.get(it.department) ?? []
    list.push(it, ...kids)
    buckets.set(it.department, list)
  }
  // Order departments per DEPT_ORDER; any unexpected departments fall to the end.
  const ordered: Array<{ dept: SectionKey; items: QuoteLineItem[]; subtotal: number }> = []
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
  // Fees always render LAST — charges close the document, after gear.
  if (feeLines.length > 0) {
    const subtotal = feeLines.reduce((s, l) => s + computeLineTotal(l), 0)
    ordered.push({ dept: 'FEES', items: feeLines, subtotal })
  }
  return ordered
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

/** Shared brand palette — see lib/pdf/brand.ts. Quote and Invoice must
 *  not drift apart; a client sees both. */
const C = PDF_BRAND

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
  docTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    letterSpacing: 2,
    color: C.accent,
  },
  meta: { flexDirection: 'column', alignItems: 'flex-end' },
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
    marginTop: 6,
    marginBottom: 12,
  },
  // Single consolidated info card with three internal sections divided
  // by 1px vertical rules. Sections stretch to the full card height
  // (flexbox default) so the rules extend even when content lengths
  // differ. Proportions roughly 25/45/30 — Production carries the most
  // content (Job, Job Code, Description, Usage Period) so it gets the
  // widest column.
  infoCard: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 3,
    marginBottom: 12,
    backgroundColor: C.accentFillSoft,
  },
  infoSection: { padding: 8 },
  infoSectionCustomer:   { width: '25%' },
  infoSectionProduction: { width: '45%', borderLeftWidth: 0.5, borderLeftColor: C.accentEdge },
  infoSectionAgent:      { width: '30%', borderLeftWidth: 0.5, borderLeftColor: C.accentEdge },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.accent,
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
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.25,
    borderBottomColor: C.ruleSoft,
  },
  rowAlt: { backgroundColor: C.zebra },
  // Column widths sum to 100
  colCode: { width: '14%', fontSize: 9, paddingRight: 4 },
  codeText: { fontSize: 8, color: C.muted, maxLines: 1, textOverflow: 'ellipsis' },
  colDesc: { width: '40%', fontSize: 9, paddingRight: 4 },
  /** Same column, inset — partner ancillaries under their unit. */
  colDescChild: { width: '40%', fontSize: 9, paddingRight: 4, paddingLeft: 10, color: C.muted },
  colQty: { width: '7%', fontSize: 9, textAlign: 'right' },
  colDays: { width: '8%', fontSize: 9, textAlign: 'right' },
  /** The calendar span next to the billed days — "1 / 5". */
  daysSpan: { fontSize: 7, color: C.faint },
  colRate: { width: '15%', fontSize: 9, textAlign: 'right' },
  colTotal: { width: '16%', fontSize: 9, textAlign: 'right' },
  qualifier: { fontSize: 8, color: C.muted, fontStyle: 'italic', marginTop: 1 },
  dateNote: { fontSize: 8, color: C.faint, marginTop: 1 },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    marginTop: 1,
    borderTopWidth: 0.5,
    borderTopColor: C.accentEdge,
  },
  subtotalLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: C.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    // Fixed width so every tinted label block lines up with the ones
    // above and below it. Auto-width left the section subtotal and the
    // discount row ragged against each other.
    width: 150,
    textAlign: 'right',
    backgroundColor: C.accentFill,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  subtotalValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    width: '16%',
    textAlign: 'right',
    backgroundColor: C.moneyFill,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  // Discount row
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginTop: 6,
  },
  discountLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.amber },
  discountValue: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.amber, width: '16%', textAlign: 'right' },
  // Totals
  totals: {
    marginTop: 12,
    paddingTop: 8,
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
    width: 110,
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
    width: 110,
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
            <Text style={styles.docTitle}>QUOTE</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaNum}>{props.orderNumber}</Text>
            <Text style={styles.metaLine}>Issued: {fmtDate(generatedAt)}</Text>
            <Text style={styles.metaLine}>Valid until: {fmtDate(expiresAt)}</Text>
          </View>
        </View>
        <View style={styles.hrThick} />

        {/* Consolidated info card — one bordered container, three
            sections divided by 1px vertical rules. Sections fill the
            full height of the card automatically (flex row default).
            Per-section contact info now lives in the People section
            below; Customer here is just the Company. */}
        <View style={styles.infoCard}>
          <View style={[styles.infoSection, styles.infoSectionCustomer]}>
            <Text style={styles.infoTitle}>Customer</Text>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Company</Text>
              <Text style={styles.infoValue}>{props.company.name}</Text>
            </View>
          </View>

          <View style={[styles.infoSection, styles.infoSectionProduction]}>
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

          <View style={[styles.infoSection, styles.infoSectionAgent]}>
            <Text style={styles.infoTitle}>SirReel Agent</Text>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{props.agent.name}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{props.agent.email}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Quote #</Text>
              <Text style={styles.infoValue}>{props.orderNumber}</Text>
            </View>
          </View>
        </View>

        {/* Line items per department */}
        {grouped.map(({ dept, items, subtotal }) => (
          // The section must be allowed to SPLIT across pages. It used to
          // carry wrap={false}, which tells react-pdf "never break this" —
          // fine for a 3-line department, catastrophic for an 18-line one:
          // once the block is taller than a page, react-pdf gives up on
          // laying it out (the "Node of type VIEW can't wrap between pages"
          // warning) and renders the rows ON TOP OF EACH OTHER. Clients
          // were receiving quotes with the description, the date note and
          // the next row all overprinted.
          //
          // wrap={false} belongs on the ROW — a single line item should
          // never be split down the middle — which is exactly what
          // InvoiceDocument and PickListDocument already do.
          <View key={dept}>
            {/* minPresenceAhead keeps the band from being orphaned at the
                foot of a page with its rows stranded overleaf. */}
            <View style={styles.sectionHeader} wrap={false} minPresenceAhead={60}>
              <Text style={styles.sectionTitle}>{sectionLabel(dept)}</Text>
              <Text style={styles.sectionSub}>{items.length} {items.length === 1 ? 'item' : 'items'}</Text>
            </View>
            <View style={styles.tableHead} wrap={false} minPresenceAhead={40}>
              <Text style={styles.colCode}>Item</Text>
              <Text style={styles.colDesc}>Description</Text>
              <Text style={styles.colQty}>Qty</Text>
              <Text style={styles.colDays}>Days</Text>
              <Text style={styles.colRate}>Rate</Text>
              <Text style={styles.colTotal}>Total</Text>
            </View>
            {items.map((item, idx) => {
              return (
                <View key={idx} style={[styles.row, idx % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
                  {/* Wrap the inventory code in a View (mirrors colDesc)
                      so the column acts as a hard layout container.
                      Without this, a Text whose content is wider than
                      its width style renders glyphs past the right
                      edge and over the next cell — the symptom this
                      patch is fixing. */}
                  <View style={styles.colCode}>
                    {/* Capped to a single line. HQ-native codes are slugs
                        ("VEH--STRAPS--RATCHET") that wrapped to three lines
                        and set the height of the whole row — three lines of
                        internal SKU next to a two-word description. */}
                    <Text style={styles.codeText}>{clientItemCode(item.inventoryCode)}</Text>
                  </View>
                  <View style={item.isChild ? styles.colDescChild : styles.colDesc}>
                    <Text>{item.isChild ? `\u2514  ${item.description}` : item.description}</Text>
                    {item.qualifier && <Text style={styles.qualifier}>{item.qualifier}</Text>}
                    {item.notes && item.notes.trim().length > 0 && (
                      <Text style={styles.qualifier}>{item.notes}</Text>
                    )}
                    {/* The per-line date range and the "Billable days: N
                        (rental period …)" sentence used to live here, three
                        wrapped lines under EVERY item. Both were saying what
                        the document already says: the usage period is in the
                        header, and the billed-vs-calendar split now rides in
                        the Days column as "1 / 5" — the same shorthand the
                        order page uses.

                        The per-line date range is gone outright (Wes, 8/29),
                        not just when it matched the header. It almost never
                        matched — the order header carries the USAGE period
                        (Sep 5–8) while lines carry the RENTAL window that
                        brackets it (Sep 4–9) — so the "only show it when it
                        differs" guard printed it on virtually every line. A
                        date under all 22 items is noise, not information. */}
                  </View>
                  <Text style={styles.colQty}>{item.quantity}</Text>
                  <Text style={styles.colDays}>
                    {item.billableDays ?? 'TBD'}
                    {item.billableDays != null &&
                      item.computedDays != null &&
                      item.billableDays !== item.computedDays && (
                        <Text style={styles.daysSpan}> / {item.computedDays}</Text>
                      )}
                  </Text>
                  <Text style={styles.colRate}>
                    {item.isIncludedAccessory && item.rate === 0
                      ? 'Included'
                      : `${fmtMoney(item.rate)}${rateUnit(item.rateType)}`}
                  </Text>
                  <Text style={styles.colTotal}>
                    {item.isIncludedAccessory && item.rate === 0
                      ? '—'
                      : item.billableDays == null
                        ? `${fmtMoney(item.rate)}/day`
                        : fmtMoney(computeLineTotal(item))}
                  </Text>
                </View>
              )
            })}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>{sectionLabel(dept)} Subtotal</Text>
              <Text style={styles.subtotalValue}>{fmtMoney(subtotal)}</Text>
            </View>
            {/* Department discount line — renders directly under the
                section subtotal when a DEPARTMENT-scope OrderDiscount
                applies. Clamped to the section subtotal so the visible
                amount can never exceed what's being discounted. */}
            {(() => {
              const d = (props.discounts ?? []).find((x) => x.scope === 'DEPARTMENT' && x.departmentKey === dept)
              if (!d) return null
              const raw = d.type === 'PERCENT' ? subtotal * (d.value / 100) : d.value
              const amt = Math.round(Math.max(0, Math.min(raw, subtotal)) * 100) / 100
              if (amt <= 0) return null
              return (
                <View style={styles.subtotalRow}>
                  <Text style={styles.subtotalLabel}>
                    {discountDisplayLabel({ label: d.label, type: d.type, value: d.value })}
                  </Text>
                  <Text style={styles.subtotalValue}>-{fmtMoney(amt)}</Text>
                </View>
              )
            })()}
          </View>
        ))}

        {/* Discount line items */}
        {discountItems.map((item, idx) => (
          <View key={`disc-${idx}`} style={styles.discountRow}>
            <Text style={styles.discountLabel}>{item.description || 'Discount'}</Text>
            <Text style={styles.discountValue}>{fmtMoney(computeLineTotal(item))}</Text>
          </View>
        ))}

        {/* Totals — derived from the shared discount-aware util
            (src/lib/orders/discountedTotals.ts). Same math that
            recalcOrderTotals persists to the Order row, so the PDF
            grand total matches what the order detail UI shows. With
            ZERO discounts the util's output is bit-identical to the
            legacy `subtotal × taxRate` math — no regression on
            pre-discount quotes. */}
        {(() => {
          const breakdown = computeOrderTotals({
            lines: props.lineItems.map((l) => ({
              department: l.department,
              type: l.isDiscount ? 'DISCOUNT' as const : 'EQUIPMENT' as const,
              lineTotal: computeLineTotal(l),
            })),
            discounts: (props.discounts ?? []).map((d) => ({
              scope: d.scope,
              departmentKey: d.departmentKey,
              type: d.type,
              value: d.value,
              label: d.label,
            })),
            taxRate: props.taxRate,
          })
          // (STEP 1C) When any non-discount line has null billableDays,
          // this is an explicit rate-card quote — dates are TBD and the
          // firm total reflects only the dated lines. Surface a banner
          // so the client doesn't read the displayed total as final.
          const undatedLineCount = props.lineItems.filter(
            (l) => !l.isDiscount && l.billableDays == null
          ).length
          const isRateCardQuote = undatedLineCount > 0
          return (
            <View style={styles.totals}>
              {isRateCardQuote && (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: '#b45309', fontSize: 9 }]}>
                    DATES TBD — RATE CARD ({undatedLineCount} line{undatedLineCount === 1 ? '' : 's'} priced /day)
                  </Text>
                  <Text style={styles.totalsValue}> </Text>
                </View>
              )}
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{isRateCardQuote ? 'Subtotal (dated lines)' : 'Subtotal'}</Text>
                <Text style={styles.totalsValue}>{fmtMoney(breakdown.rawSubtotal)}</Text>
              </View>
              {/* Order-scope discount line — sits between Subtotal and
                  Tax. Dept discounts already rendered under their
                  section subtotals above. */}
              {breakdown.orderDiscount > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>
                    {(() => {
                      const row = (props.discounts ?? []).find((x) => x.scope === 'ORDER')
                      return discountDisplayLabel({
                        label: breakdown.orderDiscountLabel,
                        type: row?.type ?? 'FIXED',
                        value: row ? row.value : 0,
                        fallback: 'Order discount',
                      })
                    })()}
                  </Text>
                  <Text style={styles.totalsValue}>-{fmtMoney(breakdown.orderDiscount)}</Text>
                </View>
              )}
              {breakdown.taxAmount > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>
                    Tax {props.taxRate > 0 ? `(${(props.taxRate * 100).toFixed(3)}%)` : ''}
                  </Text>
                  <Text style={styles.totalsValue}>{fmtMoney(breakdown.taxAmount)}</Text>
                </View>
              )}
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <Text style={styles.grandValue}>{fmtMoney(breakdown.total)}</Text>
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
