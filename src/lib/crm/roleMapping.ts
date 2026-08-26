/**
 * Title-string → PersonRole enum mapping for the auto-capture pipeline.
 *
 * The verbatim title is stored on Person.rawTitle no matter what; this
 * function only decides which PersonRole bucket it best fits, or OTHER
 * if nothing matches cleanly. Conservative on purpose: an unclear title
 * goes to OTHER rather than guessing wrong and landing in the wrong
 * role filter on the Clients page.
 *
 * ── 2026-08-26 rewrite ──────────────────────────────────────────────
 *
 * Wes flagged Emmett Tekstra: cc'd on a production thread, signature
 * reads "Production Designer | Art Director", and his role was OTHER.
 * Tracing it showed the pipeline had done everything right — it parsed
 * the title, stored it on rawTitle, and even logged
 * "production_title:art director" as the reason it trusted the mail.
 * Then the role mapper dropped it, for two independent reasons:
 *
 *   1. NO BUCKET EXISTED. captureConstants.PRODUCTION_TITLE_TOKENS
 *      recognises art department, locations, grip, wardrobe and HMU as
 *      production titles — the comment there even says those are
 *      "exactly the people booking us" — but PersonRole had nowhere to
 *      put them. Four values were added to the enum to close the gap.
 *
 *   2. COMPOUND TITLES WERE MATCHED WHOLE. Real signatures read
 *      "Production Designer | Art Director",
 *      "Location Scout/Manager", "Set Design + Prop Styling".
 *      Testing the entire string against \bart coordinator\b finds
 *      nothing. Titles are now SPLIT on |, /, +, · and comma, and every
 *      segment is tested.
 *
 * 250 contacts held a correctly-parsed title and a role of OTHER when
 * this was written. Some of them ("Production Manager" ×24) matched an
 * existing rule already — they were captured before that rule was added
 * on 2026-07-05 and the pipeline only re-evaluates role on a contact's
 * NEXT inbound mail. scripts/backfillContactRoles.ts re-runs this
 * mapper over stored titles so a rule added today reaches contacts who
 * last wrote in April.
 *
 * ── Precedence ──────────────────────────────────────────────────────
 *
 * Rules are ordered most-specific first and the FIRST match wins,
 * scanning rules in order across all segments — so a rule higher in
 * the list beats a lower one no matter which segment it was found in.
 * "Production Designer | Art Director" therefore resolves the same way
 * regardless of which half a signature puts first.
 */

/**
 * Deliberately NO `@prisma/client` import. PersonRole is used as a
 * VALUE here (not just a type), so importing the enum would pull the
 * whole Prisma client into any client component that wants this — and
 * CaptureReviewWidget, which pre-fills the reviewer's role dropdown,
 * is a client component. Before this module was shared it kept its own
 * drifted copy of these rules, which meant a reviewer could see a
 * different role than the pipeline would have assigned.
 *
 * The strings match the PersonRole enum exactly, so server callers
 * pass the result straight to Prisma.
 */
export const PERSON_ROLE_VALUES = [
  'UPM',
  'PRODUCER',
  'LINE_PRODUCER',
  'PRODUCTION_MANAGER',
  'PRODUCTION_COORDINATOR',
  'PRODUCTION_SUPERVISOR',
  'TRANSPORTATION_COORDINATOR',
  'ART_COORDINATOR',
  'ART_DIRECTOR',
  'LOCATION_MANAGER',
  'PRODUCTION_ACCOUNTANT',
  'PRODUCTION_ASSISTANT',
  'GRIP',
  'GAFFER_ELECTRIC',
  'COORDINATOR',
  'OWNER',
  'OTHER',
] as const

export type PersonRoleValue = (typeof PERSON_ROLE_VALUES)[number]

const PersonRole = Object.fromEntries(
  PERSON_ROLE_VALUES.map((v) => [v, v]),
) as { [K in PersonRoleValue]: K }

