/**
 * The driver relay — production ↔ driver, through us.
 *
 * Wes, 2026-08-28: once the vendor assigns a driver, production should be able
 * to send directions, call sheets and call times to an address WE create, have
 * it reach the driver, and have all of it visible in HQ. Neither side learns
 * the other's address, and neither has to be onboarded to anything.
 *
 * ── Why the address looks like this ──────────────────────────────────────────
 * Asked for: drivername.<token>.jobs@sirreel.com
 * Shipped:   jobs+drivername.<token>@sirreel.com
 *
 * Not a style choice. Gmail delivers a message to a mailbox when the local part
 * is that mailbox's name optionally followed by `+suffix`. `x.y.jobs@` is a
 * DIFFERENT local part — it would need either its own Workspace alias (and
 * watchedInboxes.ts is explicit that aliases break the domain-wide-delegation
 * ingest path we rely on) or a catch-all routing rule. The plus form needs no
 * Workspace change, lands in jobs@ — already watched, already ingested, and
 * already the paperwork inbox — and keeps the driver's name legible in the
 * address, which was the point of the request.
 *
 * If the dotted form is wanted later, an admin routing rule mapping
 * `*.jobs@sirreel.com` → jobs@ makes it work; parseRelayTag below already
 * accepts both spellings so no code changes when that happens.
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

/** The watched Workspace mailbox the relay rides on. */
export const RELAY_MAILBOX = 'jobs'
export const RELAY_DOMAIN = 'sirreel.com'

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'driver'
  )
}

/** jobs+{tag}@sirreel.com */
export function relayAddress(tag: string): string {
  return `${RELAY_MAILBOX}+${tag}@${RELAY_DOMAIN}`
}

/**
 * Pull our relay tag out of whatever the mail server put on the message.
 *
 * Accepts both the plus form we mint and the dotted form Wes asked for, so a
 * future catch-all routing rule needs no code change. Returns null for
 * ordinary jobs@ mail — this must never claim a message that isn't ours.
 */
export function parseRelayTag(address: string | null | undefined): string | null {
  if (!address) return null
  // A header can carry a display name and several addresses; scan them all.
  const candidates = address.toLowerCase().match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []
  for (const raw of candidates) {
    const [local, domain] = raw.split('@')
    if (domain !== RELAY_DOMAIN || !local) continue
    // jobs+<tag>
    if (local.startsWith(`${RELAY_MAILBOX}+`)) {
      const tag = local.slice(RELAY_MAILBOX.length + 1)
      if (tag) return tag
    }
    // <tag>.jobs  — the dotted spelling, only reachable behind a routing rule
    if (local.endsWith(`.${RELAY_MAILBOX}`)) {
      const tag = local.slice(0, -(RELAY_MAILBOX.length + 1))
      if (tag) return tag
    }
  }
  return null
}

export interface AssignDriverArgs {
  subRentalId: string
  driverName: string
  driverEmail: string
  driverPhone?: string | null
}

export interface AssignedDriver {
  relayTag: string
  relayAddress: string
  driverName: string
}

/**
 * Record the vendor's driver and mint the relay address.
 *
 * The tag keeps the driver's name for legibility plus 6 random bytes so it
 * isn't guessable from the name alone — anyone holding the address can mail
 * the driver, which is exactly its purpose, so it should not be derivable.
 * Re-assigning a driver re-mints: the previous address stops resolving, which
 * is the right behaviour when a vendor swaps drivers mid-job.
 */
export async function assignDriver(args: AssignDriverArgs): Promise<AssignedDriver | { error: string }> {
  const name = args.driverName.trim()
  const email = args.driverEmail.trim().toLowerCase()
  if (!name) return { error: 'Driver name is required.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid driver email is required.' }

  const tag = `${slugifyName(name)}.${randomBytes(6).toString('hex')}`
  await prisma.subRental.update({
    where: { id: args.subRentalId },
    data: {
      driverName: name,
      driverEmail: email,
      driverPhone: args.driverPhone?.trim() || null,
      driverAssignedAt: new Date(),
      relayTag: tag,
    },
  })
  return { relayTag: tag, relayAddress: relayAddress(tag), driverName: name }
}

export interface RelayTarget {
  subRentalId: string
  driverName: string
  driverEmail: string
  jobCode: string | null
  vehicleName: string
  /** Production's address — where a DRIVER's reply is relayed back to.
   *  Primary job contact, else the first contact with an email. */
  productionEmail: string | null
  productionName: string | null
}

/**
 * Resolve a relay tag to the driver it forwards to. Null when the tag is
 * unknown or the driver has since been unassigned, so a stale address goes
 * nowhere rather than to whoever holds the seat now.
 */
