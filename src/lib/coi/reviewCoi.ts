import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

/**
 * Shared AI Certificate-of-Insurance review — ONE prompt, every surface.
 *
 * There used to be three: a 9-critical/6-alert prompt behind the paperwork
 * portal, an 8-hard/4-manageable prompt behind /tools/coi-check, and a
 * trimmed 8-check prompt behind the review desk. The desk one — the surface
 * a human actually signs off on — was the weakest of the three: it never
 * asked about Primary & Non-Contributory, Waiver of Subrogation, Umbrella,
 * Workers Comp, the cancellation clause or contractor coverage, and it
 * returned one prose paragraph instead of a per-check verdict. A reviewer
 * read "LOW RISK · all critical requirements met" on a certificate whose
 * P&NC language had never been looked for.
 *
 * Now: this prompt, this normalizer, everywhere. Best-effort — never throws.
 * On any failure it returns a medium-risk stub so the caller still persists
 * the CoiCheck.
 */

/** One requirement's verdict as the model returns it. */
export interface CoiCheckItem {
  pass?: boolean
  /** What the model actually read off the certificate, verbatim-ish. */
  found?: string
  required?: string
  note?: string
  [k: string]: unknown
}

export interface CoiAiResponse {
  /** Every CRITICAL requirement passed. Gates "coverage verified". */
  criticalPass?: boolean
  /** Every ALERT requirement passed. Judgment calls, not gates. */
  alertPass?: boolean
  /** criticalPass && alertPass — a certificate with nothing to discuss. */
  overallPass?: boolean
  /** The insured entity as printed on the cert — see src/lib/coi/insuredMatch.ts. */
  namedInsured?: string | null
  policyExpiryDate?: string | null
  riskLevel?: 'low' | 'medium' | 'high' | string
  notes?: string
  /** Pre-checklist reviews only: GL + auto limits confirmed. */
  coverageVerified?: boolean

  certificateHolder?: CoiCheckItem
  generalLiability?: CoiCheckItem
  autoLiability?: CoiCheckItem
  /** Object on today's reviews; a bare boolean on pre-checklist ones. */
  autoPhysicalDamage?: CoiCheckItem | boolean
  /** Object on today's reviews; a bare boolean on pre-checklist ones. */
  additionalInsured?: CoiCheckItem | boolean
  lossPayee?: CoiCheckItem
  coverageDates?: CoiCheckItem
  policyExpiry?: CoiCheckItem & { date?: string; expired?: boolean }
  primaryNonContributory?: CoiCheckItem
  waiverOfSubrogation?: CoiCheckItem
  umbrella?: CoiCheckItem
  workersComp?: CoiCheckItem
  entertainmentPackage?: CoiCheckItem
  cancellationNotice?: CoiCheckItem
  contractorCoverage?: CoiCheckItem

  criticalIssues?: string[]
  alertIssues?: string[]
  [k: string]: unknown
}

/**
 * The canonical COI review prompt. Exported so every surface that reviews a
 * certificate asks the SAME questions — three copies of this had already
 * drifted apart into three different definitions of "reviewed".
 *
 * NOT asked here: whether the named insured matches the production company.
 * That verdict is COMPUTED on read (src/lib/coi/insuredMatch.ts) so fixing a
 * wrong production company clears the flag without re-reviewing the PDF. The
 * prompt only extracts the raw name off the certificate.
 */
