import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { processStageContractEntryRequest } from '@/lib/public/stageContractEntry'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/stage-contract/request-entry — the /stage-contract page's
 * email gate, mirroring the rental one.
 *
 * ANTI-ENUMERATION (non-negotiable): the response is the SAME constant
 * whether the address matches a Person, has stage jobs, or matches nothing.
 * No job data, company names, or existence signals ever leave this route —
 * all branching happens inside the emailed message. Same hardening as the
 * other public intakes: per-IP sliding window, honeypot `website` (silent
 * fake success), and Turnstile that stays dormant until TURNSTILE_SECRET_KEY
 * is set.
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
  const rl = checkRateLimit(`stage-contract-entry:${ip}`)
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

  // Process fully server-side; swallow every outcome. The variant is
  // deliberately NOT surfaced.
  try {
    await processStageContractEntryRequest(email)
  } catch (err) {
    console.error('[stage-contract/request-entry] processing failed (response unchanged):', err)
  }
  return NextResponse.json(NEUTRAL)
}
