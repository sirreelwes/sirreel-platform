/**
 * hr@ → HrEmail / HrMail / HrAttachment ingest pipeline.
 *
 * Structural isolation: this helper writes ONLY to the HR tables.
 * It never touches EmailMessage / EmailThread / ClaimMail. The
 * pubsub handler short-circuits hr@ to this helper BEFORE the normal
 * EmailMessage write path; the ingest filter has HR mode that
 * returns keep:false as a safety belt; this file's transactions
 * never reference the standard email tables.
 *
 * Called fire-and-forget from src/app/api/gmail/pubsub. Never throws
 * past the caller — failure is logged and the function returns.
 *
 * Pipeline per message:
 *   1. Authorship gate (shouldIngestHrEmail). Already checked by the
 *      caller; re-checked here as belt-and-suspenders.
 *   2. Upsert HrEmail keyed on gmailMessageId (idempotent).
 *   3. rfc822 cross-inbox idempotency — if another HrEmail with the
 *      same Message-Id has already been processed, mirror the HrMail
 *      link onto this row and stop.
 *   4. Pull body + attachments fresh from Gmail (the shared helper).
 *   5. Parse via Sonnet (parseHrEmail) — employee name guess +
 *      category + summary + confidence.
 *   6. Match employee against the Employee table (workEmail,
 *      personalEmails, fullName fuzzy).
 *   7. Decide disposition:
 *        FILED         — confident match + category set
 *        NEEDS_REVIEW  — partial info; Wes/Dani triage in the UI
 *        IGNORED       — non-HR noise (auto-replies, OOO, etc.)
 *   8. Upsert HrMail with the parse snapshot.
 *   9. Persist attachments via the shared forEachInboxAttachment
 *      iterator. Each attachment gets the same Sonnet document
 *      classifier the claims path uses — repurposed here to set
 *      HrAttachment.category by mapping the classifier output.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import type { HrCategory, HrDisposition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseHrEmail, type ParsedHrEmail } from '@/lib/hr/parseHrEmail'
import { shouldIngestHrEmail, HR_INBOX } from '@/lib/hr/shouldIngestHrEmail'
import { extractRoutingHeaders } from '@/lib/email/routingHeaders'
import { extractBodyFromGmailPayload, type GmailMessagePart } from '@/lib/email/body'
import {
  fetchGmailMessageFull,
  forEachInboxAttachment,
  getGmailClientForInbox,
  type GmailAttachmentMeta,
} from '@/lib/email/persistGmailAttachments'

const TEXT_MIN_CHARS = 30
const TEXT_MAX_CHARS = 200_000

export interface HrIngestOutcome {
  status: 'filed' | 'needs_review' | 'ignored' | 'skipped'
  reason?: string
  hrEmailId?: string
  hrMailId?: string
  employeeId?: string | null
  attachmentsAttached?: number
}

export async function ingestHrEmail(args: {
  inbox: string
  gmailMessageId: string
  fromAddress: string
  /** Routing headers from the message. Required for the Path B (forward
   *  alias) flow where args.inbox != hr@. The gate uses these to
   *  confirm hr@ addressing before we do any DB work. Optional when
   *  args.inbox is hr@ directly (Path A). */
  routingHeaders?: import('@/lib/email/routingHeaders').RoutingHeaders | null
}): Promise<HrIngestOutcome> {
  try {
    if (!shouldIngestHrEmail({
      inbox: args.inbox,
      fromAddress: args.fromAddress,
      routingHeaders: args.routingHeaders ?? null,
    })) {
      return { status: 'skipped', reason: 'gate rejected (wrong inbox or hr@-authored)' }
    }
    return await runIngest(args.inbox, args.gmailMessageId)
  } catch (err) {
    console.error('[hr/ingestHrEmail] failed for', args.gmailMessageId, err instanceof Error ? err.message : err)
    return { status: 'skipped', reason: 'error' }
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/\x00-\x1f]+/g, '_').replace(/\s+/g, '_').slice(0, 180) || 'attachment'
}

