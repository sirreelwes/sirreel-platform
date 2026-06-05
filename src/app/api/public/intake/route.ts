/**
 * POST /api/public/intake — hardened public submission for the
 * agent-shareable intake link feature.
 *
 * Receives: contact (name, phone, email) + jobName + optional
 * agentSlug + honeypot. Writes one Inquiry(WEB_FORM, NEW) so it
 * appears in the existing Pipeline → "New inbound" column without
 * any new triage UI.
 *
 * Hardening recipe — cloned from /api/public/supply-request:
 *   - Per-IP sliding-window rate limit (checkRateLimit / 5 per 10 min).
 *   - Honeypot field `website` — populated → silent 200 with fake
 *     reference, no DB write. Same field name as supply-request
 *     so bots don't get a hint by surface-hopping.
 *   - Strict typed validation: required name + email, plausible
 *     email format, length caps.
 *   - Captcha env-gated (TURNSTILE_SECRET_KEY).
 *   - **NO `getServerSession()`** — public endpoint, must never
 *     attach an authenticated user as assignedTo.
 *
 * Attribution:
 *   - agentSlug is OPTIONAL. When supplied, the row is validated
 *     server-side: must exist + isActive + role=AGENT + salesOnly=true.
 *     Anything else (unknown / former rep / accounting agent) →
 *     assignedToId stays null and the inquiry lands in the
 *     unassigned triage queue. Stale links still submit successfully.
 *   - The slug is also persisted in sourceMetadata.agentSlug for the
 *     audit trail even when it didn't resolve to a current rep.
 *
 * Person creation: NOT done here. Contact details live in
 * sourceMetadata.contact and triage upserts a Person when the
 * inquiry is captured. Matches supply-request exactly.
 *
 * Reference: SR-INT-NNNN where N is (count of intake-source WEB_FORM
 * inquiries + 1) zero-padded. Race-tolerant — two concurrent
 * submissions might share a reference; the inquiry IDs are distinct.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const NAME_MAX = 120
const PHONE_MAX = 30
const EMAIL_MAX = 200
const JOB_NAME_MAX = 200
const SLUG_MAX = 60

interface SubmitBody {
  contact?: { name?: unknown; phone?: unknown; email?: unknown }
  jobName?: unknown
  agentSlug?: unknown
  /** Honeypot — must be empty. */
  website?: unknown
  /** Captcha token from the client widget when TURNSTILE_SECRET_KEY is set. */
  captchaToken?: unknown
}

function isPlausibleEmail(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length <= EMAIL_MAX &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
  )
}
function asString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

function fakeReference(): string {
  // Shape matches the real reference so the honeypot response
  // isn't trivially distinguishable from a real success.
  const n = Math.floor(Math.random() * 9000) + 1000
  return `SR-INT-${n}`
}

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

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const rl = checkRateLimit(`intake:${ip}`)
  if (!rl.ok) {
    return bad(429, 'Too many requests. Try again shortly.', {
      retryAfterSeconds: rl.retryAfterSeconds,
    })
  }

  const body = (await req.json().catch(() => null)) as SubmitBody | null
  if (!body) return bad(400, 'invalid JSON body')

  // Honeypot — populated → silent fake success, no DB write.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({
      ok: true,
      reference: fakeReference(),
      message: 'Request received.',
    })
  }

  const captchaOk = await verifyTurnstile(
    typeof body.captchaToken === 'string' ? body.captchaToken : null,
    ip,
  )
  if (!captchaOk) return bad(400, 'captcha failed')

  // ── Contact ───────────────────────────────────────────────
  const contactName = asString(body.contact?.name, NAME_MAX)
  const contactEmail = isPlausibleEmail(body.contact?.email)
    ? (body.contact!.email as string).trim().toLowerCase()
    : null
  const contactPhone = asString(body.contact?.phone, PHONE_MAX)
  if (!contactName) return bad(400, 'contact.name required')
  if (!contactEmail) return bad(400, 'contact.email required')

  // ── Job name ──────────────────────────────────────────────
  const jobName = asString(body.jobName, JOB_NAME_MAX)
  if (!jobName) return bad(400, 'jobName required')

  // ── Agent attribution (optional) ──────────────────────────
  // Slug is preserved in sourceMetadata regardless of resolution so
  // the audit trail records the link the visitor used, even if that
  // agent left the team or the slug never matched a rep in the
  // first place.
  const rawSlug = asString(body.agentSlug, SLUG_MAX)
  let assignedToId: string | null = null
  if (rawSlug) {
    const agent = await prisma.user.findFirst({
      where: {
        publicSlug: rawSlug,
        isActive: true,
        role: 'AGENT',
        salesOnly: true,
      },
      select: { id: true },
    })
    if (agent) assignedToId = agent.id
  }

  // ── Reference SR-INT-NNNN ─────────────────────────────────
  // Count of prior intake submissions — uses the same per-source
  // approximation as supply-request (race-tolerant by design).
  const seq =
    (await prisma.inquiry.count({
      where: {
        source: 'WEB_FORM',
        sourceMetadata: { path: ['kind'], equals: 'intake' },
      },
    })) + 1
  const reference = `SR-INT-${String(seq).padStart(4, '0')}`

  // ── Inquiry write ─────────────────────────────────────────
  const description = [
    `${reference} · From ${contactName} <${contactEmail}>${contactPhone ? ` · ${contactPhone}` : ''}`,
    `Production: ${jobName}`,
    rawSlug ? `Via agent link: /intake/${rawSlug}${assignedToId ? '' : ' (unrecognized — unassigned)'}` : null,
  ]
    .filter((s) => s != null)
    .join('\n')

  await prisma.inquiry.create({
    data: {
      title: jobName,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      assignedToId,
      sourceMetadata: {
        kind: 'intake',
        reference,
        contact: { name: contactName, email: contactEmail, phone: contactPhone },
        jobName,
        agentSlug: rawSlug,
        agentResolved: !!assignedToId,
        submittedAt: new Date().toISOString(),
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent') || null,
      },
    },
    select: { id: true },
  })

  return NextResponse.json({
    ok: true,
    reference,
    message: 'Request received. Your SirReel agent will follow up shortly.',
  })
}
