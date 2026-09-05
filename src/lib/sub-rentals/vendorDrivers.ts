/**
 * The partner's driver roster (VendorDriver) — add by email, the driver
 * fills in the rest, the partner assigns one to a booking.
 *
 * Wes 2026-09-05: "We need an 'Add driver' for vendor portal. They enter the
 * driver's email and it sends a link to the driver to fill out. Ideally,
 * Name, phone, email, picture of driver's license, as well as what vehicles
 * they are trained to drive for that vendor." And: "When vendor sees a job in
 * the portal they can assign driver to that vehicle for that job only."
 *
 * Three surfaces share this module:
 *   · the vendor page — roster list, Add driver, Assign to this job, Resend
 *   · /drive/profile/[token] — the driver's own form
 *   · HQ — read-only, plus the authed licence proxy
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { portalBaseUrl } from '@/lib/portal/portalUrl'
import { uploadLicenseImage, type LicenseSide } from '@/lib/drivers/uploadLicenseImage'
import { assignDriver } from '@/lib/sub-rentals/driverRelay'
import { LOGISTICS_LIVE, notifyDriverAssigned, vendorPageUrl } from '@/lib/sub-rentals/conduit'

// ── Pure ─────────────────────────────────────────────────────────────────────

export interface ProfileFacts {
  firstName: string | null
  phone: string | null
  licenseFrontUrl: string | null
  licenseBackUrl: string | null
}

/** Name, a number, and both sides of the licence. Trained vehicles are
 *  useful but not required — a new hire may be trained on nothing yet. */
export function isProfileComplete(f: ProfileFacts): boolean {
  return !!(f.firstName?.trim() && f.phone?.trim() && f.licenseFrontUrl && f.licenseBackUrl)
}

export function driverDisplayName(d: { firstName: string | null; lastName: string | null; email: string }): string {
  return [d.firstName, d.lastName].map((x) => x?.trim()).filter(Boolean).join(' ') || d.email
}