async function runIngest(inbox: string, gmailMessageId: string): Promise<HrIngestOutcome> {
  // ── 1. Pull fresh body + attachments + payload from Gmail. We need
  //    the payload to extract per-recipient routing headers + body
  //    in one shot (matches the EmailMessage write path on the
  //    standard side).
  const gmail = getGmailClientForInbox(inbox)
  let payload: GmailMessagePart | undefined
  let headers: { name?: string | null; value?: string | null }[] = []
  let internalDate = 0
  try {
    const res = await gmail.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' })
    payload = res.data.payload as GmailMessagePart | undefined
    headers = res.data.payload?.headers ?? []
    internalDate = parseInt(res.data.internalDate || '0', 10)
  } catch (err) {
    console.error('[hr/ingestHrEmail] Gmail fetch failed for', gmailMessageId, err instanceof Error ? err.message : err)
    return { status: 'skipped', reason: 'gmail fetch failed' }
  }

  const get = (n: string): string => headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || ''
  const fromAddress = get('From')
  const subject = get('Subject') || '(no subject)'
  const rfc822MessageId = get('Message-ID') || get('Message-Id') || null
  const inReplyTo = get('In-Reply-To') || null
  const body = extractBodyFromGmailPayload(payload)
  const routingHeaders = extractRoutingHeaders(headers)
  const sentAt = new Date(internalDate)

  // ── 2. Upsert HrEmail keyed on gmailMessageId. Idempotent across
  //    retries — if pubsub fires twice for the same message we keep
  //    the original row.
  const hrEmail = await prisma.hrEmail.upsert({
    where: { gmailMessageId },
    create: {
      gmailMessageId,
      rfc822MessageId,
      inReplyTo,
      fromAddress,
      toAddresses: [inbox],
      subject,
      snippet: body.bodyText?.slice(0, 240) ?? null,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      bodySource: body.bodySource,
      attachmentCount: 0,
      routingHeaders: routingHeaders ?? Prisma.JsonNull,
      sentAt,
    },
    update: {
      // Idempotent update — only fields that could legitimately have
      // been missing on the first write (rare since pubsub always
      // pulls format=full).
      bodyText: body.bodyText ?? undefined,
      bodyHtml: body.bodyHtml ?? undefined,
      bodySource: body.bodySource ?? undefined,
    },
    select: { id: true },
  })

  // ── 3. Cross-inbox dedup. If any other HrEmail with the same
  //    rfc822 Message-Id already has an HrMail row, mirror the link
  //    onto this email and stop. Real-world: Wes forwards an
  //    employee complaint from his inbox into hr@ — Gmail typically
  //    preserves the original Message-Id; we don't want two HrMail
  //    rows for one underlying message.
  if (rfc822MessageId) {
    const sibling = await prisma.hrEmail.findFirst({
      where: { rfc822MessageId, id: { not: hrEmail.id }, hrMail: { isNot: null } },
      select: { id: true, hrMail: { select: { id: true, employeeId: true } } },
    })
    if (sibling?.hrMail) {
      // Don't re-create HrMail; let the existing one stand. We do NOT
      // currently mirror the HrMail link onto this duplicate HrEmail
      // — the triage UI deduplicates by rfc822 Message-Id at read
      // time, so duplicates stay invisible.
      return {
        status: 'filed',
        reason: 'duplicate of prior HrEmail; existing HrMail kept',
        hrEmailId: hrEmail.id,
        hrMailId: sibling.hrMail.id,
        employeeId: sibling.hrMail.employeeId,
      }
    }
  }

  // ── 4. Parse via Sonnet. Bounded by parseHrEmail's own try/catch.
  const text = (body.bodyText ?? body.bodyHtml ?? '').trim()
  let parse: ParsedHrEmail
  if (text.length < TEXT_MIN_CHARS) {
    parse = { employeeNameGuess: null, category: null, summary: null, confidence: 0, reasoning: 'body too short to parse' }
  } else {
    parse = await parseHrEmail(text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text)
  }

  // ── 5. Employee match. Search by personalEmails (sender domain
  //    match), then by fullName substring (case-insensitive). Picks
  //    the highest-confidence match; null is fine and falls into
  //    NEEDS_REVIEW.
  const employeeId = await matchEmployee({ parse, fromAddress })

  // ── 6. Decide disposition. Conservative — we'd rather route to
  //    NEEDS_REVIEW than auto-file the wrong employee.
  let disposition: HrDisposition
  let category: HrCategory
  let reason: string | null = null
  if (parse.confidence === 0 || (parse.category == null && parse.summary == null)) {
    disposition = 'IGNORED'
    category = 'OTHER'
    reason = 'no HR signal in body'
  } else if (employeeId && parse.category && parse.confidence >= 0.6) {
    disposition = 'FILED'
    category = parse.category
    reason = `auto-filed: ${parse.category} for matched employee`
  } else {
    disposition = 'NEEDS_REVIEW'
    category = parse.category ?? 'OTHER'
    reason = !employeeId
      ? `no employee match${parse.employeeNameGuess ? ` for "${parse.employeeNameGuess}"` : ''}`
      : 'low confidence — manual review'
  }

  const hrMail = await prisma.hrMail.upsert({
    where: { hrEmailId: hrEmail.id },
    create: {
      hrEmailId: hrEmail.id,
      employeeId,
      category,
      disposition,
      parse: parse as unknown as Prisma.InputJsonValue,
      reason,
    },
    update: {
      employeeId,
      category,
      disposition,
      parse: parse as unknown as Prisma.InputJsonValue,
      reason,
    },
    select: { id: true },
  })

  // ── 7. Persist attachments via shared helper. Each becomes an
  //    HrAttachment row linked to BOTH the HrEmail and (when
  //    available) the matched Employee. Category for now mirrors
  //    the parent HrMail category; downstream UI lets the rep
  //    override per-document.
  let attachmentsAttached = 0
  const attachmentList: GmailAttachmentMeta[] = []
  walkAttachments(payload, attachmentList)
  if (attachmentList.length > 0) {
    attachmentsAttached = await forEachInboxAttachment({
      inbox, gmailMessageId, attachments: attachmentList,
      buildBlobKey: (att) => {
        const now = new Date()
        const yyyy = String(now.getUTCFullYear())
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
        return `hr/${yyyy}/${mm}/${randomUUID()}-att-${safeName(att.filename)}`
      },
      put: (key, data, opts) => put(key, data, opts as { access: 'public'; contentType: string }),
      onAttachment: async (dl) => {
        return prisma.hrAttachment.create({
          data: {
            hrEmailId: hrEmail.id,
            employeeId,
            category,
            title: `Email attachment: ${dl.filename.slice(0, 200)}`,
            fileUrl: dl.fileUrl,
            mimeType: dl.mimeType,
            sizeBytes: dl.bytes,
            typeSource: 'EMAIL_INGEST',
            notes: [
              `Auto-attached from hr@ inbox.`,
              `Filename: ${dl.filename}`,
              `MIME: ${dl.mimeType}`,
              `Size: ${dl.bytes} bytes`,
              `Source HrEmail: ${hrEmail.id}`,
            ].join('\n\n'),
          },
        })
      },
    })
    if (attachmentsAttached > 0) {
      await prisma.hrEmail.update({
        where: { id: hrEmail.id },
        data: { attachmentCount: attachmentsAttached },
      })
    }
  }

  return {
    status: disposition === 'FILED' ? 'filed' : disposition === 'IGNORED' ? 'ignored' : 'needs_review',
    reason: reason ?? undefined,
    hrEmailId: hrEmail.id,
    hrMailId: hrMail.id,
    employeeId,
    attachmentsAttached,
  }
}

