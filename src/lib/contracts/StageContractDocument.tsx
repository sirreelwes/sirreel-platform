import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import {
  STAGE_CONTRACT_CLAUSES,
  STAGE_CONTRACT_OPENING,
  STAGE_CONTRACT_NO_EXTERIOR_FILMING_NOTICE,
  STAGE_CONTRACT_LICENSOR,
} from './stageContractClauses'

/**
 * React-PDF document for the SirReel Studio Services Stage Booking
 * contract. Parallels ContractDocument.tsx (rental agreement) but is
 * simpler — there's no redline/decision logic since stage contracts
 * aren't routed through AI Contract Review (deferred per spec).
 *
 * The Licensor signature block is pre-filled at render time with Wes
 * Bailey's typed name in a script-style serif (Times-Italic). When a
 * Wes-signature image is added to /public, swap the typed name for an
 * <Image> tag at the same position.
 */

export interface StageBookingTermsForRender {
  rentalDates: string[]      // ISO yyyy-MM-dd
  dailyRate: string          // pre-formatted "$2,500" etc.
  /** Contracted hours the daily rate buys. Null = not negotiated. */
  dayLengthHours: number | null
  /** Pre-formatted per-hour overtime rate beyond dayLengthHours. */
  overtimeHourlyRate: string | null
  productionOfficeRental: boolean
  specificSpaces: string[]
  securityGuardRequired: boolean
}

export interface StageContractPartyForRender {
  clientCompany: string
  projectName: string
  clientAddress: string
  producerName: string
  producerPhone: string
  producerEmail: string
  contactName: string        // "Your Name" on the form — defaults to producer if no separate contact
  contactPhone: string
  contactEmail: string
}

/**
 * Producer-side countersign captured by the portal. When present the
 * document renders as the EXECUTED contract: the signature (drawn image, or
 * the typed name as fallback), who signed, and the e-sign attestation +
 * audit trail. Absent = the unsigned baseline the client reviews.
 */
export interface StageContractSignatureForRender {
  signerName: string
  signerTitle?: string | null
  signerEmail?: string | null
  signatureImageDataUri?: string | null
  acknowledgmentText: string
  signedAt: Date
  ipAddress?: string | null
  userAgent?: string | null
}

export interface StageContractDocumentProps {
  party: StageContractPartyForRender
  terms: StageBookingTermsForRender
  generatedAt?: Date
  signature?: StageContractSignatureForRender | null
}

const C = {
  ink: '#111111',
  muted: '#555555',
  faint: '#888888',
  rule: '#cccccc',
  signatureGold: '#8a6a1a',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: 'Helvetica',
    fontSize: 10,
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
    marginBottom: 18,
  },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 18 },
  brandSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  docDate: { fontSize: 9, color: C.muted, marginTop: 2 },
  partyBlock: {
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  partyTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 6,
  },
  partyRow: { flexDirection: 'row', marginBottom: 2 },
  // Rates get their own bordered panel: on the old layout the money sat
  // as one plain row among the party fields and read as fine print.
  rateBox: {
    borderWidth: 1,
    borderColor: C.rule,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 6,
    marginBottom: 8,
    flexDirection: 'row',
  },
  rateCell: { flex: 1, paddingRight: 8 },
  rateCellDivider: { borderLeftWidth: 1, borderLeftColor: C.rule, paddingLeft: 10 },
  rateLabel: { fontSize: 7, color: C.muted, letterSpacing: 0.6, marginBottom: 2 },
  rateValue: { fontSize: 15, fontWeight: 700 },
  rateSub: { fontSize: 8, color: C.muted, marginTop: 1 },
  partyLabel: { width: '32%', fontSize: 9, color: C.muted },
  partyValue: { flex: 1, fontSize: 10 },
  termsBlock: {
    borderWidth: 1,
    borderColor: '#dddddd',
    backgroundColor: '#f9f7f0',
    borderRadius: 4,
    padding: 10,
    marginBottom: 16,
  },
  termsTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 6,
  },
  opening: {
    fontSize: 10,
    marginBottom: 14,
    lineHeight: 1.5,
  },
  clause: { marginBottom: 10 },
  clauseHeader: { flexDirection: 'row', marginBottom: 3 },
  clauseRef: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 4 },
  clauseTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  clauseBody: { fontSize: 10, color: C.ink, lineHeight: 1.5 },
  notice: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    textAlign: 'center',
    marginVertical: 10,
  },
  sigBlock: { marginTop: 22, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: C.rule },
  sigGroup: { marginBottom: 14 },
  sigLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 4,
  },
  sigParty: { fontSize: 10, marginBottom: 2 },
  sigTyped: {
    fontFamily: 'Times-Italic',
    fontSize: 16,
    color: C.signatureGold,
    marginTop: 2,
  },
  sigLine: {
    borderTopWidth: 0.5,
    borderTopColor: C.ink,
    marginTop: 10,
    width: 220,
  },
  sigCaption: { fontSize: 8, color: C.muted, marginTop: 2 },
  sigImage: { width: 150, height: 44, objectFit: 'contain', marginBottom: 2 },
  attestation: {
    fontSize: 7.5,
    color: C.muted,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    lineHeight: 1.4,
  },
  auditRow: { flexDirection: 'row', marginTop: 1.5 },
  auditKey: { fontSize: 7.5, color: C.faint, width: 78 },
  auditValue: { fontSize: 7.5, color: C.muted, flex: 1 },
  execBadge: {
    fontSize: 8,
    color: C.signatureGold,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: { fontSize: 8, color: C.faint, marginTop: 16, textAlign: 'center' },
})

