/**
 * Shared driver-invite core. ONE code path for all three entry points —
 * production client (from their portal job page), sales agent, and
 * warehouse/fleet (from the board) — so the three can't drift.
 *
 * Email is the identity: drivers are matched on it, and a driver who has
 * worked before keeps their file (and their licence) instead of becoming
 * a duplicate. That's the whole reason the entry is an email box rather
 * than a name.
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

const LINK_TTL_DAYS = 45

export interface InviteDriverArgs {
  bookingAssignmentId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  /** STAFF when an HQ user did it; CLIENT from the production's portal. */
  source: 'STAFF' | 'CLIENT'
  invitedByUserId?: string | null
}

export interface InviteDriverResult {
  driverId: string
  driverAssignmentId: string
  url: string
  emailResult: EmailResult
  /** True when we still need a licence from them. */
  needsLicense: boolean
}

export async function inviteDriver(args: InviteDriverArgs): Promise<InviteDriverResult> {
  const email = (args.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required')
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: args.bookingAssignmentId },
    select: {
      id: true, startDate: true,
      asset: { select: { unitName: true, category: { select: { name: true } } } },
      bookingItem: {
        select: {
          booking: {
            select: { jobName: true, company: { select: { name: true } } },
          },
        },
      },
    },
  })
  if (!assignment) throw new Error('That vehicle reservation could not be found')

  // Match an existing driver on email so a repeat driver keeps their file.
  let driver = await prisma.driver.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: {
      id: true, firstName: true,
      licenseFrontUrl: true, licenseBackUrl: true,
      licenseExpiry: true, licenseExpired: true, licenseVerified: true,
    },
  })
  if (!driver) {
    const first = (args.firstName || '').trim() || email.split('@')[0]
    const last = (args.lastName || '').trim() || '—'
    driver = await prisma.driver.create({
      data: {
        firstName: first, lastName: last, email,
        phone: args.phone ? String(args.phone).trim().slice(0, 30) : null,
        type: 'EXTERNAL',
      },
      select: {
        id: true, firstName: true,
        licenseFrontUrl: true, licenseBackUrl: true,
        licenseExpiry: true, licenseExpired: true, licenseVerified: true,
      },
    })
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
      emailSentTo: email,
      invitedBySource: args.source,
      invitedByUserId: args.invitedByUserId ?? null,
      invitedAt: new Date(),
    },
    create: {
      driverId: driver.id,
      bookingAssignmentId: assignment.id,
      token, expiresAt,
      emailSentTo: email,
      invitedBySource: args.source,
      invitedByUserId: args.invitedByUserId ?? null,
    },
    select: { id: true },
  })

  const base = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://tsx.sirreel.com'
  const url = `${base}/drive/${token}`
  const booking = assignment.bookingItem.booking

  const mail = buildDriverAssignmentEmail({
    driverFirstName: driver.firstName,
    unitName: assignment.asset.unitName,
    unitDescription: assignment.asset.category?.name ?? null,
    productionName: booking.jobName,
    companyName: booking.company?.name ?? null,
    pickupDate: assignment.startDate.toISOString().slice(0, 10),
    jobLink: url,
    needsLicense,
  })

  const emailResult = await sendAgreementEmail({
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })

  return { driverId: driver.id, driverAssignmentId: da.id, url, emailResult, needsLicense }
}
