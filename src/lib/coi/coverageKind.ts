/**
 * What a stored certificate actually IS — a full certificate of insurance,
 * or a workers' compensation certificate on its own.
 *
 * Wes 2026-09-11, looking at an account's certificate list: "Is one work
 * comp? If so can we label it that way?" Workers' comp usually arrives as
 * its own document (payroll companies — Entertainment Partners, Cast & Crew
 * — issue it), and three of the 105 live certificates in HQ are exactly
 * that, stored in the same table as everyone's COI with nothing to tell
 * them apart. Measured the same day: Little Dot / Neon (EP payroll cert),
 * Chaotic Neutral (`mnx-coi.pdf`, APPROVED), LA Film Studies Center.
 *
 * Read off the stored AI review, not the filename ("mnx-coi.pdf" is a
 * workers' comp certificate). The rule is conservative in one direction on
 * purpose: a certificate is WORKERS_COMP only when the review LOOKED for
 * general liability (the key is there), found none, found no auto
 * liability either, and did find workers' comp. A review that never
 * recorded general liability — pre-checklist rows — stays 'COI': mislabel
 * a real COI as "workers' comp" and a client is told their insurance is
 * missing.
 */

export type CoiDocumentKind = 'COI' | 'WORKERS_COMP'

const ABSENT = /^(none|n\/?a|not (found|listed|shown|present|provided|stated|indicated)|no\b|unknown|—|-)/i

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isPresent(v: unknown): boolean {
  const s = str(v)
  return !!s && !ABSENT.test(s)
}

/** The "found" text of a checklist item, including GL's per-occurrence /
 *  aggregate sub-items. Empty when the certificate shows nothing. */
function found(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const o = item as Record<string, unknown>
  const sub = (k: string) => (o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, unknown>).found : undefined)
  return [o.found, sub('perOccurrence'), sub('aggregate'), sub('combinedSingleLimit')].map(str).find(isPresent) ?? ''
}

export function coiDocumentKind(aiResponse: unknown): CoiDocumentKind {
  if (!aiResponse || typeof aiResponse !== 'object') return 'COI'
  const ai = aiResponse as Record<string, unknown>
  if (!('generalLiability' in ai)) return 'COI'
  const gl = ai.generalLiability as Record<string, unknown> | null
  if (gl && typeof gl === 'object' && gl.pass === true) return 'COI'
  if (found(gl) || found(ai.autoLiability)) return 'COI'
  return found(ai.workersComp) ? 'WORKERS_COMP' : 'COI'
}

export const COI_DOCUMENT_KIND_LABEL: Record<CoiDocumentKind, string> = {
  COI: 'Certificate of insurance',
  WORKERS_COMP: "Workers' comp",
}
