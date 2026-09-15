/**
 * A client's negotiated agreement, assembled for rendering and filing.
 *
 * Wes, 2026-09-15: "We already went back and forth with their lawyer and
 * landed here — they have large jobs with lots of vehicles — so ideally we
 * just rebrand the document they submitted."
 *
 * So the shape is: THEIR clauses, verbatim and in their numbering, plus the
 * sections their document simply does not have. The distinction is the whole
 * point of this file.
 *
 * ── Why appending is not renegotiating ────────────────────────────────
 * Their redline ends at Non-smoking. It carries no Fleet Agreement, no LCDW
 * Addendum, and no Third-Party Equipment clause. None of those were struck
 * by their counsel — two of them were never in the document they marked up
 * (the LCDW addendum and Fleet section live after the numbered clauses in
 * our standard agreement), and Third-Party Equipment did not exist until
 * 2026-09-09, four months after their May redline. Appending them reopens
 * nothing that was negotiated; editing a clause they DID mark up would.
 *
 * That distinction is load-bearing for a vehicle-heavy client:
 *  - No LCDW Addendum means no damage waiver on file at all — no
 *    $/day/vehicle, and none of its exclusions, including the
 *    overhead-clearance exclusion that decides most cube-truck claims.
 *  - No Fleet Agreement means no fuel policy.
 *  - No Third-Party Equipment clause means partner units (King Kong,
 *    PowerTrip) ship on a document whose clause 16 warrants we are "at all
 *    times the sole owner" and whose clause 4 warrants we tested gear we
 *    never touched.
 *
 * ── Numbering ──────────────────────────────────────────────────────────
 * Third-Party Equipment is appended at the next free number in THEIR
 * sequence, not at our 30 — their 30 is Facsimile Signature and their 31 is
 * Non-smoking. Renumbering their clauses is never an option: their counsel's
 * numbering is what any later dispute will cite.
 *
 * Its cross-references survive the move unchanged, which is why it can be
 * appended at all: it cites Sections 1, 2, 4, 5–11 and 16, and their redline
 * deleted only 15 and inserted 22–23, so every one of those still names the
 * same clause in their numbering. Verified by `crossReferencesHold()` below
 * and pinned by npm run test:negotiated-agreement — if a future negotiated
 * document moves one of them, the check fails rather than shipping a clause
 * that points at the wrong terms.
 */
import { CANONICAL_CLAUSES, FLEET_AGREEMENT, LCDW_ADDENDUM, type CanonicalClause } from './contractClauses'
import { GRADUATION_DAY_2026_CLAUSES, GRADUATION_DAY_2026_LEDE } from './negotiated/graduationDay2026'

export interface NegotiatedAgreement {
  /** Stable key — used by the filing script and the generated filename. */
  key: string
  /** What the filed CompanyAgreement row is titled. */
  title: string
  /** Printed under the masthead so the document names its own provenance. */
  version: string
  /** The client's clauses, verbatim, in the client's numbering. */
  clauses: CanonicalClause[]
  /** The "Please read carefully…" lede above the terms. */
  lede: string
  /**
   * Sections appended by SirReel because their document has none. Rendered
   * under a heading that SAYS they are additions — a client who reads this
   * document must be able to see what is their counsel's text and what is
   * not, without diffing it against their own file.
   */
  appendedClauses: CanonicalClause[]
  /** Company names this document is the master for. Filing script targets these. */
  companies: string[]
}

/** The canonical clause our appendix borrows, looked up rather than retyped. */
function canonical(ref: string): CanonicalClause {
  const hit = CANONICAL_CLAUSES.find((c) => c.ref === ref)
  if (!hit) throw new Error(`canonical clause ${ref} not found — did contractClauses.ts renumber?`)
  return hit
}

/** Next free number after the client's highest, so nothing is renumbered. */
export function nextFreeRef(clauses: CanonicalClause[]): string {
  const highest = clauses.reduce((max, c) => Math.max(max, Number(c.ref) || 0), 0)
  return String(highest + 1)
}

/**
 * Do the section numbers our appended clause cites still name the same
 * clauses in the client's numbering? Compares titles, not numbers, because a
 * number that survived while its clause moved is exactly the failure worth
 * catching.
 */
export function crossReferencesHold(
  clauses: CanonicalClause[],
  refs: string[] = ['1', '2', '4', '5', '6', '7', '8', '9', '10', '11', '16'],
): { ok: boolean; mismatched: Array<{ ref: string; ours: string; theirs: string | null }> } {
  const mismatched: Array<{ ref: string; ours: string; theirs: string | null }> = []
  for (const ref of refs) {
    const ours = canonical(ref).title
    const theirs = clauses.find((c) => c.ref === ref)?.title ?? null
    // Titles are compared loosely — their counsel retitled 14 with spaces
    // around the slash, which is not a renumbering.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
    if (!theirs || norm(theirs) !== norm(ours)) mismatched.push({ ref, ours, theirs })
  }
  return { ok: mismatched.length === 0, mismatched }
}

export const GRADUATION_DAY_2026: NegotiatedAgreement = {
  key: 'graduation-day-2026',
  title: '2026 Negotiated Rental Agreement',
  version: 'Negotiated 2026-05-15 · SirReel additions 2026-09-15',
  clauses: GRADUATION_DAY_2026_CLAUSES,
  lede: GRADUATION_DAY_2026_LEDE,
  appendedClauses: [
    {
      ...canonical('30'),
      ref: nextFreeRef(GRADUATION_DAY_2026_CLAUSES),
    },
  ],
  companies: ['Graduation Day Productions', 'Party Giraffes'],
}

export const NEGOTIATED_AGREEMENTS: NegotiatedAgreement[] = [GRADUATION_DAY_2026]

export function findNegotiatedAgreement(key: string): NegotiatedAgreement | undefined {
  return NEGOTIATED_AGREEMENTS.find((a) => a.key === key)
}

/** The appended addenda are the canonical ones, unmodified. */
export const APPENDED_SECTIONS = { FLEET_AGREEMENT, LCDW_ADDENDUM }
