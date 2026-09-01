import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, buildJobSessionCookieHeader, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'

export const dynamic = 'force-dynamic'

const HQ = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/**
 * POST /api/portal/job/invoice/[id]/approve — the client's answer to a
 * pre-invoice (Wes 2026-09-01: "they can view the invoice and hit
 * approve").
 *
 * Body: { decision: 'APPROVE' } | { decision: 'CHANGES', note: string }
 *
 * APPROVE also CLOSES THE JOB (Wes, same day: "a job being closed
 * shouldn't be a toggle option, but something that happens when a
 * client approves a pre-invoice"). Closing stops being a thing someone
 * remembers to do and becomes a consequence of the client agreeing the
 * numbers. The manual off-ramp stays for the jobs that never reach a
 * pre-invoice at all.
 *
 * Approval does NOT issue the invoice. Issuing stays a staff act
 * (sendInvoice) — the client has agreed the figure, not asked to be
 * billed this second, and money leaving on a client's click is not a
 * decision to automate.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const body = (await req.json().catch(() => ({}))) as { decision?: unknown; note?: unknown }
  const decision = body.decision === 'CHANGES' ? 'CHANGES' : body.decision === 'APPROVE' ? 'APPROVE' : null
  if (!decision) {
    return NextResponse.json({ error: 'decision must be APPROVE or CHANGES' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  if (decision === 'CHANGES' && !note) {
    return NextResponse.json({ error: 'Tell us what needs changing.' }, { status: 400 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true, invoiceNumber: true, status: true, total: true, orderId: true,
      preSentAt: true, clientApprovedAt: true,
      order: {
        select: {
          orderNumber: true, jobId: true,
          company: { select: { name: true } },
          job: { select: { id: true, name: true, jobCode: true, status: true } },
        },
      },
    },
  })
  // Scoped to the caller's own order — a portal session must never be
  // able to answer for someone else's invoice.
  if (!invoice || invoice.orderId !== resolved.orderId) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  if (invoice.status !== 'DRAFT' || !invoice.preSentAt) {
    return NextResponse.json(
      { error: 'This invoice is not awaiting your review.' },
      { status: 409 },
    )
  }

  const contactName = resolved.contact
    ? `${resolved.contact.firstName} ${resolved.contact.lastName}`.trim() || null
    : null
  const contactEmail = resolved.contact?.email ?? null
  const who = contactName || contactEmail || 'the client'
  const now = new Date()

  if (decision === 'APPROVE') {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          clientApprovedAt: now,
          clientApprovedByName: contactName,
          clientApprovedByEmail: contactEmail,
          clientChangeRequestedAt: null,
          clientChangeNote: null,
        },
      })
      // The job closes here rather than by hand. LOST is not overwritten
      // — a lost job that somehow reached a pre-invoice is a data
      // problem, not a job to mark wrapped.
      if (invoice.order.jobId && invoice.order.job && invoice.order.job.status !== 'LOST') {
        await tx.job.update({ where: { id: invoice.order.jobId }, data: { status: 'WRAPPED' } })
      }
      await tx.auditLog.create({
        data: {
          action: 'invoice.pre_approved_by_client',
          entityType: 'Invoice',
          entityId: invoice.id,
          newValues: {
            invoiceNumber: invoice.invoiceNumber,
            approvedBy: contactEmail,
            total: Number(invoice.total),
            jobWrapped: !!invoice.order.jobId,
          },
        },
      })
    })
  } else {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { clientChangeRequestedAt: now, clientChangeNote: note, clientApprovedAt: null },
    })
  }

  // Tell the desk either way — a pre-invoice nobody hears back about is
  // the failure mode this round exists to prevent.
  const jobLabel = invoice.order.job?.name ?? invoice.order.orderNumber
  const approved = decision === 'APPROVE'
  const orderLink = `${HQ}/orders/${invoice.orderId}`
  void sendAgreementEmail({
    to: dedupeEmails([
      ...(await channelRecipients('signed-contract-billing')),
      ...(await channelRecipients('hq-documents')),
    ]),
    subject: approved
      ? `✅ Pre-invoice approved — ${invoice.order.company.name} · ${jobLabel}`
      : `✋ Pre-invoice changes requested — ${invoice.order.company.name} · ${jobLabel}`,
    html: renderEmailShell({
      heading: approved ? 'Client approved the pre-invoice' : 'Client asked for changes',
      eyebrow: invoice.invoiceNumber,
      bodyHtml:
        p(`${esc(who)} ${approved ? 'approved' : 'asked for changes to'} the pre-invoice for <strong>${esc(jobLabel)}</strong>.`) +
        detailTable([
          { label: 'Amount', value: fmtUsd(Number(invoice.total)) },
          { label: 'Order', value: invoice.order.orderNumber },
        ]) +
        (approved
          ? p('The job is now marked wrapped. Issue the invoice when you are ready — approval agrees the figure, it does not send the bill.')
          : calloutBox(`<strong>What they said:</strong><br/>${esc(note)}`)),
      cta: { label: approved ? 'Issue the invoice' : 'Open the order', href: orderLink },
    }),
    text: renderEmailText([
      `${who} ${approved ? 'approved' : 'asked for changes to'} the pre-invoice for ${jobLabel}.`,
      `Amount: ${fmtUsd(Number(invoice.total))} · ${invoice.invoiceNumber}`,
      ...(approved ? ['The job is now wrapped. Issue the invoice when ready.'] : ['', `They said: ${note}`]),
      '',
      orderLink,
    ]),
    label: `pre-invoice-${approved ? 'approved' : 'changes'}:${invoice.invoiceNumber}`,
  })

  return NextResponse.json({ ok: true, decision, approvedAt: approved ? now : null })
}
