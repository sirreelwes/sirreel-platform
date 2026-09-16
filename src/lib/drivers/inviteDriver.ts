/**
 * Shared driver-invite core. ONE code path for all three entry points —
 * production client (from their portal job page), sales agent, and
 * warehouse/fleet (from the board) — so the three can't drift.
 *
 * Email is the identity WHEN THERE IS ONE: drivers are matched on it, and
 * a driver who has worked before keeps their file (and their licence)
 * instead of becoming a duplicate.
 *
 * A driver can also be onboarded by TEXT (Wes 2026-09-15). Half the
 * roster has no email on file and a rep at the gate rarely has one, but
 * everybody has a phone — and a blind pickup needs the driver ON their
 * own page (that is where the licence, the gate code and the self
 * check-out live). So `channel: 'SMS'` takes a phone instead, matches the
 * roster on the number, and the driver types their own email on the page
 * when they get there. Identity falls back to the phone for exactly the
 * same reason email is used: so the second job finds the first file.
 *
 * Re-inviting the same driver for the same vehicle REFRESHES the existing
 * row rather than creating a second one (see the composite unique) — a
 * client clicking twice shouldn't produce two links.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail, type EmailResult } from '@/lib/email/sendAgreementEmail'
import { buildDriverAssignmentEmail } from '@/lib/email/templates/driverAssignment'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'
import { sendTracked } from '@/lib/sms/threads'
import { toE164 } from '@/lib/sms/sendSms'
import { buildDriverAssignmentSms } from '@/lib/sms/templates/driverAssignmentSms'

const LINK_TTL_DAYS = 45

export type InviteChannel = 'EMAIL' | 'SMS'

export interface InviteDriverArgs {
  bookingAssignmentId: string
  /** Required on the EMAIL channel; optional on SMS. */
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  /** Required on the SMS channel. */
  phone?: string | null
  /** How the link travels. Default EMAIL — every existing caller. */
  channel?: InviteChannel
  /** STAFF when an HQ user did it; CLIENT from the production's portal. */
  source: 'STAFF' | 'CLIENT'
  invitedByUserId?: string | null
}

export interface InviteDriverResult {
  driverId: string
  driverAssignmentId: string
  url: string
  channel: InviteChannel
  /** Null on the SMS channel. */
  emailResult: EmailResult | null
  /** Null on the EMAIL channel. `status` is sendTracked's (queued,
   *  skipped-opted-out, skipped-unconfigured, failed…). */
  smsResult: { ok: boolean; status: string; error?: string } | null
  /** The address or number the link actually went to — for the caller's
   *  message and for the audit trail. */
  sentTo: string
  /** True when we still need a licence from them. */
  needsLicense: boolean
}

/**
 * Find a driver by phone, comparing NORMALISED numbers.
 *
 * Driver.phone is stored as typed ("(310) 555-1234", "310-555-1234",
 * "+13105551234" all exist), so an equality match on E.164 finds barely
 * any of them. The candidate set is narrowed in SQL by the last four
 * digits — which survives every format — and compared properly in JS.
 * The roster is small (tens); if it ever isn't, store a normalised
 * column rather than widening this.
 */
