/**
 * What a partner can DO from their account page, and what staff do in
 * response. Companion to vendorAccount.ts (which only reads).
 *
 * Wes 2026-09-05: "The KK portal should have things like their logo,
 * contact info, a vehicle list that is available to SirReel for sublease,
 * a place to change the rates on those vehicles… job tiles, with alerts for
 * things that are missing… a contract of some sort between KK and SirReel
 * and all other vendors."
 *
 * Three rules that shape this file:
 *   1. A rate change is a PROPOSAL. We quote clients off the partner's list
 *      rate and our discount, so a partner raising cost is a margin
 *      decision — it sits on the unit as proposed* until staff accept.
 *   2. The partner agreement is THEIR signature on OUR document. Staff
 *      upload the PDF (the terms are Wes's, not generated); signing appends
 *      a signature page and stores the executed copy beside the original.
 *   3. Every partner action lands one line in the vendor-portal channel.
 */

import { randomUUID } from 'crypto'
import { del, get as getBlob, put } from '@vercel/blob'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { shouldNotifyHq } from '@/lib/sub-rentals/partnerPhotos'
import { MAX_PROPOSED_RATE } from '@/lib/sub-rentals/rateProposalInput'
import {
  addVendorContact,
  listVendorContacts,
  removeVendorContact,
  updateVendorContactRow,
  type VendorContactInput,
} from '@/lib/sub-rentals/vendorContacts'
import {
  maskEmail,
  needsMailRoutingCode,
  partnerActionCode,
  PARTNER_CODE_TTL_MINUTES,
  verifyPartnerActionCode,
} from '@/lib/sub-rentals/partnerActionCode'

async function tellHq(subject: string, line: string, href: string): Promise<void> {
  const to = await channelRecipients('vendor-portal')
  if (to.length === 0) return
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  await sendAgreementEmail({
    to,
    subject,
    html: `<p>${line}</p><p><a href="${base}${href}">${base}${href}</a></p>`,
    text: `${line}\n\n${base}${href}`,
    label: 'vendor-portal',
  }).catch(() => null)
}

/**
 * Tell the PARTNER, at the address already on file, that something changed on
 * their page. Wes 2026-09-11, on the account link being forwardable: "Is this
 * a danger, a loop we should close?" HQ was already told about every change;
 * nobody at the partner was, so a stranger acting looked like nothing at all.
 * Now it lands in their own inbox, with what to do if it wasn't them.
 */
async function tellPartner(vendorId: string, subject: string, line: string, alsoTo: (string | null)[] = []): Promise<void> {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { email: true } })
  const to = [v?.email ?? null, ...alsoTo]
    .map((e) => (e ?? '').trim().toLowerCase())
    .filter((e, i, a) => e && a.indexOf(e) === i)
  if (to.length === 0) return
  const foot =
    'If this wasn’t you or someone at your company, reply to this email — we’ll issue a new page link and the old one stops working.'
  await sendAgreementEmail({
    to,
    subject,
    html: `<p>${line}</p><p>${foot}</p>`,
    text: `${line}\n\n${foot}`,
    label: 'vendor-portal-partner-notice',
  }).catch(() => null)
}

/**
 * Email the partner a short code, at the address already on file, for a change
 * that would move where their mail goes. The code proves the person asking can
 * read the inbox SirReel already writes to — the one thing a forwarded link
 * cannot do. Returns the masked address, so the page can say where it went.
 */
export async function sendPartnerActionCode(vendorId: string): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true, email: true } })
  const to = v?.email?.trim().toLowerCase()
  if (!to) return { ok: false, error: 'There is no email on file for your company yet — ask SirReel to add one.' }
  const code = partnerActionCode(vendorId, 'mail-routing')
  const line = `Someone asked to change where SirReel’s mail for ${v!.name} goes. The code is ${code}. It is good for about ${PARTNER_CODE_TTL_MINUTES} minutes.`
  await sendAgreementEmail({
    to: [to],
    subject: `Your code: ${code}`,
    html: `<p>${line}</p><p>If you didn’t ask for this, ignore it — nothing changes without the code.</p>`,
    text: `${line}\n\nIf you didn't ask for this, ignore it — nothing changes without the code.`,
    label: 'vendor-portal-action-code',
  }).catch(() => null)
  return { ok: true, sentTo: maskEmail(to) }
}

