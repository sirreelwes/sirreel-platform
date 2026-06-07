/**
 * claims@ → claim onboarding bridge.
 *
 * System-triggered (called fire-and-forget from the Gmail ingest paths
 * — pubsub for live notifications, sync/fetch when those routes run).
 * Never throws past the caller; any error is logged + the function
 * returns. Failure to onboard is non-fatal — the EmailMessage row
 * still exists and Ana can paste it through the manual flow.
 *
 * Three branches:
 *   1. Existing claim — parsed.carrierClaimNumber matches an
 *      InsuranceClaim already in the DB. Attach the email body + its
 *      attachments as CORRESPONDENCE ClaimDocuments, append a
 *      NEGOTIATION_NOTE timeline row, link EmailMessage.claimId. Do
 *      NOT create a new claim.
 *   2. New draft — no carrier# match AND the parse is confident
 *      (carrierName set + (carrierClaimNumber OR lossDescription)
 *      set + clientCompanyName matches an existing Company). Create
 *      a DRAFT claim with the parsed snapshot, attach the body + its
 *      attachments, link both directions. Ana reviews and finalizes
 *      via the "From email — review" badge on /claims.
 *   3. Low confidence — leave the EmailMessage as-is. Don't create a
 *      junk draft.
 *
 * Cross-inbox idempotency: before doing anything, look up every
 * EmailMessage with the same rfc822MessageId where claimId IS NOT NULL.
 * If any are found, the message is already onboarded (via another
 * inbox copy — typically the ana@ forwarded mirror). Skip.
 *
 * The body + attachments are pulled fresh from Gmail via DWD
 * impersonation of the inbox the message landed in. This lets the
 * helper work even when the EmailMessage row was created by the
 * format=metadata sync/fetch paths (which don't store bodyText), and
 * gives access to attachmentId values for the per-attachment download.
 *
 * No getServerSession. ClaimTimeline.performedBy + ClaimDocument
 * .uploadedBy are nullable, so the system-actor case writes null and
 * surfaces in the UI as "system" wherever that's rendered.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { parsePastedClaim, type ParsedClaim } from '@/lib/claims/parsePastedClaim'
import { nextClaimNumber } from '@/lib/orders'
import { extractBodyFromGmailPayload, type GmailMessagePart } from '@/lib/email/body'

const TEXT_MIN_CHARS = 30
const TEXT_MAX_CHARS = 200_000
// Cap individual attachment downloads at 25 MB — Gmail's per-attachment
// API limit is 25 MiB anyway. Anything larger is almost certainly a
// misuse (video, raw photo dump) and should be uploaded manually.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export interface OnboardOutcome {
  status: 'attached' | 'drafted' | 'skipped'
  reason?: string
  claimId?: string
  claimNumber?: string
  documentId?: string
  attachmentsAttached?: number
}

interface GmailAttachmentMeta {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

interface FetchedMessage {
  bodyText: string | null
  attachments: GmailAttachmentMeta[]
  payload: GmailMessagePart | undefined
}

function getGmailClient(impersonate: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    impersonate,
  )
  return google.gmail({ version: 'v1', auth })
}

function walkForAttachments(payload: GmailMessagePart | undefined | null, out: GmailAttachmentMeta[]): void {
  if (!payload) return
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      attachmentId: payload.body.attachmentId,
      size: payload.body.size || 0,
    })
  }
  if (payload.parts) {
    for (const child of payload.parts) walkForAttachments(child, out)
  }
}

async function fetchFromGmail(inbox: string, gmailMessageId: string): Promise<FetchedMessage | null> {
  try {
    const gmail = getGmailClient(inbox)
    const res = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' })
    const payload = res.data.payload as GmailMessagePart | undefined
    const body = extractBodyFromGmailPayload(payload)
    const attachments: GmailAttachmentMeta[] = []
    walkForAttachments(payload, attachments)
    return { bodyText: body.bodyText, attachments, payload }
  } catch (err) {
    console.warn('[claims/onboardFromEmail] Gmail fetch failed for', inbox, gmailMessageId, err instanceof Error ? err.message : err)
    return null
  }
}

export async function onboardFromEmail(emailMessageId: string): Promise<OnboardOutcome> {
  try {
    return await runOnboard(emailMessageId)
  } catch (err) {
    // Never throw past the caller — Pub/Sub batch should not fail because
    // a single onboarding crashed. Log loudly so Vercel surfaces it.
    console.error('[claims/onboardFromEmail] failed for', emailMessageId, err instanceof Error ? err.message : err)
    return { status: 'skipped', reason: 'error' }
  }
}

async function runOnboard(emailMessageId: string): Promise<OnboardOutcome> {
  const msg = await prisma.emailMessage.findUnique({
    where: { id: emailMessageId },
    select: {
      id: true,
      rfc822MessageId: true,
      gmailMessageId: true,
      claimId: true,
      bodyText: true,
      bodyHtml: true,
      subject: true,
      fromAddress: true,
      sentAt: true,
      emailAccount: { select: { emailAddress: true } },
    },
  })
  if (!msg) return { status: 'skipped', reason: 'message not found' }
  if (msg.claimId) return { status: 'skipped', reason: 'already linked' }

  // Cross-inbox idempotency: any other EmailMessage with the same
  // rfc822MessageId already linked? (ana@ may have ingested first.)
  if (msg.rfc822MessageId) {
    const sibling = await prisma.emailMessage.findFirst({
      where: { rfc822MessageId: msg.rfc822MessageId, claimId: { not: null } },
      select: { id: true, claimId: true },
    })
    if (sibling?.claimId) {
      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: { claimId: sibling.claimId },
      })
      return { status: 'skipped', reason: 'already linked via sibling', claimId: sibling.claimId }
    }
  }

  // Pull fresh body + attachment metadata from Gmail. Falls back to the
  // stored bodyText if the Gmail fetch fails (no network / 404 / etc.)
  // so the function still runs without attachments instead of refusing
  // outright.
  const inbox = msg.emailAccount?.emailAddress ?? ''
  const fetched = inbox && msg.gmailMessageId ? await fetchFromGmail(inbox, msg.gmailMessageId) : null

  const freshText = fetched?.bodyText ?? null
  const storedText = msg.bodyText ?? msg.bodyHtml ?? null
  const text = (freshText && freshText.length > 0 ? freshText : (storedText ?? '')).trim()
  if (text.length < TEXT_MIN_CHARS) return { status: 'skipped', reason: 'body too short' }
  const truncated = text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text

  const parsed = await parsePastedClaim(truncated)
  const attachments = fetched?.attachments ?? []

  // Branch 1: carrier# match → attach to existing claim.
  if (parsed.carrierClaimNumber) {
    const existing = await prisma.insuranceClaim.findFirst({
      where: { carrierClaimNumber: parsed.carrierClaimNumber },
      select: { id: true, claimNumber: true },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      return await attachToExisting({
        claimId: existing.id,
        claimNumber: existing.claimNumber,
        msg,
        text: truncated,
        inbox,
        attachments,
      })
    }
  }

  // Branch 2: new draft. Confidence gate.
  const hasCarrier = !!parsed.carrierName
  const hasIdOrLoss = !!parsed.carrierClaimNumber || !!parsed.lossDescription
  if (!hasCarrier || !hasIdOrLoss) {
    return { status: 'skipped', reason: 'low confidence — carrier or claim# / loss desc missing' }
  }
  if (!parsed.clientCompanyName) {
    return { status: 'skipped', reason: 'no client company name in parse' }
  }
  const company = await prisma.company.findFirst({
    where: { name: { contains: parsed.clientCompanyName, mode: 'insensitive' } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!company) {
    return { status: 'skipped', reason: 'no matching Company — needs manual onboarding' }
  }

  return await createDraft({ msg, parsed, company, text: truncated, inbox, attachments })
}

async function uploadText(args: {
  text: string
  claimNumber: string
  gmailMessageId: string
}): Promise<string> {
  const { text, claimNumber, gmailMessageId } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `claims/${yyyy}/${mm}/${randomUUID()}-${claimNumber}-email-${gmailMessageId}.txt`
  const blob = await put(blobKey, text, {
    access: 'private' as 'public',
    contentType: 'text/plain; charset=utf-8',
  })
  return blob.url
}

// Sanitize a Gmail-supplied filename so it's a safe blob key segment.
// Strip path separators + control chars; collapse runs of whitespace.
function safeName(name: string): string {
  return name
    .replace(/[\\/\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180) || 'attachment'
}

async function uploadAttachmentBytes(args: {
  inbox: string
  gmailMessageId: string
  claimNumber: string
  attachment: GmailAttachmentMeta
}): Promise<{ fileUrl: string; bytes: number } | null> {
  const { inbox, gmailMessageId, claimNumber, attachment } = args
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    console.warn(`[claims/onboardFromEmail] attachment too large (${attachment.size} bytes): ${attachment.filename}`)
    return null
  }
  try {
    const gmail = getGmailClient(inbox)
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailMessageId,
      id: attachment.attachmentId,
    })
    const data = res.data.data
    if (!data) return null
    const buf = Buffer.from(data, 'base64url')
    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const blobKey = `claims/${yyyy}/${mm}/${randomUUID()}-${claimNumber}-att-${safeName(attachment.filename)}`
    const blob = await put(blobKey, buf, {
      access: 'private' as 'public',
      contentType: attachment.mimeType,
    })
    return { fileUrl: blob.url, bytes: buf.length }
  } catch (err) {
    console.warn(`[claims/onboardFromEmail] attachment download failed for ${attachment.filename}:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function persistAttachments(args: {
  claimId: string
  claimNumber: string
  inbox: string
  gmailMessageId: string
  msgId: string
  attachments: GmailAttachmentMeta[]
}): Promise<number> {
  const { claimId, claimNumber, inbox, gmailMessageId, msgId, attachments } = args
  if (attachments.length === 0) return 0
  let attached = 0
  for (const att of attachments) {
    const uploaded = await uploadAttachmentBytes({ inbox, gmailMessageId, claimNumber, attachment: att })
    if (!uploaded) continue
    try {
      await prisma.claimDocument.create({
        data: {
          claimId,
          type: 'CORRESPONDENCE',
          title: `Email attachment: ${att.filename.slice(0, 200)}`,
          fileUrl: uploaded.fileUrl,
          uploadedBy: null,
          notes: [
            `Auto-attached from claims@ inbox.`,
            `Filename: ${att.filename}`,
            `MIME: ${att.mimeType}`,
            `Size: ${uploaded.bytes} bytes`,
            `Source EmailMessage: ${msgId}`,
          ].join('\n\n'),
        },
      })
      attached += 1
    } catch (err) {
      console.warn(`[claims/onboardFromEmail] claimDocument create failed for ${att.filename}:`, err instanceof Error ? err.message : err)
    }
  }
  return attached
}

async function attachToExisting(args: {
  claimId: string
  claimNumber: string
  msg: { id: string; subject: string | null; sentAt: Date; fromAddress: string; gmailMessageId: string }
  text: string
  inbox: string
  attachments: GmailAttachmentMeta[]
}): Promise<OnboardOutcome> {
  const { claimId, claimNumber, msg, text, inbox, attachments } = args
  const fileUrl = await uploadText({ text, claimNumber, gmailMessageId: msg.gmailMessageId })
  const preview = msg.subject?.slice(0, 240) ?? ''

  const result = await prisma.$transaction(async (tx) => {
    const doc = await tx.claimDocument.create({
      data: {
        claimId,
        type: 'CORRESPONDENCE',
        title: `Email from ${msg.fromAddress.slice(0, 200)} — ${msg.sentAt.toISOString().slice(0, 10)}`,
        fileUrl,
        uploadedBy: null,
        notes: [
          `Auto-attached from claims@ inbox.`,
          `Subject: ${preview}`,
          `Source EmailMessage: ${msg.id}`,
        ].filter(Boolean).join('\n\n'),
      },
      select: { id: true },
    })
    await tx.claimTimeline.create({
      data: {
        claimId,
        action: 'NEGOTIATION_NOTE',
        description: `Inbound email auto-attached (claims@): "${msg.subject ?? '(no subject)'}" from ${msg.fromAddress}.`,
        performedBy: null,
        isAi: true,
      },
    })
    await tx.emailMessage.update({
      where: { id: msg.id },
      data: { claimId },
    })
    return doc
  })

  // Attachments AFTER the main transaction — each is a Gmail+Blob round-
  // trip and we don't want to hold a DB transaction open across them.
  const attachmentsAttached = await persistAttachments({
    claimId, claimNumber, inbox, gmailMessageId: msg.gmailMessageId, msgId: msg.id, attachments,
  })

  return {
    status: 'attached',
    claimId,
    claimNumber,
    documentId: result.id,
    attachmentsAttached,
  }
}

async function createDraft(args: {
  msg: { id: string; subject: string | null; sentAt: Date; fromAddress: string; gmailMessageId: string }
  parsed: ParsedClaim
  company: { id: string; name: string }
  text: string
  inbox: string
  attachments: GmailAttachmentMeta[]
}): Promise<OnboardOutcome> {
  const { msg, parsed, company, text, inbox, attachments } = args

  const incidentDate =
    parsed.dateOfLoss
      ? new Date(`${parsed.dateOfLoss}T00:00:00.000Z`)
      : new Date(Date.UTC(msg.sentAt.getUTCFullYear(), msg.sentAt.getUTCMonth(), msg.sentAt.getUTCDate()))

  const incidentDescription =
    parsed.lossDescription && parsed.lossDescription.length >= 10
      ? parsed.lossDescription
      : `Auto-drafted from forwarded email — subject: "${msg.subject ?? '(no subject)'}". Pending Ana review.`

  const claimNumber = await nextClaimNumber()
  const fileUrl = await uploadText({ text, claimNumber, gmailMessageId: msg.gmailMessageId })

  const created = await prisma.$transaction(async (tx) => {
    const claim = await tx.insuranceClaim.create({
      data: {
        claimNumber,
        companyId: company.id,
        status: 'DRAFT',
        filedAgainst: parsed.carrierName ?? 'Unknown carrier',
        adjusterName: parsed.adjusterName,
        adjusterEmail: parsed.adjusterEmail,
        adjusterPhone: parsed.adjusterPhone,
        policyNumber: parsed.policyNumber,
        carrierClaimNumber: parsed.carrierClaimNumber,
        incidentDate,
        incidentDescription,
        lossAmount: parsed.lossAmount ?? undefined,
        acvReceived: parsed.acvReceived ?? undefined,
        depreciationApplied: parsed.depreciationApplied ?? undefined,
        deductibleAmount: parsed.deductibleAmount ?? undefined,
        totalDemand: parsed.totalDemand ?? undefined,
        amountOffered: parsed.amountOffered ?? undefined,
        amountSettled: parsed.amountSettled ?? undefined,
        onboardedFromEmailMessageId: msg.id,
      },
      select: { id: true, claimNumber: true },
    })

    const doc = await tx.claimDocument.create({
      data: {
        claimId: claim.id,
        type: 'CORRESPONDENCE',
        title: `Source email — ${msg.sentAt.toISOString().slice(0, 10)}`,
        fileUrl,
        uploadedBy: null,
        notes: [
          'Drafted from claims@ inbox (AI-parsed fields, awaiting Ana review).',
          `Subject: ${msg.subject ?? '(no subject)'}`,
          `From: ${msg.fromAddress}`,
          `Source EmailMessage: ${msg.id}`,
        ].filter(Boolean).join('\n\n'),
      },
      select: { id: true },
    })

    await tx.claimTimeline.create({
      data: {
        claimId: claim.id,
        action: 'CREATED',
        description: `Auto-drafted from forwarded claims@ email. Carrier: ${parsed.carrierName}. Pending Ana review.`,
        performedBy: null,
        isAi: true,
      },
    })

    await tx.emailMessage.update({
      where: { id: msg.id },
      data: { claimId: claim.id },
    })

    return { claim, doc }
  })

  const attachmentsAttached = await persistAttachments({
    claimId: created.claim.id,
    claimNumber: created.claim.claimNumber,
    inbox,
    gmailMessageId: msg.gmailMessageId,
    msgId: msg.id,
    attachments,
  })

  return {
    status: 'drafted',
    claimId: created.claim.id,
    claimNumber: created.claim.claimNumber,
    documentId: created.doc.id,
    attachmentsAttached,
  }
}
