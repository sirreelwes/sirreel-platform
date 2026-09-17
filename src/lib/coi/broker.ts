import { buildCoiFixIssues, type CoiAiFacts } from '@/lib/coi/fixRequest'
import type { InsuredMatchResult } from '@/lib/coi/insuredMatch'
import { coiChecklist, type CoiCheckContext, type CoiCheckStatus, type CoiCheckTier } from '@/lib/coi/checks'
import { CERTIFICATE_HOLDER } from '@/lib/coi/requirements'
import { CLIENT_SIGNOFF } from '@/lib/email/signoff'

/**
 * The BROKER off a certificate — who issued it, and how to reach them.
 *
 * Wes, 2026-09-17: "Is there a way to extract the broker from a COI and add
 * an option to send a link to them when we need an updated COI or something
 * isn't passing our test?"
 *
 * Every correction on a certificate is a round trip through the client: we
 * tell the coordinator what is short, the coordinator forwards it to their
 * broker, the broker asks what "primary and non-contributory" means, and the
 * answer comes back through the same two hops. The person who can actually
 * FIX the document is named on the document — the PRODUCER box, top-left of
 * an ACORD 25, with its own contact name, phone and e-mail.
 *
 * ── Stored where the named insured is stored, for the same reason ──────────
 * The broker's details live inside `CoiCheck.aiResponse` (`producer`), not in
 * a column: they are a raw FACT off the document, and they are read on demand
 * so a re-run corrects them without a migration. Nothing here is a verdict.
 * A review filed before this prompt existed has no `producer` key at all,
 * which reads as "never looked" rather than "looked and found nothing" — the
 * same distinction `aiHasInsuredName` carries on the desk.
 *
 * Client-safe: nothing in this module names another client, a rate, or an
 * internal note. The draft it builds is read by a third party we have no
 * relationship with, so it says what the certificate must show and nothing
 * else about the job.
 */

/** What we read off the PRODUCER box. All optional — certificates vary. */
export interface CoiBroker {
  /** The agency/brokerage as printed, e.g. "Marsh Risk & Insurance Services". */
  agency: string | null
  /** The named contact in the producer block, when one is printed. */
  contactName: string | null
  /** Producer e-mail — the address a corrected certificate is requested from. */
  email: string | null
  phone: string | null
  address: string | null
  /** The stored review carries at least one broker fact. */
  found: boolean
  /** The stored review ASKED for the broker at all (the key is present). */
  extracted: boolean
}

export const EMPTY_BROKER: CoiBroker = {
  agency: null,
  contactName: null,
  email: null,
  phone: null,
  address: null,
  found: false,
  extracted: false,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Words a model writes when the box is empty or it does not want to answer.
 * They are not broker names, and one of them in an email's "Hi <name>," is
 * how a real person reads a machine wrote it.
 */
const PLACEHOLDERS = new Set([
  'n/a',
  'na',
  'none',
  'unknown',
  'not listed',
  'not printed',
  'not shown',
  'not provided',
  'not applicable',
  'same as insured',
  'same as above',
  'see attached',
  'tbd',
  '-',
  '--',
  '',
])

function clean(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s || PLACEHOLDERS.has(s.toLowerCase().replace(/[.]+$/, ''))) return null
  return s.slice(0, max)
}

/**
 * The broker, as this stored review has it.
 *
 * Deliberately tolerant of shape: the producer block has been returned as a
 * flat string by hand-written fixtures and as an object by the prompt, and a
 * COI reviewed today has to be readable by the desk in a year.
 */
export function readCoiBroker(ai: unknown): CoiBroker {
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return EMPTY_BROKER
  const root = ai as Record<string, unknown>
  const extracted = Object.prototype.hasOwnProperty.call(root, 'producer')
  const raw = root.producer

  // A bare string is the agency name and nothing else.
  const p: Record<string, unknown> =
    typeof raw === 'string' ? { agency: raw } : raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

  const emailRaw = clean(p.email, 254)
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.toLowerCase() : null
  const broker: CoiBroker = {
    agency: clean(p.agency),
    contactName: clean(p.contactName),
    email,
    phone: clean(p.phone, 40),
    address: clean(p.address, 300),
    found: false,
    extracted,
  }
  broker.found = !!(broker.agency || broker.contactName || broker.email || broker.phone)
  return broker
}

/** "Jane Doe · Marsh Risk" — how the broker reads on a staff screen. */
export function brokerLabel(b: CoiBroker): string | null {
  const parts = [b.contactName, b.agency].filter((s): s is string => !!s)
  return parts.length ? parts.join(' · ') : b.email
}

/** The first name to greet, when the producer block printed a person. */
export function brokerFirstName(b: CoiBroker): string | null {
  if (!b.contactName) return null
  const first = b.contactName.split(/[\s,]+/).filter(Boolean)[0]
  if (!first || first.length < 2) return null
  // "Doe, Jane" prints surname-first; greeting someone by their surname is
  // worse than not greeting them at all.
  if (/,/.test(b.contactName)) return null
  return first
}

export interface BrokerFixDraft {
  /** The same asks the client-facing draft makes — one list, one source. */
  issues: string[]
  /** The editable body. The review LINK is never in here — see below. */
  message: string
}

