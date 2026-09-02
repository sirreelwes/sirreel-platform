import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import { LCDW_ADDENDUM } from './contractClauses'
import { LCDW_DAILY_RATE, usd2 } from './fees'
import { GREAT_VIBES_TTF_BASE64 } from './fonts/greatVibes'
import { WORDMARK_BLACK_DATA_URI } from './brandAssets'

/**
 * The one-page addendum that attaches a JOB to a company's annual rental
 * agreement and records the client's damage-waiver election.
 *
 * Wes, 2026-09-01: "a small addendum is added to the RA for that job file
 * with the Job Name inserted into RA and the LCDW election."
 *
 * This is NOT a second rental agreement. It restates nothing and renegotiates
 * nothing — it names the master already in force, names the job it is being
 * applied to, and carries the LCDW answer with the signature the addendum
 * itself demands ("Acceptance/decline of LCDW must be confirmed in writing
 * per fleet vehicle rental"). Everything binding lives in the master.
 *
 * The waiver text is quoted VERBATIM from contractClauses.ts — the same
 * module the baseline document and the signed copy render from — so a client
 * who accepts here and a client who accepts on the full agreement have
 * accepted identical words. If those ever drift, the contract wins and this
 * file is the bug.
 */

Font.register({
  family: 'GreatVibes',
  src: `data:font/truetype;base64,${GREAT_VIBES_TTF_BASE64}`,
})

export interface JobAddendumSignature {
  signerName: string
  signerTitle: string | null
  signerEmail: string | null
  acknowledgmentText: string
  decidedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

export interface JobAddendumProps {
  companyName: string | null
  /** How the master is titled — "2026 Annual Rental Agreement". */
  masterTitle: string
  masterEffectiveDate: Date | null
  masterExpiryDate: Date | null
  masterSignerName: string | null
  masterSignedAt: Date | null

  jobName: string | null
  jobCode: string | null
  rentalStart: Date | null
  rentalEnd: Date | null
  orderNumbers: string[]

  decision: 'ACCEPTED' | 'DECLINED'
  /** 'JOB' — the client elected for this job; 'ANNUAL' — carried from the
   *  standing election signed on the master. */
  decisionSource: 'JOB' | 'ANNUAL'
  /** What the master itself says, when it says anything. */
  standingDecision: 'ACCEPTED' | 'DECLINED' | null
  /** Descriptions of the vehicles the waiver would actually cover. */
  coveredVehicles: string[]
  /** Vehicles on the job the waiver excludes, with the reason. */
  excludedVehicles: { description: string; reason: string }[]

  /** The per-job confirmation, when the client made one. Null when the
   *  answer is carried from the master — then `masterSignatureNote` says
   *  where it came from, rather than a signature block nobody signed. */
  signature: JobAddendumSignature | null
  masterSignatureNote?: string | null
  /** The client affirmed, for this job, that the master is on file and what
   *  their waiver status is. */
  acknowledgedMaster?: boolean
  generatedAt: Date
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 56,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: '#111827',
    lineHeight: 1.45,
  },
  header: { alignItems: 'center', marginBottom: 18 },
  wordmark: { width: 150, height: 54, objectFit: 'contain' },
  subtitle: { fontSize: 9, color: '#6b7280', marginTop: 6 },
  block: { marginBottom: 14 },
  blockTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: { flexDirection: 'row', marginBottom: 2 },
  rowLabel: { width: 118, color: '#6b7280' },
  rowValue: { flex: 1, color: '#111827' },
  divider: { borderBottomWidth: 0.6, borderBottomColor: '#e5e7eb', marginVertical: 12 },
  body: { fontSize: 9, color: '#374151', marginBottom: 6 },
  // The election is the whole point of the page — it gets a frame, not a
  // sentence buried in a paragraph. A reader scanning the job file has to
  // be able to answer "did they take the waiver?" without reading prose.
  electionFrame: {
    marginTop: 4,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#111827',
    borderRadius: 4,
  },
  electionLabel: {
    fontSize: 8,
    color: '#6b7280',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 3,
  },
  electionValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111827' },
  electionRate: { fontSize: 9, color: '#374151', marginTop: 3 },
  listItem: { fontSize: 8.5, color: '#374151', marginBottom: 1 },
  signatureFrame: {
    marginTop: 6,
    padding: 8,
    borderWidth: 0.6,
    borderColor: '#d1d5db',
    borderRadius: 4,
    backgroundColor: '#f9fafb',
  },
  typedSignature: { fontFamily: 'GreatVibes', fontSize: 30, color: '#111827', marginBottom: 2 },
  signatureLine: {
    borderBottomWidth: 0.8,
    borderBottomColor: '#9ca3af',
    width: 240,
    marginTop: 2,
    marginBottom: 5,
  },
  attestation: { marginTop: 6, fontSize: 8.5, fontFamily: 'Helvetica-Oblique', color: '#374151' },
  small: { fontSize: 8, color: '#6b7280' },
  auditTable: { marginTop: 8, borderWidth: 0.6, borderColor: '#e5e7eb', borderRadius: 4 },
  auditRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  auditRowLast: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 8 },
  auditLabel: {
    width: 110,
    fontSize: 8,
    color: '#6b7280',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  auditValue: { flex: 1, fontSize: 8.5, color: '#111827' },
  footer: {
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 28,
    fontSize: 7.5,
    color: '#9ca3af',
    textAlign: 'center',
  },
})

