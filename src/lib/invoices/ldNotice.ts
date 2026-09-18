/**
 * The L&D notice — tell the production what did not come back BEFORE
 * anybody raises an invoice.
 *
 * Wes, 2026-09-18: *"It should be cued up for her to first notify the
 * production with those replacement items if they're lost, and what that
 * would cost, or to be able to write in something about damage and the cost
 * that that would be."*
 *
 * Two entry points, one shape:
 *   - compose() — what the notice WOULD say, derived from the check-in sheet
 *     via buildLdCandidates. Nothing is written; the composer previews it.
 *   - send()    — freezes those lines onto an LdNotice row and emails the
 *     production's primary contact, copying the rest of the job's contacts
 *     and billing.
 *
 * Why the lines are FROZEN on send: the candidates are derived live from the
 * inbound sheet and inventory `replacementCost`, and both move — a re-count
 * changes the sheet, and a catalog edit changes the price. What the client
 * was quoted must not drift under them, and the invoice that follows has to
 * bill exactly what the notice promised. It is also the only way Ana's
 * written-in damage lines survive to the invoice instead of being retyped.
 *
 * NOT an invoice, and the difference is load-bearing: no invoice number, no
 * due date, no payment link, no Invoice row. See templates/ldNotice.ts.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { rankRecipients } from '@/lib/email/recipients'
import { withBillingCc } from '@/lib/email/billingVisibility'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { isEmailAddress } from '@/lib/email/ccList'
import { buildLdNoticeEmail, type LdNoticeLine } from '@/lib/email/templates/ldNotice'
import { buildLdCandidates } from '@/lib/invoices/ldCandidates'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'

/** What a stored notice line looks like in the `lines` JSON column. */
export interface StoredLdNoticeLine extends LdNoticeLine {
  /** The candidate key it came from, or `manual:*` for a written-in line.
   *  Carried so the invoice composer can tell a derived line from a typed
   *  one, and so a DamageItem can still be stamped when it bills. */
  key: string
  damageItemId?: string
}

export interface LdNoticeComposition {
  orderId: string
  orderNumber: string
  jobName: string | null
  companyName: string | null
  checkedInAt: string | null
  lines: StoredLdNoticeLine[]
  /** Who it would go to, resolved the same way an invoice resolves it. */
  to: { id: string; name: string; email: string } | null
  cc: string[]
  /** A notice already sent on this order — the composer says so rather than
   *  letting Ana tell the same production twice without meaning to. */
  lastNotice: {
    id: string
    sentAt: string | null
    sentToAddress: string | null
    subtotal: number
    lineCount: number
  } | null
}

/**
 * A candidate's kind, for the notice's grouping and wording.
 *
 * Deliberately permissive about `source`: the check-in sheet grew a
 * `CHECK_IN_DAMAGED` source separately, and anything that is not an
 * outright shortfall reads as damage here. A source this function has
 * never heard of must not crash the composer.
 */
function kindOf(source: string): LdNoticeLine['kind'] {
  return source === 'CHECK_IN_SHORT' ? 'MISSING' : 'DAMAGE'
}

/**
 * The candidate list labels lines for the billing desk — "Not returned —
 * Cooler, 68 qt", "Came back damaged — …". That prefix is right on Ana's
 * screen and wrong in a client's inbox: the email already says what the
 * list is, and reading our internal shorthand back to a production is how
 * a notice starts sounding like an accusation. Strip it and let the item
 * be the item.
 */
const CLIENT_PREFIXES = [/^not returned\s*[—–-]\s*/i, /^came back damaged\s*[—–-]\s*/i]

function clientDescription(raw: string): string {
  let out = raw.trim()
  for (const re of CLIENT_PREFIXES) out = out.replace(re, '')
  return out.trim() || raw.trim()
}

