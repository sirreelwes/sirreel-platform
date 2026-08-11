/**
 * Marking an order's agent as the client's named rep.
 *
 * Order.repVisibleToClient is opt-in because every order HAS an agent —
 * self-serve jobs get one assigned automatically — and an automatic
 * assignment is not a relationship. Showing one put the wrong person's name,
 * phone and email in front of clients.
 *
 * But a rep who is actually WORKING the account should appear. Rather than a
 * toggle somebody has to remember, the signal is taken from what already
 * happened: whenever SirReel sends the client an email that names the rep
 * ("your rep is X", reply-to X), the relationship is established by that act,
 * and the portal should agree with the email the client just received.
 *
 * So this is called from the routes that send those emails. Deliberately
 * fire-and-forget: failing to flip a display flag must never fail a send that
 * already reached the client.
 */

import { prisma } from '@/lib/prisma'

export async function markRepVisibleToClient(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { repVisibleToClient: true },
    })
  } catch (err) {
    // Worth a line — a rep the client has been introduced to by email but
    // who never appears in the portal is a confusing inconsistency.
    console.error('[rep-visibility] could not mark order %s: %s', orderId, err)
  }
}
