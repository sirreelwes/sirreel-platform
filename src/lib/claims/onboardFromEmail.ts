/**
 * claims@ → claim onboarding bridge.
 *
 * System-triggered (called fire-and-forget from the Gmail Pub/Sub
 * handler). Never throws past the caller; any error is logged + the
 * function returns. Failure to onboard is non-fatal — the EmailMessage
 * row still exists and Ana can paste it through the manual flow.
 *
 * Three branches:
 *   1. Existing claim — parsed.carrierClaimNumber matches an
 *      InsuranceClaim already in the DB. Attach the email body as a
 *      CORRESPONDENCE ClaimDocument, append a NEGOTIATION_NOTE
 *      timeline row, link EmailMessage.claimId. Do NOT create a
 *      new claim.
 *   2. New draft — no carrier# match AND the parse is confident
 *      (carrierName set + (carrierClaimNumber OR lossDescription)
 *      set + clientCompanyName matches an existing Company). Create
 *      a DRAFT claim with the parsed snapshot, attach the body as a
 *      CORRESPONDENCE ClaimDocument, link both directions. Ana
 *      reviews and finalizes via the "From email — review" badge on
 *      /claims.
 *   3. Low confidence — leave the EmailMessage as-is. Don't create a
 *      junk draft.
 *
 * Cross-inbox idempotency: before doing anything, look up every
 * EmailMessage with the same rfc822MessageId where claimId IS NOT NULL.
 * If any are found, the message is already onboarded (via another
 * inbox copy — typically the ana@ forwarded mirror). Skip.
 *
 * No getServerSession. ClaimTimeline.performedBy + ClaimDocument
 * .uploadedBy are nullable, so the system-actor case writes null and
 * surfaces in the UI as "system" wherever that's rendered.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { parsePastedClaim } from '@/lib/claims/parsePastedClaim'
import { nextClaimNumber } from '@/lib/orders'

const TEXT_MIN_CHARS = 30
const TEXT_MAX_CHARS = 200_000

export interface OnboardOutcome {
  status: 'attached' | 'drafted' | 'skipped'
  reason?: string
  claimId?: string
  claimNumber?: string
  documentId?: string
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
      // Mirror the link onto this row so future queries (timeline,
      // claim detail page "source emails") see both copies.
      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: { claimId: sibling.claimId },
      })
      return { status: 'skipped', reason: 'already linked via sibling', claimId: sibling.claimId }
    }
  }

  // bodyText is the parse-ready form; bodyHtml is fallback (rare —
  // pubsub already converts when possible).
  const text = (msg.bodyText && msg.bodyText.length > 0 ? msg.bodyText : (msg.bodyHtml ?? '')).trim()
  if (text.length < TEXT_MIN_CHARS) return { status: 'skipped', reason: 'body too short' }
  const truncated = text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text

  const parsed = await parsePastedClaim(truncated)

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

  return await createDraft({ msg, parsed, company, text: truncated })
}

async function uploadBody(args: {
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

async function attachToExisting(args: {
  claimId: string
  claimNumber: string
  msg: { id: string; subject: string | null; sentAt: Date; fromAddress: string; gmailMessageId: string }
  text: string
}): Promise<OnboardOutcome> {
  const { claimId, claimNumber, msg, text } = args
  const fileUrl = await uploadBody({ text, claimNumber, gmailMessageId: msg.gmailMessageId })
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

  return {
    status: 'attached',
    claimId,
    claimNumber,
    documentId: result.id,
  }
}

async function createDraft(args: {
  msg: { id: string; subject: string | null; sentAt: Date; fromAddress: string; gmailMessageId: string }
  parsed: Awaited<ReturnType<typeof parsePastedClaim>>
  company: { id: string; name: string }
  text: string
}): Promise<OnboardOutcome> {
  const { msg, parsed, company, text } = args

  // incidentDate is non-null on the schema. Use the parsed dateOfLoss
  // when present, else fall back to the email sentAt — the rep will
  // correct it during review.
  const incidentDate =
    parsed.dateOfLoss
      ? new Date(`${parsed.dateOfLoss}T00:00:00.000Z`)
      : new Date(Date.UTC(msg.sentAt.getUTCFullYear(), msg.sentAt.getUTCMonth(), msg.sentAt.getUTCDate()))

  // incidentDescription is non-null. Use parsed.lossDescription when
  // available, else build a minimum-viable description from the subject.
  const incidentDescription =
    parsed.lossDescription && parsed.lossDescription.length >= 10
      ? parsed.lossDescription
      : `Auto-drafted from forwarded email — subject: "${msg.subject ?? '(no subject)'}". Pending Ana review.`

  const claimNumber = await nextClaimNumber()
  const fileUrl = await uploadBody({ text, claimNumber, gmailMessageId: msg.gmailMessageId })

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

  return {
    status: 'drafted',
    claimId: created.claim.id,
    claimNumber: created.claim.claimNumber,
    documentId: created.doc.id,
  }
}
