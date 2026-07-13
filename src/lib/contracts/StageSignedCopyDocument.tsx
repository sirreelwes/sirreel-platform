import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { STUDIO_TERMS } from '@/components/portal-v2/terms'
import { stageAreaLabel } from './stageAreas'
import {
  STRYKER_MMA_TITLE,
  STRYKER_EXHIBIT_A,
  renderStrykerParagraphs,
  type StrykerMergeFields,
} from './strykerAgreement'

/**
 * React-PDF document for the CLIENT'S SIGNED COPY of the v2 portal
 * studio (standing sets) contract. Rendered by
 * GET /api/portal/v2/[token]/stage-contract-pdf from the signoff
 * persisted at signing — terms snapshot, studio signature, and (for
 * Hospital-Set jobs) the full populated Stryker Master Media Use
 * Agreement with its own signature block, so the copy is self-contained.
 *
 * Parallels StageContractDocument.tsx (the Order-flow pre-signed PDF)
 * but renders the token-portal signing record instead.
 */

export interface StageSignedCopyProps {
  jobName: string
  companyName: string
  rentalStart: string
  rentalEnd: string
  terms: {
    sets: string[]
    /** Labels frozen at signing time (key → label). Falls back to the
     *  current area list for records signed before labels were
     *  snapshotted. */
    setLabels?: Record<string, string>
    prelitSets: string[]
    ratePerDay: string
    otRate: string
    prepDays: string
    shootDays: string
    strikeDays: string
    darkDays: string
    notes: string
  }
  signerName: string
  signatureImageDataUri: string
  signedAt: string
  ip: string
  stryker: {
    printedName: string
    signatureImageDataUri: string
    signedAt: string
    fields: StrykerMergeFields
  } | null
}

const C = { ink: '#111111', muted: '#555555', faint: '#888888', rule: '#cccccc', gold: '#8a6a1a' }

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    lineHeight: 1.45,
    color: C.ink,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    paddingBottom: 8,
    marginBottom: 16,
  },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 17 },
  brandSub: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, textAlign: 'right' },
  docDate: { fontSize: 8.5, color: C.muted, marginTop: 2, textAlign: 'right' },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, marginTop: 14, marginBottom: 6 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  metaCell: { width: '50%', marginBottom: 6 },
  metaLabel: { fontSize: 7.5, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginTop: 1 },
  para: { marginBottom: 6 },
  paraBold: { fontFamily: 'Helvetica-Bold' },
  notes: { marginTop: 2, marginBottom: 6, color: C.muted },
  sigBlock: {
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.rule,
  },
  sigLabel: { fontSize: 7.5, color: C.gold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, fontFamily: 'Helvetica-Bold' },
  sigImage: { width: 180, height: 45, objectFit: 'contain', alignSelf: 'flex-start' },
  sigLine: { width: 220, borderBottomWidth: 1, borderBottomColor: C.ink, marginTop: 2, marginBottom: 3 },
  sigMeta: { fontSize: 8.5, color: C.muted },
  exhibitRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.rule, paddingVertical: 3 },
  exhibitHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 3, marginTop: 4 },
  exCol1: { width: '46%' },
  exCol2: { width: '24%' },
  exCol3: { width: '10%' },
  exCol4: { width: '20%' },
  exHeadText: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  exCellText: { fontSize: 8.5 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: C.faint,
    textAlign: 'center',
  },
})

const fmtDateTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'

function Brand({ title, date }: { title: string; date: string }) {
  return (
    <View style={styles.brandRow}>
      <View>
        <Text style={styles.brandName}>SirReel</Text>
        <Text style={styles.brandSub}>SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352</Text>
      </View>
      <View>
        <Text style={styles.docTitle}>{title}</Text>
        <Text style={styles.docDate}>{date}</Text>
      </View>
    </View>
  )
}