/** Resolve a partner from their account token. Null on any miss. */
export async function vendorByToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!token || token.length < 32) return null
  const v = await prisma.vendor.findUnique({ where: { portalToken: token }, select: { id: true, name: true, isActive: true } })
  return v && v.isActive ? { id: v.id, name: v.name } : null
}

// ── Contact ────────────────────────────────────────────────────────────

export async function updateVendorContact(
  vendorId: string,
  data: { contactName?: string | null; email?: string | null; phone?: string | null; lotAddress?: string | null },
): Promise<void> {
  const clean = (v: string | null | undefined, max: number) =>
    v === undefined ? undefined : (v ?? '').trim().slice(0, max) || null
  const patch = {
    contactName: clean(data.contactName, 120),
    email: clean(data.email, 200)?.toLowerCase(),
    phone: clean(data.phone, 30),
    lotAddress: clean(data.lotAddress, 400),
  }
  const before = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { email: true } })
  const v = await prisma.vendor.update({
    where: { id: vendorId },
    data: Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)),
    select: { name: true },
  })
  if (patch.email !== undefined && patch.email !== before?.email) {
    await tellPartner(
      vendorId,
      `The contact address for ${v.name} was changed`,
      `SirReel’s mail for ${v.name} now goes to ${patch.email ?? '(cleared)'}. It was changed from your partner page.`,
      [before?.email ?? null],
    )
  }
  await tellHq(
    `${v.name} updated their contact details`,
    `${v.name} changed their contact details from their partner page: ${Object.entries(patch)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${k} → ${val ?? '(cleared)'}`)
      .join('; ')}.`,
    '/crm/portals#partners',
  )
}

// ── Contacts ───────────────────────────────────────────────────────────
//
// The partner's own list of people (Wes 2026-09-11: "I need to be able to add
// people on the partner portal. owners and others"). Same rules and same table
// as the HQ side — lib/sub-rentals/vendorContacts.ts — with HQ told whenever
// the partner changes it, exactly as a contact-details edit is announced.

export async function partnerListContacts(vendorId: string) {
  return listVendorContacts(prisma, vendorId)
}

export async function partnerAddContact(vendorId: string, vendorName: string, input: VendorContactInput, code?: unknown) {
  // Adding a person is one click. Pointing SirReel's mail at them is not:
  // that needs the code we email to the address already on file.
  if (needsMailRoutingCode({ isPrimary: input.isPrimary === true, emailBookings: input.emailBookings === true })
      && !verifyPartnerActionCode(vendorId, 'mail-routing', code)) {
    return { ok: false as const, needsCode: true as const, error: 'Enter the code we email to the address on file — that is what moves where SirReel writes to you.' }
  }
  const r = await addVendorContact(prisma, vendorId, input, { byPartner: true })
  if (r.ok) {
    if (r.contact.isPrimary || r.contact.emailBookings) {
      await tellPartner(
        vendorId,
        `${r.contact.name} was added to ${vendorName}’s SirReel page`,
        `${r.contact.name} (${r.contact.email ?? 'no email'}) was added on your partner page.${r.contact.isPrimary ? ' They are now the main contact, so SirReel’s mail goes to them.' : ''}${r.contact.emailBookings ? ' They are copied on booking mail.' : ''}`,
      )
    }
    await tellHq(
      `${vendorName} added a contact: ${r.contact.name}`,
      `${vendorName} added ${r.contact.name} (${r.contact.roleLabel}) to their people on their partner page — ${r.contact.email ?? 'no email'}${r.contact.phone ? ` · ${r.contact.phone}` : ''}.${r.contact.isPrimary ? ' They are now the main contact, so partner mail goes to them.' : ''}${r.contact.emailBookings ? ' They asked to be copied on bookings.' : ''}`,
      '/crm/portals#partners',
    )
  }
  return r
}

export async function partnerUpdateContact(vendorId: string, vendorName: string, contactId: string, input: VendorContactInput, code?: unknown) {
  const current = await prisma.vendorContact.findFirst({ where: { id: contactId, vendorId }, select: { isPrimary: true, emailBookings: true } })
  if (needsMailRoutingCode(
        { isPrimary: input.isPrimary === true, emailBookings: input.emailBookings === true },
        { isPrimary: current?.isPrimary === true, emailBookings: current?.emailBookings === true },
      )
      && !verifyPartnerActionCode(vendorId, 'mail-routing', code)) {
    return { ok: false as const, needsCode: true as const, error: 'Enter the code we email to the address on file — that is what moves where SirReel writes to you.' }
  }
  const r = await updateVendorContactRow(prisma, vendorId, contactId, input)
  if (r.ok) {
    if ((r.contact.isPrimary && !current?.isPrimary) || (r.contact.emailBookings && !current?.emailBookings)) {
      await tellPartner(
        vendorId,
        `Where SirReel writes to ${vendorName} changed`,
        `${r.contact.name} (${r.contact.email ?? 'no email'}) was changed on your partner page.${r.contact.isPrimary && !current?.isPrimary ? ' They are now the main contact.' : ''}${r.contact.emailBookings && !current?.emailBookings ? ' They are now copied on booking mail.' : ''}`,
      )
    }
    await tellHq(
      `${vendorName} updated a contact: ${r.contact.name}`,
      `${vendorName} changed ${r.contact.name} (${r.contact.roleLabel}) on their partner page — ${r.contact.email ?? 'no email'}${r.contact.phone ? ` · ${r.contact.phone}` : ''}.${r.contact.isPrimary ? ' They are the main contact.' : ''}${r.contact.emailBookings ? ' Copied on bookings.' : ''}`,
      '/crm/portals#partners',
    )
  }
  return r
}

export async function partnerRemoveContact(vendorId: string, vendorName: string, contactId: string) {
  const gone = await prisma.vendorContact.findFirst({ where: { id: contactId, vendorId }, select: { name: true } })
  const r = await removeVendorContact(prisma, vendorId, contactId)
  if (r.ok) {
    await tellHq(
      `${vendorName} removed a contact${gone ? `: ${gone.name}` : ''}`,
      `${vendorName} took ${gone?.name ?? 'someone'} off their people on their partner page. The row is kept — who we used to email is history.`,
      '/crm/portals#partners',
    )
  }
  return r
}

// ── Rate proposals ─────────────────────────────────────────────────────

export interface RateProposalInput {
  daily?: number | null
  weekly?: number | null
  monthly?: number | null
  note?: string | null
}

export async function proposeUnitRates(vendorId: string, unitId: string, input: RateProposalInput): Promise<void> {
  const unit = await prisma.subcontractedVehicle.findFirst({
    // Only units offered to SirReel — the account page lists nothing else.
    where: { id: unitId, vendorId, offeredToSirReel: true },
    select: { id: true, name: true, listDailyRate: true, listWeeklyRate: true, listMonthlyRate: true, vendor: { select: { name: true } } },
  })
  if (!unit) throw Object.assign(new Error('unit not found'), { status: 404 })
  // The route validates first (rateProposalInput.ts); this is the backstop, so
  // an out-of-range number is a 400 here and never a Decimal(10,2) throw.
  const pos = (n: number | null | undefined) => {
    if (n == null) return null
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PROPOSED_RATE) throw Object.assign(new Error('Rates must be above $0 and no more than $1,000,000.'), { status: 400 })
    return Math.round(n * 100) / 100
  }
  const daily = pos(input.daily), weekly = pos(input.weekly), monthly = pos(input.monthly)
  if (daily == null && weekly == null && monthly == null) {
    throw Object.assign(new Error('Enter at least one rate.'), { status: 400 })
  }
  await prisma.subcontractedVehicle.update({
    where: { id: unit.id },
    data: {
      proposedDailyRate: daily,
      proposedWeeklyRate: weekly,
      proposedMonthlyRate: monthly,
      rateProposedAt: new Date(),
      rateProposalNote: (input.note ?? '').trim().slice(0, 500) || null,
    },
  })
  const fmt = (n: unknown) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US')}`)
  await tellHq(
    `${unit.vendor.name} proposed new rates on ${unit.name}`,
    `${unit.vendor.name} asked for new rates on ${unit.name}: daily ${fmt(daily)} (was ${fmt(unit.listDailyRate)}), weekly ${fmt(weekly)} (was ${fmt(unit.listWeeklyRate)}), monthly ${fmt(monthly)} (was ${fmt(unit.listMonthlyRate)}). Nothing has changed yet — accept or decline it on the Portals tab.`,
    '/crm/portals#partners',
  )
}

