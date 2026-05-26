/**
 * POST /api/orders/[id]/send-quote
 *
 * Closes the lifecycle-audit gap where the "Send Quote" button only
 * flipped Order.status → QUOTE_SENT and never actually emailed the
 * client. This route:
 *
 *   1. Resolves the recipient (PRODUCER > primary > PM > PC > any),
 *      reusing the same priority the order detail page surfaces.
 *   2. Fetches the previously-generated Quote PDF from Vercel Blob.
 *      Refuses to send when no PDF exists (agent must generate via
 *      the existing "Regenerate PDF" button first — this prevents
 *      a stale/missing attachment from going out).
 *   3. Sends via the shared sendAgreementEmail wrapper (Resend),
 *      with optional CC to the other JobContacts and an optional
 *      custom note in the body.
 *   4. On email-send success, flips the order to QUOTE_SENT if it
 *      was DRAFT (computeQuoteStatusSync stamps quoteSentAt +
 *      derives quoteStatus=SENT automatically via the PUT route,
 *      so we just hit the same code path).
 *
 * Resends (status already QUOTE_SENT or beyond): email goes out
 * fresh; we do NOT re-flip status or re-stamp quoteSentAt — the
 * original send timestamp stays.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildQuoteSendEmail } from '@/lib/email/templates/quoteSend'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

interface SendQuoteBody {
  /** Optional plain-text message inserted into the email body above the
   *  standard quote-attached line. */
  message?: unknown
  /** Optional override of CC recipients. When omitted, all non-primary
   *  JobContacts on the order's job are CC'd. Pass an empty array to
   *  send to primary only. */
  cc?: unknown
}

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

interface Recipient {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean
}

/**
 * Mirrors the order detail page's computeRecipients (orders/[id]/page.tsx).
 * Kept in sync by structure: PRODUCER > primary > PM > PC > any-with-role
 * > direct jobContact override. Returned list is rank-sorted so [0] is
 * the canonical recipient.
 */
function rankRecipients(
  job: { jobContacts: { person: { id: string; firstName: string; lastName: string; email: string }; role: string; isPrimary: boolean }[] } | null,
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null,
): Recipient[] {
  const all: Recipient[] = []
  const seen = new Set<string>()
  const push = (id: string, name: string, email: string, role: string | null, isPrimary: boolean) => {
    if (!id || !email || seen.has(id)) return
    seen.add(id)
    all.push({ id, name, email, role, isPrimary })
  }
  for (const jc of job?.jobContacts ?? []) {
    push(
      jc.person.id,
      `${jc.person.firstName} ${jc.person.lastName}`.trim(),
      jc.person.email,
      jc.role,
      !!jc.isPrimary,
    )
  }
  if (jobContact) {
    push(jobContact.id, `${jobContact.firstName} ${jobContact.lastName}`.trim(), jobContact.email, null, false)
  }
  const rank = (r: Recipient): number => {
    if (r.role === 'PRODUCER') return 0
    if (r.isPrimary) return 1
    if (r.role === 'PM') return 2
    if (r.role === 'PC') return 3
    if (r.role) return 4
    return 5
  }
  all.sort((a, b) => rank(a) - rank(b))
  return all
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = (await req.json().catch(() => ({}))) as SendQuoteBody
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const ccOverride = Array.isArray(body.cc) ? (body.cc.filter((v) => typeof v === 'string') as string[]) : null

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteSentAt: true,
      sentAt: true,
      wonAt: true,
      lostAt: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      taxRate: true,
      total: true,
      portalSlug: true,
      company: { select: { name: true } },
      agent: { select: { name: true, email: true } },
      job: {
        select: {
          jobCode: true,
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  if (!order) return bad(404, 'order not found')

  if (!order.quotePdfKey || !order.quotePdfUrl) {
    return bad(400, 'No quote PDF — regenerate from the order detail page first.')
  }

  const ranked = rankRecipients(order.job, order.jobContact)
  const primary = ranked[0]
  if (!primary) return bad(400, 'No recipient — add a contact to the job first.')
  const others = ccOverride
    ? ranked.filter((r) => r !== primary && ccOverride.includes(r.email))
    : ranked.slice(1)

  // ── Fetch the PDF from Blob storage ──────────────────────
  let pdfBuffer: Buffer
  try {
    const blob = await getBlob(order.quotePdfKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return bad(500, 'quote PDF blob not retrievable — regenerate first')
    }
    const chunks: Buffer[] = []
    const reader = blob.stream.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    pdfBuffer = Buffer.concat(chunks)
  } catch (err) {
    console.error('[send-quote] blob fetch failed:', err)
    return bad(500, 'failed to fetch quote PDF')
  }

  // ── Compose the email ────────────────────────────────────
  // Branded template — dark header with the hosted white wordmark from
  // /public/sirreel-logo-white.png and a compact S-mark footer from
  // /public/s-logo-white.png. See quoteSend.ts.
  const { subject, html, text } = buildQuoteSendEmail({
    firstName: primary.name.split(' ')[0] || 'there',
    orderNumber: order.orderNumber,
    jobName: order.job?.name ?? 'your production',
    agentName: order.agent.name || 'SirReel',
    agentEmail: order.agent.email,
    customMessage: message,
  })

  const filename = `Quote-${order.orderNumber}.pdf`
  const emailResult = await sendAgreementEmail({
    to: [primary.email],
    cc: others.length > 0 ? others.map((o) => o.email) : undefined,
    subject,
    html,
    text,
    attachments: [{ filename, content: pdfBuffer }],
    label: `send-quote:${order.orderNumber}`,
  })

  if (!emailResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Email send failed: ${emailResult.reason}`,
        emailResult,
      },
      { status: 502 },
    )
  }

  // ── State transition (DRAFT → QUOTE_SENT) ────────────────
  // Resends from QUOTE_SENT or beyond don't re-flip status or
  // re-stamp quoteSentAt — the original timeline stays intact.
  if (order.status === 'DRAFT') {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'QUOTE_SENT',
        quoteSentAt: order.quoteSentAt ?? new Date(),
        ...computeQuoteStatusSync('QUOTE_SENT', {
          sentAt: order.sentAt,
          wonAt: order.wonAt,
          lostAt: order.lostAt,
        }),
      },
    })
  }

  return NextResponse.json({
    ok: true,
    emailId: emailResult.id,
    recipient: { email: primary.email, name: primary.name },
    cc: others.map((o) => ({ email: o.email, name: o.name })),
  })
}
