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
   *
   * ── An appended clause the client REDLINES is overridden HERE ──────────
   * Spell the agreed body out in this array. Do NOT edit the clause in
   * contractClauses.ts to match: `canonical('30')` is the baseline
   * Third-Party Equipment clause, and the same body is rendered by
   * RentalAgreementBody (the portal's readable agreement),
   * SignedAgreementDocument (every signed copy) and the review tooling's
   * baseline map. Editing it there renegotiates that clause for every
   * client at once, silently, on the strength of one client's counsel.
   *
   * An override is `{ ...canonical('30'), ref: …, body: '<agreed text>' }`
   * with a comment saying whose redline it came from and when. The digest in
   * npm run test:negotiated-agreement covers these clauses too, so an edit
   * to either side — here or in the canonical module — fails the test rather
   * than reaching a filed contract unnoticed.
   */
  appendedClauses: CanonicalClause[]
  /** Company names this document is the master for. Filing script targets these. */
  companies: string[]
  /**
   * Registry name → the company's EXACT name in the DB, where the two differ.
   *
   * Matching stays EXACT — an alias is a human stating which row, not the
   * lookup loosening its rule and picking a near-match. Filing a contract
   * against the wrong company is the failure worth being rigid about, and
   * this client is the reason: "Party Giraffes" also near-matches "Giraffe
   * Air LLC DBA Studio Sands", which is somebody else entirely.
   */
  companyAliases?: Record<string, string>
  /**
   * The agreed coverage window, as YYYY-MM-DD.
   *
   * Recorded here rather than typed at the command line each run. The filing
   * script refuses to file an auto-covering master with no end date — one that
   * never lapses never hands the signing ask back — and a date that must be
   * retyped for every company is a date that eventually gets mistyped into a
   * contract. Flags still override for a one-off.
   */
  effectiveDate: string
  expiryDate: string
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
  refs: string[] = ['1', '2', '4', '5', '6', '7', '8', '9', '10', '11', '14', '16'],
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
  version: 'Negotiated 2026-05-15 · SirReel additions 2026-09-15 · §32 agreed 2026-09-18',
  clauses: GRADUATION_DAY_2026_CLAUSES,
  lede: GRADUATION_DAY_2026_LEDE,
  appendedClauses: [
    {
      ...canonical('30'),
      ref: nextFreeRef(GRADUATION_DAY_2026_CLAUSES),
      // §32 AS AGREED — their counsel's 2026-09-17 redline of our appended
      // clause, plus the three qualifiers Wes sent back on 2026-09-18 and
      // Marell accepted. An OVERRIDE, never an edit to contractClauses.ts:
      // canonical('30') is still the baseline every other client renders.
      //
      // Theirs (three edits, all here, none elsewhere in the document):
      //   1. "provided that we shall remain liable for any failure … to
      //      adhere to Section 4" — we answer for the partner's testing.
      //   2. "Every obligation each party owes the other … and all of our
      //      obligations" — the clause runs both ways, not just at them.
      //   3. "and in any event we remain liable for the acts and omissions
      //      of such third parties."
      // Ours (accepted):
      //   a. "by such third party, or by us," — their first edit read "any
      //      failure of such third party's or our failure to adhere", which
      //      does not parse. Grammar only; nothing moved.
      //   b. "subject to Section 14," — the one that matters. "In any event"
      //      is what someone argues overrides the limitation of liability;
      //      this puts their new liability inside the cap both sides already
      //      agreed to, and does not take the edit back.
      //   c. "in connection with the Equipment supplied under this Agreement
      //      during the rental period" — their third edit had no boundary in
      //      time or subject.
      //   d. The LCDW sentence, placed in the clause they reopened rather
      //      than in the addendum they had already accepted: their "all of
      //      our obligations" would otherwise drag our damage waiver onto a
      //      partner's trailer, where we would waive the first $1,000 (loss
      //      of use included) and still owe the partner for it.
      //
      // Everything this survives on is the partner's own paper — partner
      // agreement §6 (condition, testing, repair at their cost) and §11
      // (they indemnify SirReel AND our clients). That is why the
      // unsigned-partner gate exists; see sub-rentals/partnerPaperGate.ts.
      body:
        'Some Equipment supplied under this Agreement is owned by third parties from whom we rent it, and is supplied to you on the same terms as Equipment we own. Where such Equipment is delivered to you directly by its owner rather than from our premises, the owner’s pre-delivery inspection and delivery record stand in place of our testing under Section 4, provided that we shall remain liable for any failure by such third party, or by us, to adhere to Section 4, and Section 16 is read as our right to rent, possess and re-rent that Equipment rather than to own it. Every obligation each party owes the other under this Agreement with respect to Equipment — including the insurance required by Sections 5 through 11, your responsibility for loss under Section 2, and your indemnity under Section 1, and all of our obligations — applies to that Equipment identically, and each owner of such Equipment is an additional beneficiary of your indemnity under Section 1 and an additional insured and loss payee under the insurance required above, to the same extent we are, and in any event, subject to Section 14, we remain liable for the acts and omissions of such third parties in connection with the Equipment supplied under this Agreement during the rental period. The Limited Collision Damage Waiver Addendum applies only to vehicles owned by us.',
    },
  ],
  companies: ['Graduation Day Productions', 'Party Giraffes'],
  // The CRM row carries the legal entity. Confirmed against the company rows
  // themselves — it is the name in journals/spend-rollup-2026-08-28 and
  // journals/company-coi-expiry-sync-2026-09-09 (company
  // 296f798c-c8d6-49af-8019-d932ce1ac9f4). Filing still matches exactly, so a
  // renamed row refuses and names the candidates rather than guessing.
  companyAliases: { 'Party Giraffes': 'Party Giraffes, LLC' },
  // Wes, 2026-09-15: "effective 5/15 through 12/31" — 5/15 being the date on
  // their counsel's PDF, the day the redline was settled.
  effectiveDate: '2026-05-15',
  expiryDate: '2026-12-31',
}

export const NEGOTIATED_AGREEMENTS: NegotiatedAgreement[] = [GRADUATION_DAY_2026]

export function findNegotiatedAgreement(key: string): NegotiatedAgreement | undefined {
  return NEGOTIATED_AGREEMENTS.find((a) => a.key === key)
}

/**
 * The negotiated agreement on file for a company, matched on the name its
 * CRM row carries — the same resolution the filing task uses, aliases
 * included.
 *
 * This is what lets the account portal offer a client THEIR document for
 * signature rather than our baseline: `offerAnnualForSignature` asks this
 * first and only falls back to the standard agreement when the answer is
 * nothing. Matching stays EXACT (see `companyAliases`) — a near-match here
 * would put one client's negotiated terms in front of another.
 */
export function negotiatedAgreementForCompany(
  companyName: string | null | undefined,
): NegotiatedAgreement | undefined {
  const name = (companyName ?? '').trim()
  if (!name) return undefined
  return NEGOTIATED_AGREEMENTS.find((a) =>
    a.companies.some((registryName) => (a.companyAliases?.[registryName] ?? registryName) === name),
  )
}

/** The appended addenda are the canonical ones, unmodified. */
export const APPENDED_SECTIONS = { FLEET_AGREEMENT, LCDW_ADDENDUM }
