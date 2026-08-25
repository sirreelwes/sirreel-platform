/**
 * Is the certificate holder us?
 *
 * Decided HERE, in code, not by the model — for the same reason the named
 * insured is (src/lib/coi/insuredMatch.ts). SirReel trades under several
 * names, and asking an AI to judge "is this one of ours" produced a boolean
 * that contradicted its own note: on the Catastrophe certificate it wrote
 * "Certificate Holder name is acceptable (SirReel Studio Services) and
 * address is correct" and set pass:false, twice out of six runs. A human
 * reads the boolean, and a certificate gets sent back to a client over it.
 *
 * The model now only reports what the holder box SAYS. This turns that text
 * into the verdict, the same way every run, forever.
 */

/** 8500 Lankershim Blvd, Sun Valley, CA 91352. */
const STREET_NUMBER = '8500'
const STREET_NAME = 'lankershim'
const ZIP = '91352'

export type HolderVerdict = 'MATCH' | 'WRONG_COMPANY' | 'WRONG_ADDRESS' | 'UNKNOWN'

export interface HolderMatchResult {
  verdict: HolderVerdict
  /** True when a human needs to look at this. */
  needsAttention: boolean
  /** What goes in the check's note. Empty on a clean match. */
  note: string
}

function normalize(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Every name SirReel is papered under. Deliberately loose on the company
 * suffix and the dba: "SirReel Production Vehicles, Inc.", "SirReel Studio
 * Rentals" and "SirReel Studio Services" are the same company, and a broker
 * picking any of them is not a defect (Wes, 2026-08-25).
 */
function isSirReel(normalized: string): boolean {
  // "sir reel" survives the punctuation strip either way it is written.
  return /\bsir\s?reel\b/.test(normalized)
}

/** Does the holder text carry a street address that ISN'T ours? */
function addressConflicts(normalized: string): boolean {
  const hasZip = /\b\d{5}\b/.test(normalized)
  const hasStreet = /\b\d{3,6}\b/.test(normalized)
  // No address printed at all — nothing to contradict. The holder box on a
  // real ACORD always carries one, so this is the OCR-failed case, and a
  // missing address is not grounds to reject a certificate that names us.
  if (!hasZip && !hasStreet) return false
  const ours =
    normalized.includes(STREET_NAME) ||
    normalized.includes(ZIP) ||
    (normalized.includes(STREET_NUMBER) && normalized.includes('sun valley'))
  return !ours
}

export function evaluateHolderMatch(found: string | null | undefined): HolderMatchResult {
  const raw = (found || '').trim()
  if (!raw) {
    return {
      verdict: 'UNKNOWN',
      needsAttention: true,
      note: 'Could not read the certificate holder box.',
    }
  }
  const n = normalize(raw)

  if (!isSirReel(n)) {
    return {
      verdict: 'WRONG_COMPANY',
      needsAttention: true,
      note:
        `The certificate holder reads "${raw}". It needs to name SirReel Production Vehicles Inc., ` +
        `8500 Lankershim Blvd, Sun Valley, CA 91352.`,
    }
  }
  if (addressConflicts(n)) {
    return {
      verdict: 'WRONG_ADDRESS',
      needsAttention: true,
      note:
        `The certificate holder names SirReel but at the wrong address ("${raw}"). It needs to read ` +
        `8500 Lankershim Blvd, Sun Valley, CA 91352.`,
    }
  }
  return { verdict: 'MATCH', needsAttention: false, note: '' }
}
