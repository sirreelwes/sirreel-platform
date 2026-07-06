/**
 * POST /api/public/contact — the public site's "Get in Touch" form.
 *
 * Thin, hardened intake (mirrors /api/public/supply-request patterns):
 *   - per-IP rate limit (same sliding-window limiter)
 *   - honeypot `website` field → silent fake-success
 *   - Turnstile verification, env-gated on TURNSTILE_SECRET_KEY
 *   - strict typed validation, no auto-reply ever
 *
 * Lands as an Inquiry(source WEB_FORM, status NEW) so it surfaces in
 * the exact staff pipeline the supply form feeds.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip })
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`public-contact:${ip}`)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests — try again shortly.' },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown; email?: unknown; message?: unknown
    website?: unknown; captchaToken?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })

  // Honeypot — bots fill it; pretend success, write nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  if (!name || !isEmail(email) || !message) {
    return NextResponse.json(
      { ok: false, error: 'Name, a valid email, and a message are required.' },
      { status: 400 },
    )
  }

  const captchaOk = await verifyTurnstile(
    typeof body.captchaToken === 'string' ? body.captchaToken : null,
    ip,
  )
  if (!captchaOk) {
    return NextResponse.json({ ok: false, error: 'Verification failed — try again.' }, { status: 400 })
  }

  await prisma.inquiry.create({
    data: {
      title: `Contact — ${name}`,
      description: message,
      source: 'WEB_FORM',
      status: 'NEW',
      sourceMetadata: {
        kind: 'contact',
        contact: { name, email },
        submittedAt: new Date().toISOString(),
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent') || null,
      },
    },
  })

  return NextResponse.json({ ok: true })
}
