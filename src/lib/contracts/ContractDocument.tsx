import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import {
  CANONICAL_CLAUSES,
  RENTAL_POLICIES,
  FLEET_AGREEMENT,
  LCDW_ADDENDUM,
  type CanonicalClause,
} from './contractClauses'

export type ChangeDecisionValue = 'PENDING' | 'ACCEPT' | 'COUNTER' | 'REJECT'

export interface AiChange {
  clause: string
  type: 'auto_approved' | 'needs_review' | 'not_acceptable' | string
  original: string
  proposed: string
  reasoning: string
  suggestedCounter?: string | null
}

export interface DecisionForRender {
  changeIndex: number
  clauseRef: string
  decision: ChangeDecisionValue
  counterLanguage: string | null
  note: string | null
}

export interface CompanyForRender {
  name?: string | null
  industry?: string | null
  billingAddress?: string | null
  billingEmail?: string | null
  billingPhone?: string | null
  notes?: string | null
}

export interface ContactForRender {
  fullName?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
}

export interface JobForRender {
  jobCode?: string | null
  name?: string | null
  productionType?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  primaryContact?: ContactForRender | null
}

/** Facility access enumeration — one entry per package-member line on
 *  the order at counter-PDF generation time. Powers the "Facility
 *  access granted under this agreement" block (Lankershim Studios
 *  flow): the client sees exactly which areas they've paid for vs.
 *  which were withheld at scope time, so there's no ambiguity about
 *  what the agreement covers. Empty/omitted → block is not rendered. */
export interface GrantedScopeEntry {
  /** Display label — typically OrderLineItem.description (the area name). */
  label: string
  /** Optional second-line annotation (e.g. clientNote for the area). */
  note?: string | null
}

export interface ContractDocumentProps {
  company: CompanyForRender | null
  job: JobForRender | null
  aiChanges: AiChange[]
  decisions: DecisionForRender[]
  generatedAt?: Date
  /** Optional facility-scope block. When provided AND non-empty,
   *  renders a "Facility access granted under this agreement" section
   *  above the closing disclaimer. Members of the package expansion
   *  on the order; populated by the counter-PDF generator. */
  grantedScope?: { packageName: string; items: GrantedScopeEntry[] } | null
  /** Header / PDF-metadata title. Defaults to the counter-proposal label
   *  (unchanged for the contract-review counter flow). The baseline
   *  document-to-sign passes "Rental Agreement" so the client isn't shown
   *  a doc mislabeled "Counter Proposal". Presentation only — does NOT
   *  affect any clause text. */
  documentTitle?: string
}