/** Staff: accept copies the proposal into the list rates; decline drops it. */
export async function resolveRateProposal(unitId: string, decision: 'accept' | 'decline'): Promise<void> {
  const u = await prisma.subcontractedVehicle.findUnique({
    where: { id: unitId },
    select: { proposedDailyRate: true, proposedWeeklyRate: true, proposedMonthlyRate: true },
  })
  if (!u) throw Object.assign(new Error('unit not found'), { status: 404 })
  await prisma.subcontractedVehicle.update({
    where: { id: unitId },
    data: {
      ...(decision === 'accept'
        ? {
            ...(u.proposedDailyRate != null && { listDailyRate: u.proposedDailyRate }),
            ...(u.proposedWeeklyRate != null && { listWeeklyRate: u.proposedWeeklyRate }),
            ...(u.proposedMonthlyRate != null && { listMonthlyRate: u.proposedMonthlyRate }),
          }
        : {}),
      proposedDailyRate: null,
      proposedWeeklyRate: null,
      proposedMonthlyRate: null,
      rateProposedAt: null,
      rateProposalNote: null,
    },
  })
}

// ── Marketing permission ───────────────────────────────────────────────

/**
 * The partner decides whether SirReel may offer a unit to clients (agreement
 * clause 10: revocable at any time). Withdrawing flips publiclyListed off,
 * which drops the unit from sirreel.com on the next render and from the
 * catalog photo proxy; re-allowing turns the flag back on, but the unit only
 * reaches the site if HQ has given it a slug and photos and the agreement is
 * signed — the partner's word is permission, not publication.
 */
