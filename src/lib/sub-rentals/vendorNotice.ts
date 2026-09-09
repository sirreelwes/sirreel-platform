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

const ACCENT = '#0F7A93'
const HEADER_BG = '#0f172a'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const CTA_BG = '#0F7A93' // the brand accent (Utliiz turquoise) — was amber-600

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
  /** The money on this booking under the deal, when it is set: what the
   *  production pays per day (their list), what the partner receives, and
   *  SirReel's share. Omitted on the estimate (nothing is committed) and on
   *  a cancellation. */
  rate?: { listDaily: number | null; vendorDaily: number | null; vendorTotal: number | null; sharePercent: number } | null
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** "Your rate: $1,276 / day (80% of $1,595 list) · $1,276 for the booking" */
function rateLine(a: VendorNoticeArgs): string | null {
  const r = a.rate
  if (!r || r.vendorDaily == null) return null
  const keep = Math.round((100 - r.sharePercent) * 100) / 100
  const basis = r.listDaily != null ? ` (${keep}% of ${usd(r.listDaily)} list)` : ` (${keep}% of list)`
  const total = r.vendorTotal != null ? ` · ${usd(r.vendorTotal)} for the booking` : ''
  return `Your rate: ${usd(r.vendorDaily)} / day${basis}${total}`
}
function rateHtml(a: VendorNoticeArgs): string {
  const l = rateLine(a)
  return l ? `<p style="font-size:13px;color:${TEXT};margin:6px 0 0;"><strong>${escapeHtml(l)}</strong></p>` : ''
}
function rateText(a: VendorNoticeArgs): string[] {
  const l = rateLine(a)
  return l ? [l] : []
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
            ${rateHtml(a)}
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
    ...rateText(a),
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
            ${rateHtml(a)}
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
    ...rateText(a),
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

// ── "This job is a go" ───────────────────────────────────────────────
//
// Wes 2026-09-06: "The please hold happens when we quote a client and that
// client replies to us that we want to hold it. The next email would be —
// the client has booked — this job looks like a go!" And: "We have a 24 hr
// cancellation policy with clients typically." So this note says the
// booking is firm, names the one way it isn't (a cancellation inside the
// client's window), and promises the partner hears the moment that happens.

export interface VendorBookedNoticeArgs extends VendorNoticeArgs {
  quantity?: number
  /** Whether the partner has already confirmed the hold on their page. */
  holdConfirmed: boolean
  /** Whether a driver has been named yet. */
  driverNamed: boolean
  /** The partner DELIVERS the unit (restroom trailers) — casual note, asks
   *  for a delivery contact (name + mobile) instead of a driver, no driver
   *  page. Wes 2026-09-07. */
  delivery?: boolean
  /** First name of the vendor's contact, for the greeting on the casual note. */
  contactFirstName?: string | null
  /** Where it goes: the exact report-to when the production has set it,
   *  else the approximate area with "exact address to follow". Partners
   *  always get this; their DRIVERS get the exact address only the day
   *  before (see conduit.driverFacingLogistics). */
  deliverTo?: { address: string | null; area: string | null }
  /** The job's name ("X Zzirit") — a vendor can hold several jobs for us
   *  at once and the code alone doesn't tell them apart (Wes 2026-09-07).
   *  Never the production company. */
  jobName?: string | null
}

export function buildVendorBookedNotice(a: VendorBookedNoticeArgs): {
  subject: string
  html: string
  text: string
} {
  if (a.delivery) return buildVendorDeliveryBookedNotice(a)
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} — ${fmt(a.endDate)}`
  const subject = `It's a go — ${a.vehicleName}, ${range}`
  const qtyLine = a.quantity && a.quantity > 1 ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">${a.quantity} units</p>` : ''
  const nextSteps: string[] = []
  if (!a.holdConfirmed) nextSteps.push('confirm the hold')
  if (!a.driverNamed) nextSteps.push('name your driver')
  const nextHtml = nextSteps.length
    ? `Two things on your booking page when you have a minute: ${nextSteps.join(' and ')}.`.replace('Two things', nextSteps.length === 1 ? 'One thing' : 'Two things')
    : 'Nothing more is needed from you right now.'

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
            <strong>The production has booked &mdash; this job is a go.</strong> Your ${escapeHtml(a.vehicleName)} is confirmed for the dates below.
          </p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            ${nextHtml} Call time and the location land on that page as the production sets them, and your driver gets them on their phone.
          </p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">Booked</p>
            <p style="font-size:20px;font-weight:800;color:${TEXT};margin:0;">${escapeHtml(range)}</p>
            ${qtyLine}
            ${a.reference ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">SirReel reference ${escapeHtml(a.reference)}</p>` : ''}
            ${rateHtml(a)}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:26px 32px 4px;">
          <a href="${a.vendorUrl}" style="display:inline-block;background-color:${CTA_BG};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:999px;">Open the booking page &rarr;</a>
        </td></tr>
        <tr><td style="padding:22px 32px 0;">
          <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
            Productions can cancel up to 24 hours before the first day. If that happens you'll hear from us the moment it does &mdash; otherwise, treat this as firm. Please reply to this email with any questions rather than contacting the production.
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
    `The production has booked — THIS JOB IS A GO.`,
    `Your ${a.vehicleName} is confirmed for the dates below.`,
    '',
    `Booked: ${range}`,
    ...(a.quantity && a.quantity > 1 ? [`Units: ${a.quantity}`] : []),
    ...(a.reference ? [`SirReel reference: ${a.reference}`] : []),
    ...rateText(a),
    '',
    nextHtml.replace(/<[^>]+>/g, ''),
    `Call time and the location land on that page as the production sets them, and your driver gets them on their phone.`,
    '',
    `Open the booking page: ${a.vendorUrl}`,
    '',
    `Productions can cancel up to 24 hours before the first day. If that happens you'll hear from us`,
    `the moment it does — otherwise, treat this as firm. Please reply to this email with any questions`,
    `rather than contacting the production.`,
    '',
    `— ${a.agentName}`,
    '& Team SirReel',
    '',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  ].join('\n')

  return { subject, html, text }
}

