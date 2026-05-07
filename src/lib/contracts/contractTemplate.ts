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
  notes?: string | null
}

export interface JobForRender {
  jobCode?: string | null
  name?: string | null
  productionType?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
}

export interface RenderArgs {
  company: CompanyForRender | null
  job: JobForRender | null
  aiChanges: AiChange[]
  decisions: DecisionForRender[]
  generatedAt?: Date
}

interface ResolvedClause {
  ref: string
  title: string
  /** What to actually render as the body (canonical, accepted, or countered). */
  body: string
  /** Source decision for this clause, if any. */
  decision?: ChangeDecisionValue
  /** AI change description, if any. */
  change?: AiChange
}

function escapeHtml(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Pair AI changes with decisions by changeIndex (the brief's stable reference).
 * Returns a map keyed by clauseRef → first decision that maps to that clauseRef
 * (for changes whose clauseRef matches a canonical clause number). Decisions
 * whose clauseRef doesn't map to a canonical clause go into `unmapped`.
 */
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
      // First decision wins if duplicates appear (unlikely; defensive).
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
    // Brief says: render `aiResponse.changes[i].proposed` for ACCEPT.
    // The AI's `proposed` is a description, not full clause text; render it
    // as the operative replacement and tag it so reviewers know.
    return {
      ref: canonical.ref,
      title: canonical.title,
      body: change.proposed || canonical.body,
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
  // REJECT or PENDING → canonical text wins.
  return { ...canonical, decision: decision.decision, change }
}

function renderHeader(args: RenderArgs): string {
  const today = fmtDate(args.generatedAt || new Date())
  return `
    <header class="doc-header">
      <div class="brand-row">
        <div class="brand">
          <div class="brand-name">SirReel Studio Rentals</div>
          <div class="brand-sub">SirReel Production Vehicles, Inc.</div>
        </div>
        <div class="doc-meta">
          <div class="doc-title">Rental Agreement — Counter Proposal</div>
          <div class="doc-date">Generated ${escapeHtml(today)}</div>
        </div>
      </div>
    </header>
  `
}

function renderInfoBlocks(args: RenderArgs): string {
  const c = args.company || {}
  const j = args.job || {}
  return `
    <section class="info-blocks">
      <div class="info-block">
        <div class="info-title">Company Information</div>
        <table class="info-table">
          <tr><th>Company Name</th><td>${escapeHtml(c.name)}</td></tr>
          <tr><th>Company Type</th><td>${escapeHtml(c.industry)}</td></tr>
          <tr><th>Company Address</th><td>${escapeHtml(c.billingAddress)}</td></tr>
          <tr><th>Company Office Email</th><td>${escapeHtml(c.billingEmail)}</td></tr>
        </table>
      </div>
      <div class="info-block">
        <div class="info-title">Job Information</div>
        <table class="info-table">
          <tr><th>Job Name</th><td>${escapeHtml(j.name)}</td></tr>
          <tr><th>Job #</th><td>${escapeHtml(j.jobCode)}</td></tr>
          <tr><th>Job Type</th><td>${escapeHtml(j.productionType)}</td></tr>
          <tr><th>Rental Start</th><td>${escapeHtml(fmtDate(j.startDate))}</td></tr>
          <tr><th>Rental End</th><td>${escapeHtml(fmtDate(j.endDate))}</td></tr>
        </table>
      </div>
    </section>
  `
}

function renderPolicies(): string {
  return `
    <section class="section">
      <h2 class="section-title">Rental Policies</h2>
      ${RENTAL_POLICIES.map(
        (p) => `
        <div class="policy">
          <div class="policy-title">${escapeHtml(p.title)}</div>
          <p class="policy-body">${escapeHtml(p.body)}</p>
        </div>
      `
      ).join('')}
    </section>
  `
}

function decisionTag(d: ChangeDecisionValue | undefined): string {
  if (!d || d === 'PENDING') return ''
  if (d === 'ACCEPT')
    return '<span class="tag tag-accept" data-decision="ACCEPT">Accepted change</span>'
  if (d === 'COUNTER')
    return '<span class="tag tag-counter" data-decision="COUNTER">Countered</span>'
  return '<span class="tag tag-reject" data-decision="REJECT">Original retained</span>'
}

function renderClauses(
  args: RenderArgs,
  byClauseRef: Map<string, { change: AiChange; decision: DecisionForRender }>
): string {
  return `
    <section class="section">
      <h2 class="section-title">Equipment and/or Vehicle Terms &amp; Conditions</h2>
      <p class="section-lede">
        Please read carefully. You are liable for our equipment and vehicles from the time
        they leave our premises until the time they are returned to us and we sign for them.
      </p>
      ${CANONICAL_CLAUSES.map((c) => {
        const resolved = resolveClause(c, byClauseRef.get(c.ref))
        return `
          <div class="clause" data-clause-ref="${escapeHtml(c.ref)}" data-decision="${escapeHtml(
          resolved.decision || 'PENDING'
        )}">
            <div class="clause-head">
              <span class="clause-num">${escapeHtml(c.ref)}.</span>
              <span class="clause-title">${escapeHtml(c.title)}</span>
              ${decisionTag(resolved.decision)}
            </div>
            <p class="clause-body">${escapeHtml(resolved.body)}</p>
          </div>
        `
      }).join('')}
    </section>
  `
}

