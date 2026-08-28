/**
 * "Send Estimate to Client" — the composer behind the button on a
 * subcontracted vehicle.
 *
 * Pure and side-effect free (no mint, no Resend, no state writes) so the
 * preview the rep reviews is byte-identical to what leaves the system —
 * the same discipline as composeQuoteEmail.
 *
 * ── Brand ─────────────────────────────────────────────────────────────────
 * The envelope is the TSX shell every client email already arrives in (slate
 * header, SirReel logo, gold rules, "TSX — The SirReel Experience" tagline,
 * "& Team SirReel" sign-off). The estimate INSIDE it is SirReel-branded and
 * says SirReel throughout: TSX is the portal brand, never the name on a
 * quote or an estimate (Wes, 2026-08-23).
 *
 * ── The money rule ────────────────────────────────────────────────────────
 * The client is quoted the VENDOR'S LIST RATE and nothing else (Wes,
 * 2026-08-28). Our negotiated discount is the margin and never appears:
 *   - `discountPercent` is not selected here.
 *   - `netCost` / `feeNetAmount` are not imported here.
 *   - `rateNotes` is NOT rendered. It is an internal field for structural
 *     nuance and negotiation posture ("they'll go to 25% if we push"), so it
 *     is deliberately left for the rep to paraphrase into their own message
 *     rather than pasted in front of a client.
 * Fees render at their list `amount` for the same reason — `discountApplies`
 * changes what WE pay, not what the client is quoted.
 */
import { prisma } from '@/lib/prisma'
import {
  fmtMoney,
  formatFeeRate,
  coversHoursNote,
  UNION_SCOPE_LABEL,
  type SubFeeUnit,
  type SubFeeUnionScope,
} from '@/lib/sub-rentals/vehicles'
import { publicUnitPath } from '@/lib/sub-rentals/publicUnit'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

const ACCENT = '#D4A547'
const HEADER_BG = '#0f172a'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const CTA_BG = '#D97706'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface EstimateEmailArgs {
  vehicleId: string
  /** Rep's own message. Replaces the default opener when present. */
  message?: string | null
  /** Client's first name for the greeting; falls back to "there". */
  clientFirstName?: string | null
  agentName: string
  agentPhone?: string | null
}

export interface EstimateEmailOk {
  ok: true
  subject: string
  html: string
  text: string
  /** The standard wording, so "write my own" opens on real copy. */
  defaultBody: string
  /** Unlisted page URL, or null when no link has been minted yet. */
  unitUrl: string | null
  vehicle: { id: string; name: string; vehicleType: string | null }
}

export type EstimateEmailResult = EstimateEmailOk | { ok: false; status: number; error: string }

const TERM_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const

