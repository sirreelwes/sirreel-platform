/**
 * POST /api/public/sms/status — Twilio's delivery-status callback for texts
 * HQ sends through sendTracked(). Updates the SmsMessage row by MessageSid:
 * queued → sent → delivered, or undelivered / failed with the error code.
 *
 * Same authenticity rules as the inbound webhook. Twilio expects a 2xx and
 * nothing else; an unknown sid is a 200 too (a message sent before logging
 * existed), never a retry storm.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function signatureValid(req: NextRequest, params: URLSearchParams, authToken: string): boolean {
  const sig = req.headers.get('x-twilio-signature') || ''
  if (!sig) return false
  const keys = [...params.keys()].sort()
  const expected = createHmac('sha1', authToken).update(req.nextUrl.href + keys.map((k) => k + (params.get(k) ?? '')).join('')).digest('base64')
  try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) } catch { return false }
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  const params = new URLSearchParams(raw)
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const secret = process.env.TWILIO_WEBHOOK_SECRET?.trim()
  const key = req.nextUrl.searchParams.get('key') || ''
  const authentic =
    (authToken && signatureValid(req, params, authToken)) ||
    (secret && key && (() => { try { return timingSafeEqual(Buffer.from(key), Buffer.from(secret)) } catch { return false } })())
  if (!authentic) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const sid = params.get('MessageSid') || params.get('SmsSid')
  const status = params.get('MessageStatus') || params.get('SmsStatus')
  if (!sid || !status) return new NextResponse('', { status: 200 })
  const errorCode = params.get('ErrorCode')
  await prisma.smsMessage.updateMany({
    where: { twilioSid: sid },
    data: { status, ...(errorCode ? { errorText: `Twilio error ${errorCode}` } : {}) },
  }).catch(() => {})
  return new NextResponse('', { status: 200 })
}
