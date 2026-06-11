/**
 * captureFromEmail — single shared helper used by every ingest path
 * (live pubsub, sync, fetch, backfill script).
 *
 * Contract:
 *   - Idempotent on EmailMessage.id AND on rfc822MessageId. Calling
 *     twice with the same EmailMessage id is a no-op; calling with a
 *     fresh row that shares rfc822 with a prior capture is a no-op.
 *   - Never throws past the caller — every failure returns
 *     { status: 'skipped', reason } so the caller (fire-and-forget on
 *     the live path) can't crash a pubsub batch.
 *   - Gate: inbox MUST be in SALES_CAPTURE_INBOXES, direction must be
 *     INBOUND, sender must NOT be @sirreel.com (claims/hr/ana paths
 *     are explicitly off limits — they have their own pipelines).
 *
 * On AUTO_CAPTURED: either creates a new Person (resolution=AUTO_FILED)
 * or enriches an existing one (resolution=AUTO_ENRICHED).
 *
 * Enrichment rule: NEVER overwrite a non-empty field. Only fill empty
 * phone / rawTitle / lastKnownProject; only update role when the
 * existing role is OTHER and the parsed title maps to something
 * specific. Every filled field is logged on InquiryCapture.enrichmentLog.
 * The capture record carries the audit trail; the Person row carries
 * the merged truth.
 */

import { prisma } from '@/lib/prisma'
import { Prisma, CaptureVerdict, CaptureResolution, PersonRole } from '@prisma/client'
import { SALES_CAPTURE_INBOXES } from './captureConstants'
import { classifyForCapture, type VerdictResult, type ParsedPayload } from './classifyForCapture'
import { mapTitleToRole } from './roleMapping'
import type { ExtractedMessage } from '@/lib/ai/messageExtractor'

export type CaptureStatus = 'auto_captured' | 'needs_review' | 'skipped' | 'duplicate' | 'noop'

export interface CaptureOutcome {
  status: CaptureStatus
  reason: string
  captureId?: string
  personId?: string
  verdict?: CaptureVerdict
}

function senderDomain(fromAddress: string): string {
  const m = fromAddress.match(/<([^>]+)>/)
  const bare = (m ? m[1] : fromAddress).trim().toLowerCase()
  const at = bare.indexOf('@')
  return at < 0 ? '' : bare.slice(at + 1)
}

