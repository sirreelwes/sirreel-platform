import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, Svg, Rect, StyleSheet } from '@react-pdf/renderer'
import { code39Geometry } from './code39'

// Shared hyphenation policy — registered once, see that module.
import '@/lib/pdf/hyphenation'

// SirReel warehouse Pick List PDF — layout modeled on the RentalWorks
// pick list (the 304572-001 "Cargo Van & Supplies" sample Wes supplied
// 2026-08-28): brand block + PICK LIST title + order-number barcode up
// top, three-section info band, line items grouped by department with
// Ordered / Out / Remaining counts and handwriting boxes for Picked /
// Verified, per-section + grand totals, PICKED BY signature line.
//
// Rendered on demand by GET /api/orders/[id]/pick-list-pdf — never
// stored in Blob, because it prints the LIVE pick state (Out/Remaining
// move as the picking floor scans items) and a stored copy would lie.

const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch (err) {
  console.warn('[PickListDocument] failed to load sirreel-logo.png, falling back to text brand:', err)
}

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

export interface PickListLine {
  department: Department
  /** InventoryItem.code — the scannable SKU. Null on custom lines. */
  code: string | null
  description: string
  /** Line notes → the indented "Notes:" sub-row (e.g. "Check for
   *  Drain Plug ( ) Initial."). */
  notes: string | null
  /** RENT (rentals), SALE (expendables), LABOR. */
  type: 'RENT' | 'SALE' | 'LABOR'
  ordered: number
  /** Quantity already pulled — pickStatus PICKED/STAGED/LOADED (or
   *  fleet-ready for FLEET lines). Remaining = ordered − out. */
  out: number
  /** True when the digital picking floor already marked this line
   *  picked — prints a ✓ in the Picked box instead of leaving it
   *  blank for handwriting. */
  picked: boolean
}

export interface PickListDocumentProps {
  orderNumber: string
  description: string | null
  companyName: string
  jobCode: string | null
  jobName: string | null
  /** DELIVER / WILL CALL — derived from Order.deliveryRequested. */
  deliveryType: string
  /** PickList.assignedTo (the picker), when one is on the list. */
  assignedToName: string | null
  agentName: string
  startDate: Date | string | null
  endDate: Date | string | null
  pickDate: Date | string | null
  lines: PickListLine[]
  generatedAt?: Date
}

// ─────────────────────────────────────────────────────────────────────
// Department labels & ordering — mirrors QuoteDocument so the pick
// list flows in the same order as the quote the client approved.
// ─────────────────────────────────────────────────────────────────────

const DEPT_LABELS: Record<Department, string> = {
  VEHICLES: 'Vehicles',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Studios',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'Grip & Electric',
  ART: 'Art Department',
}

const DEPT_ORDER: Department[] = [
  'PRO_SUPPLIES',
  'GE',
  'COMMUNICATIONS',
  'EXPENDABLES',
  'ART',
  'STAGES',
  'VEHICLES',
]

function groupByDepartment(lines: PickListLine[]): Array<{ dept: Department; lines: PickListLine[]; total: number }> {
  const buckets = new Map<Department, PickListLine[]>()
  for (const l of lines) {
    const list = buckets.get(l.department) ?? []
    list.push(l)
    buckets.set(l.department, list)
  }
  const ordered: Array<{ dept: Department; lines: PickListLine[]; total: number }> = []
  for (const dept of DEPT_ORDER) {
    const list = buckets.get(dept)
    if (list && list.length > 0) {
      ordered.push({ dept, lines: list, total: list.reduce((s, l) => s + l.ordered, 0) })
      buckets.delete(dept)
    }
  }
  for (const [dept, list] of buckets) {
    ordered.push({ dept, lines: list, total: list.reduce((s, l) => s + l.ordered, 0) })
  }
  return ordered
}

// ─────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────

/** Calendar dates — UTC, never local (see src/lib/dates/calendarDate.ts). */
function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