/** What the notice would say. Reads only. */
export async function composeLdNotice(orderId: string): Promise<LdNoticeComposition | null> {
  const set = await buildLdCandidates(orderId)
  if (!set) return null

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      booking: { select: { jobName: true } },
      job: {
        select: {
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      checkReports: {
        where: { edge: 'IN' },
        select: { submittedAt: true },
      },
    },
  })
  if (!order) return null

  const ranked = order.job ? rankRecipients(order.job, order.jobContact) : []
  const primary = ranked[0] ?? null
  // EmailMessage-era junk never reaches this list (these are Person rows),
  // but the guard is cheap and a malformed address fails the WHOLE send.
  const cc = ranked
    .slice(1)
    .map((r) => r.email)
    .filter((e) => isEmailAddress(e))

  const last = await prisma.ldNotice
    .findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, sentAt: true, sentToAddress: true, subtotal: true, lines: true,
      },
    })
    .catch(() => null)

  return {
    orderId: set.orderId,
    orderNumber: set.orderNumber,
    // Client-facing, so it goes through the resolver rather than reading
    // Job.name raw: that is what keeps a placeholder ("TBD", a Planyo cart
    // id) out of a production's inbox. See project_client_facing_job_name.
    jobName: resolveDisplayJobName({
      jobName: set.jobName,
      bookingJobName: order.booking?.jobName ?? null,
      companyName: set.companyName,
    }),
    companyName: set.companyName,
    checkedInAt: order.checkReports[0]?.submittedAt.toISOString() ?? null,
    lines: set.candidates.map((c) => ({
      key: c.key,
      description: clientDescription(c.description),
      qty: c.qty,
      unitPrice: c.unitPrice,
      kind: kindOf(c.source),
      note: c.note,
      ...(c.damageItemId ? { damageItemId: c.damageItemId } : {}),
    })),
    to: primary ? { id: primary.id, name: primary.name, email: primary.email } : null,
    cc,
    lastNotice: last
      ? {
          id: last.id,
          sentAt: last.sentAt?.toISOString() ?? null,
          sentToAddress: last.sentToAddress,
          subtotal: Number(last.subtotal),
          lineCount: Array.isArray(last.lines) ? last.lines.length : 0,
        }
      : null,
  }
}

export type SendLdNoticeResult =
  | { ok: true; noticeId: string; sentTo: string; cc: string[]; subtotal: number }
  | { ok: false; status: number; error: string }

/**
 * Freeze the lines and email the production.
 *
 * The row is written BEFORE the send and stamped after, so a notice that
 * failed to leave is still on the record with `sentAt` null — the composer
 * can then show Ana that it did not go, rather than losing what she typed.
 */
export async function sendLdNotice(args: {
  orderId: string
  lines: StoredLdNoticeLine[]
  note: string | null
  senderId: string
  senderName: string | null
  /** Reply-To. The email tells the client a reply reaches this person by
   *  name, so the two must not disagree. */
  senderEmail: string
  /** Override the resolved primary contact — rare, when the producer is
   *  not the right person to hear about a missing case. */
  toEmailOverride?: string | null
}): Promise<SendLdNoticeResult> {
  if (args.lines.length === 0) {
    return { ok: false, status: 400, error: 'a notice needs at least one line' }
  }

  const composition = await composeLdNotice(args.orderId)
  if (!composition) return { ok: false, status: 404, error: 'order not found' }

  const toEmail = args.toEmailOverride?.trim() || composition.to?.email || null
  if (!toEmail || !isEmailAddress(toEmail)) {
    return {
      ok: false,
      status: 409,
      error: 'no client contact on this order to notify — add a job contact first',
    }
  }
  const contactFirstName =
    composition.to && composition.to.email === toEmail
      ? composition.to.name.split(' ')[0] || null
      : null

  const subtotal = args.lines.reduce((s, l) => s + l.qty * (l.unitPrice > 0 ? l.unitPrice : 0), 0)

  const notice = await prisma.ldNotice.create({
    data: {
      orderId: args.orderId,
      lines: args.lines as unknown as Prisma.InputJsonValue,
      subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
      note: args.note?.trim() || null,
    },
    select: { id: true },
  })

  const mail = buildLdNoticeEmail({
    orderNumber: composition.orderNumber,
    jobName: composition.jobName,
    companyName: composition.companyName,
    contactFirstName,
    checkedInAt: composition.checkedInAt ? new Date(composition.checkedInAt) : null,
    lines: args.lines,
    note: args.note?.trim() || null,
    senderName: args.senderName,
  })

  // Billing is copied for the same reason it is copied on invoices: a notice
  // that leaves without Ana seeing it is a conversation she is not part of.
  const cc = await withBillingCc(composition.cc, toEmail)

  const sent = await sendAgreementEmail({
    to: [toEmail],
    cc,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: args.senderEmail,
    label: `ld-notice:${composition.orderNumber}`,
    orderId: args.orderId,
  })

  if (!sent.ok) {
    return { ok: false, status: 502, error: 'the notice did not send — it is saved, try again' }
  }

  await prisma.ldNotice.update({
    where: { id: notice.id },
    data: {
      sentAt: new Date(),
      sentToAddress: toEmail,
      sentCc: cc,
      sentById: args.senderId,
    },
  })

  return { ok: true, noticeId: notice.id, sentTo: toEmail, cc, subtotal }
}
