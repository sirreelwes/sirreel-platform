import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { processAgreementEntryRequest } from '@/lib/public/agreementEntry'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/rental-agreement/request-entry — the /rental-agreement
 * page's email gate.
 *
 * ANTI-ENUMERATION (non-negotiable): the response is the SAME constant
 * regardless of whether the email matches a Person, has jobs, or matches
 * nothing — no job data, company names, or existence signals ever leave this
 * route. All branching happens inside the emailed message
 * (src/lib/public/agreementEntry.ts). Hardened like /api/public/contact:
 * per-IP sliding-window rate limit, honeypot `website` field (silent fake
 * success), Turnstile verification env-gated on TURNSTILE_SECRET_KEY (the
 * same dormant-until-keyed pattern the other public intakes use).
 */

const NEUTRAL = {
  ok: true,
  message: "If we have an account for that address, you'll receive an email with next steps.",
} as const

async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip })
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`agreement-entry:${ip}`)
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as {
    email?: unknown
    website?: unknown
    captchaToken?: unknown
  } | null
  if (!body) return NextResponse.json(NEUTRAL)

  // Honeypot — bots fill it; pretend success, do nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json(NEUTRAL)
  }
  const captcha = typeof body.captchaToken === 'string' ? body.captchaToken : null
  if (!(await verifyTurnstile(captcha, ip))) {
    return NextResponse.json({ ok: false, error: 'Verification failed — reload and try again.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''

  // Process fully server-side; swallow every outcome. The variant returned by
  // the processor is deliberately NOT surfaced.
  try {
    await processAgreementEntryRequest(email)
  } catch (err) {
    console.error('[rental-agreement/request-entry] processing failed (response unchanged):', err)
  }
  return NextResponse.json(NEUTRAL)
}
