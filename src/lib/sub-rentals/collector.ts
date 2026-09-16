/**
 * Who is collecting a will-call unit — recorded once, told to the partner.
 *
 * Wes 2026-09-15: the "it's a go" note promises "we'll let you know who is
 * collecting before the start date", and nothing in HQ could keep that
 * promise — it was a person's job to remember. Now the production names them
 * on their own portal (they are the ones who know), staff can type it on the
 * job, and the partner is told the same way they are told everything else:
 * their booking page, an email, and a text if they asked for one.
 *
 * ── A NAME, and nothing else ────────────────────────────────────────────────
 * The partner needs the name they will match to a licence at their counter.
 * They do not get a number, a company or a production — the same line
 * potentialSubRental.ts draws for the on-site contact, and a rental counter
 * needs no more than a name to hand over keys against ID.
 *
 * ── Only will-call ──────────────────────────────────────────────────────────
 * A driven unit has the partner's own driver; a delivered one has their
 * delivery contact. Neither has a collector, and setCollector refuses them so
 * the field cannot quietly become a second driver column.
 */
import { prisma } from '@/lib/prisma'
import { sendPartnerMail } from '@/lib/sub-rentals/partnerMail'
import { vendorBookingCc } from '@/lib/sub-rentals/vendorContacts'
import { buildVendorCollectorNotice } from '@/lib/sub-rentals/vendorNotice'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { textPartnerAboutBooking } from '@/lib/sub-rentals/partnerSms'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

export const COLLECTOR_NAME_MAX = 120

export type SetCollectorResult =
  | { ok: true; changed: boolean; collectorName: string | null; notified: boolean }
  | { ok: false; error: string; status: number }

const clean = (raw: unknown): string | null => {
  if (raw === null) return null
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ').slice(0, COLLECTOR_NAME_MAX)
  return s || null
}

/**
 * Record who is collecting, and tell the partner when it is news to them.
 *
 * Idempotent on the same name: re-saving "Dee Ramirez" tells nobody twice.
 * Clearing the name is allowed (a production changes its mind) and is NOT
 * announced — an empty message helps no one; the next real name is.
 */
export async function setCollector(
  subRentalId: string,
  rawName: unknown,
  opts: { by: 'client' | 'staff'; jobId?: string | null } = { by: 'staff' },
): Promise<SetCollectorResult> {
  const name = clean(rawName)
  if (typeof rawName === 'string' && rawName.trim().length > COLLECTOR_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${COLLECTOR_NAME_MAX} characters.`, status: 400 }
  }
  const s = await prisma.subRental.findUnique({
    where: { id: subRentalId },
    select: {
      id: true, status: true, receiveMethod: true, collectorName: true, startDate: true, endDate: true,
      itemDescription: true, vendorToken: true, orderId: true, jobId: true,
      subcontractedVehicle: { select: { name: true } },
      job: { select: { jobCode: true } },
      vendor: { select: { id: true, name: true, email: true, poEmail: true } },
    },
  })
  if (!s) return { ok: false, error: 'That booking is not here.', status: 404 }
  if (opts.jobId && s.jobId !== opts.jobId) return { ok: false, error: 'That booking is not on your job.', status: 403 }
  if (s.receiveMethod !== 'WILL_CALL') {
    return { ok: false, error: 'This one is not collected at the partner’s lot, so there is nobody to name.', status: 409 }
  }
  if (s.status === 'CANCELLED') return { ok: false, error: 'That booking is no longer going ahead.', status: 409 }
  if ((s.collectorName ?? null) === name) return { ok: true, changed: false, collectorName: name, notified: false }

  const now = new Date()
  await prisma.subRental.update({
    where: { id: s.id },
    data: { collectorName: name, collectorSetAt: name ? now : null, ...(name ? {} : { collectorNotifiedAt: null }) },
  })
  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.collector_set',
      entityType: 'SubRental',
      entityId: s.id,
      oldValues: { collectorName: s.collectorName },
      newValues: { collectorName: name, by: opts.by },
    },
  }).catch(() => null)

  // Clearing it is not news; the partner keeps what they last heard until
  // somebody names a real person.
  if (!name) return { ok: true, changed: true, collectorName: null, notified: false }

  let notified = false
  const to = s.vendor.poEmail ?? s.vendor.email
  const vehicleName = s.subcontractedVehicle?.name ?? s.itemDescription
  if (to && s.vendorToken && s.startDate && s.endDate) {
    const notice = buildVendorCollectorNotice({
      vendorName: s.vendor.name,
      vehicleName,
      collectorName: name,
      startDate: s.startDate.toISOString().slice(0, 10),
      endDate: s.endDate.toISOString().slice(0, 10),
      reference: s.job?.jobCode ?? null,
      vendorUrl: `${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}`,
      agentName: 'Team SirReel',
      changed: !!s.collectorName,
    })
    const res = await sendPartnerMail({
      to: [to],
      cc: await vendorBookingCc(prisma, s.vendor.id, [to]),
      subject: notice.subject,
      html: notice.html,
      text: notice.text,
      label: 'sub-rental-collector',
      orderId: s.orderId ?? undefined,
    }).catch(() => ({ ok: false as const }))
    if (res.ok) {
      notified = true
      await prisma.subRental.update({ where: { id: s.id }, data: { collectorNotifiedAt: new Date() } })
    }
  }
  void textPartnerAboutBooking(s.id, 'collector')
  return { ok: true, changed: true, collectorName: name, notified }
}
