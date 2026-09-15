/**
 * A client's negotiated agreement, rendered on SirReel paper.
 *
 * Wes, 2026-09-15: "I want it branded sirreel studio services and looking as
 * much like our standard agreement as possible." So this deliberately shares
 * the standard agreement's furniture — the wordmark masthead with the trading
 * name and contact line, the centred uppercase title, the ruled uppercase
 * section headings, the two-column signature block — and differs from
 * ContractDocument only in what it is: finished terms, not a negotiation.
 *
 * What it must never do is blur whose words are whose. The client's counsel
 * wrote the numbered clauses; SirReel is adding three sections their document
 * never had. Those sit under their own heading, which says so in the
 * document, so a reader can tell without a diff. See negotiatedAgreement.ts
 * for why appending is not renegotiating.
 *
 * No redline markup here on purpose: this is not a counter-proposal, and
 * striking their lawyer's agreed text against our baseline would misrepresent
 * a settled document as an open one.
 */
import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { WORDMARK_BLACK_DATA_URI } from './brandAssets'
import { APPENDED_SECTIONS, type NegotiatedAgreement } from './negotiatedAgreement'

const C = {
  ink: '#111111',
  muted: '#555555',
  rule: '#cccccc',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.4,
    color: C.ink,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { flexDirection: 'column' },
  wordmark: { width: 112, height: 40, objectFit: 'contain', marginBottom: 2 },
  brandSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  docDate: { fontSize: 9, color: C.muted, marginTop: 2 },

  docHeadingBlock: { alignItems: 'center', marginBottom: 14 },
  docHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  docHeadingSub: { fontSize: 9, color: C.muted, marginTop: 3, textAlign: 'center' },

  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoBlock: { flex: 1, borderWidth: 1, borderColor: C.rule, padding: 8 },
  infoLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase', marginBottom: 2 },
  infoValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },

  section: { marginBottom: 12 },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
    paddingBottom: 4,
    marginBottom: 8,
  },
  sectionLede: { fontSize: 9, color: C.muted, fontStyle: 'italic', marginBottom: 8 },
  clause: { marginBottom: 8 },
  clauseHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 2, flexWrap: 'wrap' },
  clauseNum: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 4 },
  clauseTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  clauseBody: { fontSize: 10, textAlign: 'justify' },
  addedTag: {
    fontSize: 7,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 6,
  },

  sigRow: { flexDirection: 'row', gap: 30, marginTop: 24 },
  sigCol: { flex: 1 },
  sigRule: { borderBottomWidth: 1, borderBottomColor: C.ink, height: 34, marginBottom: 4 },
  sigRuleThin: { borderBottomWidth: 1, borderBottomColor: C.rule, height: 24, marginBottom: 4, marginTop: 10 },
  sigLabel: { fontSize: 7, color: C.muted, textTransform: 'uppercase' },

  footer: {
    position: 'absolute',
    bottom: 26,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: C.muted,
    borderTopWidth: 1,
    borderTopColor: C.rule,
    paddingTop: 6,
  },
  pageNumber: { position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: C.muted },
})

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export interface NegotiatedDocProps {
  agreement: NegotiatedAgreement
  /** The company this copy is for — one filed document per company. */
  companyName: string
  generatedAt?: Date
}

const SigCol: React.FC<{ who: string; withTitle?: boolean }> = ({ who, withTitle }) => (
  <View style={styles.sigCol}>
    <View style={styles.sigRule} />
    <Text style={styles.sigLabel}>{who}</Text>
    <View style={styles.sigRuleThin} />
    <Text style={styles.sigLabel}>Printed Name</Text>
    {withTitle && (
      <>
        <View style={styles.sigRuleThin} />
        <Text style={styles.sigLabel}>Title</Text>
      </>
    )}
    <View style={styles.sigRuleThin} />
    <Text style={styles.sigLabel}>Date</Text>
  </View>
)