function walkAttachments(payload: GmailMessagePart | undefined | null, out: GmailAttachmentMeta[]): void {
  if (!payload) return
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      attachmentId: payload.body.attachmentId,
      size: payload.body.size || 0,
    })
  }
  if (payload.parts) for (const child of payload.parts) walkAttachments(child, out)
}

async function matchEmployee(args: {
  parse: ParsedHrEmail
  fromAddress: string
}): Promise<string | null> {
  const { parse, fromAddress } = args
  const bare = (() => {
    const m = fromAddress.match(/<([^>]+)>/)
    return (m ? m[1] : fromAddress).trim().toLowerCase()
  })()

  // Sender-by-email: rare but precise — payroll provider mails about
  // a known employee → no, this is the SENDER not the subject; skip
  // this signal. (Future enhancement: parse "Re: payroll for
  // <name>" subject patterns.)

  // Name-based fuzzy match. Trim to first/last words; case-insensitive
  // contains against Employee.fullName. Pick the active employee with
  // the longest match (longer = more specific).
  const name = parse.employeeNameGuess?.trim()
  if (!name) return null
  const candidates = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, workEmail: true, personalEmails: true },
  })
  const lower = name.toLowerCase()
  let best: { id: string; len: number } | null = null
  for (const c of candidates) {
    const cn = c.fullName.toLowerCase()
    if (cn === lower || cn.includes(lower) || lower.includes(cn)) {
      const len = Math.min(cn.length, lower.length)
      if (!best || len > best.len) best = { id: c.id, len }
    }
    // Bare-email match against personalEmails (high-signal — bypasses
    // name guessing entirely).
    if (c.workEmail?.toLowerCase() === bare || c.personalEmails.some((e) => e.toLowerCase() === bare)) {
      return c.id
    }
  }
  return best?.id ?? null
}

export { HR_INBOX }
