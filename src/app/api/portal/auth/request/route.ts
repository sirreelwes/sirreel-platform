/**
 * POST /api/portal/auth/request — request a passwordless magic link.
 *
 * Phase 1 of the client-portal brief. Body: { email }. Resolves the
 * email to a Person; if matched, mints a PersonSession row with a
 * 30-minute magic link and emails it. If the email doesn't match a
 * Person, we do NOTHING and still return the same neutral response.
 *
 * Account-enumeration safety: the response is identical (status,
 * body, timing-roughly) whether the email matched or not. Never
 * leak Person existence.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  PERSON_MAGIC_LINK_TTL_MS,
  generatePersonMagicLinkToken,
} from '@/lib/portal/personSession'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'

function neutralResponse() {
  return NextResponse.json({
    ok: true,
    message: "If that email is on file, we've sent a sign-in link.",
  })
}

function isPlausibleEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function portalBaseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.PORTAL_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const origin = req.headers.get('origin') || req.nextUrl.origin
  return origin.replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null
  const email = body && isPlausibleEmail(body.email) ? body.email.trim().toLowerCase() : null

  // Always return neutral. Skip even the DB lookup on malformed email
  // so a probe with `email=garbage` gets the same answer as a miss.
  if (!email) return neutralResponse()

  // Case-insensitive email lookup. Person.email is unique, stored as
  // entered (no lowercase column). Use a case-insensitive contains on
  // an exact-length input — Prisma's ilike via `equals` + `mode`.
  const person = await prisma.person.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
    select: { id: true, email: true, firstName: true },
  })

  if (!person) {
    // Person missing — do nothing further, return neutral. No email,
    // no DB write. Probe cost stays at one read.
    return neutralResponse()
  }

  // Mint a fresh PersonSession (one per request — old unused rows
  // sit revoked-implicitly via expiry, can be swept later).
  const token = generatePersonMagicLinkToken()
  const expiresAt = new Date(Date.now() + PERSON_MAGIC_LINK_TTL_MS)
  const session = await prisma.personSession.create({
    data: {
      personId: person.id,
      magicLinkToken: token,
      magicLinkExpiresAt: expiresAt,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent') || null,
    },
    select: { id: true },
  })

  const baseUrl = portalBaseUrl(req)
  const link = `${baseUrl}/api/portal/auth/verify?token=${token}`

  // Send the email. Failures are logged + returned as ok-neutral so
  // we don't enumerate accounts via send-failure timing either.
  const greeting = person.firstName ? `Hi ${person.firstName},` : 'Hi,'
  const html = `
    <p>${greeting}</p>
    <p>Click the link below to sign in to your SirReel portal. This link expires in 30 minutes.</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#d97706;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Sign in</a></p>
    <p style="color:#666;font-size:12px;">If you didn't request this, you can ignore this email — nothing happens until the link is opened.</p>
    <p style="color:#666;font-size:12px;">Or paste this URL: ${link}</p>
  `.trim()
  const text = [
    greeting,
    '',
    'Click the link below to sign in to your SirReel portal. This link expires in 30 minutes.',
    '',
    link,
    '',
    "If you didn't request this, you can ignore this email — nothing happens until the link is opened.",
  ].join('\n')

  void sendAgreementEmail({
    to: [person.email],
    subject: 'Your SirReel sign-in link',
    html,
    text,
    label: `person-portal-magic-link:${session.id.slice(0, 8)}`,
  })

  return neutralResponse()
}
