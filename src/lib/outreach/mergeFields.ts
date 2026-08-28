/**
 * Merge fields for outreach copy.
 *
 * The difference between an email that gets a reply and one that gets
 * reported is whether it demonstrably knows who it is talking to. HQ
 * already knows the four things that matter — who they are, where they
 * work, what show they were last on, and when that client last had gear
 * out — so a merge that can say "since Holy Water wrapped" is a
 * different product from one that says "Hi {first}".
 *
 * ── The rule that makes this safe ──────────────────────────────────
 *
 * A TOKEN THAT CANNOT BE RESOLVED BLOCKS THE SEND TO THAT RECIPIENT.
 * It is never silently blanked and never left in the body. Both of those
 * failures are worse than not sending:
 *
 *   "Hi , hope the shoot went well"        ← blanking
 *   "Hi {{first_name}}, hope..."           ← leaving the token
 *
 * The first looks broken, the second looks like a mass mailing that went
 * wrong, and a producer who receives either learns exactly how much
 * attention we paid. So `renderForRecipient` returns the missing tokens
 * instead of a body, and the caller marks that recipient SKIPPED with a
 * reason a human can read.
 *
 * Optional copy is expressed with a CONDITIONAL block rather than an
 * empty token, so a sentence that only makes sense with a value can be
 * omitted whole:
 *
 *   {{#last_project}}Hope {{last_project}} wrapped well.{{/last_project}}
 */

export const MERGE_TOKENS = [
  'first_name',
  'last_name',
  'full_name',
  'company',
  'last_project',
  'last_rental_month',
  'sender_name',
  'sender_first_name',
] as const

export type MergeToken = (typeof MERGE_TOKENS)[number]

export interface MergeTokenMeta {
  token: MergeToken
  label: string
  /** Shown in the composer so a rep knows what will actually appear. */
  description: string
  example: string
}

export const MERGE_TOKEN_META: Record<MergeToken, MergeTokenMeta> = {
  first_name: { token: 'first_name', label: 'First name', description: "The contact's first name.", example: 'Emmett' },
  last_name: { token: 'last_name', label: 'Last name', description: "The contact's last name.", example: 'Tekstra' },
  full_name: { token: 'full_name', label: 'Full name', description: 'First and last together.', example: 'Emmett Tekstra' },
  company: { token: 'company', label: 'Company', description: 'Their production company, from their primary affiliation.', example: 'MILE 44, Inc' },
  last_project: {
    token: 'last_project',
    label: 'Last project',
    description: 'The most recent production named in their mail. Often empty — wrap it in a conditional.',
    example: 'Happy Place',
  },
  last_rental_month: {
    token: 'last_rental_month',
    label: 'Last rental month',
    description: 'When their company last had gear out, e.g. "March". Empty for clients who have never rented.',
    example: 'March',
  },
  sender_name: { token: 'sender_name', label: 'Your name', description: 'The rep sending the campaign.', example: 'Jose Pacheco' },
  sender_first_name: { token: 'sender_first_name', label: 'Your first name', description: 'Just your first name, for a sign-off.', example: 'Jose' },
}

export interface RecipientContext {
  firstName: string | null
  lastName: string | null
  companyName: string | null
  lastKnownProject: string | null
  companyLastRentalAt: Date | null
  senderName: string | null
}

export interface RenderResult {
  ok: boolean
  subject: string
  body: string
  /** Tokens the copy used that this recipient has no value for. */
  missing: MergeToken[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Resolve every token for one recipient. Null means "no value". */
export function resolveTokens(ctx: RecipientContext): Record<MergeToken, string | null> {
  const first = ctx.firstName?.trim() || null
  // Legacy rows cram a whole name into firstName and set lastName to "."
  const last = ctx.lastName?.trim() && ctx.lastName.trim() !== '.' ? ctx.lastName.trim() : null
  const full = [first, last].filter(Boolean).join(' ') || null
  const senderFull = ctx.senderName?.trim() || null

  return {
    first_name: first,
    last_name: last,
    full_name: full,
    company: ctx.companyName?.trim() || null,
    last_project: ctx.lastKnownProject?.trim() || null,
    last_rental_month: ctx.companyLastRentalAt ? MONTHS[ctx.companyLastRentalAt.getMonth()] : null,
    sender_name: senderFull,
    sender_first_name: senderFull ? senderFull.split(/\s+/)[0] : null,
  }
}

const CONDITIONAL = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g
const TOKEN = /\{\{\s*(\w+)\s*\}\}/g

function isMergeToken(v: string): v is MergeToken {
  return (MERGE_TOKENS as readonly string[]).includes(v)
}

/**
 * Render one string. Conditionals resolve FIRST, so a token that only
 * appears inside an unsatisfied block never counts as missing — that is
 * the entire point of the conditional.
 */
function renderString(
  template: string,
  values: Record<MergeToken, string | null>,
  missing: Set<MergeToken>,
): string {
  const withConditionals = template.replace(CONDITIONAL, (_m, name: string, inner: string) => {
    if (!isMergeToken(name)) return ''
    return values[name] ? inner : ''
  })

  return withConditionals.replace(TOKEN, (whole, name: string) => {
    if (!isMergeToken(name)) {
      // An unknown token is an authoring mistake, not a data gap. Leave
      // it visible in PREVIEW so the rep sees their typo; the caller
      // treats any leftover braces as a hard block on release.
      return whole
    }
    const v = values[name]
    if (v === null) {
      missing.add(name)
      return whole
    }
    return v
  })
}

export function renderForRecipient(
  subjectTemplate: string,
  bodyTemplate: string,
  ctx: RecipientContext,
): RenderResult {
  const values = resolveTokens(ctx)
  const missing = new Set<MergeToken>()
  const subject = renderString(subjectTemplate, values, missing)
  const body = renderString(bodyTemplate, values, missing)
  return {
    // Any surviving {{ }} — a missing value OR an unknown token — makes
    // this recipient unsendable.
    ok: missing.size === 0 && !/\{\{/.test(subject) && !/\{\{/.test(body),
    subject,
    body,
    missing: [...missing],
  }
}

/** Tokens a template references, for composer-side validation. */
export function tokensUsed(template: string): { known: MergeToken[]; unknown: string[] } {
  const known = new Set<MergeToken>()
  const unknown = new Set<string>()
  for (const m of template.matchAll(TOKEN)) {
    const name = m[1]
    if (isMergeToken(name)) known.add(name)
    else unknown.add(name)
  }
  for (const m of template.matchAll(/\{\{#(\w+)\}\}/g)) {
    const name = m[1]
    if (isMergeToken(name)) known.add(name)
    else unknown.add(name)
  }
  return { known: [...known], unknown: [...unknown] }
}
