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
import { get as getBlob, put } from '@vercel/blob'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

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
  const v = await prisma.vendor.update({
    where: { id: vendorId },
    data: Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)),
    select: { name: true },
  })
  await tellHq(
    `${v.name} updated their contact details`,
    `${v.name} changed their contact details from their partner page: ${Object.entries(patch)
      .filter(([, val]) => val !== undefined)
      .map(([k, val]) => `${k} → ${val ?? '(cleared)'}`)
      .join('; ')}.`,
    '/crm/portals#vendor',
  )
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
    where: { id: unitId, vendorId },
    select: { id: true, name: true, listDailyRate: true, listWeeklyRate: true, listMonthlyRate: true, vendor: { select: { name: true } } },
  })
  if (!unit) throw Object.assign(new Error('unit not found'), { status: 404 })
  const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null)
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
    '/crm/portals#vendor',
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

  await prisma.vendorAgreement.update({
    where: { id: row.id },
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
  await tellHq(
    `${row.vendor.name} signed the partner agreement`,
    `${i.signerName}${i.signerTitle ? ` (${i.signerTitle})` : ''} signed "${row.title}" for ${row.vendor.name} from their partner page.`,
    '/crm/portals#vendor',
  )
  return { signedAt }
}
