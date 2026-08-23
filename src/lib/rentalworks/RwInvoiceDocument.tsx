import * as React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import '@/lib/pdf/hyphenation'

/**
 * HQ-rendered duplicate of a RentalWorks invoice, styled to MATCH the
 * invoices RW itself prints (logo, blue department header, No/Date/Due
 * block, Issued To / Remit To, order-meta band, blue section headers with
 * yellow totals, Grand Total / Amount Paid / Remaining Balance) — so a
 * client comparing paper sees the same document family.
 *
 * Summary-level by necessity: RW's invoiceitem API surface is empty
 * tenant-wide, so each category renders as a single line carrying the
 * order description. Footer still declares it reproduced.
 */

export interface RwInvoiceDetail {
  InvoiceNumber?: string
  Status?: string
  InvoiceDate?: string
  InvoiceDueDate?: string
  Customer?: string
  Department?: string
  BillToName?: string
  BillToAttention1?: string
  BillToAddress1?: string
  BillToAddress2?: string
  BillToCity?: string
  BillToState?: string
  BillToZipCode?: string
  PaymentTerms?: string
  PurchaseOrderNumber?: string
  Deal?: string
  DealNumber?: string
  OrderNumber?: string
  OrderDescription?: string
  InvoiceDescription?: string
  BillingStartDate?: string
  BillingEndDate?: string
  UsageStartDate?: string
  UsageEndDate?: string
  RentalTotal?: number
  SalesTotal?: number
  LaborTotal?: number
  MiscellaneousTotal?: number
  FacilitiesTotal?: number
  PartsTotal?: number
  LossAndDamage?: number
  InvoiceSubTotal?: number
  InvoiceTax?: number
  TaxOption?: string
  InvoiceTotal?: number
  ReceivedTotal?: number
  RemainingTotal?: number
  Agent?: string
}

const BLUE = '#2E74B5'
const BLUE_BG = '#DEEBF7'
const YELLOW = '#FFFFCC'
const INK = '#111111'
const MUTED = '#555555'
const HAIR = '#999999'

const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch {
  LOGO_BUFFER = null
}

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, padding: 40, lineHeight: 1.35 },
  // header
  headRow: { flexDirection: 'row', justifyContent: 'space-between' },
  logo: { width: 170, height: 54, objectFit: 'contain', objectPositionX: 0 },
  brandText: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  addr: { fontSize: 8, marginTop: 4 },
  addrBold: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  deptCol: { alignItems: 'center', marginTop: 2 },
  dept: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  invWord: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BLUE, marginTop: 2 },
  numCol: { width: 170 },
  numRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 2 },
  numKey: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginRight: 6 },
  numBox: { backgroundColor: BLUE_BG, borderWidth: 1, borderColor: BLUE, color: BLUE, fontFamily: 'Helvetica-Bold', fontSize: 11, paddingHorizontal: 10, paddingVertical: 2, width: 92, textAlign: 'center' },
  numVal: { fontSize: 9, width: 92, textAlign: 'center' },
  voidTag: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#b91c1c', textAlign: 'right', marginTop: 3 },
  // Issued To / Remit To
  partyRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  party: { width: '46%' },
  partyHead: { backgroundColor: BLUE_BG, borderBottomWidth: 1, borderBottomColor: BLUE, fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 2, paddingHorizontal: 5, marginBottom: 4 },
  // meta band
  metaBand: { flexDirection: 'row', marginTop: 14, borderTopWidth: 1, borderTopColor: HAIR, borderBottomWidth: 1, borderBottomColor: HAIR, paddingVertical: 6 },
  metaCol: { flex: 1, paddingRight: 8 },
  mRow: { flexDirection: 'row', marginBottom: 1.5 },
  mKey: { fontFamily: 'Helvetica-Bold', width: 62 },
  mVal: { flex: 1 },
  // sections
  secHead: { marginTop: 14, borderWidth: 1, borderColor: BLUE, borderStyle: 'dashed', paddingVertical: 3, paddingHorizontal: 6 },
  secHeadText: { color: BLUE, fontSize: 13, fontFamily: 'Helvetica-Bold' },
  th: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: INK, paddingVertical: 3, marginTop: 4, fontFamily: 'Helvetica-Bold' },
  tr: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#cccccc' },
  cDesc: { flex: 1 },
  cNum: { width: 60, textAlign: 'right' },
  secTotalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 3 },
  secTotalBox: { flexDirection: 'row', backgroundColor: YELLOW, borderTopWidth: 1, borderTopColor: HAIR, paddingVertical: 3, paddingHorizontal: 6 },
  secTotalKey: { fontFamily: 'Helvetica-Bold', marginRight: 18 },
  // grand totals
  totalsWrap: { alignItems: 'flex-end', marginTop: 16 },
  gRow: { flexDirection: 'row', width: 240, justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6 },
  grand: { backgroundColor: YELLOW, borderTopWidth: 1, borderTopColor: INK, fontFamily: 'Helvetica-Bold' },
  bold: { fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 28, left: 40, right: 40, fontSize: 7, color: MUTED, textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#cccccc', paddingTop: 6 },
})

