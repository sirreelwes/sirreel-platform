/**
 * The note that goes to a partner when we quote their unit.
 *
 * Wes, 2026-08-28: the owner should know we've submitted an estimate for those
 * days. It is advance notice, not a hold — so the copy says so plainly rather
 * than implying a booking, which would have them turning away real work.
 *
 * It names NO client. Not the production, not the company, not the contact —
 * the shared reference is our job code. Same rule as the vendor page: the two
 * sides of a sub-rental coordinate through us. Anything added here later has
 * to clear the same bar.
 *
 * Same brand shell as the client estimate so a partner who also rents from us
 * sees one consistent sender.
 */

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

function fmt(d: string): string {
  const dt = new Date(`${d}T00:00:00.000Z`)
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export interface VendorNoticeArgs {
  vendorName: string
  vehicleName: string
  startDate: string
  endDate: string
  /** Our job code — the reference both sides can use without naming anyone. */
  reference: string | null
  vendorUrl: string
  agentName: string
}

export function buildVendorEstimateNotice(a: VendorNoticeArgs): {
  subject: string
  html: string
  text: string
} {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} — ${fmt(a.endDate)}`
  const subject = `Estimate submitted — ${a.vehicleName}, ${range}`

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <tr><td style="background-color:${HEADER_BG};padding:20px 32px;">
          <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel" style="height:28px;width:auto;display:block;" />
        </td></tr>
        <tr><td style="padding:28px 32px 4px;">
          <p style="font-size:17px;color:${TEXT};margin:0 0 12px;line-height:1.5;">Hi ${escapeHtml(a.vendorName)},</p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            We've submitted an estimate to a production for your <strong>${escapeHtml(a.vehicleName)}</strong> on the dates below.
          </p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            <strong>This is not a booking</strong> and holds nothing &mdash; it's advance notice so the dates are on your radar. We'll confirm as soon as we hear back.
          </p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">Dates quoted</p>
            <p style="font-size:20px;font-weight:800;color:${TEXT};margin:0;">${escapeHtml(range)}</p>
            ${a.reference ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">SirReel reference ${escapeHtml(a.reference)}</p>` : ''}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:26px 32px 4px;">
          <a href="${a.vendorUrl}" style="display:inline-block;background-color:${CTA_BG};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:999px;">View this booking &rarr;</a>
        </td></tr>
        <tr><td style="padding:22px 32px 0;">
          <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
            That page stays up to date as things move, and is where location, call time and driver details will be exchanged once anything is confirmed. Please reply to this email with any questions rather than contacting the production.
          </p>
        </td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <p style="font-size:16px;color:${TEXT};margin:0;line-height:1.6;">
            ${escapeHtml(a.agentName)}<br/>
            <span style="color:${MUTED};font-size:14px;">&amp; Team SirReel</span>
          </p>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px 26px;">
          <p style="font-size:12px;color:${MUTED};margin:0;">8500 Lankershim Blvd, Sun Valley CA 91352 &middot; (888) 477-7335</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    `Hi ${a.vendorName},`,
    '',
    `We've submitted an estimate to a production for your ${a.vehicleName} on the dates below.`,
    '',
    `THIS IS NOT A BOOKING and holds nothing — it's advance notice so the dates are on your radar.`,
    `We'll confirm as soon as we hear back.`,
    '',
    `Dates quoted: ${range}`,
    ...(a.reference ? [`SirReel reference: ${a.reference}`] : []),
    '',
    `View this booking: ${a.vendorUrl}`,
    '',
    `That page stays up to date as things move, and is where location, call time and driver`,
    `details will be exchanged once anything is confirmed. Please reply to this email with any`,
    `questions rather than contacting the production.`,
    '',
    `— ${a.agentName}`,
    '& Team SirReel',
    '',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  ].join('\n')

  return { subject, html, text }
}

/**
 * The note that goes to a partner when the production ACCEPTS.
 *
 * The estimate notice above deliberately holds nothing — this is its opposite
 * number and has to read that way, because the vendor's action changes: they
 * are being asked to actually block the dates on their calendar. Anything that
 * still hedges ("we may need this") leaves the unit bookable by someone else,
 * which is the exact failure the notice exists to prevent.
 *
 * Same conduit rule as everything else on this path: no production, no company,
 * no contact. Our job code is the shared reference. The dates and the unit are
 * the vendor's own facts and are safe to state.
 */
export interface VendorHoldRequestArgs extends VendorNoticeArgs {
  /** Quantity of this unit, when more than one was quoted. */
  quantity?: number
}

export function buildVendorHoldRequest(a: VendorHoldRequestArgs): {
  subject: string
  html: string
  text: string
} {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} — ${fmt(a.endDate)}`
  const subject = `Please hold — ${a.vehicleName}, ${range}`
  const qtyLine = a.quantity && a.quantity > 1 ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">${a.quantity} units</p>` : ''

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <tr><td style="background-color:${HEADER_BG};padding:20px 32px;">
          <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel" style="height:28px;width:auto;display:block;" />
        </td></tr>
        <tr><td style="padding:28px 32px 4px;">
          <p style="font-size:17px;color:${TEXT};margin:0 0 12px;line-height:1.5;">Hi ${escapeHtml(a.vendorName)},</p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            Good news &mdash; the production accepted our estimate. <strong>Please hold your ${escapeHtml(a.vehicleName)}</strong> for the dates below.
          </p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            Reply to confirm the hold, and we'll follow up with the PO. Driver, call time and location are exchanged on your booking page &mdash; you can name your driver there now.
          </p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">Dates to hold</p>
            <p style="font-size:20px;font-weight:800;color:${TEXT};margin:0;">${escapeHtml(range)}</p>
            ${qtyLine}
            ${a.reference ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">SirReel reference ${escapeHtml(a.reference)}</p>` : ''}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:26px 32px 4px;">
          <a href="${a.vendorUrl}" style="display:inline-block;background-color:${CTA_BG};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:999px;">Open the booking page &rarr;</a>
        </td></tr>
        <tr><td style="padding:22px 32px 0;">
          <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
            That page stays up to date as things move. Please reply to this email with any questions rather than contacting the production.
          </p>
        </td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <p style="font-size:16px;color:${TEXT};margin:0;line-height:1.6;">
            ${escapeHtml(a.agentName)}<br/>
            <span style="color:${MUTED};font-size:14px;">&amp; Team SirReel</span>
          </p>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px 26px;">
          <p style="font-size:12px;color:${MUTED};margin:0;">8500 Lankershim Blvd, Sun Valley CA 91352 &middot; (888) 477-7335</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    `Hi ${a.vendorName},`,
    '',
    `Good news — the production accepted our estimate.`,
    `PLEASE HOLD your ${a.vehicleName} for the dates below.`,
    '',
    `Dates to hold: ${range}`,
    ...(a.quantity && a.quantity > 1 ? [`Units: ${a.quantity}`] : []),
    ...(a.reference ? [`SirReel reference: ${a.reference}`] : []),
    '',
    `Reply to confirm the hold, and we'll follow up with the PO. Driver, call time and`,
    `location are exchanged on your booking page — you can name your driver there now.`,
    '',
    `Open the booking page: ${a.vendorUrl}`,
    '',
    `Please reply to this email with any questions rather than contacting the production.`,
    '',
    `— ${a.agentName}`,
    '& Team SirReel',
    '',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  ].join('\n')

  return { subject, html, text }
}