export async function setUnitMarketing(vendorId: string, unitId: string, allowed: boolean): Promise<void> {
  const unit = await prisma.subcontractedVehicle.findFirst({ where: { id: unitId, vendorId, offeredToSirReel: true }, select: { id: true, name: true, publiclyListed: true, vendor: { select: { name: true } } } })
  if (!unit) throw Object.assign(new Error('unit not found'), { status: 404 })
  if (unit.publiclyListed === allowed) return
  await prisma.subcontractedVehicle.update({ where: { id: unit.id }, data: { publiclyListed: allowed } })
  await prisma.auditLog.create({
    data: { action: allowed ? 'sub_vehicle.marketing_allowed' : 'sub_vehicle.marketing_withdrawn', entityType: 'SubcontractedVehicle', entityId: unit.id, newValues: { publiclyListed: allowed, via: 'partner-page' } },
  }).catch(() => {})
  await tellHq(
    allowed ? `${unit.vendor.name} allows ${unit.name} to be marketed` : `${unit.vendor.name} withdrew ${unit.name} from marketing`,
    allowed
      ? `${unit.vendor.name} re-allowed SirReel to offer their ${unit.name} to clients. It returns to sirreel.com only if it has a slug and photos.`
      : `${unit.vendor.name} withdrew permission to market their ${unit.name}. It is off sirreel.com now; do not quote it to clients.`,
    '/crm/portals#partners',
  )
  await tellPartner(
    vendorId,
    allowed ? `${unit.name} was offered to SirReel’s clients` : `${unit.name} was withdrawn from SirReel’s clients`,
    allowed
      ? `Someone on your partner page allowed SirReel to offer your ${unit.name} to clients.`
      : `Someone on your partner page withdrew your ${unit.name} from SirReel’s client-facing listings.`,
  )
}

// ── Partner photos ─────────────────────────────────────────────────────

/**
 * A partner just put a photo on their unit. It is live already (Wes
 * 2026-09-11: "live at once, HQ notified"); this records WHO added it and
 * tells HQ once per burst, so someone glances at it and presses "Looks good"
 * or removes it from the roster page.
 *
 * Fails soft on purpose: the stamp needs the uploaded_by_partner_at column
 * (scripts/add-partner-photo-columns.ts). Until it exists the photo still
 * lands and the email still goes; only the action item stays quiet.
 */