export function profilePagePath(token: string): string {
  return `/drive/profile/${token}`
}
export function profilePageUrl(token: string): string {
  return `${portalBaseUrl()}${profilePagePath(token)}`
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Roster view (what the vendor page + HQ render) ───────────────────────────

export interface RosterDriver {
  id: string
  email: string
  name: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  invitedAt: string | null
  profileViewedAt: string | null
  profileCompletedAt: string | null
  licenseFront: boolean
  licenseBack: boolean
  trainedVehicles: { id: string; name: string }[]
  /** True when the roster is being read for a booking of this unit. */
  trainedOnThisUnit: boolean
}

export async function rosterForVendor(vendorId: string, unitVehicleId: string | null): Promise<RosterDriver[]> {
  const rows = await prisma.vendorDriver.findMany({
    where: { vendorId, isActive: true },
    orderBy: [{ profileCompletedAt: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true,
      invitedAt: true, profileViewedAt: true, profileCompletedAt: true,
      licenseFrontUrl: true, licenseBackUrl: true,
      trainedVehicles: { select: { id: true, name: true } },
    },
  })
  return rows.map((d) => ({
    id: d.id,
    email: d.email,
    name: driverDisplayName(d),
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
    invitedAt: d.invitedAt?.toISOString() ?? null,
    profileViewedAt: d.profileViewedAt?.toISOString() ?? null,
    profileCompletedAt: d.profileCompletedAt?.toISOString() ?? null,
    licenseFront: !!d.licenseFrontUrl,
    licenseBack: !!d.licenseBackUrl,
    trainedVehicles: d.trainedVehicles,
    trainedOnThisUnit: !!unitVehicleId && d.trainedVehicles.some((v) => v.id === unitVehicleId),
  }))
}

// ── Templates ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** To the DRIVER: the partner added you — fill in your profile. */
export function buildVendorDriverInvite(a: { vendorName: string; driverName: string | null; profileUrl: string; resend: boolean }) {
  const first = a.driverName?.split(/\s+/)[0]
  const greet = first ? `${first} —` : 'Hi —'
  const subject = a.resend ? `Your driver profile for ${a.vendorName} — link` : `Complete your driver profile for ${a.vendorName}`
  const html = renderEmailShell({
    eyebrow: 'Driver profile',
    heading: `${a.vendorName} added you as a driver`,
    preheader: 'Takes about two minutes from your phone',
    bodyHtml: [
      p(`${esc(greet)} <strong>${esc(a.vendorName)}</strong> has listed you as one of their drivers for jobs booked through SirReel.`),
      p(`Before your first run we need a few things from you, all on one page:`),
      detailTable([
        { label: 'Your details', value: 'Name and a mobile number' },
        { label: 'Licence', value: 'A photo of the front and back' },
        { label: 'Vehicles', value: `Which of ${a.vendorName}’s units you’re trained to drive` },
      ]),
      calloutBox(`Once it’s done, ${esc(a.vendorName)} can assign you to a job and you’ll get a separate page for each one with the location, call time and a place to log your hours.`),
    ].join('\n'),
    cta: { label: 'Complete your profile', href: a.profileUrl },
    footNote: 'This link is personal to you. Please don’t forward it.',
  })
  const text = renderEmailText([
    `${greet} ${a.vendorName} has listed you as one of their drivers for jobs booked through SirReel.`,
    '',
    'Before your first run we need, on one page: your name and mobile, a photo of both sides of your licence,',
    `and which of ${a.vendorName}'s units you're trained to drive.`,
    '',
    a.profileUrl,
    '',
    'This link is personal to you. Please don’t forward it.',
  ])
  return { subject, html, text }
}

/** To the PARTNER: their driver finished the profile. */
export function buildProfileCompleteForVendor(a: {
  vendorName: string
  driverName: string
  phone: string | null
  trainedVehicles: string[]
  vendorUrl: string | null
}) {
  const subject = `${a.driverName} completed their driver profile`
  const rows = [
    { label: 'Driver', value: a.driverName },
    ...(a.phone ? [{ label: 'Mobile', value: a.phone }] : []),
    { label: 'Licence', value: 'Front and back on file' },
    { label: 'Trained on', value: a.trainedVehicles.length ? a.trainedVehicles.join(', ') : 'Nothing ticked yet' },
  ]
  const html = renderEmailShell({
    eyebrow: 'Driver roster',
    heading: `${a.driverName} is ready to assign`,
    bodyHtml: [
      p(`Hi ${esc(a.vendorName)} — <strong>${esc(a.driverName)}</strong> has completed their driver profile.`),
      detailTable(rows),
      p(`You can now assign them to a booking from that booking’s page.`),
    ].join('\n'),
    cta: a.vendorUrl ? { label: 'Open your bookings', href: a.vendorUrl } : undefined,
  })
  const text = renderEmailText([
    `Hi ${a.vendorName} — ${a.driverName} has completed their driver profile.`,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    'You can now assign them to a booking from that booking’s page.',
    ...(a.vendorUrl ? ['', a.vendorUrl] : []),
  ])
  return { subject, html, text }
}

async function cc(exclude: string[]): Promise<string[] | undefined> {
  const list = await channelRecipients('sub-rental-conduit-cc')
  const skip = new Set(exclude.map((e) => e.toLowerCase()))
  const out = list.filter((e) => e && !skip.has(e.toLowerCase()))
  return out.length ? out : undefined
}

// ── Add / resend ─────────────────────────────────────────────────────────────

export async function addVendorDriver(args: {
  vendorId: string
  email: string
  name?: string | null
}): Promise<{ ok: true; driverId: string; invited: boolean; existed: boolean } | { ok: false; error: string }> {
  const email = args.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'A valid email address is needed.' }
  const nameParts = (args.name ?? '').trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? null
  const lastName = nameParts.slice(1).join(' ') || null

  const existing = await prisma.vendorDriver.findUnique({
    where: { vendorId_email: { vendorId: args.vendorId, email } },
    select: { id: true, profileToken: true, firstName: true, lastName: true, isActive: true },
  })
  const token = existing?.profileToken ?? randomBytes(32).toString('hex')
  const row = existing
    ? await prisma.vendorDriver.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          // Only fill a name the partner typed into a blank; never overwrite what the driver entered.
          firstName: existing.firstName ?? firstName,
          lastName: existing.lastName ?? lastName,
          profileToken: token,
          profileTokenMintedAt: existing.profileToken ? undefined : new Date(),
          invitedAt: new Date(),
        },
        select: { id: true, firstName: true, lastName: true, email: true, vendor: { select: { name: true } } },
      })
    : await prisma.vendorDriver.create({
        data: { vendorId: args.vendorId, email, firstName, lastName, profileToken: token, profileTokenMintedAt: new Date(), invitedAt: new Date() },
        select: { id: true, firstName: true, lastName: true, email: true, vendor: { select: { name: true } } },
      })

  const mail = buildVendorDriverInvite({
    vendorName: row.vendor.name,
    driverName: row.firstName ? driverDisplayName(row) : null,
    profileUrl: profilePageUrl(token),
    resend: !!existing,
  })
  const res = await sendAgreementEmail({
    to: [email],
    cc: await cc([email]),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: 'vendor-driver/invite',
  }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
  if (!res.ok) console.warn('[vendorDrivers] invite not sent:', email, res.reason)

  return { ok: true, driverId: row.id, invited: res.ok, existed: !!existing }
}

