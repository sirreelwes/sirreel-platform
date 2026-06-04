/**
 * POST /api/webhooks/resend
 *
 * Resend uses Svix-format webhooks. Every request carries three
 * headers — svix-id, svix-timestamp, svix-signature — that sign the
 * RAW request body against a per-endpoint secret. We MUST verify the
 * signature against the raw body BEFORE parsing JSON or touching the
 * DB. Anything else is a wide-open write endpoint that anyone can
 * POST to.
 *
 * Env:
 *   RESEND_WEBHOOK_SECRET — Svix signing secret from the Resend
 *                           dashboard (looks like "whsec_...").
 *
 * Event handling: we care about four event types. Anything else is
 * acknowledged with 200 + ignored so Resend doesn't retry forever.
 *
 *   email.delivered          → DELIVERED
 *   email.delivery_delayed   → DELAYED
 *   email.bounced            → BOUNCED  (statusDetail = bounce reason)
 *   email.complained         → COMPLAINED
 *
 * Match: emailDelivery.resendMessageId === data.email_id. If no row
 * exists for that id (e.g. portal magic-link sends that don't write
 * a row), no-op and ack 200 — the webhook isn't a place to surface
 * "unknown email" errors back to Resend.
 *
 * Idempotency: Resend retries on non-2xx. The unique constraint on
 * resendMessageId means later events on the same delivery just call
 * updateMany — which is naturally idempotent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { prisma } from '@/lib/prisma'
import type { EmailDeliveryStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Resend sometimes batches; keep a generous body limit.
export const maxDuration = 15

interface ResendEvent {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string | string[]
    bounce?: { message?: string; subType?: string; type?: string } | null
    [key: string]: unknown
  }
}

const EVENT_TO_STATUS: Record<string, EmailDeliveryStatus> = {
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DELAYED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Refuse to accept webhooks if the verification secret isn't
    // configured. Without it we'd be running an unauthenticated
    // write endpoint.
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET is not set — refusing all events')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // Raw text — Svix signs the exact bytes Resend POSTed, so JSON
  // parsing before verification would change the bytes and break
  // signature comparison on requests where formatting differs.
  const rawBody = await req.text()
  const svixId = req.headers.get('svix-id') ?? ''
  const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
  const svixSignature = req.headers.get('svix-signature') ?? ''
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 })
  }

  let event: ResendEvent
  try {
    const wh = new Webhook(secret)
    // verify() throws on bad signature / replay / expiry. The returned
    // value is the parsed JSON of the verified body — use that, not
    // a separate JSON.parse(rawBody), so the type matches what was
    // actually signed.
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendEvent
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[webhooks/resend] signature verification failed: ${reason}`)
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // Past this line: request is verified, safe to do DB writes.

  const eventType = event.type
  const emailId = event.data?.email_id
  if (!emailId) {
    // Verified but malformed — ack so Resend doesn't retry forever.
    console.warn(`[webhooks/resend] verified event without email_id: type=${eventType}`)
    return NextResponse.json({ ok: true, ignored: 'no email_id' })
  }

  const status = EVENT_TO_STATUS[eventType]
  if (!status) {
    // Engagement events (opened, clicked) and sent — ack + ignore.
    return NextResponse.json({ ok: true, ignored: eventType })
  }

  // Bounce reason — Resend nests it under data.bounce. Stringify the
  // most useful field for display.
  let statusDetail: string | null = null
  if (status === 'BOUNCED' && event.data?.bounce) {
    const b = event.data.bounce
    statusDetail = [b.type, b.subType, b.message].filter(Boolean).join(' · ') || null
  }

  // Match by unique resendMessageId. updateMany so a no-match (row
  // doesn't exist for sends that weren't recorded) just no-ops at
  // count=0 instead of throwing.
  const result = await prisma.emailDelivery.updateMany({
    where: { resendMessageId: emailId },
    data: {
      status,
      statusDetail,
      statusAt: new Date(),
    },
  })

  return NextResponse.json({
    ok: true,
    eventType,
    emailId,
    matched: result.count,
    status,
  })
}
