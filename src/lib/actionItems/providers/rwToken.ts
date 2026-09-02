import type { UserRole } from '@prisma/client'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { rwCredentialStatus } from '@/lib/rentalworks/credential'

/**
 * RentalWorks connection provider (DERIVED).
 *
 * Deliberately NOT a stored Alert row (Wes 2026-09-02). A stored alert needs
 * somebody to create exactly one, not create it again tomorrow, and remember
 * to close it when the token comes good — three chances to leave a stale
 * "token expired" sitting on a connection that has been fine for a week.
 *
 * A derived item is idempotent by construction: it is a live read of the
 * credential's state, so there is always exactly one, and it DISAPPEARS the
 * moment Verify goes green. Nothing to dismiss, nothing to clean up.
 *
 * ownerRole is [ADMIN] alone: renewing the RentalWorks credential is Wes's
 * job, not Billing's, even though Billing feels the consequences.
 */

const OWNER: UserRole[] = ['ADMIN']

export const rwTokenProvider: ActionItemProvider = {
  id: 'rw-token',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    const s = await rwCredentialStatus()
    if (s.health === 'green') return []

    const red = s.health === 'red'
    const occurredAt = s.lastVerifiedAt ? new Date(s.lastVerifiedAt) : new Date()

    return [
      {
        // One id per STATE, not per occurrence — the item cannot pile up.
        id: `rw-token:${s.health}`,
        type: red ? 'rw_token_expired' : 'rw_token_expiring',
        title: red
          ? 'RentalWorks connection is down'
          : 'RentalWorks token is due for renewal',
        subtitle: red
          ? 'Invoice imports are stopped until it is renewed — nothing is falling back to another source.'
          : `Last renewed ${s.lastRotatedAt ? new Date(s.lastRotatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}. HQ retries automatically; paste one if it cannot.`,
        ownerRole: OWNER,
        priority: red ? 'high' : 'medium',
        href: '/collections',
        occurredAt,
        source: 'rw-token',
        // Derived state, so there is nothing to dismiss — it clears itself.
        dismissal: { kind: 'sideRow' },
      },
    ]
  },
}