interface ResolvedClause {
  ref: string
  title: string
  body: string
  decision?: ChangeDecisionValue
  change?: AiChange
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function indexChanges(
  changes: AiChange[],
  decisions: DecisionForRender[]
): {
  byClauseRef: Map<string, { change: AiChange; decision: DecisionForRender }>
  unmapped: Array<{ change: AiChange; decision: DecisionForRender }>
} {
  const decisionsByIndex = new Map<number, DecisionForRender>()
  for (const d of decisions) decisionsByIndex.set(d.changeIndex, d)

  const canonicalRefs = new Set(CANONICAL_CLAUSES.map((c) => c.ref))
  const byClauseRef = new Map<string, { change: AiChange; decision: DecisionForRender }>()
  const unmapped: Array<{ change: AiChange; decision: DecisionForRender }> = []

  changes.forEach((ch, i) => {
    const decision = decisionsByIndex.get(i)
    if (!decision) return
    const ref = String(ch.clause || '').trim()
    if (canonicalRefs.has(ref)) {
      if (!byClauseRef.has(ref)) byClauseRef.set(ref, { change: ch, decision })
    } else {
      unmapped.push({ change: ch, decision })
    }
  })

  return { byClauseRef, unmapped }
}

function resolveClause(
  canonical: CanonicalClause,
  match: { change: AiChange; decision: DecisionForRender } | undefined
): ResolvedClause {
  if (!match) return { ...canonical }
  const { change, decision } = match
  if (decision.decision === 'ACCEPT') {
    const proposed = (change.proposed || '').trim()
    // Defense-in-depth: if proposed is missing, empty, or suspiciously short
    // compared to the canonical clause, render the baseline rather than what
    // looks like AI summary text. Mirrors the route.ts coercion pass.
    const looksLikeSummary =
      !proposed ||
      proposed.length < 80 ||
      proposed.length < canonical.body.length * 0.5
    return {
      ref: canonical.ref,
      title: canonical.title,
      body: looksLikeSummary ? canonical.body : proposed,
      decision: 'ACCEPT',
      change,
    }
  }
  if (decision.decision === 'COUNTER' && decision.counterLanguage) {
    return {
      ref: canonical.ref,
      title: canonical.title,
      body: decision.counterLanguage,
      decision: 'COUNTER',
      change,
    }
  }
  return { ...canonical, decision: decision.decision, change }
}

const C = {
  ink: '#111111',
  muted: '#555555',
  faint: '#888888',
  rule: '#cccccc',
  acceptBg: '#ecfdf5',
  acceptText: '#065f46',
  acceptRule: '#10b981',
  counterBg: '#fffbeb',
  counterText: '#92400e',
  counterRule: '#f59e0b',
  rejectBg: '#fef2f2',
  rejectText: '#991b1b',
  rejectRule: '#ef4444',
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
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 18 },
  brandSub: { fontSize: 9, color: C.muted, marginTop: 2 },
  docMeta: { flexDirection: 'column', alignItems: 'flex-end' },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  docDate: { fontSize: 9, color: C.muted, marginTop: 2 },
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoBlock: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 4,
    padding: 8,
  },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 6,
  },
  infoLine: { flexDirection: 'row', marginBottom: 2 },
  infoLabel: { width: '38%', fontSize: 9, color: C.muted },
  infoValue: { width: '62%', fontSize: 9 },
  section: { marginTop: 14 },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    borderBottomWidth: 0.75,
    borderBottomColor: C.rule,
    paddingBottom: 3,
    marginBottom: 8,
  },
  sectionLede: { fontSize: 9, color: C.muted, marginBottom: 8 },
  policy: { marginBottom: 6 },
  policyTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  policyBody: { fontSize: 9, marginTop: 1, textAlign: 'justify' },
  clause: { marginBottom: 8 },
  clauseHead: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 2, flexWrap: 'wrap' },
  clauseNum: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 4 },
  clauseTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  clauseBody: { fontSize: 10, textAlign: 'justify' },
  clauseBodyAccept: {
    fontSize: 10,
    textAlign: 'justify',
    backgroundColor: C.acceptBg,
    borderLeftWidth: 2,
    borderLeftColor: C.acceptRule,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  clauseBodyCounter: {
    fontSize: 10,
    textAlign: 'justify',
    backgroundColor: C.counterBg,
    borderLeftWidth: 2,
    borderLeftColor: C.counterRule,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  tag: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tagAccept: { backgroundColor: C.acceptBg, color: C.acceptText },
  tagCounter: { backgroundColor: C.counterBg, color: C.counterText },
  tagReject: { backgroundColor: C.rejectBg, color: C.rejectText },
  fleetBody: { fontSize: 10, textAlign: 'justify', marginTop: 4 },
  scopeIntro: { fontSize: 9, color: C.muted, marginBottom: 6 },
  scopeRow: { flexDirection: 'row', marginBottom: 2 },
  scopeBullet: { width: 12, fontSize: 10 },
  scopeLabel: { flex: 1, fontSize: 10 },
  scopeNote: { fontSize: 8, color: C.muted, fontStyle: 'italic', marginLeft: 12, marginTop: 1 },
  closing: {
    marginTop: 18,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    fontSize: 8,
    color: C.muted,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: C.faint,
  },
})

const InfoLine: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <View style={styles.infoLine}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value || '—'}</Text>
  </View>
)

const DecisionTag: React.FC<{ decision?: ChangeDecisionValue }> = ({ decision }) => {
  if (!decision || decision === 'PENDING') return null
  if (decision === 'ACCEPT') return <Text style={[styles.tag, styles.tagAccept]}>Accepted</Text>
  if (decision === 'COUNTER') return <Text style={[styles.tag, styles.tagCounter]}>Countered</Text>
  return <Text style={[styles.tag, styles.tagReject]}>Original retained</Text>
}

function clauseBodyStyle(decision?: ChangeDecisionValue) {
  if (decision === 'ACCEPT') return styles.clauseBodyAccept
  if (decision === 'COUNTER') return styles.clauseBodyCounter
  return styles.clauseBody
}

