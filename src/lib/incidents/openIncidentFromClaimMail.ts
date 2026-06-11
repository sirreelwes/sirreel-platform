/**
 * Open an Incident from a ClaimMail row. Used by two surfaces:
 *
 *   1. The NEEDS_REVIEW triage "Open incident report" action — Wes or
 *      Ana clicks the button on the claim-mail widget; an Incident is
 *      minted, prefilled from the Sonnet parse, and the source email
 *      is linked to it as a CORRESPONDENCE ClaimDocument.
 *
 *   2. The DRAFTED / ATTACHED automatic path inside onboardFromEmail.
 *      Every auto-drafted claim from now on gets an Incident parent
 *      created at the same moment — see STEP 2 of the Incidents
 *      build. Forward-only; historical claims without an Incident
 *      parent stay null and the UI treats them as "pre-Incident-era"
 *      rows.
 *
 * Idempotent on (claimMailId): if the ClaimMail already has
 * incidentId set, return that Incident — never mint a duplicate.
 *
 * Auth: callers are responsible for the session/allowlist check
 * BEFORE invoking this helper. The helper accepts a `createdById`
 * the caller picked up (or null for the system-triggered onboarding
 * path).
 */

import type { ParsedClaim } from '@/lib/claims/parsePastedClaim'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextIncidentNumber } from '@/lib/orders'

export interface OpenIncidentResult {
  incidentId: string
  incidentNumber: string
  // true on first mint; false when the helper found an existing
  // Incident on the ClaimMail row and returned it as-is.
  created: boolean
}

export async function openIncidentFromClaimMail(args: {
  claimMailId: string
  createdById: string | null
}): Promise<OpenIncidentResult> {
  const { claimMailId, createdById } = args

  // ── Idempotency ─────────────────────────────────────────────
  const existing = await prisma.claimMail.findUnique({
    where: { id: claimMailId },
    select: {
      id: true,
      incidentId: true,
      inbox: true,
      parse: true,
      emailMessage: {
        select: {
          id: true,
          subject: true,
          sentAt: true,
          fromAddress: true,
        },
      },
    },
  })
  if (!existing) throw new Error(`ClaimMail ${claimMailId} not found`)
  if (existing.incidentId) {
    const already = await prisma.incident.findUnique({
      where: { id: existing.incidentId },
      select: { id: true, incidentNumber: true },
    })
    if (already) return { incidentId: already.id, incidentNumber: already.incidentNumber, created: false }
    // Dangling FK (rare; SetNull on Incident delete should have cleared
    // it). Fall through and mint a fresh one.
  }

  const parse = (existing.parse ?? null) as unknown as ParsedClaim | null

  // ── Match company / asset / order (best-effort) ─────────────
  // Company match mirrors the onboardFromEmail logic so the Incident
  // lands with the same Company link the would-have-been claim would
  // have used. Order + Asset stay null on the email-source path —
  // identifying the actual rented unit from an email is unreliable;
  // the rep links it manually in the Incident UI.
  let companyId: string | null = null
  if (parse?.clientCompanyName) {
    const company = await prisma.company.findFirst({
      where: { name: { contains: parse.clientCompanyName, mode: 'insensitive' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (company) companyId = company.id
  }

  // Build a usable description. Prefer the AI loss summary; fall back
  // to subject + provenance line.
  const description = parse?.lossDescription && parse.lossDescription.length >= 10
    ? parse.lossDescription
    : `Opened from email — subject: "${existing.emailMessage.subject ?? '(no subject)'}". Pending Ana/Wes review.`

  // dateOfLoss → occurredAt when the parse identified it.
  const occurredAt = parse?.dateOfLoss
    ? new Date(`${parse.dateOfLoss}T00:00:00.000Z`)
    : null

  const incidentNumber = await nextIncidentNumber()
  const incident = await prisma.$transaction(async (tx) => {
    const created = await tx.incident.create({
      data: {
        incidentNumber,
        source: 'EMAIL',
        status: 'OPEN',
        companyId,
        description,
        occurredAt,
        createdById,
      },
      select: { id: true, incidentNumber: true },
    })
    // Link the ClaimMail row to this Incident.
    await tx.claimMail.update({
      where: { id: claimMailId },
      data: { incidentId: created.id },
    })
    // Hand any CORRESPONDENCE-source documents already attached to
    // the would-have-been-claim chain onto the Incident when no claim
    // exists yet. (Drafted claims keep their docs on claimId; this
    // path is for NEEDS_REVIEW where the chain hasn't drafted a claim
    // yet but onboardFromEmail may have already attached the body +
    // attachments to claimId=null rows — search by emailMessageId
    // referenced in their notes.)
    // Scope conservative: only relink documents that are currently
    // ORPHAN (claimId = null AND incidentId = null) and reference
    // this email in their notes. This is rare today (the orphan
    // condition isn't writable yet from any path) but guards the
    // contract for STEP 3 when the upload UI lands.
    await tx.claimDocument.updateMany({
      where: {
        claimId: null,
        incidentId: null,
        notes: { contains: `Source EmailMessage: ${existing.emailMessage.id}` },
      },
      data: { incidentId: created.id },
    })
    return created
  })

  return { incidentId: incident.id, incidentNumber: incident.incidentNumber, created: true }
}

/**
 * Variant used by the onboardFromEmail DRAFTED path — creates the
 * Incident BEFORE the InsuranceClaim so the claim can be inserted
 * with incidentId already set in the same transaction. Takes the
 * pre-parsed data directly (no ClaimMail row to read from yet).
 *
 * Returns the new Incident id; caller passes it to the
 * InsuranceClaim.create call. Caller is also responsible for the
 * ClaimMail upsert that links incidentId after the claim lands.
 */
export async function preCreateIncidentForDraftedClaim(args: {
  tx: Prisma.TransactionClient
  parsed: ParsedClaim
  companyId: string | null
  msgSubject: string | null
  msgId: string
  createdById: string | null
}): Promise<{ id: string; incidentNumber: string }> {
  const { tx, parsed, companyId, msgSubject, msgId, createdById } = args
  const description = parsed.lossDescription && parsed.lossDescription.length >= 10
    ? parsed.lossDescription
    : `Auto-drafted from email — subject: "${msgSubject ?? '(no subject)'}". Pending Ana review.`
  const occurredAt = parsed.dateOfLoss
    ? new Date(`${parsed.dateOfLoss}T00:00:00.000Z`)
    : null
  const incidentNumber = await nextIncidentNumber()
  const incident = await tx.incident.create({
    data: {
      incidentNumber,
      source: 'EMAIL',
      status: 'OPEN',
      companyId,
      description,
      occurredAt,
      createdById,
    },
    select: { id: true, incidentNumber: true },
  })
  // Side note for forward audits: which email drafted this incident.
  // The claim row's onboardedFromEmailMessageId carries the same info
  // for the resulting claim; this comment captures the trail for the
  // incident layer.
  void msgId
  return incident
}