export function StageSignedCopyDocument(props: StageSignedCopyProps) {
  const { terms, stryker } = props
  return (
    <Document title={`SirReel Studio Contract — ${props.jobName}`}>
      <Page size="LETTER" style={styles.page}>
        <Brand title="Standing Sets Contract — Signed Copy" date={`Signed ${fmtDateTime(props.signedAt)}`} />

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Production</Text>
            <Text style={styles.metaValue}>{props.jobName}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Company</Text>
            <Text style={styles.metaValue}>{props.companyName}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Rental Start</Text>
            <Text style={styles.metaValue}>{props.rentalStart || '—'}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Rental End</Text>
            <Text style={styles.metaValue}>{props.rentalEnd || '—'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Negotiated Terms</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Sets</Text>
            <Text style={styles.metaValue}>
              {terms.sets
                .map((s) => `${terms.setLabels?.[s] || stageAreaLabel(s)}${terms.prelitSets.includes(s) ? ' (Pre-lit)' : ''}`)
                .join(', ') || '—'}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Rate Per Day</Text>
            <Text style={styles.metaValue}>${terms.ratePerDay}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>OT Rate</Text>
            <Text style={styles.metaValue}>${terms.otRate}/hr</Text>
          </View>
          {terms.prepDays ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Prep Days</Text>
              <Text style={styles.metaValue}>{terms.prepDays}</Text>
            </View>
          ) : null}
          {terms.shootDays ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Shoot Days</Text>
              <Text style={styles.metaValue}>{terms.shootDays}</Text>
            </View>
          ) : null}
          {terms.strikeDays ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Strike Days</Text>
              <Text style={styles.metaValue}>{terms.strikeDays}</Text>
            </View>
          ) : null}
          {terms.darkDays ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Dark Days</Text>
              <Text style={styles.metaValue}>{terms.darkDays}</Text>
            </View>
          ) : null}
        </View>
        {terms.notes ? <Text style={styles.notes}>Notes: {terms.notes}</Text> : null}

        <Text style={styles.sectionTitle}>Terms & Conditions</Text>
        {STUDIO_TERMS.map((t) => (
          <Text key={t.heading} style={styles.para}>
            <Text style={styles.paraBold}>{t.heading} </Text>
            {t.text}
          </Text>
        ))}

        <View style={styles.sigBlock} wrap={false}>
          <Text style={styles.sigLabel}>Studio Contract — Authorized Signature (Producer)</Text>
          {props.signatureImageDataUri ? <Image src={props.signatureImageDataUri} style={styles.sigImage} /> : null}
          <View style={styles.sigLine} />
          <Text style={styles.sigMeta}>
            {props.signerName || 'Authorized Representative'} · Signed {fmtDateTime(props.signedAt)}
            {props.ip && props.ip !== 'unknown' ? ` · IP ${props.ip}` : ''}
          </Text>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `SirReel Studio Services · Standing Sets Contract · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>

      {stryker && (
        <Page size="LETTER" style={styles.page}>
          <Brand title={STRYKER_MMA_TITLE} date={`Signed ${fmtDateTime(stryker.signedAt)}`} />

          <View style={styles.metaGrid}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Production / Show Title</Text>
              <Text style={styles.metaValue}>{stryker.fields.projectTitle}</Text>
            </View>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Producer</Text>
              <Text style={styles.metaValue}>{stryker.fields.producerName}</Text>
            </View>
          </View>

          {renderStrykerParagraphs(stryker.fields).map((p, i) => (
            <Text key={i} style={styles.para}>
              {p}
            </Text>
          ))}

          <Text style={styles.sectionTitle}>Exhibit A</Text>
          <View style={styles.exhibitHead}>
            <Text style={[styles.exCol1, styles.exHeadText]}>Product Description</Text>
            <Text style={[styles.exCol2, styles.exHeadText]}>Product No.</Text>
            <Text style={[styles.exCol3, styles.exHeadText]}>Qty</Text>
            <Text style={[styles.exCol4, styles.exHeadText]}>Value</Text>
          </View>
          {STRYKER_EXHIBIT_A.map((r) => (
            <View key={r.productNo} style={styles.exhibitRow}>
              <Text style={[styles.exCol1, styles.exCellText]}>{r.description}</Text>
              <Text style={[styles.exCol2, styles.exCellText]}>{r.productNo}</Text>
              <Text style={[styles.exCol3, styles.exCellText]}>{r.quantity}</Text>
              <Text style={[styles.exCol4, styles.exCellText]}>{r.value}</Text>
            </View>
          ))}

          <View style={styles.sigBlock} wrap={false}>
            <Text style={styles.sigLabel}>Stryker Master Media Use Agreement — Signature (on behalf of {stryker.fields.producerName})</Text>
            {stryker.signatureImageDataUri ? <Image src={stryker.signatureImageDataUri} style={styles.sigImage} /> : null}
            <View style={styles.sigLine} />
            <Text style={styles.sigMeta}>
              {stryker.printedName || 'Authorized Representative'} · Signed {fmtDateTime(stryker.signedAt)}
            </Text>
          </View>

          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }) => `SirReel Studio Services · ${STRYKER_MMA_TITLE} · Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </Page>
      )}
    </Document>
  )
}
