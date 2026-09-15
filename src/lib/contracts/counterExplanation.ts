/**
 * "Why we landed here" — the client-facing walk-through of a counter-proposal.
 *
 * Wes 2026-09-15: "an explanation button … a very tactful overview of how we
 * landed, where we landed with the clauses and the counter or acceptance,
 * right next to the PDF. They can click on that and see our reasoning and
 * hopefully soften the fact that we are not going with their redline exactly."
 *
 * What the client sees per clause, and where each part comes from:
 *   - the clause and its OUTCOME chip (accepted / our wording / kept as
 *     written) — from the saved decision, never from the model, so the chip
 *     cannot disagree with the PDF;
 *   - a one-line headline and a short, warm explanation — written by the
 *     model from what the client asked for, where we landed, and our reason.
 *
 * What the model is NOT given, on purpose: `counterReasoning` (the internal
 * strategy — "what's negotiable, what's not"), the playbook, risk levels and
 * operator flags. Text it never saw cannot leak onto a client page. A scrub
 * then replaces any explanation that still uses internal vocabulary with a
 * plain sentence for that outcome, and any decided clause the model skipped
 * gets the same — the list always matches the PDF.
 *
 * Stored on the review's `aiResponse._clientExplanation`, stamped with the
 * counterGeneratedAt it explains; a regenerated counter-PDF makes it stale
 * and the next read writes a fresh one. No schema change.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { parseAiJson } from '@/lib/ai/extractJson'
import { REDLINE_EXTRACTION_MODEL } from '@/lib/ai/models'
import { CANONICAL_CLAUSES } from './contractClauses'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

export type ExplanationOutcome = 'ACCEPT' | 'COUNTER' | 'REJECT'

export const OUTCOME_LABEL: Record<ExplanationOutcome, string> = {
  ACCEPT: 'Accepted as you proposed',
  COUNTER: 'Our suggested wording',
  REJECT: 'Kept our standard wording',
}

export interface ExplanationItemInput {
  /** Position in the list ("1", "2"…) — the model's handle. clauseRef is
   *  not unique: two changes can land on one clause. */
  key: string
  clauseRef: string
  /** A clause the client ADDED (no clause of ours by that number). Kept-out
   *  reads "Not included", not "Kept our standard wording". */
  added: boolean
  /** `title` already carries our clause's name; otherwise the writer names it. */
  named: boolean
  title: string
  outcome: ExplanationOutcome
  /** What the client changed, in a line (the review's description). */
  clientAsked: string
  /** The language we landed on — theirs, ours, or the standard clause. */
  landedOn: string
  /** Why it matters to us — context for the writer, not shown verbatim. */
  ourReason: string
  /** The operator's note on the decision, when there is one. */
  note: string | null
}

export interface ClientExplanation {
  forCounterAt: string
  generatedAt: string
  intro: string
  closing: string
  clauses: Array<{ key: string; clauseRef: string; title: string; outcome: ExplanationOutcome; outcomeLabel: string; headline: string; explanation: string }>
}

/** Words that belong to our side of the table. Any explanation using one is
 *  replaced — the model was told not to, and this is the belt to that brace. */
const INTERNAL_VOCAB = {
  test: (s: string) =>
    /\b(playbook|fall-?back|hard musts?|non-?negotiable|negotiable|leverage|concessions?|operator|risk level|high risk|not[_ ]acceptable|needs[_ ]review|auto[_ ]approved|second[- ]round|counter[_ ]?reasoning)\b/i.test(s) ||
    /\bAI\b/.test(s),
}

export function outcomeLabelFor(it: Pick<ExplanationItemInput, 'outcome' | 'added'>): string {
  if (it.added && it.outcome === 'REJECT') return 'Not included'
  if (it.added && it.outcome === 'ACCEPT') return 'Included as you wrote it'
  return OUTCOME_LABEL[it.outcome]
}

const FALLBACK: Record<ExplanationOutcome, (title: string) => string> = {
  ACCEPT: (t) => `We were glad to take your change to ${t} as you wrote it.`,
  COUNTER: (t) =>
    `We've offered wording for ${t} that keeps to what our insurance and operations require while addressing the change you asked for.`,
  REJECT: (t) =>
    `We've kept our standard wording for ${t}. It sits inside how our rentals are insured, so we aren't able to change it on a single production — happy to talk it through.`,
}

const DEFAULT_INTRO =
  'Thank you for the careful read of our rental agreement. We went through every change you proposed, and here is where we landed on each, with the thinking behind it.'
