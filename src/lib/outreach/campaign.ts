/**
 * Campaign resolution, preview and release.
 *
 * Phase 3. Everything here goes through the Phase 2 guard; nothing here
 * may reach Resend without `sendGuard` saying yes.
 *
 * ── Snapshot, don't re-query ───────────────────────────────────────
 *
 * `resolveRecipients` runs the segment ONCE, at release, and writes a
 * recipient row per person. The runner then works off those rows. A
 * segment is a moving target — contacts are captured hourly — and
 * "exactly who did we mail" has to stay answerable in six months, when
 * re-running the segment would return a different set entirely.
 *
 * ── Idempotency is in the schema, not in a flag ───────────────────
 *
 * (campaignId, personId) is unique. A double-clicked release, a retried
 * request, or a runner resuming after a crash cannot mail anyone twice,
 * because the second insert loses to the constraint rather than to a
 * check that might race.
 *
 * ── The unsubscribe footer is appended HERE ────────────────────────
 *
 * Not left to whoever writes the copy. A campaign whose author forgot
 * the footer is a CAN-SPAM violation, and "remember to include it" is
 * not a control.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { sendGuard, outreachLabel } from '@/lib/outreach/sendGuard'
import { filterSuppressed } from '@/lib/outreach/suppression'
import { mintUnsubscribeParts } from '@/lib/outreach/unsubscribeToken'
import { outreachUnsubscribeUrl } from '@/lib/portal/portalUrl'
import { renderForRecipient, type RecipientContext } from '@/lib/outreach/mergeFields'
import { segmentWhere } from '@/lib/crm/peopleSegmentQuery'
import { isPeopleSegmentKey } from '@/lib/crm/peopleSegments'

export interface SegmentSelection {
  segmentKey?: string | null
  roleKey?: string | null
  search?: string | null
}

export interface ResolvedRecipient {
  personId: string
  email: string
  ctx: RecipientContext
}

/**
 * Who this segment currently resolves to, minus internal staff and
 * anyone suppressed.
 *
 * Mirrors the People list's own clauses deliberately: the count a rep
 * saw on the chip and the count they see in the composer must agree, or
 * they will reasonably assume one of them is lying.
 */
export async function resolveRecipients(
  selection: SegmentSelection,
  viewerUserId: string | null,
  senderName: string | null,
): Promise<{ recipients: ResolvedRecipient[]; suppressedCount: number; totalBeforeSuppression: number }> {
  const clauses: Prisma.PersonWhereInput[] = [
    // Never mail ourselves.
    { NOT: { email: { contains: '@sirreel.com', mode: 'insensitive' } } },
  ]

  if (selection.roleKey) clauses.push({ role: selection.roleKey as never })
  if (selection.search?.trim()) {
    const tokens = selection.search.trim().split(/\s+/).filter(Boolean)
    clauses.push({
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: 'insensitive' as const } },
          { lastName: { contains: t, mode: 'insensitive' as const } },
          { email: { contains: t, mode: 'insensitive' as const } },
        ],
      })),
    })
  }
  if (selection.segmentKey && isPeopleSegmentKey(selection.segmentKey)) {
    clauses.push(await segmentWhere(selection.segmentKey, { viewerUserId }))
  }

  const people = await prisma.person.findMany({
    where: { AND: clauses },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      lastKnownProject: true,
      affiliations: {
        where: { isCurrent: true },
        select: { company: { select: { name: true, lastRentalAt: true } } },
        take: 1,
      },
    },
  })

  const { sendable } = await filterSuppressed(people.map((p) => p.email))
  const allowed = new Set(sendable)

  const recipients = people
    .filter((p) => allowed.has(p.email.trim().toLowerCase()))
    .map((p) => ({
      personId: p.id,
      email: p.email,
      ctx: {
        firstName: p.firstName,
        lastName: p.lastName,
        companyName: p.affiliations[0]?.company.name ?? null,
        lastKnownProject: p.lastKnownProject,
        companyLastRentalAt: p.affiliations[0]?.company.lastRentalAt ?? null,
        senderName,
      } satisfies RecipientContext,
    }))

  return {
    recipients,
    totalBeforeSuppression: people.length,
    suppressedCount: people.length - recipients.length,
  }
}

export interface PreviewRow {
  personId: string
  email: string
  ok: boolean
  subject: string
  body: string
  missing: string[]
}

/**
 * Render a handful of REAL recipients.
 *
 * Real ones, not a fabricated "Jane Example": the whole risk of a merge
 * is a contact whose company is null or whose name is a legacy "." row,
 * and a synthetic preview hides exactly those. Samples are taken from
 * the front, middle and end of the resolved list so a preview is not
 * three variations of the same well-populated record.
 */
export function buildPreview(
  subjectTemplate: string,
  bodyTemplate: string,
  recipients: ResolvedRecipient[],
  count = 3,
): PreviewRow[] {
  if (recipients.length === 0) return []
  const idx = new Set<number>()
  idx.add(0)
  if (recipients.length > 2) idx.add(Math.floor(recipients.length / 2))
  if (recipients.length > 1) idx.add(recipients.length - 1)
  const picks = [...idx].slice(0, count)

  return picks.map((i) => {
    const r = recipients[i]
    const rendered = renderForRecipient(subjectTemplate, bodyTemplate, r.ctx)
    return {
      personId: r.personId,
      email: r.email,
      ok: rendered.ok,
      subject: rendered.subject,
      body: rendered.body,
      missing: rendered.missing,
    }
  })
}

