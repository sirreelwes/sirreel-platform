import { NextRequest, NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEodCollectionsEmail } from '@/lib/email/templates/eodCollections'
import { computeEodFigures, pacificToday } from '@/lib/collections/eodReport'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/collections/eod/send — send the end-of-day collections report.
 *
 * Recipients come from the 'eod-collections' channel (Dani and Wes by default,
 * editable at /admin/notifications) — never a hardcoded list, so changing who
 * gets it is not a deploy.
 *
 * ── Order of operations ────────────────────────────────────────────────────
 *
 * The figures are STORED FIRST, then the email is sent, then the row is
 * stamped sent. If Resend is down, the day's numbers and Ana's note survive in
 * `daily_collections` and she is told the send failed — she can resend without
 * re-keying anything. The reverse order would lose the note on every failure.
 *
 * Unlike most internal notifications in this codebase this send is AWAITED and
 * its result reported. Fire-and-forget is right when a client action must not
 * be blocked by an email; here the email IS the action, and "sent" with
 * nothing delivered is the one outcome that would quietly break the report.
 *
 * Sending twice for the same day is allowed — a corrected report is a normal
 * evening. The UI warns first, and `sentAt` moves to the latest send.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback
}

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? ''))
    ? String(body.date)
    : pacificToday()

  // Recomputed server-side for the counts and the standing figures. The four
  // money fields come from the request because Ana may have corrected them —
  // that is the whole point of the panel — but everything she cannot edit is
  // read here rather than trusted from the client.
  const figures = await computeEodFigures(date)

  const cardpointe = num(body.cardpointe, figures.cardpointe.amount)
  const rentalworks = num(body.rentalworks, figures.rentalworks.amount)
  const ordersCreated = num(body.ordersCreated, figures.ordersCreated.amount)
  const quotesCreated = num(body.quotesCreated, figures.quotesCreated.amount)
  const note = typeof body.note === 'string' ? body.note.slice(0, 4000) : ''

  const dateKey = new Date(`${date}T00:00:00.000Z`)
  const figuresRow = { cardpointe, rentalworks, ordersCreated, quotesCreated, note }

  // 1. Persist before sending — see the note above.
  await prisma.dailyCollections.upsert({
    where: { date: dateKey },
    create: { date: dateKey, ...figuresRow },
    update: figuresRow,
  })

  const to = dedupeEmails(await channelRecipients('eod-collections'))
  if (to.length === 0) {
    return NextResponse.json(
      {
        error:
          'No recipients configured for the end-of-day report. Add them under Notifications in admin.',
        saved: true,
      },
      { status: 400 },
    )
  }

  const { subject, html, text } = renderEodCollectionsEmail({
    date,
    cardpointe,
    rentalworks,
    ordersCreated,
    quotesCreated,
    ordersCount: figures.ordersCreated.count,
    quotesCount: figures.quotesCreated.count,
    cardCount: figures.cardpointe.count,
    achPending: figures.context.achPending,
    achPendingCount: figures.context.achPendingCount,
    outstandingTotal: figures.context.outstandingTotal,
    outstandingCount: figures.context.outstandingCount,
    note,
    senderName: user.name || user.email,
  })

  const result = await sendAgreementEmail({
    to,
    subject,
    html,
    text,
    // Reply goes to whoever sent it, not to a no-reply. Dani asking "is the
    // ACH figure the pending one?" should land with Ana.
    replyTo: user.email,
    label: 'eod-collections',
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: `Figures saved, but the email did not send: ${result.reason}`, saved: true },
      { status: 502 },
    )
  }

  // 2. Only now is it "sent".
  const sentAt = new Date()
  await prisma.dailyCollections.update({
    where: { date: dateKey },
    data: { sentAt, sentBy: user.email },
  })

  return NextResponse.json({ ok: true, sentAt: sentAt.toISOString(), to })
}
