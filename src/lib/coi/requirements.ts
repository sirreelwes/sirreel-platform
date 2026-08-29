/**
 * What we tell a CLIENT'S BROKER the certificate has to show.
 *
 * Distinct from COI_CHECK_LABELS in checks.ts, which is our fifteen-point
 * REVIEW criteria — that list judges a certificate we already have. This one
 * is the ask, in the words we send out before a certificate exists, and it is
 * the list Wes has been pasting into emails by hand.
 *
 * ── Auto Physical Damage is the whole reason this module exists ─────────────
 * It is the line that comes back missing most often, and the reason is not
 * that the coverage is absent — it is that some brokers itemise it on the
 * certificate and others consider it implied and leave it off. So the request
 * has to say BOTH things: add it, or confirm in writing that it is included.
 * Asking only "please add it" gets an answer of "it's already covered", which
 * is not the same as evidence, and the second round trip costs a day.
 */

export interface CoiRequirement {
  label: string
  /** Sub-points that qualify the requirement. */
  details?: string[]
  /** The one that stalls certificates — rendered emphasised everywhere. */
  sticking?: boolean
}

export const CERTIFICATE_HOLDER = {
  name: 'SirReel Production Vehicles, Inc.',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
} as const

/** Insurance Requirements (All Jobs). */
export const COI_REQUIREMENTS: CoiRequirement[] = [
  { label: 'General Liability: $1,000,000 (minimum)' },
  {
    label: 'Automotive Liability: $1,000,000 (minimum)',
    details: [
      'Must include: any auto, hired autos, or non-owned autos',
      'Auto Physical Damage (Hired / Non-Owned)',
      'No Unattended Vehicle Exclusion',
    ],
  },
  {
    label:
      'Misc Rental Equipment OR Entertainment Package totaling the replacement value of rented equipment',
  },
  { label: '3rd Party Property Damage: $1,000,000 (minimum)' },
  { label: "Proof of Worker's Compensation: policy required" },
]

/** Index of the detail that gets the emphasis, so no surface hardcodes it. */
export const STICKING_POINT = 'Auto Physical Damage (Hired / Non-Owned)'

/** The paragraph that heads off the usual second round trip. */
export const AUTO_PHYSICAL_DAMAGE_NOTE =
  'One line to watch: Auto Physical Damage. Some brokers list it on the ' +
  'certificate and others do not, so if it is missing we need it added — or ' +
  'written confirmation that it is included in the policy. Either is fine; we ' +
  'just cannot release a vehicle without one of them.'

/** Plain-text rendering, for the email body. */
export function requirementsAsText(): string {
  const lines: string[] = ['INSURANCE REQUIREMENTS (ALL JOBS)', '']
  for (const r of COI_REQUIREMENTS) {
    lines.push(`  • ${r.label}`)
    for (const d of r.details ?? []) lines.push(`      - ${d}`)
  }
  lines.push(
    '',
    'Certificate holder / additional insured / loss payee:',
    `  ${CERTIFICATE_HOLDER.name}`,
    `  ${CERTIFICATE_HOLDER.address}`,
  )
  return lines.join('\n')
}

/** HTML rendering, for the email body. Callers supply the escape helper so
 *  this module stays free of template-specific imports. */
export function requirementsAsHtml(opts: { textColor: string; mutedColor: string; accent: string }): string {
  const items = COI_REQUIREMENTS.map((r) => {
    const details = (r.details ?? [])
      .map((d) => {
        const hot = d === STICKING_POINT
        return `<li style="margin: 2px 0; color: ${hot ? opts.accent : opts.mutedColor}; ${hot ? 'font-weight: 700;' : ''}">${d}</li>`
      })
      .join('')
    return `<li style="margin: 6px 0; color: ${opts.textColor};"><strong>${r.label}</strong>${
      details ? `<ul style="margin: 4px 0 0; padding-left: 18px; font-size: 13px;">${details}</ul>` : ''
    }</li>`
  }).join('')
  return `<ul style="margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.55;">${items}</ul>`
}
