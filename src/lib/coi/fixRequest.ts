import type { InsuredMatchResult } from '@/lib/coi/insuredMatch'
import { formatCalendarDate } from '@/lib/dates/calendarDate'

/**
 * "What's still missing on this certificate", in client-facing words.
 *
 * A rejected COI used to end the conversation inside HQ: the desk marked it
 * REJECTED and someone then hand-wrote an email reconstructing which of the
 * eight checks in COI_PROMPT had actually failed. This turns the stored AI
 * verdict back into that list once, so the review desk can prefill it and
 * send what the reviewer sees.
 *
 * Client-safe by construction: every line describes SirReel's requirement or
 * the client's OWN certificate. The named-insured line comes from
 * `clientMessage`, which is the variant that never names another client's
 * company back at a different client.
 */

export interface CoiAiFacts {
  overallPass?: unknown
  coverageVerified?: unknown
  additionalInsured?: unknown
  autoPhysicalDamage?: unknown
  notes?: unknown
}

export interface CoiFixDraft {
  /** One bullet per failed check, client-facing. */
  issues: string[]
  /** The full editable message body the reviewer sends. */
  message: string
}

/** Only an explicit `false` is a failure — undefined means "not extracted". */
const failed = (v: unknown): boolean => v === false

export function buildCoiFixIssues(args: {
  ai: CoiAiFacts | null
  match: InsuredMatchResult | null
  policyExpiryDate: Date | null
  now?: Date
}): string[] {
  const { ai, match, policyExpiryDate } = args
  const now = args.now ?? new Date()
  const issues: string[] = []

  if (match?.needsAttention && match.clientMessage) {
    issues.push(match.clientMessage)
  }
  if (failed(ai?.coverageVerified)) {
    issues.push(
      'Coverage limits: we need General Liability of at least $1,000,000 each occurrence and ' +
        '$2,000,000 general aggregate, and Automobile Liability at a $1,000,000 combined single ' +
        'limit covering Hired and Non-Owned Autos.',
    )
  }
  if (failed(ai?.autoPhysicalDamage)) {
    issues.push(
      'Hired Auto Physical Damage: the certificate needs to show physical damage coverage on ' +
        'hired/rented autos — this is what repairs or replaces the vehicle itself. A deductible ' +
        'structure is fine; auto liability on its own is not enough.',
    )
  }
  if (failed(ai?.additionalInsured)) {
    issues.push(
      'SirReel Production Vehicles Inc., 8500 Lankershim Blvd, Sun Valley, CA 91352 must be named ' +
        'as both Additional Insured and Loss Payee.',
    )
  }
  if (policyExpiryDate && policyExpiryDate.getTime() < now.getTime()) {
    // UTC, via the shared helper: policy expiry is a CALENDAR date, and
    // rendering it in LA time reads back a policy that expired the day
    // before the one printed on the certificate.
    issues.push(
      `Policy dates: the policy on this certificate expired ${formatCalendarDate(policyExpiryDate, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })}. We need coverage that runs through the end of the rental.`,
    )
  }

  // Nothing specific failed but the certificate still didn't pass — fall back
  // to the reviewer's own words rather than sending an empty ask.
  if (issues.length === 0 && ai && ai.overallPass !== true && typeof ai.notes === 'string' && ai.notes.trim()) {
    issues.push(ai.notes.trim())
  }
  return issues
}

export function buildCoiFixDraft(args: {
  ai: CoiAiFacts | null
  match: InsuredMatchResult | null
  policyExpiryDate: Date | null
  jobName: string | null
  uploadUrl: string | null
  contactFirstName?: string | null
  now?: Date
}): CoiFixDraft {
  const issues = buildCoiFixIssues(args)
  const greeting = args.contactFirstName ? `Hi ${args.contactFirstName},` : 'Hi,'
  const forJob = args.jobName ? ` for ${args.jobName}` : ''

  const lines: string[] = [
    greeting,
    '',
    `Thanks for sending the certificate of insurance${forJob}. We're not able to accept it as-is —` +
      ` here's what we still need:`,
    '',
    ...(issues.length
      ? issues.map((i) => `• ${i}`)
      : ['• A corrected certificate of insurance.']),
    '',
    'Your broker should be able to issue a corrected certificate quickly.',
  ]
  if (args.uploadUrl) {
    lines.push('', `You can upload the corrected certificate here: ${args.uploadUrl}`)
  }
  lines.push('', 'Thanks,', 'SirReel Production Vehicles')

  return { issues, message: lines.join('\n') }
}