export async function resolveRelayTarget(tag: string): Promise<RelayTarget | null> {
  const s = await prisma.subRental.findFirst({
    where: { relayTag: tag, driverEmail: { not: null } },
    select: {
      id: true,
      driverName: true,
      driverEmail: true,
      itemDescription: true,
      job: {
        select: {
          jobCode: true,
          jobContacts: {
            select: { isPrimary: true, person: { select: { firstName: true, lastName: true, email: true } } },
          },
        },
      },
    },
  })
  if (!s?.driverEmail) return null

  const contacts = (s.job?.jobContacts ?? []).filter((c) => !!c.person?.email)
  const chosen = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null

  return {
    subRentalId: s.id,
    driverName: s.driverName ?? 'Driver',
    driverEmail: s.driverEmail,
    jobCode: s.job?.jobCode ?? null,
    vehicleName: s.itemDescription,
    productionEmail: chosen?.person?.email ?? null,
    productionName: chosen
      ? `${chosen.person!.firstName ?? ''} ${chosen.person!.lastName ?? ''}`.trim() || null
      : null,
  }
}

/**
 * Which way is this message going?
 *
 * 'to-driver'     production (or anyone else holding the address) → the driver
 * 'to-production' the driver replying → back to production
 * null            we can't place it, so we relay nothing and only log
 *
 * The from-address check is also the loop guard: a message from the driver is
 * never sent back to the driver.
 */
export function relayDirection(
  fromAddress: string | null | undefined,
  target: RelayTarget,
): 'to-driver' | 'to-production' | null {
  const from = (fromAddress || '').toLowerCase()
  if (!from) return null
  if (from.includes(target.driverEmail.toLowerCase())) {
    return target.productionEmail ? 'to-production' : null
  }
  return 'to-driver'
}

/**
 * Wrap a relayed message so the driver knows what it is and how to answer,
 * without exposing who sent it or any SirReel-internal detail.
 *
 * The driver replies to the relay address, not to production: that keeps the
 * conduit intact in both directions and keeps the thread in HQ.
 */
export function relayWrapper(args: {
  target: RelayTarget
  originalSubject: string
  bodyHtml: string
}): { subject: string; html: string } {
  const ref = args.target.jobCode ? ` · ${args.target.jobCode}` : ''
  const subject = args.originalSubject || `Job details — ${args.target.vehicleName}`
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="background:#f3f4f6;border-left:3px solid #D4A547;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#4b5563;">
    Production message for <strong>${args.target.driverName}</strong> — ${args.target.vehicleName}${ref}.<br/>
    Reply to this email and your answer goes back to the production through SirReel.
  </div>
  ${args.bodyHtml}
</div>`
  return { subject, html }
}

/**
 * Relay one inbound message. Called from the Gmail pubsub handler once per
 * message (that loop already skips anything previously ingested, which is what
 * stops a message being forwarded twice).
 *
 * Non-fatal by construction: a relay failure must never break ingest for the
 * rest of the mailbox, so everything returns a reason instead of throwing.
 * The message is still ingested either way — being able to see it is the
 * point, and that stays true when forwarding fails.
 */
export async function relayInboundMessage(args: {
  tag: string
  fromAddress: string | null
  subject: string
  bodyHtml: string
}): Promise<{ relayed: boolean; direction?: string; reason?: string }> {
  const { sendAgreementEmail } = await import('@/lib/email/sendAgreementEmail')
  const target = await resolveRelayTarget(args.tag)
  if (!target) return { relayed: false, reason: 'unknown-or-unassigned-tag' }

  const direction = relayDirection(args.fromAddress, target)
  if (!direction) return { relayed: false, reason: 'no-production-contact-to-reply-to' }

  const to = direction === 'to-driver' ? target.driverEmail : target.productionEmail!
  const wrapped = relayWrapper({
    target,
    originalSubject: args.subject,
    bodyHtml:
      direction === 'to-driver'
        ? args.bodyHtml
        : `<p style="font-size:14px;color:#4b5563;margin:0 0 12px;">From ${target.driverName}, your driver:</p>${args.bodyHtml}`,
  })

  const res = await sendAgreementEmail({
    to: [to],
    // Replies come back to the relay, never to the other party directly —
    // that is what keeps the conduit intact and the thread visible in HQ.
    replyTo: relayAddress(args.tag),
    subject: wrapped.subject,
    html: wrapped.html,
    label: `driver-relay-${direction}`,
  })
  return res.ok
    ? { relayed: true, direction }
    : { relayed: false, direction, reason: res.reason }
}
