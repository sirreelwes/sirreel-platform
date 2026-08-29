import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { promoteHoldsOnApproval } from '@/lib/orders/holdOnQuoteSend'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'
import {
  ensureSignedAgreementForOrder,
  ensureBaselineRentalDocumentToSign,
} from '@/lib/orders/signedAgreement'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { requestSubRentalsOnApproval } from '@/lib/sub-rentals/requestOnApproval'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/portal/job/approve-quote
 *
 * The client-side half of "send quote → client says yes". Cookie-authenticated
 * from the Job Page portal (same gate as /api/portal/job/coi), so the person
 * clicking is the contact the magic link was issued to.
 *
 * Approving does two things in one action:
 *   1. Flips the order QUOTE_SENT (or DRAFT) → APPROVED, syncing quoteStatus
 *      to WON and stamping wonAt. APPROVED is a GATE, not an auto-book —
 *      bookOrder() still requires an explicit staff action, it just becomes
 *      available. (Wes, 2026-08-25: client approval is the yes.)
 *   2. Releases the rental agreement into the same portal, so the Rental
 *      Agreement row flips from "your rep will send this shortly" to a live
 *      "Sign agreement →" without anyone at SirReel touching it. Composed
 *      from the same three helpers /api/orders/[id]/send-paperwork-portal
 *      uses — no contract text is rendered here.
 *   3. Asks any partner whose unit we quoted on this order to actually HOLD
 *      it (requestSubRentalsOnApproval). Until this existed the vendor's last
 *      word from us was the estimate notice's "this is NOT a booking", no
 *      matter what the client did — so a sub-rented coach stayed bookable by
 *      someone else right through to the shoot date.
 *
 * Idempotent: a double-click (or an already-approved order) returns ok with
 * alreadyApproved=true rather than re-stamping wonAt or re-releasing.
 *
 * Agreement prep is best-effort and NEVER fails the approval. The client's
 * "yes" is the durable fact; if the release breaks, the order is still
 * approved, the rep is still told, and agreementError says what needs a hand.
 */

// Portal states from which the agreement is already reviewable/signable —
// no release needed. Mirrors send-paperwork-portal.
const ALREADY_SIGNABLE = new Set([
  'PORTAL_RELEASED',
  'NEGOTIATED_READY',
  'DOWNLOAD_SENT',
  'REDLINE_UPLOADED',
  'UNDER_REVIEW',
])
const ALREADY_SIGNED = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'])

