/**
 * Minting scoped payment-details share links.
 *
 * Two callers, one code path so they cannot drift:
 *   PORTAL          a producer sends the details to their A/P department
 *   PUBLIC_REQUEST  someone asks through the public payment-info form
 *
 * Both exist to keep account numbers OUT of email. The link is the whole
 * message; there is nothing in it for an attacker to rewrite, and the reader
 * gets the numbers from sirreel.com over TLS instead of from a forwarded
 * message they cannot authenticate.
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

/** The URL is the credential — 24 bytes puts guessing out of reach. */
const TOKEN_BYTES = 24
const TTL_DAYS = 90

const SINGLETON = 'singleton'

/**
 * Origin for a share link built OUTSIDE a request — the operator send has no
 * incoming request to take a host from. The marketing host serves
 * /pay-details/[token] (it is in middleware's public allow-list), and it is
 * the host clients recognise, which matters on a link about money.
 */
export function paymentShareBaseUrl(): string {
  return PUBLIC_SITE_ORIGIN
}

export interface MintedShare {
  token: string
  expiresAt: Date
}

/**
 * True when there is enough on file to be worth sending someone to.
 * A half-configured record would invite an A/P department to wire money
 * against incomplete instructions, which is worse than sending nothing.
 */
export async function paymentDetailsConfigured(): Promise<boolean> {
  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { paymentPayeeName: true, paymentAccountNumber: true, paymentRoutingAch: true },
  })
  return !!(s?.paymentPayeeName && s?.paymentAccountNumber && s?.paymentRoutingAch)
}

export async function createPaymentShare(args: {
  sentToEmail: string
  /** PAPERWORK_PORTAL — a client sent it from the v2 guided portal, which
   *  authenticates by token and has no PortalAccess row to attribute to; the
   *  booking's person is the audit trail there instead. */
  createdVia: 'PORTAL' | 'PUBLIC_REQUEST' | 'OPERATOR' | 'PAPERWORK_PORTAL'
  portalAccessId?: string | null
  personId?: string | null
}): Promise<MintedShare> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000)
  await prisma.paymentDetailsShare.create({
    data: {
      token,
      sentToEmail: args.sentToEmail,
      createdVia: args.createdVia,
      portalAccessId: args.portalAccessId ?? null,
      personId: args.personId ?? null,
      expiresAt,
    },
  })
  return { token, expiresAt }
}

/** Wording shared by both share emails, so the anti-fraud line is identical
 *  wherever a client meets it. Consistency is the point: a client who has
 *  read this twice is primed to distrust the message that contradicts it. */
export const SHARE_FRAUD_WARNING =
  'We do not send banking details by email, and our details never change. ' +
  'If you receive a message claiming our bank account has changed — even from ' +
  'a familiar address — call us before sending payment.'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Mint a share and email the link — the whole A/P hand-off, in one place.
 *
 * Both client portals offer this now (the job portal by session, the v2
 * paperwork portal by token) and the message they send has to be the same
 * message: it carries the anti-fraud warning, and a warning a client meets in
 * two different wordings is one they stop reading. The ROUTES own who is
 * allowed to ask and how often; everything after that is here.
 *
 * The email carries NO account numbers — only a link. There is nothing in it
 * for an attacker to rewrite, and the reader gets the numbers from a TLS page.
 */
export async function sendPaymentShareEmail(args: {
  to: string
  /** Origin of the request, so the link points at the host the client is
   *  actually on — a portal-host client sent to the marketing host 404s. */
  origin: string
  /** Client company, for the opening line. */
  company: string
  /** " for order S260826-004", or '' when there is no order to name. */
  orderRef: string
  createdVia: 'PORTAL' | 'PUBLIC_REQUEST' | 'OPERATOR' | 'PAPERWORK_PORTAL'
  portalAccessId?: string | null
  personId?: string | null
  /** Injected so this module stays free of the email transport. */
  send: (msg: { to: string[]; subject: string; html: string; text: string }) => Promise<{
    ok: boolean
    reason?: string
  }>
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // Confirm details EXIST before promising an A/P department a working link.
  // Sending someone to an empty page invites them to go hunting for the
  // numbers in an old email, which is the habit this is meant to break.
  if (!(await paymentDetailsConfigured())) {
    console.error('[payment-share] details not configured — nothing sent')
    return {
      ok: false,
      status: 409,
      error: 'Payment details are not available yet. Contact billing@sirreel.com.',
    }
  }

  const { token } = await createPaymentShare({
    sentToEmail: args.to,
    createdVia: args.createdVia,
    portalAccessId: args.portalAccessId ?? null,
    personId: args.personId ?? null,
  })

  const link = `${args.origin}/pay-details/${token}`
  const subject = `SirReel Studio Services — payment details${args.orderRef}`

  const text = [
    'Hello,',
    '',
    `${args.company} has asked us to send SirReel Studio Services' payment details${args.orderRef}.`,
    '',
    'You can view them here:',
    link,
    '',
    SHARE_FRAUD_WARNING,
    '',
    'Questions: billing@sirreel.com',
    '',
    'SirReel Studio Services',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#1a1a1a">
      <p>Hello,</p>
      <p>${escapeHtml(args.company)} has asked us to send SirReel Studio Services&rsquo; payment
      details${escapeHtml(args.orderRef)}.</p>
      <p style="margin:22px 0">
        <a href="${link}" style="background:#1a1a1a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View payment details</a>
      </p>
      <p style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:11px 13px;font-size:13px;color:#78350f">
        <strong>${escapeHtml(SHARE_FRAUD_WARNING)}</strong>
      </p>
      <p style="font-size:13px;color:#555">Questions: billing@sirreel.com</p>
      <p style="font-size:13px;color:#555">SirReel Studio Services</p>
    </div>`

  const sent = await args.send({ to: [args.to], subject, html, text })
  if (!sent.ok) {
    console.error('[payment-share] send failed to %s: %s', args.to, sent.reason)
    return {
      ok: false,
      status: 502,
      error: 'We could not send that email. Contact billing@sirreel.com.',
    }
  }
  return { ok: true }
}
