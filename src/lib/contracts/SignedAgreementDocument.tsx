import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import { CANONICAL_CLAUSES, RENTAL_POLICIES, FLEET_AGREEMENT, LCDW_ADDENDUM } from './contractClauses'
import { GREAT_VIBES_TTF_BASE64 } from './fonts/greatVibes'

// Register the handwriting font used for the client's typed signature name.
// Inlined as a base64 data-URI (decoded by @react-pdf/font via fontkit at
// render) so it is bundle-guaranteed on Vercel serverless — no filesystem or
// network fetch that could 404 and silently fall back to a default face.
Font.register({
  family: 'GreatVibes',
  src: `data:font/truetype;base64,${GREAT_VIBES_TTF_BASE64}`,
})

export interface SignedAgreementMeta {
  signerName: string
  signerTitle: string
  signerEmail: string
  signatureImageDataUri: string
  acknowledgmentText: string
  signedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

export interface SignedAgreementJob {
  jobCode?: string | null
  name?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
}

export interface SignedAgreementCompany {
  name?: string | null
  billingAddress?: string | null
}

export interface SignedAgreementDocumentProps {
  company: SignedAgreementCompany | null
  job: SignedAgreementJob | null
  signature: SignedAgreementMeta
  documentLabel: 'baseline' | 'negotiated'
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
  header: {
    textAlign: 'center',
    marginBottom: 18,
  },
  brand: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  badge: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#dcfce7',
    color: '#166534',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.7,
  },
  block: {
    marginBottom: 14,
  },
  blockTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  rowLabel: {
    width: 110,
    color: '#6b7280',
  },
  rowValue: {
    flex: 1,
    color: '#111827',
  },
  divider: {
    borderBottomWidth: 0.6,
    borderBottomColor: '#e5e7eb',
    marginVertical: 12,
  },
  clauseBlock: {
    marginBottom: 10,
  },
  clauseTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  clauseBody: {
    fontSize: 9,
    color: '#374151',
  },
  policyBlock: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.3,
    borderBottomColor: '#f3f4f6',
  },
  policyTitle: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 1,
  },
  signatureFrame: {
    marginTop: 6,
    padding: 8,
    borderWidth: 0.6,
    borderColor: '#d1d5db',
    borderRadius: 4,
    backgroundColor: '#f9fafb',
  },
  signatureImage: {
    width: 220,
    height: 70,
    objectFit: 'contain',
  },
  // Typed name rendered as the client's e-signature when no drawn image was
  // captured (the native flow captures a typed name, not a canvas drawing).
  // GreatVibes is a bundled OFL handwriting font (see ./fonts/greatVibes.ts).
  typedSignature: {
    fontFamily: 'GreatVibes',
    fontSize: 30,
    color: '#111827',
    marginBottom: 2,
  },
  signatureLine: {
    borderBottomWidth: 0.8,
    borderBottomColor: '#9ca3af',
    width: 240,
    marginTop: 2,
    marginBottom: 5,
  },
  attestation: {
    marginTop: 6,
    fontSize: 8.5,
    fontFamily: 'Helvetica-Oblique',
    color: '#374151',
  },
  small: {
    fontSize: 8,
    color: '#6b7280',
  },
  auditTable: {
    marginTop: 8,
    borderWidth: 0.6,
    borderColor: '#e5e7eb',
    borderRadius: 4,
  },
  auditRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.3,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  auditRowLast: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  auditLabel: {
    width: 110,
    fontSize: 8,
    color: '#6b7280',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  auditValue: {
    flex: 1,
    fontSize: 8.5,
    color: '#111827',
  },
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

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
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

export function SignedAgreementDocument({
  company,
  job,
  signature,
  documentLabel,
}: SignedAgreementDocumentProps) {
  const docLabel = documentLabel === 'negotiated' ? 'Negotiated' : 'Baseline'
  return (
    <Document
      title={`SirReel Rental Agreement — ${signature.signerName}`}
      author="SirReel Studio Rentals"
      subject="Signed Rental Agreement"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>SIRREEL STUDIO RENTALS</Text>
          <Text style={styles.subtitle}>Equipment and Vehicle Rental Agreement</Text>
          <Text style={styles.badge}>SIGNED · {docLabel.toUpperCase()}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Agreement</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Company</Text>
            <Text style={styles.rowValue}>{company?.name || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Address</Text>
            <Text style={styles.rowValue}>{company?.billingAddress || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Job</Text>
            <Text style={styles.rowValue}>
              {job?.name || '—'}
              {job?.jobCode ? ` (${job.jobCode})` : ''}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Rental period</Text>
            <Text style={styles.rowValue}>
              {fmtDate(job?.startDate) || '—'}{' '}{job?.endDate ? `– ${fmtDate(job.endDate)}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Signatory</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{signature.signerName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Title</Text>
            <Text style={styles.rowValue}>{signature.signerTitle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue}>{signature.signerEmail}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Signed at</Text>
            <Text style={styles.rowValue}>{fmtDateTime(signature.signedAt)}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Acknowledgment</Text>
          <Text style={styles.clauseBody}>{signature.acknowledgmentText}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Signature</Text>
          <View style={styles.signatureFrame}>
            {signature.signatureImageDataUri ? (
              <Image src={signature.signatureImageDataUri} style={styles.signatureImage} />
            ) : (
              <Text style={styles.typedSignature}>{signature.signerName}</Text>
            )}
            <View style={styles.signatureLine} />
            <Text style={styles.small}>
              {signature.signerName}
              {signature.signerTitle ? `, ${signature.signerTitle}` : ''}
            </Text>
          </View>
          <Text style={styles.attestation}>
            Signed electronically by {signature.signerName} on {fmtDate(signature.signedAt)}.
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>E-SIGN audit trail</Text>
          <View style={styles.auditTable}>
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>Timestamp</Text>
              <Text style={styles.auditValue}>{fmtDateTime(signature.signedAt)}</Text>
            </View>
            <View style={styles.auditRow}>
              <Text style={styles.auditLabel}>IP address</Text>
              <Text style={styles.auditValue}>{signature.ipAddress || 'unknown'}</Text>
            </View>
            <View style={styles.auditRowLast}>
              <Text style={styles.auditLabel}>User agent</Text>
              <Text style={styles.auditValue}>{signature.userAgent || 'unknown'}</Text>
            </View>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `SirReel Rental Agreement · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={styles.blockTitle}>Rental Policies</Text>
        {RENTAL_POLICIES.map((policy, i) => (
          <View key={`policy-${i}`} style={styles.policyBlock}>
            <Text style={styles.policyTitle}>{policy.title}</Text>
            <Text style={styles.clauseBody}>{policy.body}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.blockTitle}>Terms and Conditions</Text>
        {CANONICAL_CLAUSES.map((clause) => (
          <View key={`clause-${clause.ref}`} style={styles.clauseBlock} wrap={false}>
            <Text style={styles.clauseTitle}>
              {clause.ref}. {clause.title}
            </Text>
            <Text style={styles.clauseBody}>{clause.body}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.blockTitle}>{FLEET_AGREEMENT.title}</Text>
        <Text style={styles.clauseBody}>{FLEET_AGREEMENT.intro}</Text>
        <Text style={[styles.clauseBody, { marginTop: 4 }]}>{FLEET_AGREEMENT.fuelPolicy}</Text>

        <View style={styles.divider} />

        <Text style={styles.blockTitle}>{LCDW_ADDENDUM.title}</Text>
        <Text style={styles.clauseBody}>{LCDW_ADDENDUM.rate}</Text>
        <Text style={[styles.clauseBody, { marginTop: 4 }]}>{LCDW_ADDENDUM.scope}</Text>
        <Text style={[styles.clauseBody, { marginTop: 4 }]}>{LCDW_ADDENDUM.note}</Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `SirReel Rental Agreement · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  )
}
