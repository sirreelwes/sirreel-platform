import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet, type DocumentProps } from '@react-pdf/renderer'

// Brand logo loaded as a raw Buffer at module load — the most reliable path
// for @react-pdf's <Image> on Vercel (mirrors QuoteDocument.tsx).
const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch {
  LOGO_BUFFER = null
}

export interface DotUnit {
  unitName: string
  categoryName: string
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  licensePlate: string | null
  /** Latest BitInspection date (ISO yyyy-mm-dd) or null when none on file. */
  latestBitDate: string | null
  /** What's missing on this unit (for the client-visible note). */
  missing: string[]
}

export interface DotSheetProps {
  companyName: string | null
  jobName: string | null
  jobCode: string | null
  generatedAt: Date
  units: DotUnit[]
}

const NAVY = '#16191d'
const MUTED = '#687078'
const HAIRLINE = '#d8dce2'
const RED = '#b42318'

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 48, fontSize: 10, color: NAVY, fontFamily: 'Helvetica' },
  topBand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1.5, borderBottomColor: NAVY, paddingBottom: 10, marginBottom: 18 },
  brandLogo: { width: 150, height: 40, objectFit: 'contain' },
  brandFallback: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY },
  titleCol: { alignItems: 'flex-end' },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  docSub: { fontSize: 9, color: MUTED, marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  metaLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  unitCard: { borderWidth: 1, borderColor: HAIRLINE, borderRadius: 6, padding: 16, marginBottom: 14 },
  unitHead: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  unitCat: { fontSize: 9, color: MUTED, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', marginBottom: 12 },
  cellLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  cellVal: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  cellValMono: { fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  missing: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: RED },
  bitRow: { marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: HAIRLINE },
  missingBanner: { backgroundColor: '#fcebeb', borderWidth: 1, borderColor: '#f3c2c2', borderRadius: 4, padding: 8, marginTop: 4 },
  missingBannerText: { fontSize: 8.5, color: RED },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 8 },
  footerText: { fontSize: 7.5, color: MUTED },
})

const fmtDate = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      {value ? <Text style={styles.cellVal}>{value}</Text> : <Text style={styles.missing}>— Not on file —</Text>}
    </View>
  )
}

export function DotSheetDocument(props: DotSheetProps): React.ReactElement<DocumentProps> {
  const stamp = props.generatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <Document title={`SirReel DOT Information — ${props.jobName ?? props.jobCode ?? 'Vehicles'}`}>
      {props.units.map((u, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          <View style={styles.topBand}>
            {LOGO_BUFFER ? <Image src={LOGO_BUFFER} style={styles.brandLogo} /> : <Text style={styles.brandFallback}>SirReel Production Vehicles</Text>}
            <View style={styles.titleCol}>
              <Text style={styles.docTitle}>DOT INFORMATION</Text>
              <Text style={styles.docSub}>Vehicle {i + 1} of {props.units.length}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View>
              <Text style={styles.metaLabel}>Prepared for</Text>
              <Text style={styles.metaVal}>{props.companyName ?? '—'}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Production</Text>
              <Text style={styles.metaVal}>{props.jobName ?? props.jobCode ?? '—'}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Prepared</Text>
              <Text style={styles.metaVal}>{stamp}</Text>
            </View>
          </View>

          <View style={styles.unitCard}>
            <Text style={styles.unitHead}>{u.unitName}</Text>
            <Text style={styles.unitCat}>{u.categoryName}</Text>

            <View style={styles.grid}>
              <Field label="Year" value={u.year != null ? String(u.year) : null} />
              <Field label="Make / Model" value={[u.make, u.model].filter(Boolean).join(' ') || null} />
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>VIN</Text>
                {u.vin ? <Text style={styles.cellValMono}>{u.vin}</Text> : <Text style={styles.missing}>— Not on file —</Text>}
              </View>
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>License plate</Text>
                {u.licensePlate ? <Text style={styles.cellValMono}>{u.licensePlate}</Text> : <Text style={styles.missing}>— Not on file —</Text>}
              </View>
            </View>

            <View style={styles.bitRow}>
              <Text style={styles.cellLabel}>Latest BIT inspection (CHP Biennial Inspection of Terminals)</Text>
              {u.latestBitDate
                ? <Text style={styles.cellVal}>{fmtDate(u.latestBitDate)} — certificate on file{' '}</Text>
                : <Text style={styles.missing}>— No BIT inspection on file —</Text>}
            </View>

            {u.missing.length > 0 && (
              <View style={styles.missingBanner}>
                <Text style={styles.missingBannerText}>
                  Missing for this vehicle: {u.missing.join(', ')}. Contact SirReel to complete the record before relying on this sheet.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>SirReel Production Vehicles, Inc. · DOT vehicle information</Text>
            <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>
  )
}
