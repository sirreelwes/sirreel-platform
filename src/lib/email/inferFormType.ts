import type { InferredFormType } from '@prisma/client'

/**
 * Heuristic Subject-line classifier for SirReel inbox traffic. Cognito Forms
 * submissions land with predictable prefixes; this picks the form type so
 * the pipeline UI can render a colored badge per kind.
 *
 * Order matters: ANNUAL_AGREEMENT must be tested before JOB_AGREEMENT
 * because "Annual Rental Agreement" matches both patterns otherwise.
 *
 * Returns null on no match — the slider/list show no form badge in that case.
 */

const RULES: ReadonlyArray<{ pattern: RegExp; type: InferredFormType }> = [
  // ANNUAL_AGREEMENT first — must beat the plain "Rental Agreement" rule.
  { pattern: /\bannual\s+rental\s+agreement\b/i, type: 'ANNUAL_AGREEMENT' },
  // JOB_AGREEMENT — "Rental Agreement" not preceded by "Annual".
  { pattern: /(?<!annual\s)\brental\s+agreement\b/i, type: 'JOB_AGREEMENT' },
  { pattern: /\bvehicle\s+damage\s+report\b/i, type: 'DAMAGE_REPORT' },
  { pattern: /\bcertificate\s+of\s+insurance\b/i, type: 'COI' },
  // BOOKING_INQUIRY catches both Cognito's "NEW INQUIRY" prefix and the
  // older "Booking Inquiry" header.
  { pattern: /^\s*new\s+inquiry\b/i, type: 'BOOKING_INQUIRY' },
  { pattern: /\bbooking\s+inquiry\b/i, type: 'BOOKING_INQUIRY' },
]

export function inferFormTypeFromSubject(subject: string | null | undefined): InferredFormType | null {
  if (!subject) return null
  for (const rule of RULES) {
    if (rule.pattern.test(subject)) return rule.type
  }
  return null
}