// ── Assign to this booking ───────────────────────────────────────────────────

/**
 * The vendor picks a roster driver for THIS sub-rental. Snapshots name /
 * email / phone onto the row (every existing reader uses those), links the
 * roster id, mints the relay address, and runs the conduit fan-out (driver
 * page + production notice).
 */
export async function assignRosterDriver(subRentalId: string, vendorDriverId: string): Promise<
  | { ok: true; driverName: string; relayAddress: string; driverMailed: boolean; productionMailed: number }
  | { ok: false; error: string }
> {
  const sub = await prisma.subRental.findUnique({ where: { id: subRentalId }, select: { vendorId: true, status: true } })
  if (!sub) return { ok: false, error: 'Booking not found.' }
  if (sub.status === 'CANCELLED') return { ok: false, error: 'This booking has been cancelled.' }
  const d = await prisma.vendorDriver.findFirst({
    where: { id: vendorDriverId, vendorId: sub.vendorId, isActive: true },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true },
  })
  // Scoped to the booking's vendor: a guessed id from another partner's roster is a 404, not a leak.
  if (!d) return { ok: false, error: 'That driver is not on your roster.' }

  const res = await assignDriver({
    subRentalId,
    driverName: driverDisplayName(d),
    driverEmail: d.email,
    driverPhone: d.phone,
  })
  if ('error' in res) return { ok: false, error: res.error }
  await prisma.subRental.update({ where: { id: subRentalId }, data: { vendorDriverId: d.id } })

  const fanout = await notifyDriverAssigned(subRentalId).catch((err) => {
    console.warn('[vendorDrivers] fan-out failed:', err instanceof Error ? err.message : err)
    return { driverUrl: null, driverMailed: false, productionMailed: 0 }
  })
  return { ok: true, driverName: res.driverName, relayAddress: res.relayAddress, driverMailed: fanout.driverMailed, productionMailed: fanout.productionMailed }
}

// ── The driver's own profile page ────────────────────────────────────────────

const PROFILE_SELECT = {
  id: true, vendorId: true, email: true, firstName: true, lastName: true, phone: true,
  licenseFrontUrl: true, licenseBackUrl: true, licenseUploadedAt: true,
  profileViewedAt: true, profileCompletedAt: true, isActive: true,
  trainedVehicles: { select: { id: true } },
  vendor: {
    select: {
      name: true, email: true, poEmail: true,
      subcontractedVehicles: { where: { isActive: true }, orderBy: { name: 'asc' as const }, select: { id: true, name: true, vehicleType: true } },
    },
  },
} as const

export async function vendorDriverByProfileToken(token: string) {
  if (!token || token.length < 32) return null
  const row = await prisma.vendorDriver.findFirst({ where: { profileToken: token }, select: PROFILE_SELECT })
  return row && row.isActive ? row : null
}

export interface ProfileView {
  vendorName: string
  email: string
  firstName: string
  lastName: string
  phone: string
  license: { front: boolean; back: boolean }
  vehicles: { id: string; name: string; vehicleType: string | null; trained: boolean }[]
  complete: boolean
  completedAt: string | null
}

export function profileViewOf(row: NonNullable<Awaited<ReturnType<typeof vendorDriverByProfileToken>>>): ProfileView {
  const trained = new Set(row.trainedVehicles.map((v) => v.id))
  return {
    vendorName: row.vendor.name,
    email: row.email,
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
    phone: row.phone ?? '',
    license: { front: !!row.licenseFrontUrl, back: !!row.licenseBackUrl },
    vehicles: row.vendor.subcontractedVehicles.map((v) => ({ ...v, trained: trained.has(v.id) })),
    complete: isProfileComplete(row),
    completedAt: row.profileCompletedAt?.toISOString() ?? null,
  }
}

/**
 * Save the text half of the profile. Trained vehicles are replaced
 * wholesale with what was ticked (scoped to the vendor's own roster of
 * units — an id from another vendor's fleet is dropped, not saved).
 */
