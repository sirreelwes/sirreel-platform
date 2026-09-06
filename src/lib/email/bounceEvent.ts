/**
 * What a Resend bounce / complaint event actually says.
 *
 * ── The bug this exists for (2026-09-04 → 09-06) ───────────────────
 * Resend fires `email.bounced` PER RECIPIENT, and `data.to` on that
 * event is the recipient that bounced — not the message's To line. The
 * webhook used to treat every bounce as "the message failed": it flipped
 * the whole EmailDelivery to BOUNCED and suppressed `to[0]`.
 *
 * Twelve client emails in a row went "BOUNCED" that way. Every one had
 * oliver@sirreel.com in CC, and Oliver's Gmail vacation responder was
 * auto-replying to the envelope sender — Resend's per-message SES
 * bounce address. SES cannot read an out-of-office as a delivery
 * report, so it filed each one as a Transient/General bounce against
 * "Oliver Carlson <oliver@sirreel.com>", display name and all. The
 * clients had every message (Briana opened her portal six minutes
 * after her "bounced" quote); HQ showed red, a quote got re-sent to
 * Luis twice, and Wes spent a weekend forwarding mail by hand.
 *
 * ── The rules ─────────────────────────────────────────────────────
 *  1. A bounce names ONE recipient. Compare it to the delivery's To.
 *     Only a bounce of the To changes the delivery's status; a CC
 *     bounce is a note on the row, never a status change.
 *  2. Suppress on PERMANENT bounces and complaints only. A transient
 *     bounce is "try later" by definition — a full mailbox, a
 *     greylist, an auto-reply — and suppressing on it turns a Tuesday
 *     out-of-office into a permanent block.
 *  3. Addresses arrive in any shape ("Name <addr>", mixed case). Reduce
 *     to the bare lowercase address before comparing or storing.
 */

export interface BounceEventInput {
  /** 'email.bounced' | 'email.complained' */
  eventType: string
  /** Resend's `data.to` — the recipient the event is about. */
  eventTo: string | string[] | null | undefined
  /** Resend's `data.bounce.type`: 'Permanent' | 'Transient' | 'Undetermined' */
  bounceType?: string | null
  /** The EmailDelivery row this event matched, if any. */
  delivery: { toAddress: string; ccAddresses: string[] } | null
}

export interface BounceEventVerdict {
  /** Bare lowercase address the event is about, or null if unparseable. */
  bouncedAddress: string | null
  /** 'to' — the primary recipient; 'cc' — a copy; 'unknown' — no row / no match. */
  role: 'to' | 'cc' | 'unknown'
  /** True when the delivery's own status should change (To bounced, or no row to compare). */
  affectsDelivery: boolean
  /** True when the bounced address belongs on the suppression list. */
  shouldSuppress: boolean
  isPermanent: boolean
}

/** "Oliver Carlson <oliver@sirreel.com>" → "oliver@sirreel.com". */
export function bareAddress(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const m = raw.match(/<([^<>]+)>\s*$/)
  const addr = (m ? m[1] : raw).trim().toLowerCase()
  return addr.includes('@') ? addr : null
}

export function classifyBounceEvent(input: BounceEventInput): BounceEventVerdict {
  const rawTo = Array.isArray(input.eventTo) ? input.eventTo[0] : input.eventTo
  const bouncedAddress = bareAddress(rawTo)
  const isComplaint = input.eventType === 'email.complained'
  const isPermanent = isComplaint || /^permanent$/i.test(input.bounceType ?? '')

  let role: BounceEventVerdict['role'] = 'unknown'
  if (input.delivery && bouncedAddress) {
    if (bareAddress(input.delivery.toAddress) === bouncedAddress) role = 'to'
    else if (input.delivery.ccAddresses.some((c) => bareAddress(c) === bouncedAddress)) role = 'cc'
  }

  return {
    bouncedAddress,
    role,
    // No row, or an event we cannot attribute to a CC: treat it as the
    // message failing, the way the handler always did. A known CC never
    // touches the To's status.
    affectsDelivery: role !== 'cc',
    shouldSuppress: !!bouncedAddress && isPermanent,
    isPermanent,
  }
}