export async function composeEstimateEmail(args: EstimateEmailArgs): Promise<EstimateEmailResult> {
  const v = await prisma.subcontractedVehicle.findUnique({
    where: { id: args.vehicleId },
    // Explicit allow-list. discountPercent and rateNotes are NOT here — see
    // the money rule in the file header.
    select: {
      id: true,
      name: true,
      vehicleType: true,
      specs: true,
      listDailyRate: true,
      listWeeklyRate: true,
      listMonthlyRate: true,
      isActive: true,
      publicToken: true,
      vendorId: true,
    },
  })
  if (!v) return { ok: false, status: 404, error: 'vehicle not found' }

  // Fees in effect = the vendor's blanket rows (vehicleId NULL) UNION this
  // unit's own. Reading only the vehicle relation silently dropped Driver,
  // Mileage, Generator and Supplies from the estimate — every King Kong fee
  // is vendor-level — which would have quoted a day at the bare vehicle rate.
  // Same scope as GET /api/sub-rentals/fees.
  const fees = await prisma.subcontractedFee.findMany({
    where: {
      isActive: true,
      vendorId: v.vendorId,
      OR: [{ vehicleId: null }, { vehicleId: v.id }],
    },
    select: {
      id: true,
      label: true,
      amount: true,
      unit: true,
      coversHours: true,
      unionScope: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })

  const terms = (
    [
      ['daily', v.listDailyRate],
      ['weekly', v.listWeeklyRate],
      ['monthly', v.listMonthlyRate],
    ] as const
  )
    .filter(([, rate]) => rate != null)
    .map(([key, rate]) => ({ label: TERM_LABEL[key], value: fmtMoney(String(rate)) }))

  if (terms.length === 0) {
    return { ok: false, status: 400, error: 'No rates are set on this vehicle — add a rate before sending an estimate.' }
  }

  const unitUrl = v.publicToken ? `${PUBLIC_SITE_ORIGIN}${publicUnitPath(v.publicToken)}` : null
  const typeLabel = v.vehicleType ?? 'Production vehicle'
  const greetName = args.clientFirstName?.trim() || 'there'
  const subject = `SirReel estimate — ${v.name}`

  const defaultBody =
    `Here's the estimate for the ${v.name}. Rates below are per the terms noted; ` +
    `let me know your dates and I'll confirm availability and lock it in.`
  const bodyText = args.message?.trim() || defaultBody

  // ── Rate table ──────────────────────────────────────────────────────────
  const rateRows = terms
    .map(
      (t, i) => `
              <tr>
                <td style="padding: 10px 16px; font-size: 15px; color: ${TEXT}; ${i ? 'border-top: 1px solid #f0f0f0;' : ''}">${escapeHtml(t.label)}</td>
                <td align="right" style="padding: 10px 16px; font-size: 15px; font-weight: 700; color: ${TEXT}; ${i ? 'border-top: 1px solid #f0f0f0;' : ''}">${escapeHtml(t.value)}</td>
              </tr>`,
    )
    .join('')

  const feeRows = fees
    .map((f) => {
      const rate = formatFeeRate({
        amount: String(f.amount),
        unit: f.unit as SubFeeUnit,
        coversHours: f.coversHours ? String(f.coversHours) : null,
      })
      const covers = coversHoursNote({
        amount: String(f.amount),
        unit: f.unit as SubFeeUnit,
        coversHours: f.coversHours ? String(f.coversHours) : null,
      })
      const scope = f.unionScope as SubFeeUnionScope
      const quals = [covers, scope !== 'ALL' ? UNION_SCOPE_LABEL[scope] : null].filter(Boolean).join(' · ')
      return `
              <tr>
                <td style="padding: 9px 16px; font-size: 14px; color: ${TEXT}; border-top: 1px solid #f0f0f0;">
                  ${escapeHtml(f.label)}
                  ${quals ? `<br/><span style="font-size: 12px; color: ${MUTED};">${escapeHtml(quals)}</span>` : ''}
                </td>
                <td align="right" valign="top" style="padding: 9px 16px; font-size: 14px; font-weight: 600; color: ${TEXT}; border-top: 1px solid #f0f0f0;">${escapeHtml(rate)}</td>
              </tr>`
    })
    .join('')

  const feeBlock = fees.length
    ? `
          <tr>
            <td style="padding: 0 32px 4px;">
              <p style="font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${MUTED}; margin: 18px 0 8px;">Additional charges</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                ${feeRows}
              </table>
            </td>
          </tr>`
    : ''

  const unitBlock = unitUrl
    ? `
          <tr>
            <td align="center" style="padding: 24px 32px 4px;">
              <a href="${unitUrl}" style="display: inline-block; background-color: ${CTA_BG}; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; padding: 13px 28px; border-radius: 999px;">See photos &amp; specs &rarr;</a>
            </td>
          </tr>`
    : ''

  const specLines = (v.specs ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const bigCap = (c: string) => `<span style="font-size:13px;">${c}</span>`
  const smCap = (c: string) => `<span style="font-size:10px;">${c}</span>`
  const wordGap = '<span style="display:inline-block;width:10px;">&nbsp;</span>'
  const dashGap = `<span style="font-size:11px;color:rgba(212,165,71,0.6);margin:0 6px;">&ndash;</span>`
  const tsxTagline = [
    bigCap('T'), bigCap('S'), bigCap('X'),
    dashGap,
    bigCap('T'), smCap('H'), smCap('E'),
    wordGap,
    bigCap('S'), smCap('I'), smCap('R'), bigCap('R'), smCap('E'), smCap('E'), smCap('L'),
    wordGap,
    bigCap('E'), smCap('X'), smCap('P'), smCap('E'), smCap('R'), smCap('I'), smCap('E'), smCap('N'), smCap('C'), smCap('E'),
  ].join('')

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <tr>
            <td style="background-color: ${HEADER_BG}; padding: 20px 32px;">
              <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel" style="height: 28px; width: auto; display: block;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 4px;">
              <p style="font-size: 17px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.5;">Hi ${escapeHtml(greetName)},</p>
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.6;">${escapeHtml(bodyText)}</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 14px 32px 0;">
              <div style="border-left: 3px solid ${ACCENT}; padding-left: 14px;">
                <p style="font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${ACCENT}; margin: 0 0 2px;">SirReel Estimate</p>
                <p style="font-size: 20px; font-weight: 800; color: ${TEXT}; margin: 0;">${escapeHtml(v.name)}</p>
                <p style="font-size: 13px; color: ${MUTED}; margin: 2px 0 0;">${escapeHtml(typeLabel)}</p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 32px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                ${rateRows}
              </table>
            </td>
          </tr>
          ${feeBlock}
          ${unitBlock}

          <tr>
            <td style="padding: 22px 32px 0;">
              <p style="font-size: 13px; color: ${MUTED}; margin: 0; line-height: 1.6;">
                Estimate only &mdash; not a reservation. Rates are subject to availability and confirmation, and exclude applicable taxes. Dates are held once confirmed in writing.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 22px 32px 4px;">
              <p style="font-size: 16px; color: ${TEXT}; margin: 0; line-height: 1.6;">
                ${escapeHtml(args.agentName)}<br/>
                <span style="color: ${MUTED}; font-size: 14px;">&amp; Team SirReel</span>
                ${args.agentPhone ? `<br/><span style="color: ${MUTED}; font-size: 14px;">${escapeHtml(args.agentPhone)}</span>` : ''}
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding: 26px 32px 8px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                <td style="border-top: 1px solid rgba(212,165,71,0.35); padding-top: 12px;">
                  <span style="color: ${ACCENT}; letter-spacing: 3px; font-family: Georgia, 'Times New Roman', serif;">${tsxTagline}</span>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 4px 32px 26px;">
              <p style="font-size: 12px; color: ${MUTED}; margin: 0;">8500 Lankershim Blvd, Sun Valley CA 91352 &middot; (888) 477-7335</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textParts: string[] = [
    `Hi ${greetName},`,
    '',
    bodyText,
    '',
    `SIRREEL ESTIMATE — ${v.name}`,
    typeLabel,
    '',
    ...terms.map((t) => `  ${t.label}: ${t.value}`),
  ]
  if (fees.length) {
    textParts.push('', 'Additional charges:')
    for (const f of fees) {
      const rate = formatFeeRate({
        amount: String(f.amount),
        unit: f.unit as SubFeeUnit,
        coversHours: f.coversHours ? String(f.coversHours) : null,
      })
      const covers = coversHoursNote({
        amount: String(f.amount),
        unit: f.unit as SubFeeUnit,
        coversHours: f.coversHours ? String(f.coversHours) : null,
      })
      const scope = f.unionScope as SubFeeUnionScope
      const quals = [covers, scope !== 'ALL' ? UNION_SCOPE_LABEL[scope] : null].filter(Boolean).join(' · ')
      textParts.push(`  ${f.label}: ${rate}${quals ? ` (${quals})` : ''}`)
    }
  }
  if (specLines.length) {
    textParts.push('', 'Specs:', ...specLines.map((s) => `  - ${s}`))
  }
  if (unitUrl) textParts.push('', `Photos & specs: ${unitUrl}`)
  textParts.push(
    '',
    'Estimate only — not a reservation. Rates are subject to availability and confirmation, and exclude applicable taxes.',
    '',
    `— ${args.agentName}`,
    '& Team SirReel',
    ...(args.agentPhone ? [args.agentPhone] : []),
    '',
    'TSX — The SirReel Experience',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  )

  return {
    ok: true,
    subject,
    html,
    text: textParts.join('\n'),
    defaultBody,
    unitUrl,
    vehicle: { id: v.id, name: v.name, vehicleType: v.vehicleType },
  }
}