// Only a quote the client could actually have reviewed is approvable.
const APPROVABLE_FROM = new Set(['DRAFT', 'QUOTE_SENT'])

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      sentAt: true,
      wonAt: true,
      lostAt: true,
      quotePdfUrl: true,
      total: true,
      archivedAt: true,
      _count: { select: { lineItems: true } },
      agent: { select: { id: true, name: true, email: true } },
      company: { select: { name: true } },
      job: { select: { id: true, name: true, jobCode: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (order.status === 'CANCELLED') {
    return NextResponse.json(
      { error: 'This order was cancelled. Contact your SirReel rep.' },
      { status: 409 },
    )
  }
  // Already past the quote stage — treat as success so a double-click or a
  // stale tab reads as "done", not as an error the client has to interpret.
  if (!APPROVABLE_FROM.has(order.status)) {
    return NextResponse.json({ ok: true, alreadyApproved: true, status: order.status })
  }
  // An archived or emptied order is not approvable. Archive is how a
  // superseded quote gets retired — when its lines are merged into
  // another order, the client keeps a working portal link to a shell
  // whose PDF still shows the old numbers. On 2026-08-26 a client
  // approved exactly that: an archived order, zero line items, $0 total,
  // which released a rental agreement against nothing. The status guards
  // above don't catch it (the shell is still QUOTE_SENT) and neither
  // does the PDF guard (the stale PDF is still attached).
  if (order.archivedAt || order._count.lineItems === 0) {
    return NextResponse.json(
      {
        error:
          'This quote has been superseded. Your SirReel rep has sent a replacement — please approve that one, or contact them if you cannot find it.',
      },
      { status: 409 },
    )
  }
  // The button is hidden without a quote PDF; enforce it here too so the
  // client can never approve something they were never shown.
  if (!order.quotePdfUrl) {
    return NextResponse.json(
      { error: 'There is no quote to approve yet. Your SirReel rep is still finalizing it.' },
      { status: 409 },
    )
  }

  const approvedAt = new Date()
  const sync = computeQuoteStatusSync('APPROVED', {
    sentAt: order.sentAt,
    wonAt: order.wonAt,
    lostAt: order.lostAt,
  }, approvedAt)

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'APPROVED', ...sync },
  })

  // The quote's soft holds become firm now the client has said yes
  // (Wes 2026-08-25). Sending the quote reserves the fleet at backup rank
  // so a dead quote can't freeze a truck; approval is the moment it
  // should actually block. Best-effort like the rest of the post-approval
  // work below — the approval is the durable fact.
  const promotion = await promoteHoldsOnApproval(order.id)
  if (promotion.error) {
    console.error('[approve-quote] hold promotion failed:', promotion.error)
  }

  const approverName =
    [resolved.contact?.firstName, resolved.contact?.lastName].filter(Boolean).join(' ').trim() ||
    resolved.contact?.email ||
    'the client'

  // Audit BEFORE the best-effort work: the approval is the durable fact and
  // must be recorded even if the release or the notifications fall over.
  // userId stays null — the actor is a client contact, not an HQ User.
  await prisma.auditLog.create({
    data: {
      action: 'order.quote_approved_by_client',
      entityType: 'Order',
      entityId: order.id,
      oldValues: { status: order.status },
      newValues: {
        status: 'APPROVED',
        approvedBy: approverName,
        approvedByContactId: resolved.contactId,
        portalAccessId: resolved.portalAccessId,
      },
      ipAddress: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    },
  }).catch((err) => console.error('[approve-quote] audit write failed:', err))

  // ── Release the rental agreement into this portal ──────────────────
  let agreementStatus: string | null = null
  let agreementError: string | null = null
  try {
    await ensureSignedAgreementForOrder(order.id)
    await ensureBaselineRentalDocumentToSign(order.id)
    const agreement = await prisma.signedAgreement.findUnique({
      where: { orderId_contractType: { orderId: order.id, contractType: 'RENTAL_AGREEMENT' } },
      select: { id: true, status: true, documentToSignUrl: true },
    })
    if (!agreement) {
      agreementError = 'No rental agreement row could be created for this order.'
    } else if (ALREADY_SIGNED.has(agreement.status) || ALREADY_SIGNABLE.has(agreement.status)) {
      agreementStatus = agreement.status
    } else if (agreement.status === 'PORTAL_GENERATED') {
      if (!agreement.documentToSignUrl) {
        agreementError = 'Agreement PDF could not be generated.'
      } else {
        const updated = await prisma.signedAgreement.update({
          where: { id: agreement.id },
          data: { status: 'PORTAL_RELEASED' },
          select: { status: true },
        })
        agreementStatus = updated.status
      }
    } else {
      agreementStatus = agreement.status
    }
  } catch (err: any) {
    agreementError = err?.message || 'Agreement preparation failed.'
    console.error('[approve-quote] agreement prep failed:', err)
  }

  // ── Ask any sub-rental partner to hold their unit ──────────────────
  // Best-effort in the same sense as the agreement release: the flip to
  // REQUESTED is durable, and a partner we failed to reach is reported
  // rather than swallowed — see requestOnApproval's failure posture.
  let subRentals: Awaited<ReturnType<typeof requestSubRentalsOnApproval>> = {
    requested: [],
    unnotified: [],
  }
  try {
    subRentals = await requestSubRentalsOnApproval({
      orderId: order.id,
      jobId: order.job?.id ?? null,
      jobCode: order.job?.jobCode ?? null,
      agentName: order.agent?.name ?? null,
      agentEmail: order.agent?.email ?? null,
    })
  } catch (err) {
    console.error('[approve-quote] sub-rental hold request failed:', err)
  }

  // ── Tell the rep: email + in-app Alert (Wes, 2026-08-25) ───────────
  const orderLink = `/orders/${order.id}`
  const headline = `${order.company?.name || 'A client'} approved quote ${order.orderNumber}`
  const jobLabel = order.job ? `${order.job.name} (${order.job.jobCode})` : '—';

  // A partner we could not reach is as urgent as an unreleased agreement:
  // the client is committed to a unit whose owner still thinks it's free.
  const subRentalAlertLine = subRentals.unnotified.length
    ? ` ${subRentals.unnotified.length} sub-rental partner${
        subRentals.unnotified.length === 1 ? '' : 's'
      } could NOT be asked to hold — call them.`
    : subRentals.requested.length
      ? ` ${subRentals.requested.length} sub-rental partner${
          subRentals.requested.length === 1 ? ' was' : 's were'
        } asked to hold.`
      : ''

  await prisma.alert.create({
    data: {
      type: 'quote.approved',
      title: headline,
      body: `${approverName} approved ${order.orderNumber} in the client portal.${
        agreementError
          ? ' The rental agreement could NOT be released automatically — release it manually.'
          : ' The rental agreement has been released for signature.'
      }${subRentalAlertLine}`,
      severity: agreementError || subRentals.unnotified.length ? 'high' : 'medium',
      link: orderLink,
    },
  }).catch((err) => console.error('[approve-quote] alert write failed:', err))

  if (order.agent?.email) {
    const agreementLine = agreementError
      ? `<p style="color:#b91c1c"><strong>Action needed:</strong> the rental agreement could not be released automatically (${agreementError}). Open the order and use &ldquo;Send for signature&rdquo;.</p>`
      : `<p>The rental agreement has been released to their portal — they can sign it now.</p>`

    const fmtSub = (r: (typeof subRentals.requested)[number]) =>
      `${r.vendorName} — ${r.vehicleName}${r.startDate ? ` (${r.startDate}${r.endDate && r.endDate !== r.startDate ? ` → ${r.endDate}` : ''})` : ''}`
    const subRentalHtml = subRentals.requested.length
      ? `<p><strong>Sub-rentals</strong></p><ul>${subRentals.requested
          .map((r) =>
            r.notified
              ? `<li>${fmtSub(r)} — asked to hold.</li>`
              : `<li style="color:#b91c1c">${fmtSub(r)} — <strong>NOT asked to hold:</strong> ${r.warning}</li>`,
          )
          .join('')}</ul>${
          subRentals.unnotified.length
            ? `<p style="color:#b91c1c"><strong>Action needed:</strong> call the partners above — the client is committed to a unit whose owner has not been asked to block the dates.</p>`
            : ''
        }`
      : ''
    const subRentalText = subRentals.requested.length
      ? '\nSub-rentals:\n' +
        subRentals.requested
          .map((r) => (r.notified ? `  · ${fmtSub(r)} — asked to hold.` : `  · ${fmtSub(r)} — NOT ASKED: ${r.warning}`))
          .join('\n') +
        '\n'
      : ''
    await sendAgreementEmail({
      to: [order.agent.email],
      subject: headline,
      label: 'quote-approved-rep',
      orderId: order.id,
      html: `
        <p><strong>${approverName}</strong> just approved quote <strong>${order.orderNumber}</strong> in the client portal.</p>
        <p>Job: ${jobLabel}<br/>Client: ${order.company?.name || '—'}<br/>Total: $${Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        ${agreementLine}
        ${subRentalHtml}
        <p>The order is now APPROVED and ready to book.</p>
      `,
      text:
        `${approverName} approved quote ${order.orderNumber} in the client portal.\n` +
        `Job: ${jobLabel}\nClient: ${order.company?.name || '—'}\n` +
        (agreementError
          ? `ACTION NEEDED: the rental agreement could not be released automatically (${agreementError}).\n`
          : `The rental agreement has been released to their portal.\n`) +
        subRentalText +
        `The order is now APPROVED and ready to book.`,
    }).catch((err) => console.error('[approve-quote] rep email failed:', err))
  }

  return NextResponse.json({
    ok: true,
    status: 'APPROVED',
    approvedAt: approvedAt.toISOString(),
    agreementStatus,
    agreementError,
    subRentalsRequested: subRentals.requested.length,
    subRentalsUnnotified: subRentals.unnotified.length,
  })
}