/**
 * How many recipients would be unsendable because a token has no value
 * for them. Surfaced BEFORE release so the rep can rewrite the sentence
 * or wrap it in a conditional, rather than discovering it in the
 * skipped-count afterwards.
 */
export function countUnrenderable(
  subjectTemplate: string,
  bodyTemplate: string,
  recipients: ResolvedRecipient[],
): { unrenderable: number; byToken: Record<string, number> } {
  const byToken: Record<string, number> = {}
  let unrenderable = 0
  for (const r of recipients) {
    const res = renderForRecipient(subjectTemplate, bodyTemplate, r.ctx)
    if (!res.ok) {
      unrenderable += 1
      for (const t of res.missing) byToken[t] = (byToken[t] ?? 0) + 1
    }
  }
  return { unrenderable, byToken }
}

/** Append the unsubscribe footer. Never optional. */
export function withUnsubscribeFooter(body: string, email: string): { text: string; html: string } {
  const url = outreachUnsubscribeUrl(mintUnsubscribeParts(email))
  const text = `${body}\n\n—\nYou're receiving this because we've worked together or crossed paths on a production.\nUnsubscribe: ${url}`
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  const html =
    `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917">` +
    `${escaped}` +
    `<hr style="border:0;border-top:1px solid #e7e5e4;margin:28px 0 12px">` +
    `<p style="font-size:12px;color:#78716c;margin:0">You're receiving this because we've worked together or crossed paths on a production.<br>` +
    `<a href="${url}" style="color:#78716c">Unsubscribe</a></p></div>`
  return { text, html }
}

export interface ReleaseResult {
  sent: number
  skipped: number
  failed: number
  blocked?: string
}

/**
 * Send a campaign's PENDING recipients.
 *
 * Re-entrant: only PENDING rows are touched, so a second call after a
 * timeout resumes rather than duplicating.
 */
export async function releaseCampaign(campaignId: string, userId: string): Promise<ReleaseResult> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true, subject: true, bodyTemplate: true, fromName: true,
      fromAddress: true, replyTo: true, status: true,
    },
  })
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'CANCELLED') return { sent: 0, skipped: 0, failed: 0, blocked: 'Campaign was cancelled.' }

  const pending = await prisma.outreachCampaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    select: { id: true, personId: true, email: true, renderedSubject: true, renderedBody: true },
  })
  if (pending.length === 0) return { sent: 0, skipped: 0, failed: 0 }

  const from = campaign.fromAddress ?? ''
  const guard = await sendGuard({ userId, fromAddress: from, recipients: pending.map((r) => r.email) })
  if (!guard.allowed) {
    return { sent: 0, skipped: 0, failed: 0, blocked: guard.message ?? guard.reason }
  }

  const allowed = new Set(guard.sendable)
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of pending) {
    const normalized = row.email.trim().toLowerCase()

    if (!allowed.has(normalized)) {
      // Suppressed or beyond today's cap. Left PENDING when it was a cap
      // (tomorrow's run picks it up); marked SKIPPED when suppressed.
      const wasSuppressed = guard.suppressed.some((s) => s.email === normalized)
      if (wasSuppressed) {
        await prisma.outreachCampaignRecipient.update({
          where: { id: row.id },
          data: { status: 'SKIPPED', reason: 'On the suppression list' },
        })
        skipped += 1
      }
      continue
    }

    if (!row.renderedSubject || !row.renderedBody) {
      await prisma.outreachCampaignRecipient.update({
        where: { id: row.id },
        data: { status: 'SKIPPED', reason: 'Copy could not be personalised for this contact' },
      })
      skipped += 1
      continue
    }

    const { text, html } = withUnsubscribeFooter(row.renderedBody, row.email)
    const result = await sendAgreementEmail({
      to: [row.email],
      subject: row.renderedSubject,
      html,
      text,
      replyTo: campaign.replyTo ?? undefined,
      label: outreachLabel(userId, campaign.id),
    })

    if (!result.ok) {
      await prisma.outreachCampaignRecipient.update({
        where: { id: row.id },
        data: { status: 'FAILED', reason: result.reason ?? 'send failed' },
      })
      failed += 1
      continue
    }

    const sentAt = new Date()
    await prisma.outreachCampaignRecipient.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt, resendMessageId: result.id ?? null },
    })

    if (result.id) {
      await recordEmailDelivery({
        resendMessageId: result.id,
        toAddress: row.email,
        subject: row.renderedSubject,
        label: outreachLabel(userId, campaign.id),
      })
    }

    // The touch lands on the contact's timeline like any other, so the
    // history stays whole and a rep doesn't cold-call someone we mailed
    // this morning.
    await prisma.outreachActivity.create({
      data: {
        type: 'EMAIL',
        personId: row.personId,
        notes: `Outreach campaign: ${campaign.subject}`,
        occurredAt: sentAt,
        createdById: userId,
      },
    })
    sent += 1
  }

  const remaining = await prisma.outreachCampaignRecipient.count({
    where: { campaignId, status: 'PENDING' },
  })
  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      status: remaining > 0 ? 'SENDING' : 'SENT',
      releasedAt: campaign.status === 'DRAFT' ? new Date() : undefined,
      completedAt: remaining > 0 ? null : new Date(),
    },
  })

  return { sent, skipped, failed }
}