/** Calendar dates — UTC, never local. See SignedAgreementDocument. */
function fmtDay(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

export function JobAddendumDocument(props: JobAddendumProps) {
  const {
    companyName, masterTitle, masterEffectiveDate, masterExpiryDate,
    masterSignerName, masterSignedAt,
    jobName, jobCode, rentalStart, rentalEnd, orderNumbers,
    decision, decisionSource, standingDecision,
    coveredVehicles, excludedVehicles, signature, masterSignatureNote,
    acknowledgedMaster, generatedAt,
  } = props

  const accepted = decision === 'ACCEPTED'
  const jobLabel = [jobCode, jobName].filter(Boolean).join(' · ') || 'This job'
  const masterTerm = masterEffectiveDate || masterExpiryDate
    ? `${fmtDay(masterEffectiveDate)} – ${masterExpiryDate ? fmtDay(masterExpiryDate) : 'until terminated'}`
    : '—'

  return (
    <Document
      title={`Job Addendum — ${jobLabel}`}
      author="SirReel Studio Rentals"
      subject="Rental Agreement Job Addendum"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Image src={WORDMARK_BLACK_DATA_URI} style={styles.wordmark} />
          <Text style={styles.subtitle}>Rental Agreement — Job Addendum</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Job</Text>
          <Row label="Job name" value={jobName || '—'} />
          <Row label="Job number" value={jobCode || '—'} />
          <Row label="Rental period" value={`${fmtDay(rentalStart)} – ${fmtDay(rentalEnd)}`} />
          {orderNumbers.length > 0 ? (
            <Row label="Order(s)" value={orderNumbers.join(', ')} />
          ) : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Agreement in force</Text>
          <Row label="Lessee" value={companyName || '—'} />
          <Row label="Agreement" value={masterTitle} />
          <Row label="Term" value={masterTerm} />
          {masterSignerName || masterSignedAt ? (
            <Row
              label="Executed"
              value={[masterSignerName, masterSignedAt ? `on ${fmtDay(masterSignedAt)}` : null]
                .filter(Boolean)
                .join(' ') || '—'}
            />
          ) : null}
          <Text style={[styles.body, { marginTop: 6 }]}>
            This addendum adds the job identified above to the {masterTitle} between SirReel
            Production Vehicles, Inc. dba SirReel Studio Rentals and {companyName || 'Lessee'}.
            All terms, conditions, insurance requirements and policies of that agreement apply to
            this job in full and are not modified by this addendum. This addendum records one
            thing: the Limited Collision Damage Waiver election for this job.
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.block} wrap={false}>
          <Text style={styles.blockTitle}>{LCDW_ADDENDUM.title}</Text>

          <View style={styles.electionFrame}>
            <Text style={styles.electionLabel}>Election for {jobLabel}</Text>
            <Text style={styles.electionValue}>
              {accepted ? 'LCDW ACCEPTED' : 'LCDW DECLINED'}
            </Text>
            <Text style={styles.electionRate}>
              {accepted
                ? `Lessee accepts the Limited Collision Damage Waiver at ${usd2(LCDW_DAILY_RATE)} per day, per eligible vehicle, for the rental period above.`
                : 'Lessee declines the Limited Collision Damage Waiver and remains responsible for all loss of or damage to the vehicles under the rental agreement.'}
            </Text>
            {/* Where the answer came from. An annual account already answered
                on the master ("for all fleet vehicle rentals"), and a reader
                of the job file has to be able to tell a carried-forward
                answer from one the client gave for THIS job. */}
            <Text style={[styles.electionRate, { marginTop: 4, color: '#6b7280' }]}>
              {decisionSource === 'ANNUAL'
                ? 'Carried forward from the standing election on the agreement above.'
                : standingDecision && standingDecision !== decision
                  ? `Updated for this job. The agreement\u2019s standing election is ${standingDecision === 'ACCEPTED' ? 'ACCEPT' : 'DECLINE'}.`
                  : 'Confirmed by Lessee for this job.'}
            </Text>
          </View>

          <Text style={styles.body}>{LCDW_ADDENDUM.coverage}</Text>
          <Text style={styles.body}>{LCDW_ADDENDUM.exclusions}</Text>
          <Text style={styles.body}>{LCDW_ADDENDUM.scope}</Text>
        </View>

        {accepted && (coveredVehicles.length > 0 || excludedVehicles.length > 0) ? (
          <View style={styles.block} wrap={false}>
            <Text style={styles.blockTitle}>What this election applies to</Text>
            {coveredVehicles.length > 0 ? (
              <>
                <Text style={[styles.small, { marginBottom: 2 }]}>Covered on this job:</Text>
                {coveredVehicles.map((v, i) => (
                  <Text key={`c${i}`} style={styles.listItem}>• {v}</Text>
                ))}
              </>
            ) : null}
            {/* Excluded vehicles are printed on an ACCEPTED addendum on
                purpose. A client who pays for the waiver and discovers at
                claim time that their PopVan was never eligible has been sold
                nothing, and found out in the worst possible circumstance. */}
            {excludedVehicles.length > 0 ? (
              <>
                <Text style={[styles.small, { marginTop: 6, marginBottom: 2 }]}>
                  NOT covered — the waiver is unavailable on these:
                </Text>
                {excludedVehicles.map((v, i) => (
                  <Text key={`e${i}`} style={styles.listItem}>• {v.description} — {v.reason}</Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.block} wrap={false}>
          <Text style={styles.blockTitle}>
            {acknowledgedMaster ? 'Acknowledged and confirmed in writing' : 'Confirmed in writing'}
          </Text>
          {acknowledgedMaster ? (
            /* The affirmation Wes asked for, printed as its own sentence
               rather than buried in the attestation: a reader of the job file
               has to be able to see that the client was told which agreement
               governs this job and what their waiver status is. */
            <Text style={[styles.body, { marginBottom: 4 }]}>
              Lessee confirmed that {masterTitle} is on file with SirReel and in effect for
              this job, and that the Limited Collision Damage Waiver election above is
              {' '}{accepted ? 'ACCEPTED' : 'DECLINED'}.
            </Text>
          ) : null}
          <Text style={[styles.small, { marginBottom: 6 }]}>{LCDW_ADDENDUM.note}</Text>
          {signature ? (
            <>
              <View style={styles.signatureFrame}>
                <Text style={styles.typedSignature}>{signature.signerName}</Text>
                <View style={styles.signatureLine} />
                <Text style={styles.small}>
                  {[signature.signerName, signature.signerTitle].filter(Boolean).join(' · ')}
                </Text>
                {signature.signerEmail ? (
                  <Text style={styles.small}>{signature.signerEmail}</Text>
                ) : null}
                <Text style={styles.attestation}>{signature.acknowledgmentText}</Text>
              </View>

              <View style={styles.auditTable}>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>Elected</Text>
                  <Text style={styles.auditValue}>{fmtDateTime(signature.decidedAt)}</Text>
                </View>
                <View style={signature.userAgent ? styles.auditRow : styles.auditRowLast}>
                  <Text style={styles.auditLabel}>IP address</Text>
                  <Text style={styles.auditValue}>{signature.ipAddress || 'not recorded'}</Text>
                </View>
                {signature.userAgent ? (
                  <View style={styles.auditRowLast}>
                    <Text style={styles.auditLabel}>Device</Text>
                    <Text style={styles.auditValue}>{signature.userAgent}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            /* No job-level signature, and the page does not draw one. The
               waiver was signed on the master; a signature block here would
               claim a confirmation the client never gave for this job. */
            <View style={styles.signatureFrame}>
              <Text style={styles.body}>{masterSignatureNote || 'Signed on the agreement above.'}</Text>
              <Text style={styles.small}>
                No separate confirmation was required for this job.
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.footer} fixed>
          SirReel Production Vehicles, Inc. dba SirReel Studio Rentals · Job addendum generated{' '}
          {fmtDateTime(generatedAt)}
        </Text>
      </Page>
    </Document>
  )
}