function fmtTimestamp(d: Date): string {
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Barcode
// ─────────────────────────────────────────────────────────────────────

function Barcode({ value, width, height }: { value: string; width: number; height: number }) {
  const geo = code39Geometry(value)
  const unit = width / geo.totalWidth
  return (
    <Svg width={width} height={height}>
      {geo.bars.map((b, i) => (
        <Rect key={i} x={b.x * unit} y={0} width={b.width * unit} height={height} fill="#111111" />
      ))}
    </Svg>
  )
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
  band: '#f1f1f1',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    lineHeight: 1.3,
    color: C.ink,
  },
  // Top band
  topBand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandCol: { width: '32%' },
  brandLogo: { width: 110, height: 'auto', marginBottom: 5 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 14, marginBottom: 4 },
  brandLine: { flexDirection: 'row', marginBottom: 1 },
  brandLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  brandValue: { fontSize: 8.5 },
  titleCol: { width: '36%', alignItems: 'center' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 24, letterSpacing: 1.5, lineHeight: 1 },
  titleSub: { fontSize: 9, color: C.muted, marginTop: 8 },
  barcodeCol: { width: '28%', alignItems: 'flex-end' },
  barcodeLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 3 },
  barcodeNum: { fontSize: 9, letterSpacing: 3, marginTop: 2 },
  hrThick: {
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    marginTop: 8,
    marginBottom: 10,
  },
  // Info band — three sections divided by vertical rules, like the
  // quote's info card and the RW original's three column groups.
  infoCard: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: C.rule,
    borderRadius: 3,
    marginBottom: 10,
  },
  infoSection: { padding: 7 },
  infoSectionOrder:  { width: '42%' },
  infoSectionRental: { width: '30%', borderLeftWidth: 0.5, borderLeftColor: C.rule },
  infoSectionPeople: { width: '28%', borderLeftWidth: 0.5, borderLeftColor: C.rule },
  infoLine: { flexDirection: 'row', marginBottom: 1.5 },
  infoLabel: { width: '38%', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  infoValue: { width: '62%', fontSize: 8.5 },
  // Table
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: C.ink,
    borderTopWidth: 0.75,
    borderTopColor: C.ink,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  rentalBanner: {
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    backgroundColor: C.band,
  },
  rentalBannerText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    letterSpacing: 1,
    textDecoration: 'underline',
  },
  deptHeader: {
    paddingVertical: 3,
    paddingHorizontal: 2,
    backgroundColor: C.band,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
  },
  deptHeaderText: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 0.25,
    borderBottomColor: C.ruleSoft,
  },
  rowAlt: { backgroundColor: C.zebra },
  notesRow: {
    paddingVertical: 2.5,
    paddingLeft: '14%',
    borderBottomWidth: 0.25,
    borderBottomColor: C.ruleSoft,
    borderStyle: 'dashed',
  },
  notesText: { fontSize: 8, color: C.muted },
  notesLabel: { fontFamily: 'Helvetica-Bold' },
  // Columns sum to 100
  colCode:      { width: '12%', fontSize: 8.5, paddingRight: 3 },
  colDesc:      { width: '38%', fontSize: 8.5, paddingRight: 4 },
  colType:      { width: '8%',  fontSize: 8.5 },
  colOrdered:   { width: '9%',  fontSize: 8.5, textAlign: 'right', paddingRight: 6 },
  colOut:       { width: '8%',  fontSize: 8.5, textAlign: 'right', paddingRight: 6 },
  colRemaining: { width: '10%', fontFamily: 'Helvetica-Bold', fontSize: 8.5, textAlign: 'right', paddingRight: 6 },
  colPicked:    { width: '7.5%', alignItems: 'center' },
  colVerified:  { width: '7.5%', alignItems: 'center' },
  // Handwriting box for Picked / Verified
  checkBox: {
    width: 14,
    height: 12,
    borderWidth: 0.5,
    borderColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 9, fontFamily: 'Helvetica-Bold', lineHeight: 1 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 3.5,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    backgroundColor: C.band,
  },
  totalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, marginRight: 14 },
  totalValue: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, width: '10%', textAlign: 'right', paddingRight: 6 },
  totalSpacer: { width: '15%' },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
  },
  grandTotalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 14 },
  grandTotalValue: { fontFamily: 'Helvetica-Bold', fontSize: 10, width: '10%', textAlign: 'right', paddingRight: 6 },
  // Signature
  signatureRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    marginTop: 36,
  },
  signatureLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 8 },
  signatureLine: {
    width: 220,
    borderBottomWidth: 0.75,
    borderBottomColor: C.ink,
  },
  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: C.faint,
  },
})

// ─────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────

