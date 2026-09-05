import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { WORDMARK_BLACK_DATA_URI } from './brandAssets'
import {
  VENDOR_AGREEMENT_TITLE,
  VENDOR_AGREEMENT_VERSION,
  VENDOR_AGREEMENT_SIRREEL,
  VENDOR_AGREEMENT_OPENING,
  VENDOR_AGREEMENT_CLAUSES,
} from './vendorAgreementClauses'

/**
 * React-PDF render of the Partner Vehicle Agreement (vendorAgreementClauses.ts).
 * Parallels StageContractDocument: SirReel's side is pre-filled with Wes's
 * typed name; the partner's side is blank because the partner signs through
 * their account page, which appends a signature page with the drawn
 * signature and audit trail (vendorAccountActions.signVendorAgreement).
 * Fleet brand (the vehicles side), so the SirReel wordmark, not Studio
 * Services.
 */

export interface VendorAgreementPartyForRender {
  name: string
  address: string | null
  contactName: string | null
  email: string | null
}

export interface VendorAgreementDocumentProps {
  partner: VendorAgreementPartyForRender
  generatedAt?: Date
}

const C = { ink: '#111111', muted: '#555555', faint: '#888888', rule: '#cccccc', gold: '#8a6a1a' }

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.45, color: C.ink },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: C.ink, paddingBottom: 8, marginBottom: 18 },
  brandLogo: { width: 120, height: 'auto', marginBottom: 6 },
  brandSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  docDate: { fontSize: 9, color: C.muted, marginTop: 2 },
  parties: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  partyBlock: { flex: 1, borderWidth: 1, borderColor: '#dddddd', borderRadius: 4, padding: 10 },
  partyTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, marginBottom: 6 },
  partyName: { fontFamily: 'Helvetica-Bold', fontSize: 10.5, marginBottom: 2 },
  partyLine: { fontSize: 9.5, color: C.ink },
  partyBlank: { fontSize: 9.5, color: C.faint },
  opening: { fontSize: 10, marginBottom: 14, lineHeight: 1.5 },
  clause: { marginBottom: 10 },
  clauseHeader: { flexDirection: 'row', marginBottom: 3 },
  clauseRef: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 4 },
  clauseTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  clauseBody: { fontSize: 10, lineHeight: 1.5 },
  sigBlock: { marginTop: 22, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: C.rule, flexDirection: 'row', gap: 24 },
  sigGroup: { flex: 1 },
  sigLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: C.muted, marginBottom: 4 },
  sigParty: { fontSize: 10, marginBottom: 2 },
  sigTyped: { fontFamily: 'Times-Italic', fontSize: 16, color: C.gold, marginTop: 2 },
  sigLine: { borderTopWidth: 0.5, borderTopColor: C.ink, marginTop: 10, width: 200 },
  sigCaption: { fontSize: 8, color: C.muted, marginTop: 2 },
  sigSpacer: { height: 22 },
  footer: { position: 'absolute', bottom: 28, left: 44, right: 44, fontSize: 8, color: C.faint, textAlign: 'center' },
})

function fmtToday(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function VendorAgreementDocument({ partner, generatedAt }: VendorAgreementDocumentProps) {
  const today = generatedAt ?? new Date()
  const addressLines = (partner.address ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return (
    <Document title={`${VENDOR_AGREEMENT_TITLE} — ${partner.name}`} author={VENDOR_AGREEMENT_SIRREEL.legalName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRow}>
          <View>
            <Image src={WORDMARK_BLACK_DATA_URI} style={styles.brandLogo} />
            <Text style={styles.brandSub}>{VENDOR_AGREEMENT_SIRREEL.legalName}</Text>
            <Text style={styles.brandSub}>{VENDOR_AGREEMENT_SIRREEL.address}</Text>
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>{VENDOR_AGREEMENT_TITLE.toUpperCase()}</Text>
            <Text style={styles.docDate}>Prepared {fmtToday(today)} · v{VENDOR_AGREEMENT_VERSION}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyBlock}>
            <Text style={styles.partyTitle}>SirReel</Text>
            <Text style={styles.partyName}>{VENDOR_AGREEMENT_SIRREEL.legalName}</Text>
            <Text style={styles.partyLine}>{VENDOR_AGREEMENT_SIRREEL.address}</Text>
            <Text style={styles.partyLine}>{VENDOR_AGREEMENT_SIRREEL.signerName}, {VENDOR_AGREEMENT_SIRREEL.signerTitle}</Text>
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.partyTitle}>Partner</Text>
            <Text style={styles.partyName}>{partner.name}</Text>
            {addressLines.length > 0 ? addressLines.map((l, i) => <Text key={i} style={styles.partyLine}>{l}</Text>) : <Text style={styles.partyBlank}>Address on file with SirReel</Text>}
            {partner.contactName ? <Text style={styles.partyLine}>{partner.contactName}</Text> : null}
            {partner.email ? <Text style={styles.partyLine}>{partner.email}</Text> : null}
          </View>
        </View>

        <Text style={styles.opening}>{VENDOR_AGREEMENT_OPENING}</Text>

        {VENDOR_AGREEMENT_CLAUSES.map((c) => (
          <View key={c.ref} style={styles.clause} wrap={false}>
            <View style={styles.clauseHeader}>
              <Text style={styles.clauseRef}>{c.ref}.</Text>
              <Text style={styles.clauseTitle}>{c.title}</Text>
            </View>
            <Text style={styles.clauseBody}>{c.body}</Text>
          </View>
        ))}

        <View style={styles.sigBlock} wrap={false}>
          <View style={styles.sigGroup}>
            <Text style={styles.sigLabel}>Agreed — SirReel</Text>
            <Text style={styles.sigParty}>{VENDOR_AGREEMENT_SIRREEL.legalName}</Text>
            <Text style={styles.sigTyped}>{VENDOR_AGREEMENT_SIRREEL.signerName}</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigCaption}>{VENDOR_AGREEMENT_SIRREEL.signerName}, {VENDOR_AGREEMENT_SIRREEL.signerTitle} · {fmtToday(today)}</Text>
          </View>
          <View style={styles.sigGroup}>
            <Text style={styles.sigLabel}>Agreed — Partner</Text>
            <Text style={styles.sigParty}>{partner.name}</Text>
            <View style={styles.sigSpacer} />
            <View style={styles.sigLine} />
            <Text style={styles.sigCaption}>Signed electronically from the partner page; the signature page follows.</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          SirReel · {VENDOR_AGREEMENT_SIRREEL.address} · sirreel.com · {VENDOR_AGREEMENT_TITLE} v{VENDOR_AGREEMENT_VERSION}
        </Text>
      </Page>
    </Document>
  )
}