export async function notePartnerPhotoAdded(args: { vendorId: string; vendorName: string; unitId: string; unitName: string; photoId: string }): Promise<void> {
  const now = new Date()
  let previous: Date | null = null
  try {
    const prev = await prisma.subcontractedVehiclePhoto.findFirst({
      where: { vehicleId: args.unitId, uploadedByPartnerAt: { not: null }, id: { not: args.photoId } },
      orderBy: { uploadedByPartnerAt: 'desc' },
      select: { uploadedByPartnerAt: true },
    })
    previous = prev?.uploadedByPartnerAt ?? null
    await prisma.subcontractedVehiclePhoto.update({ where: { id: args.photoId }, data: { uploadedByPartnerAt: now } })
  } catch (e) {
    console.warn('[partner photo] could not stamp uploadedByPartnerAt (column missing? run scripts/add-partner-photo-columns.ts):', e instanceof Error ? e.message : e)
  }
  await prisma.auditLog.create({
    data: { action: 'sub_vehicle.photo_added_by_partner', entityType: 'SubcontractedVehiclePhoto', entityId: args.photoId, newValues: { vehicleId: args.unitId, vendorId: args.vendorId, via: 'partner-page' } },
  }).catch(() => {})
  if (shouldNotifyHq(previous, now)) {
    await tellHq(
      `${args.vendorName} added photos to ${args.unitName}`,
      `${args.vendorName} put new photos on their ${args.unitName} from their partner page. They are live wherever the unit is listed — have a look and press “Looks good”, or remove any that should not be public.`,
      `/sub-rentals/vehicles/${args.unitId}`,
    )
  }
}

// ── Partner agreement ──────────────────────────────────────────────────

