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
import { SALES_CAPTURE_INBOXES, FREEMAIL_DOMAINS } from './captureConstants'
import { classifyForCapture, type VerdictResult, type ParsedPayload } from './classifyForCapture'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'
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
  // (Shared FREEMAIL_DOMAINS constant — same guard as the person-history
  // company suggestions.)
  if (FREEMAIL_DOMAINS.has(domain)) return null

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
  const emailLower = normalizeEmail(parsed.email)
  const role = mapTitleToRole(parsed.title)

  // Alias-aware lookup: if this sender's email was minted onto a
  // PersonEmailAlias by a past merge, the survivor's Person row
  // resolves here. Without this, the loser's old address re-mints a
  // fresh Person on the next inbound and undoes the merge.
  const existing = await resolvePersonByEmail(emailLower, {
    select: {
      id: true,
      phone: true,
      mobile: true,
      rawTitle: true,
      lastKnownProject: true,
      role: true,
    },
  }) as { id: string; phone: string | null; mobile: string | null; rawTitle: string | null; lastKnownProject: string | null; role: PersonRole } | null

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

/**
 * Outreach capture — the Quick Reply (rep-initiated send) path.
 *
 * Unlike `captureFromEmail` (the pubsub ingest path, which gates Person
 * creation behind AUTO_CAPTURED and never creates a Company), this ALWAYS
 * files the sender as a Person (by email — the durable entity) AND ensures
 * the Company exists (match-or-CREATE by name): the rep committed by
 * replying, so the contact is real history and the person needs a home.
 * A newly-created company lands the capture as NEEDS_REVIEW for cleanup.
 * NO Job is created here — a job is a transaction, materialized by the
 * soft-hold / real-intent path. The parsed company name + job name are
 * stored on the capture so the review item is one-click to action later.
 *
 * Reuses the SAME primitives as captureFromEmail — classifyForCapture
 * (verdict + parsed payload), captureNewOrEnrich (Person email upsert +
 * enrichment), findDomainMatchedCompany / findExactNameCompany (Company
 * match) — plus the from-parse company-create shape ({ name, tier: 'NEW' }).
 *
 * Idempotent: Person keyed by email, Company keyed by name, InquiryCapture
 * keyed by EmailMessage.id — re-running yields exactly one Person + one
 * Company. Never throws past the caller (best-effort; capture must never
 * block the reply).
 */
export interface OutreachCaptureOutcome extends CaptureOutcome {
  companyId?: string
  companyCreated?: boolean
}