// ── "It's a go" — delivered units ────────────────────────────────────
//
// A restroom trailer is dropped and collected; the partner's driver never
// meets the production, logs no hours and needs no page. So the note is
// short and casual, and the one ask is a name and a mobile the office can
// text or call if the drop-off or pickup moves on the day (Wes 2026-09-07).

function buildVendorDeliveryBookedNotice(a: VendorBookedNoticeArgs): {
  subject: string
  html: string
  text: string
} {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} — ${fmt(a.endDate)}`
  const subject = `${a.jobName ? `${a.jobName}: ` : ''}${a.vehicleName} for ${range} — confirmed`
  const who = a.contactFirstName || a.vendorName
  const units = a.quantity && a.quantity > 1 ? `${a.quantity} × ${a.vehicleName}` : `the ${a.vehicleName}`
  const confirmed = `The production booked, so ${units} ${a.quantity && a.quantity > 1 ? 'are' : 'is'} confirmed for ${range}. Drop-off and pickup details are on the booking page and will update there if anything changes.`
  const ask = a.driverNamed
    ? `Thanks for the delivery contact. If that changes, update it on the booking page.`
    : `Could you add a name and mobile on the booking page for whoever is handling the delivery and pickup? We'll only use it if the address or timing changes that day.`

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
          <p style="font-size:17px;color:${TEXT};margin:0 0 12px;line-height:1.5;">Hey ${escapeHtml(who)},</p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            ${escapeHtml(confirmed)}
          </p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">${escapeHtml(ask)}</p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">Delivering</p>
            <p style="font-size:22px;font-weight:800;color:${TEXT};margin:0;line-height:1.25;">${a.quantity && a.quantity > 1 ? `${a.quantity} &times; ` : ''}${escapeHtml(a.vehicleName)}</p>
            <p style="font-size:17px;font-weight:700;color:${TEXT};margin:8px 0 0;">${escapeHtml(range)}</p>
            ${a.deliverTo?.address ? `<p style="font-size:15px;color:${TEXT};margin:6px 0 0;"><span style="color:${MUTED};">To</span> ${escapeHtml(a.deliverTo.address)}</p>` : a.deliverTo?.area ? `<p style="font-size:15px;color:${TEXT};margin:6px 0 0;"><span style="color:${MUTED};">To</span> ${escapeHtml(a.deliverTo.area)} <span style="color:${MUTED};">&middot; exact address to follow</span></p>` : ''}
            ${a.jobName ? `<p style="font-size:15px;color:${TEXT};margin:6px 0 0;"><span style="color:${MUTED};">Job</span> ${escapeHtml(a.jobName)}${a.reference ? ` <span style="color:${MUTED};">&middot; ${escapeHtml(a.reference)}</span>` : ''}</p>` : a.reference ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">SirReel reference ${escapeHtml(a.reference)}</p>` : ''}
            ${rateHtml(a)}
          </div>
        </td></tr>
        <tr><td align="center" style="padding:26px 32px 4px;">
          <a href="${a.vendorUrl}" style="display:inline-block;background-color:${CTA_BG};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:999px;">Open the booking page &rarr;</a>
        </td></tr>
        <tr><td style="padding:22px 32px 0;">
          <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
            If the production cancels inside 24 hours I'll let you know right away; otherwise treat this as firm. Any questions, reply here.
          </p>
        </td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <p style="font-size:16px;color:${TEXT};margin:0;line-height:1.6;">
            Thanks,<br/>${escapeHtml(a.agentName)}<br/>
            <span style="color:${MUTED};font-size:14px;">SirReel</span>
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
    `Hey ${who},`,
    '',
    confirmed,
    '',
    ask,
    '',
    `DELIVERING: ${a.quantity && a.quantity > 1 ? `${a.quantity} × ` : ''}${a.vehicleName}`,
    `Dates: ${range}`,
    ...(a.deliverTo?.address ? [`To: ${a.deliverTo.address}`] : a.deliverTo?.area ? [`To: ${a.deliverTo.area} — exact address to follow`] : []),
    ...(a.jobName ? [`Job: ${a.jobName}${a.reference ? ` (${a.reference})` : ''}`] : a.reference ? [`SirReel reference: ${a.reference}`] : []),
    ...rateText(a),
    '',
    `Booking page: ${a.vendorUrl}`,
    '',
    `If the production cancels inside 24 hours I'll let you know right away; otherwise treat this as firm. Any questions, reply here.`,
    '',
    'Thanks,',
    a.agentName,
    'SirReel',
    '',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  ].join('\n')

  return { subject, html, text }
}