const usd = (v: unknown) =>
  `$ ${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fdate = (d?: string) => {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ''
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${dt.getUTCFullYear()}`
}

const SECTION_LABEL: Record<string, string> = {
  RentalTotal: 'RENTAL',
  SalesTotal: 'SALES',
  LaborTotal: 'LABOR',
  FacilitiesTotal: 'FACILITIES',
  PartsTotal: 'PARTS',
  LossAndDamage: 'LOSS & DAMAGE',
  MiscellaneousTotal: 'MISCELLANEOUS',
}

export function RwInvoiceDocument({ inv, renderedAt }: { inv: RwInvoiceDetail; renderedAt: string }) {
  const sections = (Object.keys(SECTION_LABEL) as Array<keyof typeof SECTION_LABEL>)
    .map((k) => ({ key: k, label: SECTION_LABEL[k], amount: Number((inv as Record<string, unknown>)[k] ?? 0) }))
    .filter((x) => Math.abs(x.amount) > 0.004)

  const isVoid = (inv.Status ?? '').toUpperCase() === 'VOID'
  const description = inv.InvoiceDescription || inv.OrderDescription || 'Rental services'
  const dealLine = inv.Deal ? (inv.DealNumber ? `${inv.Deal}-${inv.DealNumber}` : inv.Deal) : ''
  const billCity = [inv.BillToCity, inv.BillToState].filter(Boolean).join(', ') + (inv.BillToZipCode ? ` ${inv.BillToZipCode}` : '')
  const billing = [fdate(inv.BillingStartDate), fdate(inv.BillingEndDate)].filter(Boolean).join(' - ')
  const usage = [fdate(inv.UsageStartDate), fdate(inv.UsageEndDate)].filter(Boolean).join(' - ')
  const tax = Number(inv.InvoiceTax ?? 0)

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* ── Header: logo | department + Invoice | No/Date/Due ── */}
        <View style={s.headRow}>
          <View style={{ width: 200 }}>
            {LOGO_BUFFER ? <Image src={LOGO_BUFFER} style={s.logo} /> : <Text style={s.brandText}>SirReel</Text>}
            <Text style={s.addrBold}>SirReel Studio Services</Text>
            <Text style={s.addr}>8500 Lankershim Blvd</Text>
            <Text style={s.addr}>Sun Valley, CA 91352</Text>
            <Text style={s.addr}>Phone:  (888) 477-7335</Text>
          </View>
          <View style={s.deptCol}>
            {inv.Department ? <Text style={s.dept}>{inv.Department}</Text> : null}
            <Text style={s.invWord}>Invoice</Text>
          </View>
          <View style={s.numCol}>
            <View style={s.numRow}>
              <Text style={s.numKey}>No:</Text>
              <Text style={s.numBox}>{inv.InvoiceNumber ?? '—'}</Text>
            </View>
            <View style={s.numRow}>
              <Text style={s.numKey}>Date:</Text>
              <Text style={s.numVal}>{fdate(inv.InvoiceDate) || '—'}</Text>
            </View>
            <View style={s.numRow}>
              <Text style={s.numKey}>Due:</Text>
              <Text style={s.numVal}>{fdate(inv.InvoiceDueDate) || '—'}</Text>
            </View>
            {isVoid && <Text style={s.voidTag}>VOID</Text>}
          </View>
        </View>

        {/* ── Issued To / Remit To ── */}
        <View style={s.partyRow}>
          <View style={s.party}>
            <Text style={s.partyHead}>Issued To</Text>
            <Text>{inv.BillToName || inv.Customer || '—'}</Text>
            {inv.BillToAttention1 ? <Text>{inv.BillToAttention1}</Text> : null}
            {inv.BillToAddress1 ? <Text>{inv.BillToAddress1}</Text> : null}
            {inv.BillToAddress2 ? <Text>{inv.BillToAddress2}</Text> : null}
            {billCity.trim() ? <Text>{billCity}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.partyHead}>Remit To</Text>
            <Text>Sirreel Studio Services</Text>
            <Text>8500 Lankershim Blvd</Text>
            <Text>Sun Valley, CA 91352</Text>
          </View>
        </View>

        {/* ── Order meta band ── */}
        <View style={s.metaBand}>
          <View style={[s.metaCol, { flex: 1.3 }]}>
            <View style={s.mRow}><Text style={s.mKey}>Order:</Text><Text style={s.mVal}>{inv.OrderNumber ?? '—'}</Text></View>
            <View style={s.mRow}><Text style={s.mKey}>Description:</Text><Text style={s.mVal}>{inv.OrderDescription || '—'}</Text></View>
            <View style={s.mRow}><Text style={s.mKey}>Customer:</Text><Text style={s.mVal}>{inv.Customer ?? '—'}</Text></View>
            {dealLine ? <View style={s.mRow}><Text style={s.mKey}>Deal:</Text><Text style={s.mVal}>{dealLine}</Text></View> : null}
            {inv.PurchaseOrderNumber ? <View style={s.mRow}><Text style={s.mKey}>PO No:</Text><Text style={s.mVal}>{inv.PurchaseOrderNumber}</Text></View> : null}
          </View>
          <View style={s.metaCol}>
            {inv.Agent ? (
              <View style={s.mRow}><Text style={s.mKey}>Agent:</Text><Text style={s.mVal}>{inv.Agent.split(',').reverse().join(' ').trim()}</Text></View>
            ) : null}
          </View>
          <View style={[s.metaCol, { flex: 1.2 }]}>
            {billing ? <View style={s.mRow}><Text style={[s.mKey, { width: 76 }]}>Billing Period:</Text><Text style={s.mVal}>{billing}</Text></View> : null}
            {usage ? <View style={s.mRow}><Text style={[s.mKey, { width: 76 }]}>Usage Period:</Text><Text style={s.mVal}>{usage}</Text></View> : null}
            <View style={s.mRow}><Text style={[s.mKey, { width: 76 }]}>Terms:</Text><Text style={s.mVal}>{inv.PaymentTerms || '—'}</Text></View>
          </View>
        </View>

        {/* ── Category sections (summary rows — RW exposes no line items) ── */}
        {sections.map((sec) => (
          <View key={sec.key}>
            <View style={s.secHead}><Text style={s.secHeadText}>{sec.label}</Text></View>
            <View style={s.th}>
              <Text style={s.cDesc}>Description</Text>
              <Text style={s.cNum}>Extended</Text>
            </View>
            <View style={s.tr}>
              <Text style={s.cDesc}>{description}</Text>
              <Text style={s.cNum}>{Number(sec.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            </View>
            <View style={s.secTotalRow}>
              <View style={s.secTotalBox}>
                <Text style={s.secTotalKey}>{sec.label} Total</Text>
                <Text style={s.bold}>{usd(sec.amount)}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* ── Grand totals ── */}
        <View style={s.totalsWrap}>
          {tax !== 0 ? (
            <View style={s.gRow}>
              <Text>Tax{inv.TaxOption ? ` (${inv.TaxOption})` : ''}</Text>
              <Text>{usd(tax)}</Text>
            </View>
          ) : null}
          <View style={[s.gRow, s.grand]}>
            <Text>Grand Total</Text>
            <Text>{usd(inv.InvoiceTotal)}</Text>
          </View>
          <View style={s.gRow}>
            <Text style={s.bold}>Amount Paid</Text>
            <Text>{usd(inv.ReceivedTotal)}</Text>
          </View>
          <View style={s.gRow}>
            <Text style={s.bold}>Remaining Balance</Text>
            <Text style={s.bold}>{usd(isVoid ? 0 : inv.RemainingTotal)}</Text>
          </View>
        </View>

        <Text style={s.footer}>
          Reproduced from RentalWorks invoice records by SirReel HQ on {renderedAt}. Figures reflect
          RentalWorks at render time; the RentalWorks record remains the document of record.
        </Text>
      </Page>
    </Document>
  )
}