const ORDERED_RULES: ReadonlyArray<{ pattern: RegExp; role: PersonRoleValue }> = [
  // ── Most-specific production roles ────────────────────────────────
  { pattern: /\bunit production manager\b|\bupm\b/i, role: PersonRole.UPM },
  { pattern: /\bline producer\b/i, role: PersonRole.LINE_PRODUCER },

  // Transpo before the generic coordinator rule.
  { pattern: /\btransp(o(rt(ation)?)?)? coordinator\b|\btransp(o)? captain\b/i, role: PersonRole.TRANSPORTATION_COORDINATOR },

  // ── Locations ─────────────────────────────────────────────────────
  // Before ART/coordinator: "locations coordinator" is a locations
  // person, not a generic coordinator. Covers the assistant + scout
  // variants ("Key Assistant Location Manager", "Location Scout/Manager").
  { pattern: /\blocations?\s*(manager|scout|coordinator)\b|\bassistant location manager\b/i, role: PersonRole.LOCATION_MANAGER },

  // ── Art department ────────────────────────────────────────────────
  // ART_COORDINATOR stays its own bucket (it is a distinct job and
  // predates this); everything else in the department maps to
  // ART_DIRECTOR. Deliberately BEFORE the bare \bcoordinator\b and
  // \bdesigner\b rules.
  { pattern: /\bart coordinator\b|\bart dept\.? coord/i, role: PersonRole.ART_COORDINATOR },
  {
    pattern: /\bart director\b|\bproduction design(er)?\b|\bart direction\b|\bset (decorator|decoration|design(er)?|dresser|dec)\b|\bart dep(artmen)?t\b|\bprops? (master|stylist|styling|coordinator)\b|\blead(man|person)\b/i,
    role: PersonRole.ART_DIRECTOR,
  },

  // ── Production office ─────────────────────────────────────────────
  // "Head of Production" reads as the manager tier in practice.
  { pattern: /\bproduction manager\b|\bprod\.? manager\b|\bhead of production\b/i, role: PersonRole.PRODUCTION_MANAGER },
  { pattern: /\bproduction coordinator\b|\bprod\.? coord\.?\b|\bapoc\b/i, role: PersonRole.PRODUCTION_COORDINATOR },
  { pattern: /\bproduction supervisor\b|\bprod\.? supervisor\b/i, role: PersonRole.PRODUCTION_SUPERVISOR },
  { pattern: /\bproduction accountant\b|\bproduction auditor\b/i, role: PersonRole.PRODUCTION_ACCOUNTANT },
  // "PA" only as a standalone token or with an explicit qualifier —
  // never as a substring, which would catch every "Pa" in a word.
  { pattern: /\bproduction assistant\b|\boffice pa\b|\bset pa\b|^pa$/i, role: PersonRole.PRODUCTION_ASSISTANT },

  // ── Grip & electric ───────────────────────────────────────────────
  // Two departments, not one: grip rigs and supports, electric lights.
  // Both book their own trucks, which is why they get their own buckets.
  //
  // Qualified "best boy" resolves to its department. BARE "best boy" is
  // deliberately NOT matched: convention usually reads it as best boy
  // electric, but "usually" is not good enough for a field sales will
  // segment on — it stays OTHER with the real title on rawTitle.
  { pattern: /\bbest boy grip\b|\bkey grip\b|\bdolly grip\b|\brigging grip\b|\bgrip\b/i, role: PersonRole.GRIP },
  { pattern: /\bgaffer\b|\bbest boy electric\b|\bchief lighting technician\b|\belectrician\b|\blighting (technician|tech|director)\b|\bbest boy lamp\b/i, role: PersonRole.GAFFER_ELECTRIC },

  // ── Generic fallbacks ─────────────────────────────────────────────
  { pattern: /\bcoordinator\b/i, role: PersonRole.COORDINATOR },
  { pattern: /\bexecutive producer\b|\bproducer\b|\bco-?producer\b|\bsegment producer\b|\bfield producer\b/i, role: PersonRole.PRODUCER },
  { pattern: /\bowner\b|\bfounder\b|\bceo\b|\bpresident\b/i, role: PersonRole.OWNER },
]

/**
 * Separators that join two job titles in one signature line. Comma is
 * included, which is why "Art Director, IATSE 800 ADG" resolves — the
 * union-local half simply matches nothing.
 *
 * NOT split on "&" or "and": those appear inside single titles
 * ("Hair & Makeup", "Studio and Production Services") far more often
 * than they join two.
 */
const TITLE_SEPARATORS = /[|/+·•;,]|\s-\s|\s—\s/

/** Split a signature title line into individually-testable segments. */
export function splitTitleSegments(rawTitle: string): string[] {
  const segments = rawTitle
    .split(TITLE_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  // Always test the whole string too — a title containing a separator
  // inside a single real role ("Hair/Makeup") must still match as a
  // unit if a rule covers it.
  return segments.length > 1 ? [rawTitle.trim(), ...segments] : [rawTitle.trim()]
}

export function mapTitleToRole(rawTitle: string | null | undefined): PersonRoleValue {
  if (!rawTitle) return PersonRole.OTHER
  const segments = splitTitleSegments(rawTitle)
  if (segments.length === 0) return PersonRole.OTHER

  // Rule-major order: a higher-priority rule wins even if it matches a
  // later segment. Without this, "Set Designer | UPM" would resolve to
  // ART_DIRECTOR purely because of word order.
  for (const rule of ORDERED_RULES) {
    for (const segment of segments) {
      if (rule.pattern.test(segment)) return rule.role
    }
  }
  return PersonRole.OTHER
}