export const COI_PROMPT = `You are reviewing a Certificate of Insurance (COI) for SirReel Production Vehicles Inc.

CERTIFICATE HOLDER REQUIRED — 8500 Lankershim Blvd, Sun Valley, CA 91352.
Any of these names at that address is CORRECT (they are the same company):
- SirReel Production Vehicles, Inc.
- SirReel Production Vehicles, Inc. dba SirReel Studio Rentals
- SirReel Studio Rentals
- SirReel Studio Services
A different company at that address, or SirReel at a different address, FAILS.

ALSO EXTRACT (does not affect pass/fail):
- namedInsured: the NAMED INSURED exactly as printed on the certificate — the
  entity the policy covers. This is the box usually labeled "INSURED", NOT the
  certificate holder (SirReel) and NOT the insurance carrier or the broker/
  producer. Copy it verbatim, including any "dba" wording. Null if unreadable.
  Do NOT judge whether it is the right company — only report what it says.

CRITICAL REQUIREMENTS (cannot be waived — all must pass):
1. certificateHolder — SirReel named as Certificate Holder, correct address
2. generalLiability — Each Occurrence min $1,000,000 AND General Aggregate min $2,000,000
3. autoLiability — CSL min $1,000,000, must cover Hired AND Non-Owned Autos
4. autoPhysicalDamage — Hired Auto Physical Damage. The certificate MUST show
   physical damage coverage on the hired/rented autos; this is the coverage that
   pays to repair or replace SirReel's vehicles, so it is REQUIRED. On SirReel
   certs it appears as a "Hired Auto Physical Damage" line in the Automobile
   section and/or the Description of Operations, and is commonly stated as a
   DEDUCTIBLE structure (e.g. a percentage of the loss subject to a minimum and
   maximum) rather than a dollar limit — that is acceptable and PASSES. Also
   accept explicit "Physical Damage", "Comprehensive & Collision", or a stated
   physical-damage limit. FAIL only if NO physical-damage coverage on
   rented/hired autos appears anywhere on the cert (auto LIABILITY alone is not
   enough).
5. additionalInsured — SirReel named as Additional Insured
6. lossPayee — SirReel named as Loss Payee
7. coverageDates — policy period covers the rental period
8. policyExpiry — policy not expired

ALERT REQUIREMENTS (admin judgment call — an exception can be approved):
A. primaryNonContributory — the certificate should state the insured's coverage
   is primary and non-contributory as respects SirReel (their policy pays first
   and cannot demand SirReel's insurance contribute). This wording rarely gets
   its own coverage line — look for it in the Description of Operations box
   (e.g. "coverage is primary and non-contributory", "primary & non-contributory
   as respects the additional insured") or a referenced endorsement form
   (commonly CG 20 01). Any of those PASSES. FAIL only if no
   primary/non-contributory language appears anywhere on the cert. When it
   FAILS, the note must explain the fix: this is a standard endorsement the
   client's broker can add same-day at no cost — ask the broker to reissue the
   COI showing primary and non-contributory wording in favor of SirReel
   Production Vehicles Inc. If the broker says the policy genuinely lacks it,
   that is a real coverage gap.
B. waiverOfSubrogation — if the SUBR WVD column shows "Y" on ANY policy row this
   passes. Present on General Liability only is sufficient.
C. umbrella — Umbrella/Excess Liability $1,000,000. Preferred, not always
   required for smaller productions.
D. entertainmentPackage — Entertainment Package or Rented Equipment $1,000,000.
   A production package equivalent is acceptable.
E. workersComp — Workers Compensation. May sit on a separate payroll-company
   certificate, in which case note that.
F. cancellationNotice — 30-day cancellation notice clause.
G. contractorCoverage — independent contractor coverage on workers comp.

RULES:
- Judge ONLY what is printed on this certificate. Never assume a coverage is
  present because it usually is.
- "found" is what you actually read on the document (a limit, a phrase, a form
  number). Leave it "" if the item is absent.
- On any FAIL, "note" says what is missing and what the broker must issue.

Return ONLY valid JSON (no markdown, no preamble):
{
  "namedInsured": "Exactly As Printed, Inc." | null,
  "policyExpiryDate": "YYYY-MM-DD" | null,
  "certificateHolder": { "pass": true, "found": "", "note": "" },
  "generalLiability": {
    "pass": true,
    "perOccurrence": { "pass": true, "found": "", "required": "$1,000,000" },
    "aggregate": { "pass": true, "found": "", "required": "$2,000,000" },
    "note": ""
  },
  "autoLiability": {
    "pass": true,
    "combinedSingleLimit": { "pass": true, "found": "", "required": "$1,000,000" },
    "hiredAutos": { "pass": true, "found": "" },
    "nonOwnedAutos": { "pass": true, "found": "" },
    "note": ""
  },
  "autoPhysicalDamage": { "pass": true, "found": "", "note": "" },
  "additionalInsured": { "pass": true, "found": "", "note": "" },
  "lossPayee": { "pass": true, "found": "", "note": "" },
  "coverageDates": { "pass": true, "found": "", "note": "" },
  "policyExpiry": { "pass": true, "date": "YYYY-MM-DD", "expired": false, "note": "" },
  "primaryNonContributory": { "pass": true, "found": "", "note": "" },
  "waiverOfSubrogation": { "pass": true, "found": "", "note": "" },
  "umbrella": { "pass": true, "found": "", "note": "" },
  "entertainmentPackage": { "pass": true, "found": "", "note": "" },
  "workersComp": { "pass": true, "found": "", "note": "" },
  "cancellationNotice": { "pass": true, "found": "", "note": "" },
  "contractorCoverage": { "pass": true, "found": "", "note": "" },
  "criticalIssues": [],
  "alertIssues": [],
  "notes": "Two or three sentences a reviewer can read at a glance."
}`

