/**
 * Title-string → PersonRole enum mapping for the auto-capture pipeline.
 *
 * The verbatim title is stored on Person.rawTitle no matter what; this
 * function only decides which of the ~10 PersonRole buckets it best
 * fits, or OTHER if nothing matches cleanly. Conservative on purpose:
 * unclear titles go to OTHER rather than guessing wrong and landing in
 * the wrong role-filter on the Clients page stats strip.
 */

import { PersonRole } from '@prisma/client'

const ORDERED_RULES: ReadonlyArray<{ pattern: RegExp; role: PersonRole }> = [
  // Most-specific first — substrings of less-specific titles must
  // match the specific bucket before falling through.
  { pattern: /\bunit production manager\b|\bupm\b/i, role: PersonRole.UPM },
  { pattern: /\bline producer\b/i, role: PersonRole.LINE_PRODUCER },
  // After UPM ("unit production manager" is more specific) but before
  // the generic buckets. Added 2026-07-05 for the public form's role
  // buttons — bare "PM" is NOT matched (too collision-prone).
  { pattern: /\bproduction manager\b|\bprod\.? manager\b/i, role: PersonRole.PRODUCTION_MANAGER },
  { pattern: /\bproduction coordinator\b|\bprod\.? coord\.?\b/i, role: PersonRole.PRODUCTION_COORDINATOR },
  { pattern: /\bproduction supervisor\b/i, role: PersonRole.PRODUCTION_SUPERVISOR },
  { pattern: /\btransp(o(rt(ation)?)?)? coordinator\b|\btransp(o)? captain\b/i, role: PersonRole.TRANSPORTATION_COORDINATOR },
  { pattern: /\bart coordinator\b|\bart dept coord/i, role: PersonRole.ART_COORDINATOR },
  { pattern: /\bcoordinator\b/i, role: PersonRole.COORDINATOR },
  { pattern: /\bexecutive producer\b|\bep\b|\bproducer\b|\bco-?producer\b|\bsegment producer\b|\bfield producer\b/i, role: PersonRole.PRODUCER },
  { pattern: /\bowner\b|\bfounder\b|\bceo\b|\bpresident\b/i, role: PersonRole.OWNER },
]

export function mapTitleToRole(rawTitle: string | null | undefined): PersonRole {
  if (!rawTitle) return PersonRole.OTHER
  const t = rawTitle.trim()
  if (!t) return PersonRole.OTHER
  for (const rule of ORDERED_RULES) {
    if (rule.pattern.test(t)) return rule.role
  }
  return PersonRole.OTHER
}
