import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { STUDIO_TERMS } from '@/components/portal-v2/terms'
import { stageAreaLabel } from './stageAreas'
import { WORDMARK_WHITE_DATA_URI } from './brandAssets'
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
 * Visual language (July 2026 restyle): branded editorial — dark
 * repeating header with the REAL white wordmark (embedded via
 * brandAssets.ts, never typed as text), gold-rule accents matching the
 * portal/email treatment, Times serif headings, formal execution blocks
 * for signatures, and a distinct title panel giving the Stryker MMA a
 * clear visual break as its own agreement. PRESENTATION ONLY — every
 * legal string, value, timestamp, and signature datum is unchanged.
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
    /** Included complex amenities frozen at signing (labels). Absent on
     *  records signed before complex areas existed — section is omitted. */
    complexAreasIncluded?: string[]
    /** LED Wall technician arrangement frozen at signing, when the LED
     *  Wall add-on was on (e.g. "SirReel LED technician scheduled"). */
    ledWallTechLabel?: string
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

const C = {
  ink: '#111111',
  muted: '#555555',
  faint: '#888888',
  rule: '#d9d7d2',
  dark: '#0a0a0a',
  gold: '#D4A547',
  goldInk: '#8a6a1a',
  panel: '#f8f7f4',
}

const SERIF = 'Times-Roman'
const SERIF_BOLD = 'Times-Bold'

const styles = StyleSheet.create({
  // NOTE: no lineHeight on the page style — react-pdf 4.5.1 silently
  // drops dynamic (`render`-prop) text, e.g. the Page X of Y footer,
  // when lineHeight is inherited from the page. Line height lives on
  // the individual content styles below instead.
  page: {
    paddingTop: 78,
    paddingBottom: 60,
    paddingHorizontal: 52,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: C.ink,
  },

  // ── Repeating dark brand band ─────────────────────────────────────
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 56,
    backgroundColor: C.dark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 52,
  },
  bandRule: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: C.gold,
  },
  wordmark: { width: 108, height: 26, objectFit: 'contain' },
  bandRight: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontFamily: SERIF_BOLD, fontSize: 11, color: '#ffffff', textAlign: 'right' },
  docDate: { fontSize: 8, color: C.gold, marginTop: 3, textAlign: 'right', letterSpacing: 0.4 },

  // ── Repeating footer ──────────────────────────────────────────────
  footerWrap: {
    position: 'absolute',
    bottom: 26,
    left: 52,
    right: 52,
    borderTopWidth: 0.75,
    borderTopColor: C.rule,
    paddingTop: 7,
  },
  footerAddress: { fontSize: 7, color: C.faint, textAlign: 'center', letterSpacing: 0.3 },
  footerPage: {
    position: 'absolute',
    bottom: 16,
    left: 52,
    right: 52,
    fontSize: 7,
    color: C.faint,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  // ── Meta / title blocks ───────────────────────────────────────────
  metaPanel: {
    backgroundColor: C.panel,
    borderWidth: 0.75,
    borderColor: C.rule,
    borderRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metaCell: { width: '50%', marginBottom: 5, paddingRight: 10 },
  metaCellLast: { marginBottom: 0 },
  metaLabel: {
    fontSize: 6.5,
    color: C.goldInk,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontFamily: 'Helvetica-Bold',
  },
  metaValue: { fontFamily: SERIF_BOLD, fontSize: 10.5, marginTop: 1, color: C.ink },

  // ── Sections ──────────────────────────────────────────────────────
  sectionWrap: { marginTop: 10, marginBottom: 5 },
  sectionTitle: { fontFamily: SERIF_BOLD, fontSize: 13, color: C.ink },
  sectionRule: { width: 26, height: 2, backgroundColor: C.gold, marginTop: 3 },

  para: { marginBottom: 4, textAlign: 'justify', lineHeight: 1.15 },
  paraBold: { fontFamily: 'Helvetica-Bold' },
  clause: { marginBottom: 0 },
  notes: { marginTop: 1, marginBottom: 4, color: C.muted, lineHeight: 1.15 },

  // ── Execution blocks ──────────────────────────────────────────────
  sigBlock: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.ink,
    borderLeftWidth: 3,
    borderLeftColor: C.gold,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: '#fffefb',
  },
  sigLabel: {
    fontSize: 7,
    color: C.goldInk,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 5,
    fontFamily: 'Helvetica-Bold',
  },
  sigImage: { width: 180, height: 40, objectFit: 'contain', alignSelf: 'flex-start' },
  sigLine: { width: 240, borderBottomWidth: 1, borderBottomColor: C.ink, marginTop: 2, marginBottom: 5 },
  sigMeta: { fontSize: 8.5, color: C.muted, lineHeight: 1.4 },

  // ── Exhibit A table ───────────────────────────────────────────────
  exhibitHead: {
    flexDirection: 'row',
    backgroundColor: C.dark,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  exhibitRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  exhibitRowAlt: { backgroundColor: C.panel },
  exCol1: { width: '46%' },
  exCol2: { width: '24%' },
  exCol3: { width: '10%' },
  exCol4: { width: '20%' },
  exHeadText: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.5 },
  exCellText: { fontSize: 8.5, lineHeight: 1.3 },

  // ── Stryker title panel (distinct-agreement break) ────────────────
  strykerPanel: {
    backgroundColor: C.dark,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  strykerPanelRule: { width: 34, height: 2, backgroundColor: C.gold, marginBottom: 7 },
  strykerPanelTitle: { fontFamily: SERIF_BOLD, fontSize: 15, color: '#ffffff' },
  strykerPanelMeta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  strykerPanelCell: { width: '50%', paddingRight: 10 },
  strykerPanelLabel: {
    fontSize: 6.5,
    color: C.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontFamily: 'Helvetica-Bold',
  },
  strykerPanelValue: { fontFamily: SERIF_BOLD, fontSize: 11, marginTop: 2, color: '#ffffff' },
})