function splitName(full: string | null): { first: string; last: string } {
  if (!full) return { first: 'Unknown', last: '' }
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

async function findDomainMatchedCompany(domain: string): Promise<string | null> {
  if (!domain) return null
  // Skip the freemail jungle — those are never domain-matched.
  const FREEMAIL = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
    'msn.com', 'live.com', 'comcast.net', 'verizon.net', 'sbcglobal.net',
  ])
  if (FREEMAIL.has(domain)) return null

  const hits = await prisma.company.findMany({
    where: {
      OR: [
        { website: { contains: domain, mode: 'insensitive' } },
        { billingEmail: { endsWith: `@${domain}`, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 2,
  })
  return hits.length === 1 ? hits[0].id : null
}

async function findExactNameCompany(name: string | null): Promise<string | null> {
  if (!name) return null
  const trimmed = name.trim()
  if (trimmed.length < 3) return null
  const hits = await prisma.company.findMany({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  })
  return hits.length === 1 ? hits[0].id : null
}

interface EnrichmentChange {
  from: string | PersonRole | null
  to: string | PersonRole
}

async function captureNewOrEnrich(args: {
  parsed: ParsedPayload
  emailMessageId: string
  inbox: string
}): Promise<{ personId: string; resolution: CaptureResolution; enrichmentLog: Record<string, EnrichmentChange> | null }> {
  const { parsed, emailMessageId, inbox } = args
  if (!parsed.email) {
    // Defensive: classifier should always set this from fromAddress.
    throw new Error('captureNewOrEnrich: missing parsed.email')
  }
  const emailLower = parsed.email.toLowerCase()
  const role = mapTitleToRole(parsed.title)

  const existing = await prisma.person.findFirst({
    where: { email: { equals: emailLower, mode: 'insensitive' } },
    select: {
      id: true,
      phone: true,
      mobile: true,
      rawTitle: true,
      lastKnownProject: true,
      role: true,
    },
  })

  if (existing) {
    const log: Record<string, EnrichmentChange> = {}
    const data: Prisma.PersonUpdateInput = {}
    if (!existing.phone && !existing.mobile && parsed.phone) {
      data.phone = parsed.phone
      log.phone = { from: null, to: parsed.phone }
    }
    if (!existing.rawTitle && parsed.title) {
      data.rawTitle = parsed.title
      log.rawTitle = { from: null, to: parsed.title }
    }
    if (!existing.lastKnownProject && parsed.project) {
      data.lastKnownProject = parsed.project
      log.lastKnownProject = { from: null, to: parsed.project }
    }
    if (existing.role === PersonRole.OTHER && role !== PersonRole.OTHER) {
      data.role = role
      log.role = { from: existing.role, to: role }
    }
    if (Object.keys(data).length > 0) {
      // Stamp sourceMessageId so the most recent enrichment is
      // traceable — but DON'T touch `source` if already set.
      data.sourceMessageId = emailMessageId
      await prisma.person.update({ where: { id: existing.id }, data })
    }
    return {
      personId: existing.id,
      resolution: CaptureResolution.AUTO_ENRICHED,
      enrichmentLog: Object.keys(log).length > 0 ? log : null,
    }
  }

  // Brand-new person. Mint with source=email_capture.
  const { first, last } = splitName(parsed.name)
  const created = await prisma.person.create({
    data: {
      firstName: first,
      lastName: last,
      email: emailLower,
      phone: parsed.phone,
      role,
      rawTitle: parsed.title,
      lastKnownProject: parsed.project,
      source: 'email_capture',
      sourceMessageId: emailMessageId,
      notes: `Auto-captured from ${inbox}`,
    },
    select: { id: true },
  })
  return { personId: created.id, resolution: CaptureResolution.AUTO_FILED, enrichmentLog: null }
}

export async function captureFromEmail(emailMessageId: string): Promise<CaptureOutcome> {
  try {
    const email = await prisma.emailMessage.findUnique({
      where: { id: emailMessageId },
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        snippet: true,
        bodyText: true,
        direction: true,
        rfc822MessageId: true,
        extractedData: true,
        duplicateOfId: true,
        emailAccount: { select: { emailAddress: true } },
      },
    })
    if (!email) return { status: 'skipped', reason: 'EmailMessage not found' }

    const inbox = email.emailAccount.emailAddress.toLowerCase()

    // Gate ─────────────────────────────────────────────────────────
    if (!SALES_CAPTURE_INBOXES.has(inbox)) {
      return { status: 'skipped', reason: `inbox ${inbox} not in capture allowlist` }
    }
    if (email.direction !== 'inbound') {
      return { status: 'skipped', reason: `direction=${email.direction} (capture is INBOUND-only)` }
    }
    if (email.duplicateOfId) {
      return { status: 'skipped', reason: 'duplicate-of EmailMessage row (canonical lives elsewhere)' }
    }

    // Idempotency: existing capture by EmailMessage id ─────────────
    const existingByEmail = await prisma.inquiryCapture.findUnique({
      where: { emailMessageId: email.id },
      select: { id: true, verdict: true, personId: true },
    })
    if (existingByEmail) {
      return {
        status: 'duplicate',
        reason: 'capture already exists for this EmailMessage',
        captureId: existingByEmail.id,
        personId: existingByEmail.personId ?? undefined,
        verdict: existingByEmail.verdict,
      }
    }

    // Cross-inbox dedup by rfc822 ──────────────────────────────────
    if (email.rfc822MessageId) {
      const existingByRfc = await prisma.inquiryCapture.findFirst({
        where: { rfc822MessageId: email.rfc822MessageId },
        select: { id: true, verdict: true, personId: true },
      })
      if (existingByRfc) {
        return {
          status: 'duplicate',
          reason: 'capture exists for sibling EmailMessage sharing rfc822MessageId',
          captureId: existingByRfc.id,
          personId: existingByRfc.personId ?? undefined,
          verdict: existingByRfc.verdict,
        }
      }
    }

    // Classify ─────────────────────────────────────────────────────
    const extracted = (email.extractedData as ExtractedMessage | null) ?? null
    const domain = senderDomain(email.fromAddress)
    const domainMatchedCompanyId = await findDomainMatchedCompany(domain)

    const verdict: VerdictResult = classifyForCapture({
      inbox,
      fromAddress: email.fromAddress,
      subject: email.subject,
      bodySnippet: email.snippet ?? email.bodyText ?? null,
      extracted,
      domainMatchedCompanyId,
    })

    // Resolve companyId (domain match OR exact name match) ─────────
    const exactNameCompanyId = await findExactNameCompany(verdict.parsed.companyString)
    const linkedCompanyId = domainMatchedCompanyId ?? exactNameCompanyId

    // Persist ──────────────────────────────────────────────────────
    if (verdict.verdict === 'AUTO_CAPTURED') {
      const enriched = await captureNewOrEnrich({
        parsed: verdict.parsed,
        emailMessageId: email.id,
        inbox,
      })
      const capture = await prisma.inquiryCapture.create({
        data: {
          emailMessageId: email.id,
          rfc822MessageId: email.rfc822MessageId,
          inbox,
          verdict: CaptureVerdict.AUTO_CAPTURED,
          verdictReason: verdict.reason,
          signals: verdict.signals,
          parsedName: verdict.parsed.name,
          parsedEmail: verdict.parsed.email,
          parsedPhone: verdict.parsed.phone,
          parsedTitle: verdict.parsed.title,
          parsedCompanyString: verdict.parsed.companyString,
          parsedProject: verdict.parsed.project,
          personId: enriched.personId,
          companyId: linkedCompanyId,
          resolution: enriched.resolution,
          enrichmentLog: enriched.enrichmentLog as unknown as Prisma.InputJsonValue,
          resolvedAt: new Date(),
        },
        select: { id: true },
      })
      return {
        status: 'auto_captured',
        reason: verdict.reason,
        captureId: capture.id,
        personId: enriched.personId,
        verdict: CaptureVerdict.AUTO_CAPTURED,
      }
    }

    if (verdict.verdict === 'NEEDS_REVIEW') {
      // Pending-review dedupe — one pending row per contact email at a
      // time. If a parent PENDING NEEDS_REVIEW already exists for this
      // sender, mint the new row but attach it to the parent so the
      // widget surfaces a single review item and the rep resolves all
      // attached messages with one Add/Dismiss.
      const parsedEmailLower = verdict.parsed.email?.toLowerCase() ?? null
      const parent = parsedEmailLower
        ? await prisma.inquiryCapture.findFirst({
            where: {
              verdict: CaptureVerdict.NEEDS_REVIEW,
              resolution: CaptureResolution.PENDING,
              attachedToCaptureId: null,
              parsedEmail: { equals: parsedEmailLower, mode: 'insensitive' },
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          })
        : null

      const capture = await prisma.inquiryCapture.create({
        data: {
          emailMessageId: email.id,
          rfc822MessageId: email.rfc822MessageId,
          inbox,
          verdict: CaptureVerdict.NEEDS_REVIEW,
          verdictReason: verdict.reason,
          signals: verdict.signals,
          parsedName: verdict.parsed.name,
          parsedEmail: verdict.parsed.email,
          parsedPhone: verdict.parsed.phone,
          parsedTitle: verdict.parsed.title,
          parsedCompanyString: verdict.parsed.companyString,
          parsedProject: verdict.parsed.project,
          companyId: linkedCompanyId,
          resolution: CaptureResolution.PENDING,
          attachedToCaptureId: parent?.id ?? null,
        },
        select: { id: true },
      })
      return {
        status: 'needs_review',
        reason: parent ? `${verdict.reason} (attached to ${parent.id})` : verdict.reason,
        captureId: capture.id,
        verdict: CaptureVerdict.NEEDS_REVIEW,
      }
    }

    // SKIPPED — stored for audit, no Person touched.
    const capture = await prisma.inquiryCapture.create({
      data: {
        emailMessageId: email.id,
        rfc822MessageId: email.rfc822MessageId,
        inbox,
        verdict: CaptureVerdict.SKIPPED,
        verdictReason: verdict.reason,
        signals: verdict.signals,
        parsedName: verdict.parsed.name,
        parsedEmail: verdict.parsed.email,
        parsedPhone: verdict.parsed.phone,
        parsedTitle: verdict.parsed.title,
        parsedCompanyString: verdict.parsed.companyString,
        parsedProject: verdict.parsed.project,
        companyId: linkedCompanyId,
        resolution: CaptureResolution.AUTO_SKIPPED,
        resolvedAt: new Date(),
      },
      select: { id: true },
    })
    return {
      status: 'skipped',
      reason: verdict.reason,
      captureId: capture.id,
      verdict: CaptureVerdict.SKIPPED,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[crm/captureFromEmail] error:', emailMessageId, msg)
    return { status: 'skipped', reason: `error: ${msg}` }
  }
}
