import type { InsuredMatchResult } from '@/lib/coi/insuredMatch'
import { CLIENT_SIGNOFF } from '@/lib/email/signoff'
import { coiChecklist, hasCoiChecklist } from '@/lib/coi/checks'
import type { CoiAiResponse } from '@/lib/coi/reviewCoi'
import { formatCalendarDate } from '@/lib/dates/calendarDate'

/**
 * "What's still missing on this certificate", in client-facing words.
 *
 * A rejected COI used to end the conversation inside HQ: the desk marked it
 * REJECTED and someone then hand-wrote an email reconstructing which checks
 * had actually failed. This turns the stored AI verdict back into that list
 * once, so the review desk can prefill it and send what the reviewer sees.
 *
 * Reads the per-check verdicts when the stored review has them, and falls
 * back to the four flat booleans a pre-checklist review carried. Either way
 * the rule is the same and it is the one that matters: only an explicit FAIL
 * becomes an ask. A requirement the review never looked at is OUR gap to
 * close by re-running it, not something to demand from the client.
 *
 * Client-safe by construction: every line describes SirReel's requirement or
 * the client's OWN certificate. The named-insured line comes from
 * `clientMessage`, which is the variant that never names another client's
 * company back at a different client.
 */

export interface CoiAiFacts extends CoiAiResponse {
  [k: string]: unknown
}

/**
 * What each failed requirement asks the client for, in their words. Keyed by
 * the shared check keys. Only checks that a CLIENT can act on appear here —
 * `coverageDates` and `policyExpiry` are covered by the expiry line below.
 */
const ASK_BY_CHECK: Record<string, string> = {
  certificateHolder:
    'Certificate holder: the certificate needs to name SirReel Production Vehicles Inc., ' +
    '8500 Lankershim Blvd, Sun Valley, CA 91352.',
  generalLiability:
    'General Liability: we need at least $1,000,000 each occurrence and $2,000,000 general aggregate.',
  autoLiability:
    'Automobile Liability: we need a $1,000,000 combined single limit covering Hired and ' +
    'Non-Owned Autos.',
  autoPhysicalDamage:
    'Hired Auto Physical Damage: the certificate needs to show physical damage coverage on ' +
    'hired/rented autos — this is what repairs or replaces the vehicle itself. A deductible ' +
    'structure is fine; auto liability on its own is not enough.',
  additionalInsured:
    'SirReel Production Vehicles Inc., 8500 Lankershim Blvd, Sun Valley, CA 91352 must be named ' +
    'as both Additional Insured and Loss Payee.',
  lossPayee:
    'SirReel Production Vehicles Inc., 8500 Lankershim Blvd, Sun Valley, CA 91352 must be named ' +
    'as Loss Payee as well as Additional Insured.',
  primaryNonContributory:
    'Primary & Non-Contributory: the certificate needs to state that your coverage is primary and ' +
    'non-contributory as respects SirReel. This is a standard endorsement your broker can usually ' +
    'add the same day at no cost.',
  waiverOfSubrogation:
    'Waiver of Subrogation in favor of SirReel — your broker can show this in the SUBR WVD column ' +
    'or in the Description of Operations.',
}

/** Alert-tier items worth asking for: broker-fixable endorsements, not coverage the client may not carry. */
const ASKABLE_ALERTS = new Set(['primaryNonContributory', 'waiverOfSubrogation'])

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
  if (hasCoiChecklist(ai)) {
    // Per-check verdicts. FAIL only — an UNKNOWN row is a review that never
    // asked, and asking the client to fix something we never looked at is how
    // we look like we didn't read their certificate.
    for (const row of coiChecklist(ai)) {
      if (row.status !== 'FAIL') continue
      if (row.tier === 'ALERT' && !ASKABLE_ALERTS.has(row.key)) continue
      const ask = ASK_BY_CHECK[row.key]
      if (ask) issues.push(ask)
    }
    // Both named the other; one bullet is enough.
    if (issues.includes(ASK_BY_CHECK.additionalInsured) && issues.includes(ASK_BY_CHECK.lossPayee)) {
      issues.splice(issues.indexOf(ASK_BY_CHECK.lossPayee), 1)
    }
  } else {
    // Pre-checklist review: the four flat booleans are all it ever carried.
    if (failed(ai?.coverageVerified)) {
      issues.push(
        'Coverage limits: we need General Liability of at least $1,000,000 each occurrence and ' +
          '$2,000,000 general aggregate, and Automobile Liability at a $1,000,000 combined single ' +
          'limit covering Hired and Non-Owned Autos.',
      )
    }
    if (failed(ai?.autoPhysicalDamage)) {
      issues.push(ASK_BY_CHECK.autoPhysicalDamage)
    }
    if (failed(ai?.additionalInsured)) {
      issues.push(ASK_BY_CHECK.additionalInsured)
    }
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
  // The legal entity name appears ABOVE, in the requirement text, where
  // the certificate has to name it exactly. It is not the sign-off.
  lines.push('', 'Thanks,', CLIENT_SIGNOFF)

  return { issues, message: lines.join('\n') }
}
