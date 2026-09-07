/**
 * POST /api/public/vendor-hq/contact — the product site's "Talk to us"
 * form (utliiz.com/#contact).
 *
 * Why a form and not a mailto: there is no mailbox on utliiz.com yet
 * (Wes 2026-09-07: "No email setup yet at host"), and a public site whose
 * only call to action is a dead address is a site that does not work.
 * The form delivers to VerMar's ops inbox (vermarOpsEmails — Wes until
 * VERMAR_OPS_EMAILS says otherwise) with Reply-To set to the sender, so
 * answering is one keystroke. Nothing is written to the database: these
 * are VerMar's leads, not SirReel inquiries, and there is no VerMar lead
 * table yet — the email IS the record, which is why a failed send is a
 * visible error and not a swallowed one.
 *
 * Hardened like /api/public/contact: per-IP rate limit, honeypot
 * `website` field → silent fake success, strict typed validation, and
 * no auto-reply to the sender (nothing here can be used to relay mail).
 * No Turnstile — this host has no site key, and the route must not fail
 * closed when TURNSTILE_SECRET_KEY is set for sirreel.com.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { HQ_PRODUCT, vermarOpsEmails } from '@/lib/hq-white-label/product'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`vendor-hq-contact:${ip}`)
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many messages from this connection — try again in a few minutes.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as {
    name?: unknown; email?: unknown; company?: unknown; units?: unknown; message?: unknown; website?: unknown
  } | null
  if (!body) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })

  // Honeypot — bots fill it; pretend success, send nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const name = str(body.name, 200)
  const email = str(body.email, 320).toLowerCase()
  const company = str(body.company, 200)
  const units = str(body.units, 40)
  const message = str(body.message, 5000)
  if (!name || !isEmail(email) || !company) {
    return NextResponse.json({ ok: false, error: 'Your name, a valid email and your company are required.' }, { status: 400 })
  }

  const to = vermarOpsEmails()
  const rows: [string, string][] = [
    ['Name', name],
    ['Email', email],
    ['Company', company],
    ['Units', units || '—'],
  ]
  const html = [
    `<p><strong>${esc(name)}</strong> at <strong>${esc(company)}</strong> wrote in from ${esc(HQ_PRODUCT.siteHost)}.</p>`,
    `<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${k}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join('')}</table>`,
    message ? `<p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px;margin-top:12px">${esc(message)}</p>` : '<p style="color:#666">(no message)</p>',
    `<p style="color:#666;font-size:12px">Reply to this email to answer them. Sent from the ${esc(HQ_PRODUCT.name)} site contact form.</p>`,
  ].join('')
  const text = [
    `${name} at ${company} wrote in from ${HQ_PRODUCT.siteHost}.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    message || '(no message)',
    '',
    `Reply to this email to answer them.`,
  ].join('\n')

  const sent = await sendAgreementEmail({
    to,
    replyTo: email,
    subject: `${HQ_PRODUCT.name} — ${company} wants to talk`,
    html,
    text,
    label: 'vermar-hq-contact',
  })
  if (!sent.ok) {
    console.error('[vendor-hq/contact] send failed:', sent.reason)
    return NextResponse.json({ ok: false, error: 'Your message did not go through. Please try again in a minute.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
