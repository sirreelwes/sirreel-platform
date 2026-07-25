import * as React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

/**
 * HQ-rendered duplicate of a RentalWorks invoice.
 *
 * RW's API can't export its own documents (all print/PDF endpoints 404 and
 * its invoiceitem surface is empty tenant-wide), so this renders a clean
 * SUMMARY invoice from the live invoice record: bill-to, PO, terms, the
 * deal/description, rental window, category totals, tax and balance.
 * No line items exist to fetch — category totals are as itemized as RW
 * allows. Clearly labeled as reproduced so it can't be mistaken for the
 * originally issued document.
 */

export interface RwInvoiceDetail {
  InvoiceNumber?: string
  Status?: string
  InvoiceDate?: string
  InvoiceDueDate?: string
  Customer?: string
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
  OrderNumber?: string
  OrderDescription?: string
  InvoiceDescription?: string
  BillingStartDate?: string
  BillingEndDate?: string
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

const GOLD = '#C89B3C'
const INK = '#18181b'
const MUTED = '#6b6b74'
const HAIR = '#e4e4e7'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, color: INK, padding: 48, lineHeight: 1.45 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  invTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  invNo: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  voidTag: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#b91c1c', textAlign: 'right', marginTop: 3 },
  rule: { borderBottomWidth: 2, borderBottomColor: GOLD, marginTop: 12, marginBottom: 14 },
  cols: { flexDirection: 'row', justifyContent: 'space-between' },
  colHead: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  metaRow: { flexDirection: 'row', marginBottom: 1.5 },
  metaKey: { width: 78, color: MUTED },
  section: { marginTop: 16 },
  descBox: { marginTop: 14, padding: 10, backgroundColor: '#f7f7f8', borderRadius: 4 },
  table: { marginTop: 16 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: HAIR },
  tTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1.5, borderTopColor: INK, marginTop: 2 },
  bold: { fontFamily: 'Helvetica-Bold' },
  balance: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 6, backgroundColor: '#fdf6e7', paddingHorizontal: 8, borderRadius: 4 },
  footer: { position: 'absolute', bottom: 34, left: 48, right: 48, fontSize: 7.5, color: MUTED, textAlign: 'center', borderTopWidth: 0.5, borderTopColor: HAIR, paddingTop: 8 },
})

const usd = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fdate = (d?: string) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function RwInvoiceDocument({ inv, renderedAt }: { inv: RwInvoiceDetail; renderedAt: string }) {
  const categories: Array<[string, number]> = (
    [
      ['Rental', inv.RentalTotal],
      ['Sales', inv.SalesTotal],
      ['Labor', inv.LaborTotal],
      ['Facilities', inv.FacilitiesTotal],
      ['Parts', inv.PartsTotal],
      ['Loss & Damage', inv.LossAndDamage],
      ['Miscellaneous', inv.MiscellaneousTotal],
    ] as Array<[string, unknown]>
  )
    .map(([k, v]) => [k, Number(v ?? 0)] as [string, number])
    .filter(([, v]) => Math.abs(v) > 0.004)

  const isVoid = (inv.Status ?? '').toUpperCase() === 'VOID'
  const billCityLine = [inv.BillToCity, inv.BillToState].filter(Boolean).join(', ') + (inv.BillToZipCode ? ` ${inv.BillToZipCode}` : '')

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.brand}>SIRREEL STUDIO SERVICES</Text>
            <Text style={s.brandSub}>SirReel Production Vehicles, Inc. · Sun Valley, CA</Text>
          </View>
          <View>
            <Text style={s.invTitle}>INVOICE</Text>
            <Text style={s.invNo}>#{inv.InvoiceNumber ?? '—'}</Text>
            {isVoid && <Text style={s.voidTag}>VOID</Text>}
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.cols}>
          <View style={{ maxWidth: 240 }}>
            <Text style={s.colHead}>Bill To</Text>
            <Text style={s.bold}>{inv.BillToName || inv.Customer || '—'}</Text>
            {inv.BillToAttention1 ? <Text>{inv.BillToAttention1}</Text> : null}
            {inv.BillToAddress1 ? <Text>{inv.BillToAddress1}</Text> : null}
            {inv.BillToAddress2 ? <Text>{inv.BillToAddress2}</Text> : null}
            {billCityLine.trim() ? <Text>{billCityLine}</Text> : null}
          </View>
          <View>
            <Text style={s.colHead}>Details</Text>
            <View style={s.metaRow}><Text style={s.metaKey}>Invoice date</Text><Text>{fdate(inv.InvoiceDate)}</Text></View>
            <View style={s.metaRow}><Text style={s.metaKey}>Due</Text><Text>{fdate(inv.InvoiceDueDate)}</Text></View>
            <View style={s.metaRow}><Text style={s.metaKey}>Terms</Text><Text>{inv.PaymentTerms || '—'}</Text></View>
            {inv.PurchaseOrderNumber ? (
              <View style={s.metaRow}><Text style={s.metaKey}>PO #</Text><Text>{inv.PurchaseOrderNumber}</Text></View>
            ) : null}
            <View style={s.metaRow}><Text style={s.metaKey}>RW order</Text><Text>#{inv.OrderNumber ?? '—'}</Text></View>
            {inv.Agent ? (
              <View style={s.metaRow}><Text style={s.metaKey}>Agent</Text><Text>{inv.Agent.split(',').reverse().join(' ').trim()}</Text></View>
            ) : null}
          </View>
        </View>

        <View style={s.descBox}>
          {inv.Deal ? <Text style={s.bold}>{inv.Deal}</Text> : null}
          <Text>{inv.InvoiceDescription || inv.OrderDescription || 'Rental services'}</Text>
          {(inv.BillingStartDate || inv.BillingEndDate) ? (
            <Text style={{ color: MUTED, marginTop: 2 }}>
              Rental period: {fdate(inv.BillingStartDate)} – {fdate(inv.BillingEndDate)}
            </Text>
          ) : null}
        </View>

        <View style={s.table}>
          {categories.map(([label, amount]) => (
            <View key={label} style={s.tRow}>
              <Text>{label}</Text>
              <Text>{usd(amount)}</Text>
            </View>
          ))}
          <View style={s.tRow}>
            <Text style={s.bold}>Subtotal</Text>
            <Text style={s.bold}>{usd(inv.InvoiceSubTotal)}</Text>
          </View>
          <View style={s.tRow}>
            <Text>Tax{inv.TaxOption ? ` (${inv.TaxOption})` : ''}</Text>
            <Text>{usd(inv.InvoiceTax)}</Text>
          </View>
          <View style={s.tTotal}>
            <Text style={[s.bold, { fontSize: 12 }]}>Total</Text>
            <Text style={[s.bold, { fontSize: 12 }]}>{usd(inv.InvoiceTotal)}</Text>
          </View>
          <View style={s.tRow}>
            <Text>Received</Text>
            <Text>{usd(inv.ReceivedTotal)}</Text>
          </View>
          <View style={s.balance}>
            <Text style={[s.bold, { fontSize: 11 }]}>Balance due</Text>
            <Text style={[s.bold, { fontSize: 11 }]}>{usd(isVoid ? 0 : inv.RemainingTotal)}</Text>
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
