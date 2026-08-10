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

/** The URL is the credential — 24 bytes puts guessing out of reach. */
const TOKEN_BYTES = 24
const TTL_DAYS = 90

const SINGLETON = 'singleton'

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
  createdVia: 'PORTAL' | 'PUBLIC_REQUEST'
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