export async function saveProfile(
  vendorDriverId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const str = (k: string, max: number) => {
    const v = body[k]
    if (v === undefined) return undefined
    if (v !== null && typeof v !== 'string') return null
    return (v ?? '').toString().trim().slice(0, max) || null
  }
  const firstName = str('firstName', 60)
  const lastName = str('lastName', 60)
  const phone = str('phone', 30)
  if (firstName === null && 'firstName' in body) return { ok: false, error: 'Your first name is needed.' }
  if (phone === null && 'phone' in body) return { ok: false, error: 'A mobile number is needed.' }

  const data: Record<string, unknown> = {}
  if (firstName !== undefined) data.firstName = firstName
  if (lastName !== undefined) data.lastName = lastName
  if (phone !== undefined) data.phone = phone

  if (Array.isArray(body.trainedVehicleIds)) {
    const wanted = body.trainedVehicleIds.filter((x): x is string => typeof x === 'string')
    const me = await prisma.vendorDriver.findUnique({ where: { id: vendorDriverId }, select: { vendorId: true } })
    const allowed = await prisma.subcontractedVehicle.findMany({
      where: { vendorId: me?.vendorId ?? '', id: { in: wanted } },
      select: { id: true },
    })
    data.trainedVehicles = { set: allowed.map((v) => ({ id: v.id })) }
  }

  await prisma.vendorDriver.update({ where: { id: vendorDriverId }, data })
  await afterProfileChange(vendorDriverId)
  return { ok: true }
}

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = ['jpeg', 'png', 'webp', 'heic', 'heif']

export async function saveProfileLicense(
  vendorDriverId: string,
  side: LicenseSide,
  file: File,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const type = file.type || 'application/octet-stream'
  if (!ALLOWED.some((t) => type.includes(t))) return { ok: false, error: 'Please upload a photo (JPG, PNG or HEIC).', status: 400 }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'That photo is too large — please upload one under 12MB.', status: 400 }
  // Reuses the Driver licence uploader: same private store, own prefix via the id.
  const up = await uploadLicenseImage({
    driverId: `vendor-${vendorDriverId}`,
    side,
    filename: file.name || `license-${side}`,
    contentType: type,
    data: Buffer.from(bytes),
  })
  await prisma.vendorDriver.update({
    where: { id: vendorDriverId },
    data:
      side === 'front'
        ? { licenseFrontKey: up.blobKey, licenseFrontUrl: up.fileUrl, licenseFrontMimeType: type, licenseUploadedAt: new Date() }
        : { licenseBackKey: up.blobKey, licenseBackUrl: up.fileUrl, licenseBackMimeType: type, licenseUploadedAt: new Date() },
  })
  await afterProfileChange(vendorDriverId)
  return { ok: true }
}

/**
 * After any profile write: refresh the snapshot on live bookings this
 * driver is assigned to, and — the first time the profile is whole — stamp
 * it and tell the partner.
 */
async function afterProfileChange(vendorDriverId: string): Promise<void> {
  const d = await prisma.vendorDriver.findUnique({
    where: { id: vendorDriverId },
    select: {
      id: true, vendorId: true, email: true, firstName: true, lastName: true, phone: true,
      licenseFrontUrl: true, licenseBackUrl: true, profileCompletedAt: true,
      trainedVehicles: { select: { name: true } },
      vendor: { select: { name: true, email: true, poEmail: true } },
    },
  })
  if (!d) return

  // Snapshot sync — the production's portal and the vendor page read these.
  await prisma.subRental.updateMany({
    where: { vendorDriverId: d.id, status: { in: [...LOGISTICS_LIVE] } },
    data: { driverName: driverDisplayName(d), driverPhone: d.phone },
  })

  if (d.profileCompletedAt || !isProfileComplete(d)) return
  await prisma.vendorDriver.update({ where: { id: d.id }, data: { profileCompletedAt: new Date() } })

  const to = d.vendor.poEmail ?? d.vendor.email
  if (!to) return
  const latest = await prisma.subRental.findFirst({
    where: { vendorId: d.vendorId, vendorToken: { not: null }, status: { in: [...LOGISTICS_LIVE, 'ESTIMATED'] } },
    orderBy: { vendorTokenMintedAt: 'desc' },
    select: { vendorToken: true },
  })
  const mail = buildProfileCompleteForVendor({
    vendorName: d.vendor.name,
    driverName: driverDisplayName(d),
    phone: d.phone,
    trainedVehicles: d.trainedVehicles.map((v) => v.name),
    vendorUrl: latest?.vendorToken ? vendorPageUrl(latest.vendorToken) : null,
  })
  await sendAgreementEmail({
    to: [to],
    cc: await cc([to]),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: 'vendor-driver/profile-complete',
  }).catch((err: unknown) => console.warn('[vendorDrivers] completion notice failed:', err instanceof Error ? err.message : err))
}
