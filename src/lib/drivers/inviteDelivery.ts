/**
 * Did the driver's invite actually reach them?
 *
 * Wes, 2026-09-15: "how can i know if the drivers that i already named
 * received their texts?" — the Drivers card showed INVITED / VIEWED,
 * which is about the LINK, not about the message. A text that Twilio
 * never delivered looked identical to one sitting unread on a phone, and
 * the difference is whether anyone is coming for the truck.
 *
 * One lookup for a page's worth of drivers, keyed by DriverAssignment id.
 * Emailed invites are not covered here — EmailDelivery already tracks
 * those on its own row and the card names the address it went to.
 */

import { prisma } from '@/lib/prisma'

export type TextDeliveryState = 'delivered' | 'sent' | 'pending' | 'failed' | 'not-sent'

export interface TextDelivery {
  state: TextDeliveryState
  /** What to show: "Text delivered", "Text failed — not delivered"… */
  label: string
  /** Twilio's word (or ours), for the tooltip. */
  raw: string
  at: string | null
  /** Why it didn't go, when we know. */
  error: string | null
}

/**
 * Twilio's lifecycle is queued → sent → delivered, with undelivered/failed
 * as the ends that matter. Our own skipped-* statuses never left HQ at
 * all, and those are the ones a rep has to act on, so they read as
 * failures rather than as "pending".
 */
function classify(status: string | null, error: string | null): TextDelivery['state'] {
  const s = (status || '').toLowerCase()
  if (s === 'delivered') return 'delivered'
  if (s === 'sent') return 'sent'
  if (s === 'queued' || s === 'accepted' || s === 'sending') return 'pending'
  if (s.startsWith('skipped') || s === 'failed' || s === 'undelivered' || error) return 'failed'
  return 'pending'
}

function labelFor(state: TextDelivery['state'], status: string | null): string {
  switch (state) {
    case 'delivered': return 'Text delivered'
    case 'sent': return 'Text sent'
    case 'pending': return 'Text sending…'
    case 'failed':
      return status === 'skipped-opted-out'
        ? 'Not texted — they replied STOP'
        : status === 'skipped-unconfigured'
          ? 'Not texted — texting is off'
          : status === 'skipped-quiet'
            ? 'Held until morning — quiet hours'
            : 'Text failed — not delivered'
    default: return 'No text sent'
  }
}

/** Exposed for the test — the mapping is the part with rules in it. */
export const __testing = { classify, labelFor }

/** Latest invite text per DriverAssignment id. */
export async function textDeliveryForAssignments(
  driverAssignmentIds: string[],
): Promise<Map<string, TextDelivery>> {
  const ids = [...new Set(driverAssignmentIds.filter(Boolean))]
  const out = new Map<string, TextDelivery>()
  if (ids.length === 0) return out

  const rows = await prisma.smsMessage.findMany({
    where: { driverAssignmentId: { in: ids }, direction: 'OUTBOUND' },
    orderBy: { createdAt: 'asc' },
    select: { driverAssignmentId: true, status: true, errorText: true, createdAt: true },
  })
  // Ascending, so the last write per id wins — a re-invite replaces the
  // older attempt rather than reporting it.
  for (const r of rows) {
    if (!r.driverAssignmentId) continue
    const state = classify(r.status, r.errorText)
    out.set(r.driverAssignmentId, {
      state,
      label: labelFor(state, r.status),
      raw: r.status ?? 'unknown',
      at: r.createdAt.toISOString(),
      error: r.errorText ?? null,
    })
  }
  return out
}
