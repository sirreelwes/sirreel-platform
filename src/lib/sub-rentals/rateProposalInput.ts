/**
 * The partner's rate form, read strictly. Pure — no DB — so it is testable
 * (tests/sub-rentals/rate-proposal.test.ts).
 *
 * The route used to run every field through Number(), so `true` became $1,
 * "abc" was silently dropped, and 1e9 reached a Decimal(10,2) column and came
 * back as a 500 carrying Prisma's own message to the partner's screen.
 */

/** Well past any real daily, weekly or monthly rate, well inside Decimal(10,2). */
export const MAX_PROPOSED_RATE = 1_000_000

export type ProposedRate = { ok: true; value: number | null } | { ok: false }

/**
 * One field. Blank / null → not proposing that period. A number, or a string
 * of one (the form is free text, so "$1,200" is allowed), above zero and up to
 * the cap → rounded to cents. Anything else is refused, never guessed at.
 */
export function parseProposedRate(raw: unknown): ProposedRate {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null }
  let n: number
  if (typeof raw === 'number') n = raw
  else if (typeof raw === 'string' && /^\$?\d[\d,]*(\.\d+)?$/.test(raw.trim().replace(/^\$\s+/, '$'))) {
    n = Number(raw.replace(/[\s$,]/g, ''))
  } else return { ok: false }
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PROPOSED_RATE) return { ok: false }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

export interface ParsedRateProposal {
  daily: number | null
  weekly: number | null
  monthly: number | null
  note: string | null
}

/** The whole body: every field valid and at least one rate, or one sentence for the partner. */
export function parseRateProposal(body: Record<string, unknown>): { ok: true; input: ParsedRateProposal } | { ok: false; error: string } {
  const out: Partial<Record<'daily' | 'weekly' | 'monthly', number | null>> = {}
  for (const k of ['daily', 'weekly', 'monthly'] as const) {
    const r = parseProposedRate(body[k])
    if (!r.ok) {
      return { ok: false, error: `The ${k} rate must be a dollar amount above $0 and no more than $${MAX_PROPOSED_RATE.toLocaleString('en-US')}.` }
    }
    out[k] = r.value
  }
  if (out.daily == null && out.weekly == null && out.monthly == null) return { ok: false, error: 'Enter at least one rate.' }
  return {
    ok: true,
    input: {
      daily: out.daily ?? null,
      weekly: out.weekly ?? null,
      monthly: out.monthly ?? null,
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null,
    },
  }
}
