/**
 * Texting a partner when a booking moves — their choice, their number.
 *
 * Wes 2026-09-15, preparing the California Rent A Car walkthrough: "can you
 * also show how they could choose to get notified by text?" A rental desk
 * reads a text in the minute it lands and an email when someone opens the
 * inbox, and the one message that is worth that difference is "please hold
 * these dates".
 *
 * ── It is a nudge, never the record ─────────────────────────────────────────
 * The EMAIL still goes, every time, to everyone it went to before. The text
 * carries the unit, the dates and the link, and nothing that only exists in
 * the text — a partner who never opts in loses nothing.
 *
 * ── Consent is theirs ───────────────────────────────────────────────────────
 * VendorContact.smsBookings is off by default and is ticked by the PARTNER on
 * their own page, next to the number it will text; smsConsentAt stamps when.
 * Sending goes through sendTracked, so STOP, quiet hours (9pm-6am Pacific,
 * these are automated) and the thread log work exactly as they do for a
 * client or a driver. A number that replied STOP gets nothing, whatever the
 * box says.
 *
 * ── The conduit still holds ─────────────────────────────────────────────────
 * No production name, no company, no address, no rate. The same rule the
 * partner emails follow (potentialSubRental.ts) — a text is not a loophole.
 */
import { prisma } from '@/lib/prisma'
import { sendTracked } from '@/lib/sms/threads'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

export type PartnerSmsKind = 'estimate' | 'hold' | 'go' | 'released'

const day = (ymd: string | null): string =>
  ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'TBC'

/** The words. Pure, so the test reads exactly what a partner would. */
export function buildPartnerSms(
  kind: PartnerSmsKind,
  a: { vehicleName: string; startDate: string | null; endDate: string | null; url: string },
): string {
  const range = a.startDate && a.endDate && a.startDate !== a.endDate ? `${day(a.startDate)}-${day(a.endDate)}` : day(a.startDate)
  const head = `SirReel: ${a.vehicleName}, ${range}.`
  switch (kind) {
    case 'estimate':
      return `${head} We've quoted it to a production — nothing held yet, just a heads-up. Details: ${a.url}`
    case 'hold':
      return `${head} The production accepted — please hold these dates. Confirm in one tap: ${a.url}`
    case 'go':
      return `${head} The production booked — it's a go. Details: ${a.url}`
    case 'released':
      return `${head} The production cancelled, so those dates are yours again: ${a.url}`
  }
}

/**
 * Text everyone at this partner who asked to hear about bookings.
 *
 * Never throws: a failed text must not roll back the booking or the email
 * that already went. Returns what happened, for the caller's warning line.
 */
export async function textPartnerAboutBooking(
  subRentalId: string,
  kind: PartnerSmsKind,
): Promise<{ sent: number; skipped: string[] }> {
  const out = { sent: 0, skipped: [] as string[] }
  try {
    const s = await prisma.subRental.findUnique({
      where: { id: subRentalId },
      select: {
        id: true, itemDescription: true, startDate: true, endDate: true, vendorToken: true,
        subcontractedVehicle: { select: { name: true } },
        vendor: { select: { id: true, contacts: { where: { isActive: true, smsBookings: true, phone: { not: null } }, select: { name: true, phone: true } } } },
      },
    })
    if (!s?.vendorToken) return out
    const people = s.vendor.contacts
    if (people.length === 0) return out
    const body = buildPartnerSms(kind, {
      vehicleName: s.subcontractedVehicle?.name ?? s.itemDescription,
      startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
      endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
      url: `${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}`,
    })
    for (const p of people) {
      const r = await sendTracked({ to: p.phone!, body, source: 'system', subRentalId: s.id })
      if (r.ok) out.sent++
      else out.skipped.push(`${p.name}: ${r.status}`)
    }
  } catch (err) {
    console.error('[partnerSms] failed:', err instanceof Error ? err.message : err)
  }
  return out
}