const DEFAULT_CLOSING =
  "If anything here doesn't work for your production, reply to your SirReel rep — we're glad to talk any of it through."

/**
 * The review's clause refs are not always our numbers: "15 (missing)",
 * "22 (new)", "24 (renumbered)", "30-new". Only a plain number of ours gets
 * our clause title; a renumbered ref is the CLIENT's numbering (their 24 is
 * not our 24), so it is named by the writer instead.
 */
export function parseClauseRef(ref: string): { canonical: (typeof CANONICAL_CLAUSES)[number] | null; added: boolean; display: string } {
  const r = ref.trim()
  const base = r.replace(/-new$/i, '').replace(/\s*\(.*\)\s*$/, '').trim()
  const tag = (r.match(/\(([^)]*)\)\s*$/)?.[1] ?? '').toLowerCase()
  const byBase = CANONICAL_CLAUSES.find((x) => x.ref === base) ?? null
  // Added only when the review says so. "Fleet Agreement" / "LCDW" are ours
  // without being numbered clauses; accepting their removal is an ACCEPT of
  // our section, not a client addition.
  const added = /-new$/i.test(r) || /\b(new|added)\b/.test(tag)
  // Our number means our clause when the ref is plain or names OUR clause as
  // missing/removed; a renumbered or new ref is the client's numbering.
  const canonical = !added && !/renumber/.test(tag) ? byBase : null
  return { canonical, added, display: !base ? 'A clause' : /^\d/.test(base) ? `§${base}` : base }
}

const squash = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()

/** Counter wording that removes the clause rather than rewording it. */
export function isRemovalText(t: string): boolean {
  const x = squash(t)
  return x.length < 120 && /(intentionally (omitted|deleted|left blank)|\[?(omitted|deleted|reserved|removed)\]?\.?$|not (be )?included|clause (is )?(deleted|removed|struck))/.test(x)
}

/** Build the per-clause inputs from a review's changes and saved decisions. */
export function buildExplanationItems(
  changes: Array<{ clause?: unknown; description?: unknown; proposed?: unknown; reasoning?: unknown; suggestedCounter?: unknown }>,
  decisions: Array<{ changeIndex: number; clauseRef: string; decision: string; counterLanguage: string | null; note: string | null }>,
): ExplanationItemInput[] {
  const items: ExplanationItemInput[] = []
  for (const d of [...decisions].sort((a, b) => a.changeIndex - b.changeIndex)) {
    if (d.decision !== 'ACCEPT' && d.decision !== 'COUNTER' && d.decision !== 'REJECT') continue
    const ch = changes[d.changeIndex] ?? {}
    const ref = String(d.clauseRef || ch.clause || '').trim()
    const { canonical, added, display } = parseClauseRef(ref)
    const counterText = String(d.counterLanguage || ch.suggestedCounter || '')
    // A "counter" whose wording is the client's own reads as acceptance on
    // the PDF, so it must read as acceptance here — the first dry run
    // (SR-JOB-0347) chipped "Our suggested wording" over "included as you
    // drafted it".
    // And a "counter" on a clause the client ADDED whose wording is a
    // removal ("intentionally omitted") keeps it out of the agreement — the
    // second dry run chipped "Our suggested wording" over "not included".
    const outcome: ExplanationOutcome =
      d.decision === 'COUNTER' && counterText && squash(counterText) === squash(String(ch.proposed ?? ''))
        ? 'ACCEPT'
        : d.decision === 'COUNTER' && added && (!counterText.trim() || isRemovalText(counterText))
          ? 'REJECT'
          : d.decision
    const landedOn =
      outcome === 'ACCEPT'
        ? String(ch.proposed ?? '')
        : outcome === 'COUNTER'
          ? counterText
          : canonical?.body ?? (added ? '(not included in the agreement)' : '(our standard wording)')
    items.push({
      key: String(items.length + 1),
      added,
      named: !!canonical,
      clauseRef: ref,
      title: canonical ? `§${canonical.ref} ${canonical.title}` : display,
      outcome,
      clientAsked: String(ch.description ?? '').trim(),
      landedOn: landedOn.trim(),
      ourReason: String(ch.reasoning ?? '').trim(),
      note: d.note?.trim() || null,
    })
  }
  return items
}

/** Turn whatever the model returned into the page's shape — every decided
 *  clause present, in order, outcome from the decision, internal words out. */