export const NegotiatedAgreementDocument: React.FC<NegotiatedDocProps> = ({
  agreement,
  companyName,
  generatedAt,
}) => {
  const generated = generatedAt || new Date()
  const { FLEET_AGREEMENT, LCDW_ADDENDUM } = APPENDED_SECTIONS

  return (
    <Document
      title={`SirReel ${agreement.title} — ${companyName}`}
      author="SirReel Studio Services"
      subject={agreement.title}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRow} fixed>
          <View style={styles.brand}>
            <Image src={WORDMARK_BLACK_DATA_URI} style={styles.wordmark} />
            <Text style={styles.brandSub}>SirReel Studio Services · SirReel Production Vehicles, Inc.</Text>
            <Text style={styles.brandSub}>
              8500 Lankershim Blvd, Sun Valley, CA 91352 · (818) 515-2389 · info@sirreel.com
            </Text>
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>{agreement.title}</Text>
            <Text style={styles.docDate}>{companyName}</Text>
          </View>
        </View>

        <View style={styles.docHeadingBlock}>
          <Text style={styles.docHeading}>Equipment &amp; Vehicle Rental Agreement</Text>
          <Text style={styles.docHeadingSub}>
            {agreement.title} · {agreement.version}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Company / Lessee</Text>
            <Text style={styles.infoValue}>{companyName}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Lessor</Text>
            <Text style={styles.infoValue}>SirReel Production Vehicles, Inc.</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Prepared</Text>
            <Text style={styles.infoValue}>{fmtDate(generated)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Equipment and/or Vehicle Terms &amp; Conditions</Text>
          <Text style={styles.sectionLede}>{agreement.lede}</Text>
          {agreement.clauses.map((c) => (
            <View key={c.ref} style={styles.clause} wrap={false}>
              <View style={styles.clauseHead}>
                <Text style={styles.clauseNum}>{c.ref}.</Text>
                <Text style={styles.clauseTitle}>{c.title}</Text>
              </View>
              <Text style={styles.clauseBody}>{c.body}</Text>
            </View>
          ))}
        </View>

        {/* Named as additions IN the document. A client who agreed the clauses
            above must be able to see what is new without diffing files. */}
        <View style={styles.section} break>
          <Text style={styles.sectionTitle}>Additional Terms</Text>
          <Text style={styles.sectionLede}>
            The following sections are part of SirReel&apos;s standard rental agreement and were not
            covered by the negotiated terms above. They are included here so this document states
            the whole of the agreement between us.
          </Text>
          {agreement.appendedClauses.map((c) => (
            <View key={c.ref} style={styles.clause} wrap={false}>
              <View style={styles.clauseHead}>
                <Text style={styles.clauseNum}>{c.ref}.</Text>
                <Text style={styles.clauseTitle}>{c.title}</Text>
                <Text style={styles.addedTag}>· added by SirReel</Text>
              </View>
              <Text style={styles.clauseBody}>{c.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{FLEET_AGREEMENT.title}</Text>
          <Text style={styles.sectionLede}>{FLEET_AGREEMENT.intro}</Text>
          <Text style={styles.clauseBody}>{FLEET_AGREEMENT.fuelPolicy}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{LCDW_ADDENDUM.title}</Text>
          <Text style={[styles.clauseBody, { fontFamily: 'Helvetica-Bold', marginBottom: 4 }]}>
            {LCDW_ADDENDUM.rate}
          </Text>
          <Text style={[styles.clauseBody, { marginBottom: 4 }]}>{LCDW_ADDENDUM.coverage}</Text>
          <Text style={[styles.clauseBody, { fontFamily: 'Helvetica-Bold', marginBottom: 4 }]}>
            {LCDW_ADDENDUM.exclusions}
          </Text>
          <Text style={[styles.clauseBody, { marginBottom: 4 }]}>{LCDW_ADDENDUM.scope}</Text>
          <Text style={styles.clauseBody}>{LCDW_ADDENDUM.note}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agreement &amp; Signature</Text>
          <Text style={styles.clauseBody}>
            I have read, understood, and agree to the terms and conditions above. I am an Authorized
            Representative of the Lessee and I understand and accept the terms and conditions in this
            contract.
          </Text>
          <View style={styles.sigRow}>
            <SigCol who="Signature of Authorized Representative" withTitle />
            <SigCol who="SirReel Representative Signature" />
          </View>
        </View>

        <Text style={styles.footer} fixed>
          SirReel Production Vehicles, Inc. dba SirReel Studio Services · 8500 Lankershim Blvd, Sun
          Valley, CA 91352 · (818) 515-2389 · info@sirreel.com
        </Text>
        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  )
}