// Signature timestamps render in Pacific time with an explicit zone
// label — the server runs in UTC, and an unlabeled UTC time on the
// document of record reads as the wrong signing time (found when a
// 1:30 PM PT signing printed as "8:30 PM").
const fmtDateTime = (iso: string) =>
  iso
    ? `${new Date(iso).toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
      })} PT`
    : '—'

/** Repeating dark brand band + gold rule — every page of the document. */
function BrandBand({ title, date }: { title: string; date: string }) {
  return (
    <>
      <View style={styles.band} fixed>
        <Image src={WORDMARK_WHITE_DATA_URI} style={styles.wordmark} />
        <View style={styles.bandRight}>
          <Text style={styles.docTitle}>{title}</Text>
          <Text style={styles.docDate}>{date}</Text>
        </View>
      </View>
      <View style={styles.bandRule} fixed />
    </>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionWrap} minPresenceAhead={40}>
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  )
}

export function StageSignedCopyDocument(props: StageSignedCopyProps) {
  const { terms, stryker } = props
  return (
    <Document title={`SirReel Studio Contract — ${props.jobName}`}>
      <Page size="LETTER" style={styles.page}>
        <BrandBand title="Standing Sets Contract — Signed Copy" date={`Signed ${fmtDateTime(props.signedAt)}`} />

        <View style={styles.metaPanel}>
          <View style={styles.metaGrid}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Production</Text>
              <Text style={styles.metaValue}>{props.jobName}</Text>
            </View>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Company</Text>
              <Text style={styles.metaValue}>{props.companyName}</Text>
            </View>
            <View style={[styles.metaCell, styles.metaCellLast]}>
              <Text style={styles.metaLabel}>Rental Start</Text>
              <Text style={styles.metaValue}>{props.rentalStart || '—'}</Text>
            </View>
            <View style={[styles.metaCell, styles.metaCellLast]}>
              <Text style={styles.metaLabel}>Rental End</Text>
              <Text style={styles.metaValue}>{props.rentalEnd || '—'}</Text>
            </View>
          </View>
        </View>

        <SectionTitle>Negotiated Terms</SectionTitle>
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
        {terms.ledWallTechLabel ? (
          <Text style={styles.para}>
            <Text style={styles.paraBold}>LED Wall technician: </Text>
            {terms.ledWallTechLabel}
          </Text>
        ) : null}
        {terms.complexAreasIncluded && terms.complexAreasIncluded.length > 0 ? (
          <View>
            <SectionTitle>Complex Areas Included</SectionTitle>
            <Text style={styles.para}>
              The following shared complex areas are included with this agreement:{' '}
              {terms.complexAreasIncluded.join(', ')}.
            </Text>
          </View>
        ) : null}
        {terms.notes ? <Text style={styles.notes}>Notes: {terms.notes}</Text> : null}

        <SectionTitle>Terms & Conditions</SectionTitle>
        {STUDIO_TERMS.map((t) => (
          <View key={t.heading} style={styles.clause} wrap={false}>
            <Text style={styles.para}>
              <Text style={styles.paraBold}>{t.heading} </Text>
              {t.text}
            </Text>
          </View>
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

        <View style={styles.footerWrap} fixed>
          <Text style={styles.footerAddress}>SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352</Text>
        </View>
        {/* pageNumber render prop only evaluates on a Text that is a direct
            child of <Page> — nesting it in a View/component yields blank. */}
        <Text
          style={styles.footerPage}
          render={({ pageNumber, totalPages }) => `SirReel Studio Services · Standing Sets Contract · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>

      {stryker && (
        <Page size="LETTER" style={styles.page}>
          <BrandBand title={STRYKER_MMA_TITLE} date={`Signed ${fmtDateTime(stryker.signedAt)}`} />

          {/* Distinct-agreement break: the Stryker MMA opens with its own
              dark title panel so it reads as a separate agreement, not a
              continuation of the studio contract. */}
          <View style={styles.strykerPanel}>
            <View style={styles.strykerPanelRule} />
            <Text style={styles.strykerPanelTitle}>{STRYKER_MMA_TITLE}</Text>
            <View style={styles.strykerPanelMeta}>
              <View style={styles.strykerPanelCell}>
                <Text style={styles.strykerPanelLabel}>Production / Show Title</Text>
                <Text style={styles.strykerPanelValue}>{stryker.fields.projectTitle}</Text>
              </View>
              <View style={styles.strykerPanelCell}>
                <Text style={styles.strykerPanelLabel}>Producer</Text>
                <Text style={styles.strykerPanelValue}>{stryker.fields.producerName}</Text>
              </View>
            </View>
          </View>

          {renderStrykerParagraphs(stryker.fields).map((p, i) => (
            <View key={i} minPresenceAhead={20}>
              <Text style={styles.para}>{p}</Text>
            </View>
          ))}

          <SectionTitle>Exhibit A</SectionTitle>
          <View style={styles.exhibitHead} minPresenceAhead={60}>
            <Text style={[styles.exCol1, styles.exHeadText]}>Product Description</Text>
            <Text style={[styles.exCol2, styles.exHeadText]}>Product No.</Text>
            <Text style={[styles.exCol3, styles.exHeadText]}>Qty</Text>
            <Text style={[styles.exCol4, styles.exHeadText]}>Value</Text>
          </View>
          {STRYKER_EXHIBIT_A.map((r, i) => (
            <View key={r.productNo} style={i % 2 === 1 ? [styles.exhibitRow, styles.exhibitRowAlt] : styles.exhibitRow}>
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

          <View style={styles.footerWrap} fixed>
            <Text style={styles.footerAddress}>SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352</Text>
          </View>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) => `SirReel Studio Services · ${STRYKER_MMA_TITLE} · Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </Page>
      )}
    </Document>
  )
}
