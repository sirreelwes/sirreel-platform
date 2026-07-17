/**
 * POST /api/public/payment-info — the "Payments made simple." request
 * flow (Wes ruled A). SENSITIVE: triggers the payment/ACH email.
 *
 * INVARIANTS (do not weaken):
 *  - The user-visible response is IDENTICAL for known and unknown
 *    addresses — same status, same body, no redirects. Enumeration of
 *    the CRM through this endpoint must be impossible.
 *  - Details are delivered by EMAIL ONLY, to the RESOLVED on-file
 *    address (resolvePersonByEmail — merge-safe, alias-aware), never
 *    to the submitted string.
 *  - KNOWN = person resolves AND sits on ≥1 Job with status QUOTED /
 *    ACTIVE / WRAPPED. NEW-status jobs and unattached CRM people do
 *    NOT qualify (the CRM is full of stale RentalWorks imports).
 *  - UNKNOWN (or details unconfigured) → agent-queue Inquiry, nothing
 *    sent.
 *  - Rate-limited per IP AND per submitted email (3/hour each).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { resolvePersonByEmail, normalizeEmail } from '@/lib/people/email'
import { buildPaymentInfoEmail } from '@/lib/email/templates/paymentInfo'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'

const UNIFORM_RESPONSE = {
  ok: true,
  message:
    "If that address is on file, we've just emailed your payment info. If not, a SirReel agent will reach out.",
}

const RATE: { windowMs: number; max: number } = { windowMs: 60 * 60 * 1000, max: 3 }

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const body = (await req.json().catch(() => null)) as {
    email?: unknown
    website?: unknown
  } | null

  // Honeypot — bots get the uniform response, nothing happens.
  if (body && typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json(UNIFORM_RESPONSE)
  }

  const submitted = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''
  if (!submitted || !isEmail(submitted)) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 })
  }

  // Per-IP and per-email limits — this endpoint can trigger outbound
  // mail; it must not be usable as a spam cannon against an on-file
  // address or as a probe loop.
  const ipRl = checkRateLimit(`payment-info:ip:${ip}`, RATE)
  const emailRl = checkRateLimit(`payment-info:email:${normalizeEmail(submitted)}`, RATE)
  if (!ipRl.ok || !emailRl.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests — try again later.' },
      { status: 429 },
    )
  }

  try {
    const person = (await resolvePersonByEmail(submitted, {
      select: {
        id: true,
        email: true,
        firstName: true,
        jobContacts: {
          select: { job: { select: { status: true } } },
        },
      },
    })) as
      | { id: string; email: string; firstName: string | null; jobContacts: Array<{ job: { status: string } }> }
      | null

    const qualifies =
      !!person &&
      person.jobContacts.some((jc) => ['QUOTED', 'ACTIVE', 'WRAPPED'].includes(jc.job.status))

    const settings = await prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { paymentDetails: true },
    })
    const details = settings?.paymentDetails?.trim() || null

    if (qualifies && person && details) {
      // KNOWN — send to the RESOLVED on-file address, never the
      // submitted string (they can differ via aliases/merges).
      const email = buildPaymentInfoEmail({ firstName: person.firstName, paymentDetails: details })
      const sent = await sendAgreementEmail({
        to: [person.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        label: 'payment-info',
      })
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action: 'public.payment_info_sent',
          entityType: 'Person',
          entityId: person.id,
          oldValues: { submittedEmail: submitted },
          newValues: { sentTo: person.email, sendOk: sent.ok, at: new Date().toISOString() },
        },
      })
      if (!sent.ok) {
        console.error('[payment-info] send failed for person', person.id, sent)
      }
    } else {
      // UNKNOWN (or details unconfigured) — agent queue, send NOTHING.
      await prisma.inquiry.create({
        data: {
          source: 'WEB_FORM',
          status: 'NEW',
          title: 'Payment info request',
          description: `Payment info / ACH request from the public site.\n\nSubmitted email: ${submitted}\nOn file: ${person ? `person ${person.id} (no qualifying job)` : 'no match'}\n\nVerify the requester and send payment details manually.`,
          ...(person ? { personId: person.id } : {}),
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action: 'public.payment_info_request_unknown',
          entityType: 'Person',
          entityId: person?.id ?? 'unmatched',
          oldValues: { submittedEmail: submitted },
          newValues: { queued: true, at: new Date().toISOString() },
        },
      })
    }
  } catch (err) {
    // Even on internal failure the public response stays uniform — the
    // error is ours to chase in logs, not a signal to the requester.
    console.error('[payment-info] request handling failed:', err)
  }

  return NextResponse.json(UNIFORM_RESPONSE)
}