export function assembleExplanation(
  parsed: { intro?: unknown; closing?: unknown; clauses?: unknown },
  items: ExplanationItemInput[],
  forCounterAt: Date,
): ClientExplanation {
  const byKey = new Map<string, { name: string; headline: string; explanation: string }>()
  for (const c of Array.isArray(parsed.clauses) ? (parsed.clauses as any[]) : []) {
    const key = String(c?.id ?? '').trim()
    if (key && !byKey.has(key)) {
      byKey.set(key, {
        name: String(c?.name ?? '').trim(),
        headline: String(c?.headline ?? '').trim(),
        explanation: String(c?.explanation ?? '').trim(),
      })
    }
  }
  const clean = (s: string) => (s && !INTERNAL_VOCAB.test(s) ? s : '')
  const intro = clean(String(parsed.intro ?? '').trim()) || DEFAULT_INTRO
  const closing = clean(String(parsed.closing ?? '').trim()) || DEFAULT_CLOSING
  return {
    forCounterAt: forCounterAt.toISOString(),
    generatedAt: new Date().toISOString(),
    intro,
    closing,
    clauses: items.map((it) => {
      const got = byKey.get(it.key)
      const label = outcomeLabelFor(it)
      return {
        key: it.key,
        clauseRef: it.clauseRef,
        // Our clause title when the ref is ours; otherwise the writer's short
        // name for it ("Rights in Recordings"), kept to a few words.
        title:
          it.named || !got?.name || !clean(got.name) || got.name.length > 60 ||
          squash(got.name).includes(squash(it.title.replace(/^§/, '')))
            ? it.title
            : `${it.title} ${got.name}`,
        outcome: it.outcome,
        outcomeLabel: label,
        // A headline that only repeats the chip says nothing; drop it.
        headline: squash(clean(got?.headline ?? '')) === squash(label) ? '' : clean(got?.headline ?? ''),
        explanation:
          clean(got?.explanation ?? '') ||
          (it.added && it.outcome === 'REJECT'
            ? `We weren't able to add ${it.title} — it falls outside how our rentals are insured and run. Happy to talk through the concern behind it.`
            : FALLBACK[it.outcome](it.title)),
      }
    }),
  }
}

const SYSTEM = `You write the short, client-facing explanation that sits beside SirReel Studio Services' counter-proposal to a production company's redline of our vehicle rental agreement. The client clicks "Why we landed here" to read it.

Your reader is a producer, production manager or their attorney who marked up our agreement and is about to find that we did not take every change. The goal is that they come away feeling heard and respected, understanding our reasons, and seeing the path to getting this signed.

Voice:
- Warm, plain, confident, brief. A thoughtful rep writing to a client they want to keep — never defensive, never legalistic, never apologetic to the point of weakness.
- Lead with what we DID do for them where there is something to give. Frame kept or countered language around the concern behind their change and the practical reason on our side (how the rental is insured, how the fleet operates, protecting both parties if something goes wrong).
- Do not quote clause text back at length; the PDF has it. Refer to what the clause does.
- Do not give legal advice. Do not offer alternatives, "narrower versions" or further changes that are not in the wording we landed on.
- THE OUTCOME IS DECIDED AND FINAL, and it is exactly what their PDF shows. Every sentence must agree with it:
  - "Accepted as you proposed" / "Included as you wrote it": we took their change. If their change REMOVED something, we are fine leaving it out — never ask whether it was intentional, never argue for what was removed, never hint we still want it.
  - "Our suggested wording": the clause now reads the way WE wrote it. Describe what our wording does; do not call it theirs.
  - "Kept our standard wording": the clause stays as we originally drafted it.
  - "Not included": their added clause is not in the agreement.
- "Our reason" is background from our side and may pre-date the decision. Where it conflicts with the Outcome, the Outcome wins.
- Never mention internal process: no playbooks, fallbacks, risk levels, "negotiable", leverage, concessions, reviewers, AI or models. Never characterise the client's redline as unreasonable or aggressive.

Per clause:
- "name": the clause's subject in 1–4 words ("Rights in Recordings", "Subrogation"), taken from what the clause is about.
- "headline": one short line (under 12 words) naming where we landed in human terms — never just the outcome label (the page already shows it as a chip), e.g. "Happy to add a cure period before default".
- "explanation": 1–3 sentences. Do not open by restating the outcome label. For an accepted clause, a sentence of thanks or why it works. For our suggested wording, what the new wording does for them and what it keeps in place for us. For standard wording kept, the reason in terms a producer accepts, and an open door to talk.

Return ONLY JSON, no markdown:
{
  "intro": "<2–3 sentences: thanks for the careful review, we went through every change, the overall shape of where we landed>",
  "clauses": [ { "id": "<the id exactly as given>", "name": "...", "headline": "...", "explanation": "..." } ],
  "closing": "<1–2 sentences inviting them to reply to their rep with questions>"
}
Include every clause you are given, using its id exactly.`

