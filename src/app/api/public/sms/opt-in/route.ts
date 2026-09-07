/**
 * POST /api/public/sms/opt-in — the public SMS consent form on /sms-terms.
 *
 * Body { phone, consent: true }. Records the affirmative opt-in on the
 * number's thread (optedInVia 'form', clears any STOP) and sends the
 * campaign's opt-in confirmation text when Twilio is configured — the same
 * string a texted START receives. Before the number is live the opt-in is
 * still recorded; the confirmation is logged as skipped.
 *
 * Public + unauthenticated: rate-limited per IP, E.164 only, and it
 * never reveals whether a number is already known.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { toE164 } from '@/lib/sms/sendSms'
import { getOrCreateThread, KEYWORD_REPLIES, sendTracked } from '@/lib/sms/threads'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`sms-opt-in:${ip}`, { windowMs: 60 * 60 * 1000, max: 10 })
  if (!rl.ok) return NextResponse.json({ ok: false, error: 'Too many attempts — try again later.' }, { status: 429 })

  const body = (await req.json().catch(() => null)) as { phone?: unknown; consent?: unknown } | null
  const phone = typeof body?.phone === 'string' ? toE164(body.phone) : null
  if (!phone) return NextResponse.json({ ok: false, error: 'Enter a valid US mobile number.' }, { status: 400 })
  if (body?.consent !== true) return NextResponse.json({ ok: false, error: 'Please check the consent box.' }, { status: 400 })

  const thread = await getOrCreateThread(phone)
  if (!thread) return NextResponse.json({ ok: false, error: 'Enter a valid US mobile number.' }, { status: 400 })
  await prisma.smsThread.update({ where: { id: thread.id }, data: { optedOutAt: null, optedInAt: new Date(), optedInVia: 'form' } })
  await prisma.auditLog.create({
    data: { action: 'sms.opt_in_form', entityType: 'SmsThread', entityId: thread.id, newValues: { phoneTail: phone.slice(-4), ip } },
  }).catch(() => {})

  // The confirmation is the carrier-filed opt-in string. A human just asked
  // for it, so it is exempt from quiet hours.
  const sent = await sendTracked({ to: phone, body: KEYWORD_REPLIES.optIn, source: 'system', overrideQuietHours: true })

  const tail = phone.slice(-4)
  return NextResponse.json({ ok: true, phone: `(•••) •••-${tail}`, confirmationSent: sent.ok })
}