async function findDriverByPhone(e164: string) {
  const last4 = e164.slice(-4)
  const candidates = await prisma.driver.findMany({
    where: { phone: { endsWith: last4 } },
    select: {
      id: true, firstName: true, phone: true, email: true,
      licenseFrontUrl: true, licenseBackUrl: true,
      licenseExpiry: true, licenseExpired: true, licenseVerified: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  return candidates.find((d) => d.phone && toE164(d.phone) === e164) ?? null
}

export async function inviteDriver(args: InviteDriverArgs): Promise<InviteDriverResult> {
  const channel: InviteChannel = args.channel ?? 'EMAIL'
  const email = (args.email || '').trim().toLowerCase()
  const phone = toE164(args.phone || '')

  if (channel === 'EMAIL') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('A valid email address is required')
    }
  } else {
    if (!phone) throw new Error('A valid mobile number is required to text the link')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('That email address does not look right')
    }
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: args.bookingAssignmentId },
    select: {
      id: true, startDate: true,
      asset: { select: { unitName: true, category: { select: { name: true } } } },
      bookingItem: {
        select: {
          booking: {
            select: { jobId: true, jobName: true, company: { select: { name: true } } },
          },
        },
      },
    },
  })
  if (!assignment) throw new Error('That vehicle reservation could not be found')

  const DRIVER_FILE = {
    id: true, firstName: true, phone: true, email: true,
    licenseFrontUrl: true, licenseBackUrl: true,
    licenseExpiry: true, licenseExpired: true, licenseVerified: true,
  } as const

  // Match an existing driver so a repeat driver keeps their file (and
  // their licence). Email first when we have one; otherwise the number.
  let driver = email
    ? await prisma.driver.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: DRIVER_FILE,
      })
    : null
  if (!driver && phone) driver = await findDriverByPhone(phone)
  if (!driver) {
    const first = (args.firstName || '').trim() || (email ? email.split('@')[0] : 'Driver')
    // Empty, not a placeholder glyph: every display site composes
    // `${firstName} ${lastName}`.trim(), so '' disappears cleanly while
    // '—' shows up as "Wes —" in the roster.
    const last = (args.lastName || '').trim()
    driver = await prisma.driver.create({
      data: {
        firstName: first, lastName: last,
        email: email || null,
        phone: phone ?? (args.phone ? String(args.phone).trim().slice(0, 30) : null),
        type: 'EXTERNAL',
      },
      select: DRIVER_FILE,
    })
  } else {
    // A file found by one channel learns the other — the number we just
    // texted, or an email typed on a later invite. Never overwritten: the
    // driver's own entry on their page wins over an agent's guess.
    const learn: { phone?: string; email?: string } = {}
    if (phone && !driver.phone) learn.phone = phone
    if (email && !driver.email) learn.email = email
    if (Object.keys(learn).length) {
      driver = await prisma.driver.update({ where: { id: driver.id }, data: learn, select: DRIVER_FILE })
    }
  }

  const gate = evaluateLicenseGate(driver)
  const needsLicense = !gate.ok

  const token = randomUUID()
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
  const da = await prisma.driverAssignment.upsert({
    where: {
      driverId_bookingAssignmentId: {
        driverId: driver.id,
        bookingAssignmentId: assignment.id,
      },
    },
    // Re-invite refreshes the link and resets the clock, but keeps the row
    // (and therefore any history) rather than stacking duplicates.
    update: {
      token, expiresAt, status: 'INVITED',
      emailSentTo: email || null,
      smsSentTo: channel === 'SMS' ? phone : null,
      invitedBySource: args.source,
      invitedByUserId: args.invitedByUserId ?? null,
      invitedAt: new Date(),
    },
    create: {
      driverId: driver.id,
      bookingAssignmentId: assignment.id,
      token, expiresAt,
      emailSentTo: email || null,
      smsSentTo: channel === 'SMS' ? phone : null,
      invitedBySource: args.source,
      invitedByUserId: args.invitedByUserId ?? null,
    },
    select: { id: true },
  })

  const base = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://tsx.sirreel.com'
  const url = `${base}/drive/${token}`
  const booking = assignment.bookingItem.booking

  // Unattended pickup? Then the email should say so up front — the page
  // carries the gate and lockbox codes and the driver's own check-out
  // step, and a driver who expects to be met will not look for them.
  const unattendedPickup = booking.jobId
    ? !!(await prisma.order.findFirst({
        where: { jobId: booking.jobId, status: { not: 'CANCELLED' }, blindPickup: true },
        select: { id: true },
      }))
    : false

  // ── SMS channel: the text carries the same three facts the email
  //    opens with (unit, production, date) and the same link. Short by
  //    design — a carrier-registered message with one URL, and
  //    sendTracked appends the STOP line and logs the row. `staff`
  //    because a human pressed the button: a 5am pickup invite must not
  //    be held until quiet hours end.
  if (channel === 'SMS' && phone) {
    const smsResult = await sendTracked({
      to: phone,
      body: buildDriverAssignmentSms({
        driverFirstName: driver.firstName,
        unitName: assignment.asset.unitName,
        productionName: booking.jobName,
        pickupDate: assignment.startDate.toISOString().slice(0, 10),
        jobLink: url,
        needsLicense,
        unattendedPickup,
      }),
      source: 'staff',
      jobId: booking.jobId ?? null,
      driverAssignmentId: da.id,
      sentById: args.invitedByUserId ?? null,
    })
    return {
      driverId: driver.id,
      driverAssignmentId: da.id,
      url,
      channel,
      emailResult: null,
      smsResult,
      sentTo: phone,
      needsLicense,
    }
  }

  const mail = buildDriverAssignmentEmail({
    driverFirstName: driver.firstName,
    unitName: assignment.asset.unitName,
    unitDescription: assignment.asset.category?.name ?? null,
    productionName: booking.jobName,
    companyName: booking.company?.name ?? null,
    pickupDate: assignment.startDate.toISOString().slice(0, 10),
    jobLink: url,
    needsLicense,
    unattendedPickup,
  })

  const emailResult = await sendAgreementEmail({
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // Labelled so driver invites are filterable in EmailDelivery next to
    // portal/invite and the rest — an unlabelled row is invisible when
    // someone asks "did the driver ever get their link?".
    label: 'driver/assignment',
  })

  return {
    driverId: driver.id,
    driverAssignmentId: da.id,
    url,
    channel,
    emailResult,
    smsResult: null,
    sentTo: email,
    needsLicense,
  }
}