/** Ordered keys of the requirements the model is asked to judge. */
export const CRITICAL_CHECK_KEYS = [
  'certificateHolder',
  'generalLiability',
  'autoLiability',
  'autoPhysicalDamage',
  'additionalInsured',
  'lossPayee',
  'coverageDates',
  'policyExpiry',
] as const

export const ALERT_CHECK_KEYS = [
  // Primary & Non-Contributory sits in ALERT, not CRITICAL: the paperwork
  // portal has always tiered it this way and /tools/coi-check disagreed. It
  // is a standard endorsement a broker adds same-day, so it is worth asking
  // for on every certificate that lacks it — but it does not hold a
  // production's truck at the gate on its own. (Wes, 2026-08-25.)
  'primaryNonContributory',
  'waiverOfSubrogation',
  'umbrella',
  'entertainmentPackage',
  'workersComp',
  'cancellationNotice',
  'contractorCoverage',
] as const

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function itemPass(v: unknown): boolean | undefined {
  if (v && typeof v === 'object' && 'pass' in (v as Record<string, unknown>)) {
    const p = (v as CoiCheckItem).pass
    return typeof p === 'boolean' ? p : undefined
  }
  return undefined
}

/**
 * Turn whatever the model returned into the one shape the app reads.
 *
 * The pass/fail rollups and the risk level are computed HERE, not asked of
 * the model: a summary field the model fills in itself can disagree with the
 * per-check verdicts sitting right beside it, and the summary is what gates
 * "coverage verified" on a job.
 */
export function normalizeCoiReview(raw: CoiAiResponse): CoiAiResponse {
  const out: CoiAiResponse = { ...raw }

  const criticalVerdicts = CRITICAL_CHECK_KEYS.map((k) => itemPass(raw[k]))
  const alertVerdicts = ALERT_CHECK_KEYS.map((k) => itemPass(raw[k]))
  // An expired policy fails regardless of what `pass` says.
  const expired = raw.policyExpiry?.expired === true
  const graded = criticalVerdicts.some((v) => v !== undefined)

  if (graded) {
    // Unknown is not a pass: a requirement the model could not verdict is a
    // requirement nobody has confirmed.
    out.criticalPass = criticalVerdicts.every((v) => v === true) && !expired
    out.alertPass = alertVerdicts.every((v) => v === true)
    out.overallPass = out.criticalPass && out.alertPass
    out.riskLevel = !out.criticalPass ? 'high' : !out.alertPass ? 'medium' : 'low'
  }

  const expiry =
    (typeof raw.policyExpiryDate === 'string' && DATE_ONLY.test(raw.policyExpiryDate) && raw.policyExpiryDate) ||
    (typeof raw.policyExpiry?.date === 'string' && DATE_ONLY.test(raw.policyExpiry.date) && raw.policyExpiry.date) ||
    null
  out.policyExpiryDate = expiry

  out.namedInsured =
    typeof raw.namedInsured === 'string' && raw.namedInsured.trim() ? raw.namedInsured.trim() : null

  return out
}

export async function runCoiAiReview(buffer: Buffer, mimeType: string): Promise<CoiAiResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { criticalPass: false, overallPass: false, riskLevel: 'medium', notes: 'AI review not run (no API key)' }
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const isPdf = mimeType === 'application/pdf'
    const base64 = buffer.toString('base64')
    const res = await client.messages.create({
      model: REVIEW_MODEL,
      // The per-check output runs ~1.5k tokens on a busy certificate; a
      // truncated response loses the checks silently.
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: [
            isPdf
              ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: base64 } }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: (mimeType === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
                    data: base64,
                  },
                },
            { type: 'text', text: COI_PROMPT },
          ] as any,
        },
      ],
    })
    const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return normalizeCoiReview(parseAiJson<CoiAiResponse>(text, { tag: 'coi-review', stopReason: res.stop_reason }))
  } catch (err) {
    console.error('[reviewCoi] AI review failed:', err instanceof Error ? err.message : err)
    return {
      criticalPass: false,
      overallPass: false,
      riskLevel: 'medium',
      notes: `AI review failed: ${(err as Error).message}`,
    }
  }
}