// ── "This job is off" ────────────────────────────────────────────────
//
// The other half of the 24-hour promise above: a cancelled order tells
// the partner at once, so their unit goes back on their own calendar.

export interface VendorCancelledNoticeArgs extends VendorNoticeArgs {
  quantity?: number
}

export function buildVendorCancelledNotice(a: VendorCancelledNoticeArgs): {
  subject: string
  html: string
  text: string
} {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} — ${fmt(a.endDate)}`
  const subject = `Cancelled — ${a.vehicleName}, ${range}`

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
            The production has cancelled. <strong>Your ${escapeHtml(a.vehicleName)} is released</strong> for the dates below &mdash; it's yours to book elsewhere.
          </p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">
            Sorry for the churn. If a cancellation fee applies under our agreement, we'll settle it with you directly.
          </p>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">Released</p>
            <p style="font-size:20px;font-weight:800;color:${TEXT};margin:0;">${escapeHtml(range)}</p>
            ${a.reference ? `<p style="font-size:13px;color:${MUTED};margin:2px 0 0;">SirReel reference ${escapeHtml(a.reference)}</p>` : ''}
            ${rateHtml(a)}
          </div>
        </td></tr>
        ${a.vendorUrl ? `<tr><td align="center" style="padding:22px 32px 0;">
          <a href="${escapeHtml(a.vendorUrl)}?ack=release" style="display:inline-block;background-color:${ACCENT};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">Confirm you have the dates back</a>
          <p style="font-size:13px;color:${MUTED};margin:10px 0 0;">One tap, so we know the release reached you and nobody has to chase it.</p>
        </td></tr>` : ''}
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
    `The production has cancelled. Your ${a.vehicleName} is RELEASED for the dates below — it's yours to book elsewhere.`,
    '',
    `Released: ${range}`,
    ...(a.reference ? [`SirReel reference: ${a.reference}`] : []),
    ...rateText(a),
    '',
    ...(a.vendorUrl
      ? ['', `Confirm you have the dates back: ${a.vendorUrl}?ack=release`]
      : []),
    '',
    `Sorry for the churn. If a cancellation fee applies under our agreement, we'll settle it with you directly.`,
    '',
    `— ${a.agentName}`,
    '& Team SirReel',
    '',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  ].join('\n')

  return { subject, html, text }
}
