/**
 * POST /api/public/space-inquiry — "Check Availability" intake for the
 * public Spaces pages (Standing Sets today).
 *
 * Reuses the SAME staff pipeline and hardening as /api/public/contact:
 *   - per-IP rate limit, honeypot, Turnstile (env-gated), no auto-reply
 *   - lands an Inquiry(source WEB_FORM, status NEW)
 *
 * A dedicated route (not /api/public/contact) because this payload is
 * STRUCTURED — selected space names + a date window — which the message-
 * only contact endpoint can't carry. Selected ids are re-resolved against
 * the live published spaces server-side, so the stored set names can't be
 * spoofed by the client. Both a readable description AND structured
 * sourceMetadata land so staff see the request with or without parsing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { PUBLIC_SPACE_VISIBLE_WHERE } from '@/lib/site/spaces'

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
// Accept a plain YYYY-MM-DD date string (the <input type="date"> value).
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`public-space-inquiry:${ip}`)
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown; email?: unknown; message?: unknown
    startDate?: unknown; endDate?: unknown
    spaceIds?: unknown; website?: unknown; captchaToken?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })

  // Honeypot — bots fill it; pretend success, write nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  const startDate = typeof body.startDate === 'string' && isDate(body.startDate) ? body.startDate : null
  const endDate = typeof body.endDate === 'string' && isDate(body.endDate) ? body.endDate : null
  const rawIds = Array.isArray(body.spaceIds)
    ? body.spaceIds.filter((x): x is string => typeof x === 'string').slice(0, 50)
    : []

  if (!name || !isEmail(email)) {
    return NextResponse.json({ ok: false, error: 'Name and a valid email are required.' }, { status: 400 })
  }

  const captchaOk = await verifyTurnstile(
    typeof body.captchaToken === 'string' ? body.captchaToken : null,
    ip,
  )
  if (!captchaOk) {
    return NextResponse.json({ ok: false, error: 'Verification failed — try again.' }, { status: 400 })
  }

  // Re-resolve selected ids against the LIVE published spaces so the stored
  // names are trustworthy (client can't inject arbitrary set names).
  const selected = rawIds.length
    ? await prisma.space.findMany({
        where: { id: { in: rawIds }, ...PUBLIC_SPACE_VISIBLE_WHERE },
        select: { id: true, name: true, type: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    : []
  const setNames = selected.map((s) => s.name)

  // Readable description (staff-facing) + structured metadata.
  const window = startDate || endDate ? `${startDate ?? '?'} → ${endDate ?? '?'}` : 'not specified'
  const setsLine = setNames.length ? setNames.join(', ') : 'not specified'
  const description = [
    `Sets: ${setsLine}`,
    `Dates: ${window}`,
    '',
    message || '(no message provided)',
  ].join('\n')

  await prisma.inquiry.create({
    data: {
      title: `Standing Sets availability — ${name}`,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      sourceMetadata: {
        kind: 'space-availability',
        contact: { name, email },
        spaces: selected.map((s) => ({ id: s.id, name: s.name, type: s.type })),
        dates: { start: startDate, end: endDate },
        submittedAt: new Date().toISOString(),
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent') || null,
      },
    },
  })

  return NextResponse.json({ ok: true })
}