/** Staff: file the document to be signed. Supersedes any live one. */
export async function uploadVendorAgreement(args: {
  vendorId: string
  title: string
  filename: string
  bytes: Buffer
  effectiveDate?: Date | null
  expiryDate?: Date | null
  byUserId: string | null
}): Promise<{ id: string }> {
  if (args.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw Object.assign(new Error('That does not look like a PDF.'), { status: 400 })
  }
  const key = `vendor-agreements/${args.vendorId}/${randomUUID()}-${args.filename.replace(/[^A-Za-z0-9._-]+/g, '-')}`
  const up = await put(key, args.bytes, { access: 'private' as 'public', contentType: 'application/pdf' })
  return prisma.$transaction(async (tx) => {
    await tx.vendorAgreement.updateMany({
      where: { vendorId: args.vendorId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    return tx.vendorAgreement.create({
      data: {
        vendorId: args.vendorId,
        title: args.title.trim().slice(0, 160) || 'Partner Agreement',
        fileKey: key,
        fileUrl: up.url,
        originalFilename: args.filename.slice(0, 250),
        fileSize: args.bytes.length,
        effectiveDate: args.effectiveDate ?? null,
        expiryDate: args.expiryDate ?? null,
        uploadedById: args.byUserId,
      },
      select: { id: true },
    })
  })
}

export interface SignVendorAgreementInput {
  vendorId: string
  agreementId: string
  signerName: string
  signerTitle: string | null
  signerEmail: string
  signatureImageData: string
  acknowledgmentText: string
  ipAddress: string | null
  userAgent: string | null
}

/**
 * The partner signs: append a signature page to the uploaded PDF, store
 * the executed copy, record the evidence. The original stays as uploaded.
 */
export async function signVendorAgreement(i: SignVendorAgreementInput): Promise<{ signedAt: Date }> {
  const row = await prisma.vendorAgreement.findFirst({
    // 'current' = whichever agreement is live for this partner.
    where: { ...(i.agreementId === 'current' ? {} : { id: i.agreementId }), vendorId: i.vendorId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, fileUrl: true, signedAt: true, vendor: { select: { name: true } } },
  })
  if (!row) throw Object.assign(new Error('agreement not found'), { status: 404 })
  if (row.signedAt) throw Object.assign(new Error('This agreement has already been signed.'), { status: 409 })

  const blob = await getBlob(row.fileUrl, { access: 'private' })
  if (!blob || blob.statusCode !== 200 || !blob.stream) throw new Error('could not read the agreement')
  const original = Buffer.from(await new Response(blob.stream).arrayBuffer())

  const signedAt = new Date()
  const doc = await PDFDocument.load(original, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])
  const ink = rgb(0.07, 0.07, 0.07)
  const muted = rgb(0.45, 0.43, 0.4)
  let y = 720
  const line = (text: string, size = 10.5, f = font, color = ink) => {
    page.drawText(text, { x: 56, y, size, font: f, color })
    y -= size + 8
  }
  line('SIGNATURE PAGE', 9, bold, muted)
  y -= 6
  line(row.title, 16, bold)
  line(`Partner: ${row.vendor.name}`, 11)
  y -= 10
  line(`Signed by ${i.signerName}${i.signerTitle ? `, ${i.signerTitle}` : ''}`, 11, bold)
  line(i.signerEmail, 10.5, font, muted)
  line(`${signedAt.toUTCString()}`, 10.5, font, muted)
  if (i.ipAddress) line(`From ${i.ipAddress}${i.userAgent ? ` · ${i.userAgent.slice(0, 90)}` : ''}`, 8.5, font, muted)
  y -= 8
  // The drawn signature
  try {
    const png = await doc.embedPng(Buffer.from(i.signatureImageData.replace(/^data:image\/png;base64,/, ''), 'base64'))
    const w = 220
    const h = (png.height / png.width) * w
    page.drawImage(png, { x: 56, y: y - h, width: w, height: h })
    y -= h + 6
    page.drawLine({ start: { x: 56, y }, end: { x: 56 + w, y }, thickness: 0.8, color: muted })
    y -= 18
  } catch {
    /* a malformed image never blocks the signature record */
  }
  // Acknowledgement, wrapped crudely at ~95 chars
  const words = i.acknowledgmentText.split(/\s+/)
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 95) { line(cur.trim(), 9.5, font, muted); cur = w } else cur = `${cur} ${w}`
  }
  if (cur.trim()) line(cur.trim(), 9.5, font, muted)

  const bytes = Buffer.from(await doc.save())
  const key = `vendor-agreements/${i.vendorId}/${row.id}-signed-${signedAt.getTime()}.pdf`
  const up = await put(key, bytes, { access: 'private' as 'public', contentType: 'application/pdf' })

  // Conditional on still being unsigned AND still live. The read above is
  // seconds old by now (blob read, PDF build, blob write): a double submit
  // would otherwise overwrite the first signer's evidence, and a staff re-file
  // in between would let the partner "sign" the superseded document.
  const won = await prisma.vendorAgreement.updateMany({
    where: { id: row.id, signedAt: null, deletedAt: null },
    data: {
      signedAt,
      signerName: i.signerName,
      signerTitle: i.signerTitle,
      signerEmail: i.signerEmail,
      signerIpAddress: i.ipAddress,
      signerUserAgent: i.userAgent,
      signatureImageData: i.signatureImageData,
      acknowledgmentText: i.acknowledgmentText,
      signedFileKey: key,
      signedFileUrl: up.url,
    },
  })
  if (won.count !== 1) {
    // Lost the race: the executed copy we just wrote belongs to nobody.
    await del(up.url).catch(() => {})
    const now = await prisma.vendorAgreement.findUnique({ where: { id: row.id }, select: { deletedAt: true } })
    throw Object.assign(
      new Error(now?.deletedAt ? 'This agreement was replaced while you were signing — reload the page to sign the current one.' : 'This agreement has already been signed.'),
      { status: 409 },
    )
  }
  await tellHq(
    `${row.vendor.name} signed the partner agreement`,
    `${i.signerName}${i.signerTitle ? ` (${i.signerTitle})` : ''} signed "${row.title}" for ${row.vendor.name} from their partner page.`,
    '/crm/portals#partners',
  )
  // Signing is the heaviest thing the page can do, and the page link is
  // forwardable — so the address on file hears about it (Wes 2026-09-11).
  await tellPartner(
    i.vendorId,
    `${row.title} was signed for ${row.vendor.name}`,
    `${i.signerName}${i.signerTitle ? ` (${i.signerTitle})` : ''} signed "${row.title}" on your SirReel partner page, using the email ${i.signerEmail}.`,
    [i.signerEmail],
  )
  return { signedAt }
}