export const ContractDocument: React.FC<ContractDocumentProps> = ({
  company,
  job,
  aiChanges,
  decisions,
  generatedAt,
  grantedScope,
  documentTitle,
}) => {
  const generated = generatedAt || new Date()
  const { byClauseRef, unmapped } = indexChanges(aiChanges, decisions)
  const c = company || {}
  const j = job || {}
  const contact = j.primaryContact || null
  const docTitle = documentTitle || 'Rental Agreement — Counter Proposal'

  return (
    <Document
      title={`SirReel ${docTitle}`}
      author="SirReel Studio Rentals"
      subject={docTitle}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRow} fixed>
          <View style={styles.brand}>
            <Text style={styles.brandName}>SirReel</Text>
            <Text style={styles.brandSub}>SirReel Production Vehicles, Inc.</Text>
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>{docTitle}</Text>
            <Text style={styles.docDate}>Generated {fmtDate(generated)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoTitle}>Company Information</Text>
            <InfoLine label="Name" value={c.name} />
            <InfoLine label="Type" value={c.industry} />
            <InfoLine label="Address" value={c.billingAddress} />
            <InfoLine label="Office Email" value={c.billingEmail} />
            <InfoLine label="Phone" value={c.billingPhone} />
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoTitle}>Job Information</Text>
            <InfoLine label="Name" value={j.name} />
            <InfoLine label="Job #" value={j.jobCode} />
            <InfoLine label="Type" value={j.productionType} />
            <InfoLine label="Start" value={fmtDate(j.startDate)} />
            <InfoLine label="End" value={fmtDate(j.endDate)} />
          </View>
        </View>

        {contact && (
          <View style={[styles.infoRow, { marginTop: -4 }]}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoTitle}>Primary Contact</Text>
              <InfoLine label="Name" value={contact.fullName} />
              <InfoLine label="Position" value={contact.role} />
              <InfoLine label="Email" value={contact.email} />
              <InfoLine label="Phone" value={contact.phone} />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rental Policies</Text>
          {RENTAL_POLICIES.map((p) => (
            <View key={p.title} style={styles.policy} wrap={false}>
              <Text style={styles.policyTitle}>{p.title}</Text>
              <Text style={styles.policyBody}>{p.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section} break>
          <Text style={styles.sectionTitle}>Equipment and/or Vehicle Terms & Conditions</Text>
          <Text style={styles.sectionLede}>
            Please read carefully. You are liable for our equipment and vehicles from the time
            they leave our premises until the time they are returned to us and we sign for them.
          </Text>
          {CANONICAL_CLAUSES.map((cc) => {
            const resolved = resolveClause(cc, byClauseRef.get(cc.ref))
            return (
              <View key={cc.ref} style={styles.clause} wrap={false}>
                <View style={styles.clauseHead}>
                  <Text style={styles.clauseNum}>{cc.ref}.</Text>
                  <Text style={styles.clauseTitle}>{cc.title}</Text>
                  <DecisionTag decision={resolved.decision} />
                </View>
                <Text style={clauseBodyStyle(resolved.decision)}>{resolved.body}</Text>
              </View>
            )
          })}
        </View>

        <View style={styles.section} break>
          <Text style={styles.sectionTitle}>{FLEET_AGREEMENT.title}</Text>
          <Text style={styles.sectionLede}>{FLEET_AGREEMENT.intro}</Text>
          <Text style={styles.fleetBody}>{FLEET_AGREEMENT.fuelPolicy}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{LCDW_ADDENDUM.title}</Text>
          <Text style={[styles.fleetBody, { fontFamily: 'Helvetica-Bold' }]}>
            {LCDW_ADDENDUM.rate}
          </Text>
          <Text style={styles.fleetBody}>{LCDW_ADDENDUM.scope}</Text>
          <Text style={styles.fleetBody}>{LCDW_ADDENDUM.note}</Text>
        </View>

        {unmapped.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Negotiated Items</Text>
            <Text style={styles.sectionLede}>
              The following items refer to provisions outside the numbered clause list above
              (e.g., Fleet sub-clauses or grouped sections).
            </Text>
            {unmapped.map(({ change, decision }, idx) => {
              const acceptBody = (() => {
                const proposed = typeof change.proposed === 'string' ? change.proposed.trim() : ''
                if (!proposed || proposed.length < 80) {
                  return `(Item retained as originally drafted.) Original: ${change.original}`
                }
                return proposed
              })()
              const body =
                decision.decision === 'COUNTER' && decision.counterLanguage
                  ? decision.counterLanguage
                  : decision.decision === 'ACCEPT'
                    ? acceptBody
                    : `(Item retained as originally drafted.) Original: ${change.original}`
              return (
                <View key={`unmapped-${idx}`} style={styles.clause} wrap={false}>
                  <View style={styles.clauseHead}>
                    <Text style={styles.clauseNum}>§{change.clause}</Text>
                    <DecisionTag decision={decision.decision} />
                  </View>
                  <Text style={clauseBodyStyle(decision.decision)}>{body}</Text>
                </View>
              )
            })}
          </View>
        )}

        {grantedScope && grantedScope.items.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Facility access granted under this agreement</Text>
            <Text style={styles.scopeIntro}>
              The {grantedScope.packageName} on this order grants access to the following areas
              for the rental period. Areas not listed here are not included in this agreement.
            </Text>
            {grantedScope.items.map((item, i) => (
              <View key={i} wrap={false}>
                <View style={styles.scopeRow}>
                  <Text style={styles.scopeBullet}>•</Text>
                  <Text style={styles.scopeLabel}>{item.label}</Text>
                </View>
                {item.note && item.note.trim().length > 0 && (
                  <Text style={styles.scopeNote}>{item.note}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.closing}>
          <Text>
            This document reflects SirReel&apos;s negotiation position based on per-clause review
            of the client&apos;s redlined agreement. It is a proposal for discussion and does not
            itself constitute an executed contract.
          </Text>
        </View>

        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  )
}

export default ContractDocument