/** Write the explanation without storing it (the dry-run path). */
export async function composeCounterExplanation(reviewId: string): Promise<ClientExplanation | null> {
  const review = await prisma.contractReview.findUnique({
    where: { id: reviewId },
    select: {
      aiResponse: true,
      counterGeneratedAt: true,
      company: { select: { name: true } },
      job: { select: { name: true } },
      changeDecisions: { select: { changeIndex: true, clauseRef: true, decision: true, counterLanguage: true, note: true } },
    },
  })
  if (!review?.counterGeneratedAt) return null
  const ai = (review.aiResponse ?? {}) as Record<string, unknown>
  const changes = Array.isArray(ai.changes) ? (ai.changes as any[]) : []
  const items = buildExplanationItems(changes, review.changeDecisions)
  if (items.length === 0) return null

  const userText = [
    `Production company: ${review.company?.name || 'the production'}`,
    review.job?.name ? `Production: ${review.job.name}` : '',
    '',
    'The clauses, in order:',
    ...items.map((it) =>
      [
        `--- id: ${it.key} · ${it.title}${it.added ? ' (a clause the client added)' : ''}`,
        `Outcome: ${outcomeLabelFor(it)}`,
        `What the client changed: ${it.clientAsked || '(not summarised)'}`,
        `Where we landed: ${it.landedOn.slice(0, 1500) || '(see the PDF)'}`,
        `Our reason (context for you — rephrase for the client, do not quote): ${it.ourReason || '(none recorded)'}`,
        it.note ? `Note from our team for this clause: ${it.note}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ]
    .filter((l) => l !== null)
    .join('\n')

  let parsed: { intro?: unknown; closing?: unknown; clauses?: unknown } = {}
  try {
    const response = await client.messages.create({
      model: REDLINE_EXTRACTION_MODEL,
      max_tokens: 8000,
      // No `thinking` param: the pinned SDK (0.39) predates adaptive
      // thinking's types, and Opus 5 runs adaptive by default anyway.
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    })
    const raw = response.content.find((b) => b.type === 'text')
    parsed = parseAiJson(raw && raw.type === 'text' ? raw.text : '', {
      tag: 'counter-explanation',
      stopReason: response.stop_reason,
    })
  } catch (err: any) {
    // A failed write still yields a complete, tactful page from the
    // per-outcome sentences — the client is never shown an error for this.
    console.error('[counter-explanation] generation failed:', reviewId, err?.message || err)
  }

  return assembleExplanation(parsed, items, review.counterGeneratedAt)
}

export async function generateCounterExplanation(reviewId: string): Promise<ClientExplanation | null> {
  const explanation = await composeCounterExplanation(reviewId)
  if (!explanation) return null
  // Re-read before writing: aiResponse is also rewritten by a re-run, and a
  // stale copy must not put the old analysis back.
  const fresh = await prisma.contractReview.findUnique({ where: { id: reviewId }, select: { aiResponse: true } })
  const base = (fresh?.aiResponse ?? {}) as Record<string, unknown>
  await prisma.contractReview.update({
    where: { id: reviewId },
    data: { aiResponse: { ...base, _clientExplanation: explanation } as any },
  })
  return explanation
}

/** The stored explanation when it matches the current counter-PDF; otherwise
 *  write a fresh one (or return null when `generate` is false). */
export async function getCounterExplanation(
  reviewId: string,
  opts: { generate: boolean; force?: boolean },
): Promise<ClientExplanation | null> {
  if (!opts.force) {
    const review = await prisma.contractReview.findUnique({
      where: { id: reviewId },
      select: { aiResponse: true, counterGeneratedAt: true },
    })
    const stored = (review?.aiResponse as { _clientExplanation?: ClientExplanation } | null)?._clientExplanation
    if (stored && review?.counterGeneratedAt && stored.forCounterAt === review.counterGeneratedAt.toISOString()) {
      return stored
    }
  }
  return opts.generate ? generateCounterExplanation(reviewId) : null
}