/**
 * What we send the broker, in the reviewer's editable words.
 *
 * ── The link is NOT in this text, on purpose ───────────────────────────────
 * The route appends it after whatever the reviewer sends, the same way the
 * partner welcome puts the account link in the renderer rather than in the
 * draft (CLAUDE.md, 2026-09-11). A reviewer trimming a paragraph cannot
 * delete the one thing the email exists to deliver.
 */
export function buildBrokerFixDraft(args: {
  ai: CoiAiFacts | null
  match: InsuredMatchResult | null
  policyExpiryDate: Date | null
  ctx?: CoiCheckContext
  broker: CoiBroker
  /** The broker's own client — the entity on the certificate. */
  insuredName: string | null
  jobName: string | null
  now?: Date
}): BrokerFixDraft {
  const issues = buildCoiFixIssues(args)
  const first = brokerFirstName(args.broker)
  const insured = args.insuredName?.trim() || null

  const forJob = args.jobName ? ` for ${args.jobName}` : ''
  const whose = insured ? `${insured}'s` : 'your client’s'

  const lines: string[] = [
    first ? `Hi ${first},` : 'Hello,',
    '',
    `${insured || 'Your client'} is renting production vehicles and equipment from SirReel` +
      `${forJob}, and we've reviewed the certificate of insurance issued on ${whose} behalf.` +
      ` We're not able to accept it as-is — here's what we still need:`,
    '',
    ...(issues.length ? issues.map((i) => `• ${i}`) : ['• A corrected certificate of insurance.']),
    '',
    `Certificate holder, additional insured and loss payee is ${CERTIFICATE_HOLDER.name}, ${CERTIFICATE_HOLDER.address}.`,
    '',
    'Thanks,',
    CLIENT_SIGNOFF,
  ]

  return { issues, message: lines.join('\n') }
}

/**
 * The block the ROUTE appends under the reviewer's message. One wording, so
 * the plain-text and HTML halves of the email cannot describe the link
 * differently.
 */
export function brokerReviewLinkLines(reviewUrl: string): string[] {
  return [
    'The full review — every requirement, what the certificate shows today and what is still open — is here:',
    reviewUrl,
    'It is read-only, and the page tells you where to send the corrected certificate.',
  ]
}

// ── The read-only review the broker opens ───────────────────────────────────

/** One requirement, as a third party is allowed to see it. */
export interface BrokerPacketCheck {
  key: string
  label: string
  tier: CoiCheckTier
  status: CoiCheckStatus
  /** What THEIR certificate shows — read off their own document. */
  found: string | null
}

export interface BrokerReviewPacket {
  /** The broker's own client, as printed on the certificate. */
  insuredName: string | null
  /** What the rental is, in a word the broker can match to a request. */
  jobLabel: string | null
  policyExpiryDate: Date | null
  /** The asks, identical to the ones in the email. */
  issues: string[]
  /** Every requirement with a verdict — the review itself. */
  checks: BrokerPacketCheck[]
  /** Nothing is open any more (approved since the link was sent). */
  resolved: boolean
  holder: typeof CERTIFICATE_HOLDER
  /** Where a corrected certificate goes back. */
  uploadUrl: string | null
  /** The equipment-line figure, when the job has one. */
  replacementSentence: string | null
}

/**
 * Everything the broker page renders, and NOTHING else.
 *
 * The envelope is the point of this function existing. The link is a
 * credential a third party can forward, so what it opens is fixed here
 * rather than assembled in a page where a later edit could widen it:
 *
 *   IN  — the requirements, the verdict per requirement, what their own
 *         certificate shows, the insured's name, the job's name, where to
 *         send the corrected certificate.
 *   OUT — the reviewer's internal note, the AI's prose, the risk level, the
 *         stored PDF, the order, any rate, any contact but ours.
 *
 * The per-check `note` is dropped deliberately: it is model prose about the
 * document and it names requirements this job may not even have (the same
 * leak the client-facing draft was fixed for on 2026-09-09). The bullets in
 * `issues` are the authoritative ask.
 */
export function buildBrokerReviewPacket(args: {
  ai: CoiAiFacts | null
  match: InsuredMatchResult | null
  policyExpiryDate: Date | null
  ctx?: CoiCheckContext
  insuredName: string | null
  jobLabel: string | null
  approved: boolean
  uploadUrl: string | null
  replacementSentence?: string | null
  now?: Date
}): BrokerReviewPacket {
  const issues = buildCoiFixIssues(args)
  const checks: BrokerPacketCheck[] = coiChecklist(args.ai as never, args.ctx).map((r) => ({
    key: r.key,
    label: r.label,
    tier: r.tier,
    status: r.status,
    found: r.found,
  }))
  return {
    insuredName: args.insuredName?.trim() || null,
    jobLabel: args.jobLabel?.trim() || null,
    policyExpiryDate: args.policyExpiryDate,
    issues,
    checks,
    resolved: args.approved,
    holder: CERTIFICATE_HOLDER,
    uploadUrl: args.uploadUrl,
    replacementSentence: args.replacementSentence ?? null,
  }
}