export async function captureOutreachContact(args: {
  emailMessageId: string
  /** Company name from the richer parse-quote extraction (preferred over the
   *  ingest Haiku's companyString when present). */
  companyNameHint?: string | null
  /** Job/production name — stored on the capture for one-click action later;
   *  no Job row is created here. */
  projectHint?: string | null
}): Promise<OutreachCaptureOutcome> {
  try {
    const email = await prisma.emailMessage.findUnique({
      where: { id: args.emailMessageId },
      select: {
        id: true, fromAddress: true, subject: true, snippet: true, bodyText: true,
        direction: true, rfc822MessageId: true, extractedData: true, duplicateOfId: true,
        emailAccount: { select: { emailAddress: true } },
      },
    })
    if (!email) return { status: 'skipped', reason: 'EmailMessage not found' }
    const inbox = email.emailAccount.emailAddress.toLowerCase()
    if (!SALES_CAPTURE_INBOXES.has(inbox)) return { status: 'skipped', reason: `inbox ${inbox} not in capture allowlist` }
    if (email.direction !== 'inbound') return { status: 'skipped', reason: `direction=${email.direction} (capture is INBOUND-only)` }
    if (email.duplicateOfId) return { status: 'skipped', reason: 'duplicate-of EmailMessage row' }

    // Already fully captured (a prior capture that already filed a Person) →
    // idempotent no-op. A prior pubsub NEEDS_REVIEW row WITHOUT a person is
    // upgraded below (the rep's reply makes it real).
    const prior =
      (await prisma.inquiryCapture.findUnique({ where: { emailMessageId: email.id }, select: { id: true, personId: true, companyId: true, verdict: true } })) ??
      (email.rfc822MessageId
        ? await prisma.inquiryCapture.findFirst({ where: { rfc822MessageId: email.rfc822MessageId }, select: { id: true, personId: true, companyId: true, verdict: true } })
        : null)
    if (prior?.personId) {
      return { status: 'duplicate', reason: 'contact already captured for this email', captureId: prior.id, personId: prior.personId, companyId: prior.companyId ?? undefined, verdict: prior.verdict }
    }

    const extracted = (email.extractedData as ExtractedMessage | null) ?? null
    const domain = senderDomain(email.fromAddress)
    const domainMatchedCompanyId = await findDomainMatchedCompany(domain)
    const verdict = classifyForCapture({
      inbox, fromAddress: email.fromAddress, subject: email.subject,
      bodySnippet: email.snippet ?? email.bodyText ?? null, extracted, domainMatchedCompanyId,
    })
    const parsed = verdict.parsed
    if (!parsed.email) return { status: 'skipped', reason: 'no sender email to file' }

    // PERSON — always file (email match → enrich, else create).
    const enriched = await captureNewOrEnrich({ parsed, emailMessageId: email.id, inbox })

    // COMPANY — match (domain → exact name), else CREATE (from-parse shape).
    const companyName = (args.companyNameHint?.trim() || parsed.companyString || '').trim()
    const exactNameCompanyId = await findExactNameCompany(companyName || null)
    let companyId: string | null = domainMatchedCompanyId ?? exactNameCompanyId
    let companyCreated = false
    if (!companyId && companyName.length >= 3) {
      const co = await prisma.company.create({ data: { name: companyName, tier: 'NEW' }, select: { id: true } })
      companyId = co.id
      companyCreated = true
    }

    // A new company needs human cleanup → NEEDS_REVIEW; a person filed into a
    // known/no company is AUTO_CAPTURED.
    const finalVerdict = companyCreated ? CaptureVerdict.NEEDS_REVIEW : CaptureVerdict.AUTO_CAPTURED
    const resolution = companyCreated ? CaptureResolution.PENDING : enriched.resolution
    const project = (args.projectHint?.trim() || parsed.project) ?? null

    const captureData = {
      inbox,
      verdict: finalVerdict,
      verdictReason: companyCreated ? `${verdict.reason} · created company "${companyName}" for review` : verdict.reason,
      signals: verdict.signals,
      parsedName: parsed.name,
      parsedEmail: parsed.email,
      parsedPhone: parsed.phone,
      parsedTitle: parsed.title,
      parsedCompanyString: companyName || parsed.companyString,
      parsedProject: project,
      personId: enriched.personId,
      companyId,
      resolution,
      enrichmentLog: enriched.enrichmentLog as unknown as Prisma.InputJsonValue,
      ...(finalVerdict === CaptureVerdict.AUTO_CAPTURED ? { resolvedAt: new Date() } : {}),
    }

    let captureId: string
    if (prior) {
      // Upgrade an existing (person-less) capture in place — no duplicate row.
      await prisma.inquiryCapture.update({ where: { id: prior.id }, data: captureData })
      captureId = prior.id
    } else {
      const created = await prisma.inquiryCapture.create({
        data: { ...captureData, emailMessageId: email.id, rfc822MessageId: email.rfc822MessageId },
        select: { id: true },
      })
      captureId = created.id
    }

    return {
      status: finalVerdict === CaptureVerdict.NEEDS_REVIEW ? 'needs_review' : 'auto_captured',
      reason: captureData.verdictReason,
      captureId,
      personId: enriched.personId,
      companyId: companyId ?? undefined,
      companyCreated,
      verdict: finalVerdict,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[crm/captureOutreachContact] error:', args.emailMessageId, msg)
    return { status: 'skipped', reason: `error: ${msg}` }
  }
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