function renderFleetAndLcdw(): string {
  return `
    <section class="section">
      <h2 class="section-title">${escapeHtml(FLEET_AGREEMENT.title)}</h2>
      <p class="section-lede">${escapeHtml(FLEET_AGREEMENT.intro)}</p>
      <p class="clause-body">${escapeHtml(FLEET_AGREEMENT.fuelPolicy)}</p>
    </section>
    <section class="section">
      <h2 class="section-title">${escapeHtml(LCDW_ADDENDUM.title)}</h2>
      <p class="clause-body"><strong>${escapeHtml(LCDW_ADDENDUM.rate)}</strong></p>
      <p class="clause-body">${escapeHtml(LCDW_ADDENDUM.scope)}</p>
      <p class="clause-body">${escapeHtml(LCDW_ADDENDUM.note)}</p>
    </section>
  `
}

function renderUnmapped(
  unmapped: Array<{ change: AiChange; decision: DecisionForRender }>
): string {
  if (unmapped.length === 0) return ''
  return `
    <section class="section">
      <h2 class="section-title">Additional Negotiated Items</h2>
      <p class="section-lede">
        The following items refer to provisions outside the numbered clause list above
        (e.g., Fleet sub-clauses or grouped sections).
      </p>
      ${unmapped
        .map(({ change, decision }) => {
          const body =
            decision.decision === 'COUNTER' && decision.counterLanguage
              ? decision.counterLanguage
              : decision.decision === 'ACCEPT'
                ? change.proposed
                : `(Item retained as originally drafted.) Original: ${change.original}`
          return `
            <div class="clause" data-clause-ref="${escapeHtml(change.clause)}" data-decision="${escapeHtml(
            decision.decision
          )}">
              <div class="clause-head">
                <span class="clause-num">§${escapeHtml(change.clause)}</span>
                ${decisionTag(decision.decision)}
              </div>
              <p class="clause-body">${escapeHtml(body)}</p>
            </div>
          `
        })
        .join('')}
    </section>
  `
}

const STYLES = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.45;
  }
  body { padding: 0.5in 0.6in; }
  .doc-header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .brand-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand-name { font-size: 18pt; font-weight: 700; letter-spacing: -0.5px; }
  .brand-sub { font-size: 9pt; color: #555; margin-top: 2px; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 11pt; font-weight: 700; }
  .doc-date { font-size: 9pt; color: #555; }
  .info-blocks { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .info-block { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; }
  .info-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #555; margin-bottom: 6px; }
  .info-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .info-table th { text-align: left; font-weight: 600; color: #555; padding: 2px 8px 2px 0; vertical-align: top; width: 40%; }
  .info-table td { padding: 2px 0; vertical-align: top; }
  .section { margin-top: 18px; page-break-inside: auto; }
  .section-title { font-size: 13pt; font-weight: 700; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 0 0 10px 0; }
  .section-lede { font-size: 10pt; color: #444; margin: 0 0 10px 0; }
  .policy { margin-bottom: 8px; }
  .policy-title { font-weight: 700; font-size: 10pt; }
  .policy-body { font-size: 10pt; margin: 2px 0 0 0; }
  .clause { margin-bottom: 10px; page-break-inside: avoid; }
  .clause-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; flex-wrap: wrap; }
  .clause-num { font-weight: 700; }
  .clause-title { font-weight: 700; }
  .clause-body { margin: 0; font-size: 10pt; text-align: justify; }
  .tag {
    display: inline-block;
    font-size: 8pt;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-left: 4px;
  }
  .tag-accept { background: #d1fae5; color: #065f46; }
  .tag-counter { background: #fef3c7; color: #92400e; }
  .tag-reject { background: #fee2e2; color: #991b1b; }
  .clause[data-decision="COUNTER"] .clause-body { background: #fffbeb; padding: 4px 6px; border-left: 3px solid #f59e0b; }
  .clause[data-decision="ACCEPT"] .clause-body { background: #ecfdf5; padding: 4px 6px; border-left: 3px solid #10b981; }
  footer.doc-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9pt; color: #666; }
`

export function renderContractHtml(args: RenderArgs): string {
  const { byClauseRef, unmapped } = indexChanges(args.aiChanges, args.decisions)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SirReel Rental Agreement — Counter Proposal</title>
  <style>${STYLES}</style>
</head>
<body>
  ${renderHeader(args)}
  ${renderInfoBlocks(args)}
  ${renderPolicies()}
  ${renderClauses(args, byClauseRef)}
  ${renderFleetAndLcdw()}
  ${renderUnmapped(unmapped)}
  <footer class="doc-footer">
    This document reflects SirReel's negotiation position based on per-clause review of the client's redlined agreement.
    It is a proposal for discussion and does not itself constitute an executed contract.
  </footer>
</body>
</html>`
}
