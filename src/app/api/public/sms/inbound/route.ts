/**
 * POST /api/public/sms/inbound — Twilio's webhook for every text to our number.
 *
 * Point the number's "A message comes in" webhook at
 *   https://hq.sirreel.com/api/public/sms/inbound?key=<TWILIO_WEBHOOK_SECRET>
 *
 * AUTHENTICITY — two checks, either passes:
 *   1. X-Twilio-Signature validated with TWILIO_AUTH_TOKEN (Twilio's own
 *      scheme: HMAC-SHA1 over URL + sorted POST params).
 *   2. The ?key= in the URL equals TWILIO_WEBHOOK_SECRET (for accounts that
 *      only hold an API key and no auth token — ours, today).
 * With neither configured the route refuses everything, loudly, rather than
 * letting anyone on the internet talk to the assistant as "a driver".
 *
 * FLOW: record the inbound → carrier keywords (STOP/START/HELP) get fixed
 * replies and never reach the model → otherwise the thread's recent turns
 * plus a who-is-this hint run through the SAME assistant as the web chat
 * (src/lib/assistant/runAssistant.ts) → the reply goes back as TwiML, which
 * works before a from-number is even configured, and is logged.
 *
 * Opted-out numbers still get keyword handling (START must work) but no
 * assistant replies. Rate limit is per number.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'
import { runAssistant } from '@/lib/assistant/runAssistant'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import {
  applyKeyword, classifyKeyword, getOrCreateThread, identifyNumber, KEYWORD_REPLIES,
  recordInbound, recordOutbound, turnsForModel,
} from '@/lib/sms/threads'
import { prisma } from '@/lib/prisma'
import { identifySender } from '@/lib/assistant/senderIdentity'

export const dynamic = 'force-dynamic'

function twiml(message?: string): NextResponse {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = message ? `<Response><Message>${esc(message)}</Message></Response>` : '<Response></Response>'
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

/** Twilio's request signature: base64(HMAC-SHA1(authToken, url + concat(sorted key+value))). */
function signatureValid(req: NextRequest, params: URLSearchParams, authToken: string): boolean {
  const sig = req.headers.get('x-twilio-signature') || ''
  if (!sig) return false
  const url = req.nextUrl.href
  const keys = [...params.keys()].sort()
  const payload = url + keys.map((k) => k + (params.get(k) ?? '')).join('')
  const expected = createHmac('sha1', authToken).update(payload).digest('base64')
  try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) } catch { return false }
}

function secretValid(req: NextRequest, secret: string): boolean {
  const given = req.nextUrl.searchParams.get('key') || ''
  try { return given.length > 0 && timingSafeEqual(Buffer.from(given), Buffer.from(secret)) } catch { return false }
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  const params = new URLSearchParams(raw)

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const secret = process.env.TWILIO_WEBHOOK_SECRET?.trim()
  const authentic = (authToken && signatureValid(req, params, authToken)) || (secret && secretValid(req, secret))
  if (!authentic) {
    if (!authToken && !secret) console.error('[sms/inbound] refused: neither TWILIO_AUTH_TOKEN nor TWILIO_WEBHOOK_SECRET is set')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const from = params.get('From') || ''
  const body = (params.get('Body') || '').trim()
  const sid = params.get('MessageSid') || null
  if (!from || !body) return twiml()

  const thread = await getOrCreateThread(from)
  if (!thread) return twiml()

  // Twilio retries on non-2xx; a duplicate sid must not double-log or double-answer.
  if (sid) {
    const dup = await prisma.smsMessage.findUnique({ where: { twilioSid: sid }, select: { id: true } })
    if (dup) return twiml()
  }
  await recordInbound({ threadId: thread.id, body, twilioSid: sid })

  // Carrier keywords first — fixed replies, matching the campaign filing.
  const kw = classifyKeyword(body)
  if (kw) {
    await applyKeyword(thread.id, kw)
    const reply = KEYWORD_REPLIES[kw]
    await recordOutbound({ threadId: thread.id, body: reply, source: 'keyword', status: 'twiml' })
    return twiml(reply)
  }

  // An opted-out number gets nothing but keywords.
  if (thread.optedOutAt) return twiml()

  const rl = checkRateLimit(`sms:${thread.phone}`, { windowMs: 10 * 60 * 1000, max: 15 })
  if (!rl.ok) {
    const reply = `SirReel: We've had a lot of messages from this number just now. Please call ${PUBLIC_CONTACT.phone} and an agent will help. Reply STOP to opt out.`
    await recordOutbound({ threadId: thread.id, body: reply, source: 'system', status: 'twiml' })
    return twiml(reply)
  }

  const [who, sender] = await Promise.all([identifyNumber(thread.phone), identifySender(thread.phone).catch(() => null)])
  if (who.personId !== thread.personId || who.subRentalId !== thread.subRentalId) {
    await prisma.smsThread.update({ where: { id: thread.id }, data: { personId: who.personId, subRentalId: who.subRentalId } }).catch(() => {})
  }

  const turns = await turnsForModel(thread.id)
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: body })

  const { reply: replyRaw, toolsUsed } = await runAssistant({ turns, ip: thread.phone, channel: 'sms', context: who.context, senderPhone: thread.phone, sender: sender ?? undefined })
  const reply = replyRaw.length > 1500 ? `${replyRaw.slice(0, 1480)}…` : replyRaw
  await recordOutbound({ threadId: thread.id, body: reply, source: 'assistant', status: 'twiml', subRentalId: who.subRentalId })
  if (toolsUsed.length) {
    await prisma.auditLog.create({
      data: { action: 'sms.assistant_tools', entityType: 'SmsThread', entityId: thread.id, newValues: { tools: toolsUsed, phoneTail: thread.phone.slice(-4), staff: sender?.staff?.name ?? null, contactJobs: sender?.contactJobs.map((j) => j.jobCode) ?? [] } },
    }).catch(() => {})
  }
  return twiml(reply)
}
