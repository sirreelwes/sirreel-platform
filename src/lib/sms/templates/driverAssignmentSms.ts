/**
 * The driver invite, as a text (Wes 2026-09-15: "onboard drivers with a
 * text and they can enter their email").
 *
 * The email's opening three facts — which truck, whose show, what day —
 * then the link. Everything else the email says lives on the page the
 * link opens, and a text that scrolls is a text nobody reads.
 *
 * It does NOT carry a gate or lockbox code, ever: those are released on
 * the page, and only once the driver has a name, a number and a licence
 * on file. A code in a text is a code in a stranger's message preview.
 *
 * sendTracked appends "Reply STOP to opt out." — don't write it here.
 */

export function buildDriverAssignmentSms(args: {
  driverFirstName: string | null
  unitName: string
  productionName: string | null
  pickupDate: string
  jobLink: string
  needsLicense: boolean
  unattendedPickup: boolean
}): string {
  const hi = args.driverFirstName?.trim() ? `${args.driverFirstName.trim()}, ` : ''
  const show = args.productionName?.trim() ? ` for ${args.productionName.trim()}` : ''
  const when = friendlyDate(args.pickupDate)
  const lines = [
    `SirReel: ${hi}you're driving ${args.unitName}${show}, picking up ${when}.`,
    args.unattendedPickup
      ? 'Nobody will be there to meet you — your page has the pickup steps and the codes.'
      : null,
    args.needsLicense
      ? 'Open your page to add your license and your details:'
      : 'Your pickup details:',
    args.jobLink,
  ].filter(Boolean)
  return lines.join(' ')
}

/** "Tue Sep 16" — a date a driver reads at a glance, not an ISO string. */
function friendlyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}