export function PickListDocument(props: PickListDocumentProps) {
  const generatedAt = props.generatedAt ?? new Date()
  const sections = groupByDepartment(props.lines)
  const grandTotal = props.lines.reduce((s, l) => s + l.ordered, 0)

  return (
    <Document title={`Pick List ${props.orderNumber}`} author="SirReel Production Vehicles, Inc.">
      <Page size="LETTER" style={styles.page}>
        {/* Top band */}
        <View style={styles.topBand}>
          <View style={styles.brandCol}>
            {LOGO_BUFFER ? (
              <Image src={LOGO_BUFFER} style={styles.brandLogo} />
            ) : (
              <Text style={styles.brandName}>SirReel</Text>
            )}
            <View style={styles.brandLine}>
              <Text style={styles.brandLabel}>Warehouse: </Text>
              <Text style={styles.brandValue}>Warehouse</Text>
            </View>
            <View style={styles.brandLine}>
              <Text style={styles.brandLabel}>Delivery Type: </Text>
              <Text style={styles.brandValue}>{props.deliveryType}</Text>
            </View>
            <View style={styles.brandLine}>
              <Text style={styles.brandLabel}>Assigned To: </Text>
              <Text style={styles.brandValue}>{props.assignedToName ?? '—'}</Text>
            </View>
            <View style={styles.brandLine}>
              <Text style={styles.brandLabel}>Pick Date: </Text>
              <Text style={styles.brandValue}>{fmtDay(props.pickDate)}</Text>
            </View>
          </View>
          <View style={styles.titleCol}>
            <Text style={styles.docTitle}>PICK LIST</Text>
            <Text style={styles.titleSub}>No: {props.orderNumber}</Text>
          </View>
          <View style={styles.barcodeCol}>
            <Text style={styles.barcodeLabel}>Order No:</Text>
            <Barcode value={props.orderNumber} width={150} height={30} />
            <Text style={styles.barcodeNum}>{props.orderNumber}</Text>
          </View>
        </View>
        <View style={styles.hrThick} />

        {/* Info band */}
        <View style={styles.infoCard}>
          <View style={[styles.infoSection, styles.infoSectionOrder]}>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Order:</Text>
              <Text style={styles.infoValue}>{props.orderNumber}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Description:</Text>
              <Text style={styles.infoValue}>{props.description ?? '—'}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Customer:</Text>
              <Text style={styles.infoValue}>{props.companyName}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Job:</Text>
              <Text style={styles.infoValue}>{props.jobName ?? '—'}</Text>
            </View>
          </View>
          <View style={[styles.infoSection, styles.infoSectionRental]}>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Start Rental:</Text>
              <Text style={styles.infoValue}>{fmtDay(props.startDate)}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Stop Rental:</Text>
              <Text style={styles.infoValue}>{fmtDay(props.endDate)}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Job Code:</Text>
              <Text style={styles.infoValue}>{props.jobCode ?? '—'}</Text>
            </View>
          </View>
          <View style={[styles.infoSection, styles.infoSectionPeople]}>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Agent:</Text>
              <Text style={styles.infoValue}>{props.agentName}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Picker:</Text>
              <Text style={styles.infoValue}>{props.assignedToName ?? '—'}</Text>
            </View>
          </View>
        </View>

        {/* Table head */}
        <View style={styles.tableHead} fixed>
          <Text style={styles.colCode}>Item Code</Text>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colType}>Type</Text>
          <Text style={styles.colOrdered}>Ordered</Text>
          <Text style={styles.colOut}>Out</Text>
          <Text style={styles.colRemaining}>Remaining</Text>
          <Text style={[styles.colPicked, { textAlign: 'center' }]}>Picked</Text>
          <Text style={[styles.colVerified, { textAlign: 'center' }]}>Verified</Text>
        </View>
        <View style={styles.rentalBanner}>
          <Text style={styles.rentalBannerText}>RENTAL</Text>
        </View>

        {/* Sections */}
        {sections.map((section) => (
          <View key={section.dept}>
            <View style={styles.deptHeader}>
              <Text style={styles.deptHeaderText}>{DEPT_LABELS[section.dept]}</Text>
            </View>
            {section.lines.map((line, idx) => (
              <View key={idx} wrap={false}>
                <View style={[styles.row, ...(idx % 2 === 1 ? [styles.rowAlt] : [])]}>
                  <Text style={styles.colCode}>{line.code ?? '—'}</Text>
                  <Text style={styles.colDesc}>{line.description}</Text>
                  <Text style={styles.colType}>{line.type}</Text>
                  <Text style={styles.colOrdered}>{line.ordered}</Text>
                  <Text style={styles.colOut}>{line.out}</Text>
                  <Text style={styles.colRemaining}>{line.ordered - line.out}</Text>
                  <View style={styles.colPicked}>
                    <View style={styles.checkBox}>
                      {line.picked ? <Text style={styles.checkMark}>X</Text> : null}
                    </View>
                  </View>
                  <View style={styles.colVerified}>
                    <View style={styles.checkBox} />
                  </View>
                </View>
                {line.notes ? (
                  <View style={styles.notesRow}>
                    <Text style={styles.notesText}>
                      <Text style={styles.notesLabel}>Notes: </Text>
                      {line.notes}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.totalLabel}>Total for {DEPT_LABELS[section.dept]}</Text>
              <Text style={styles.totalValue}>{section.total}</Text>
              <View style={styles.totalSpacer} />
            </View>
          </View>
        ))}

        {/* Grand total */}
        <View style={styles.grandTotalRow} wrap={false}>
          <Text style={styles.grandTotalLabel}>Grand Total:</Text>
          <Text style={styles.grandTotalValue}>{grandTotal}</Text>
          <View style={styles.totalSpacer} />
        </View>

        {/* Signature */}
        <View style={styles.signatureRow} wrap={false}>
          <Text style={styles.signatureLabel}>PICKED BY:</Text>
          <View style={styles.signatureLine} />
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Printed {fmtTimestamp(generatedAt)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