function fmtDateRange(isoDates: string[]): string {
  if (!isoDates || isoDates.length === 0) return '(no dates selected)'
  // Sort and group contiguous runs for a more readable rendering.
  const sorted = [...isoDates].filter(Boolean).sort()
  if (sorted.length === 1) return prettyDate(sorted[0])
  const runs: string[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00')
    const cur = new Date(sorted[i] + 'T00:00:00')
    const diffDays = (cur.getTime() - prev.getTime()) / 86_400_000
    if (diffDays === 1) {
      runs[runs.length - 1].push(sorted[i])
    } else {
      runs.push([sorted[i]])
    }
  }
  return runs
    .map((r) => (r.length === 1 ? prettyDate(r[0]) : `${prettyDate(r[0])} \u2013 ${prettyDate(r[r.length - 1])}`))
    .join(', ')
}

function prettyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtToday(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function StageContractDocument(props: StageContractDocumentProps) {
  const { party, terms, generatedAt, signature } = props
  const today = generatedAt ?? new Date()

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Brand header */}
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.brandName}>SirReel Studio Services</Text>
            <Text style={styles.brandSub}>8500 Lankershim Blvd, Sun Valley, CA</Text>
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>STAGE BOOKING AGREEMENT</Text>
            <Text style={styles.docDate}>Generated {fmtToday(today)}</Text>
          </View>
        </View>

        {/* Producer / Project block */}
        <View style={styles.partyBlock}>
          <Text style={styles.partyTitle}>Producer & Production</Text>
          <PartyRow label="Company Name" value={party.clientCompany} />
          <PartyRow label="Project Title" value={party.projectName} />
          <PartyRow label="Company Address" value={party.clientAddress} />
          <PartyRow label="Producer" value={party.producerName} />
          <PartyRow label="Producer Phone" value={party.producerPhone} />
          <PartyRow label="Producer Email" value={party.producerEmail} />
          <PartyRow label="Contact" value={party.contactName} />
          <PartyRow label="Contact Phone" value={party.contactPhone} />
          <PartyRow label="Contact Email" value={party.contactEmail} />
        </View>

        {/* Negotiated Terms block */}
        <View style={styles.termsBlock}>
          <Text style={styles.termsTitle}>Rental Description ("Terms")</Text>
          <PartyRow label="Rental date(s)" value={fmtDateRange(terms.rentalDates)} />
        </View>

        {/* Money terms, called out rather than buried in the list above. */}
        <View style={styles.rateBox}>
          <View style={styles.rateCell}>
            <Text style={styles.rateLabel}>DAILY RATE</Text>
            <Text style={styles.rateValue}>{terms.dailyRate}</Text>
            <Text style={styles.rateSub}>per day</Text>
          </View>
          <View style={[styles.rateCell, styles.rateCellDivider]}>
            <Text style={styles.rateLabel}>DAY LENGTH</Text>
            <Text style={styles.rateValue}>
              {terms.dayLengthHours != null ? `${terms.dayLengthHours} hrs` : '\u2014'}
            </Text>
            <Text style={styles.rateSub}>
              {terms.dayLengthHours != null ? 'included in the daily rate' : 'not specified'}
            </Text>
          </View>
          <View style={[styles.rateCell, styles.rateCellDivider]}>
            <Text style={styles.rateLabel}>OVERTIME</Text>
            <Text style={styles.rateValue}>{terms.overtimeHourlyRate ?? '\u2014'}</Text>
            <Text style={styles.rateSub}>
              {terms.overtimeHourlyRate
                ? terms.dayLengthHours != null
                  ? `per hour beyond ${terms.dayLengthHours}`
                  : 'per hour beyond the day length'
                : 'not specified'}
            </Text>
          </View>
        </View>

        <View>
          <PartyRow label="Production office rental" value={terms.productionOfficeRental ? 'Yes' : 'No'} />
          {terms.specificSpaces.length > 0 && (
            <PartyRow label="Spaces booked" value={terms.specificSpaces.join(', ')} />
          )}
          <PartyRow
            label="Security guard required"
            value={terms.securityGuardRequired ? 'Yes — at Producer\u2019s expense per clause 4' : 'Not required'}
          />
        </View>

        {/* Opening recital */}
        <Text style={styles.opening}>{STAGE_CONTRACT_OPENING}</Text>

        {/* Clauses 1-4 */}
        {STAGE_CONTRACT_CLAUSES.slice(0, 4).map((c) => (
          <Clause key={c.ref} clause={c} />
        ))}

        {/* No-filming notice */}
        <Text style={styles.notice}>{STAGE_CONTRACT_NO_EXTERIOR_FILMING_NOTICE}</Text>

        {/* Clauses 5-14 */}
        {STAGE_CONTRACT_CLAUSES.slice(4).map((c) => (
          <Clause key={c.ref} clause={c} />
        ))}

        {/* Signature block — Licensor pre-signed, Producer side empty for portal signing */}
        <View style={styles.sigBlock} wrap={false}>
          <View style={styles.sigGroup}>
            <Text style={styles.sigLabel}>Accepted and Agreed — Licensor</Text>
            <Text style={styles.sigParty}>{STAGE_CONTRACT_LICENSOR.party}</Text>
            {/* TODO(brand): replace typed-name with <Image> when Wes signature
                PNG is committed to /public. Keep position + colour so the
                portal countersign flow lines up. */}
            <Text style={styles.sigTyped}>{STAGE_CONTRACT_LICENSOR.signerName}</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigCaption}>
              {STAGE_CONTRACT_LICENSOR.signerName}, {STAGE_CONTRACT_LICENSOR.signerTitle} {'\u00b7'} {fmtToday(today)}
            </Text>
          </View>

          <View style={styles.sigGroup}>
            <Text style={styles.sigLabel}>Accepted and Agreed — Producer</Text>
            <Text style={styles.sigParty}>{party.clientCompany}</Text>
            {signature ? (
              <>
                {signature.signatureImageDataUri ? (
                  <Image src={signature.signatureImageDataUri} style={styles.sigImage} />
                ) : (
                  <Text style={styles.sigTyped}>{signature.signerName}</Text>
                )}
                <View style={styles.sigLine} />
                <Text style={styles.sigCaption}>
                  {signature.signerName}
                  {signature.signerTitle ? `, ${signature.signerTitle}` : ''} {'\u00b7'}{' '}
                  {fmtToday(signature.signedAt)}
                </Text>
              </>
            ) : (
              <>
                {/* Producer countersign — collected at /portal sign endpoint */}
                <View style={styles.sigLine} />
                <Text style={styles.sigCaption}>Signature, printed name, date</Text>
              </>
            )}
          </View>
        </View>

        {/* E-sign attestation + audit trail — only on the executed copy. */}
        {signature && (
          <View wrap={false}>
            <Text style={styles.attestation}>
              This contract was executed electronically. By typing their name and submitting the
              acknowledgement below through the SirReel client portal, the Producer signatory
              adopted an electronic signature with the same force and effect as a handwritten
              signature.
            </Text>
            <Text style={[styles.attestation, { borderTopWidth: 0, marginTop: 4, paddingTop: 0 }]}>
              “{signature.acknowledgmentText}”
            </Text>
            <View style={{ marginTop: 6 }}>
              <View style={styles.auditRow}>
                <Text style={styles.auditKey}>Signed</Text>
                <Text style={styles.auditValue}>{signature.signedAt.toISOString()}</Text>
              </View>
              <View style={styles.auditRow}>
                <Text style={styles.auditKey}>Signatory</Text>
                <Text style={styles.auditValue}>
                  {signature.signerName}
                  {signature.signerEmail ? ` (${signature.signerEmail})` : ''}
                </Text>
              </View>
              <View style={styles.auditRow}>
                <Text style={styles.auditKey}>IP address</Text>
                <Text style={styles.auditValue}>{signature.ipAddress || 'unknown'}</Text>
              </View>
              <View style={styles.auditRow}>
                <Text style={styles.auditKey}>Device</Text>
                <Text style={styles.auditValue}>{signature.userAgent || 'unknown'}</Text>
              </View>
            </View>
          </View>
        )}

        <Text style={styles.footer}>
          SirReel Studio Services {'\u00b7'} 8500 Lankershim Blvd, Sun Valley, CA {'\u00b7'} sirreel.com
        </Text>
      </Page>
    </Document>
  )
}

function PartyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.partyRow}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={styles.partyValue}>{value || '\u2014'}</Text>
    </View>
  )
}

function Clause({ clause }: { clause: { ref: string; title: string; body: string } }) {
  // Split body on double-newline to render multi-paragraph clauses (the
  // sub-lettered clauses 3, 4(a), 5(a)(b), 12, 14 use this).
  const paragraphs = clause.body.split(/\n\n+/)
  return (
    <View style={styles.clause} wrap={false}>
      <View style={styles.clauseHeader}>
        <Text style={styles.clauseRef}>{clause.ref}.</Text>
        <Text style={styles.clauseTitle}>{clause.title.toUpperCase()}</Text>
      </View>
      {paragraphs.map((p, i) => (
        <Text key={i} style={i > 0 ? [styles.clauseBody, { marginTop: 4 }] : styles.clauseBody}>
          {p}
        </Text>
      ))}
    </View>
  )
}
