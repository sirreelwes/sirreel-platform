/**
 * Action Items engine — shared types.
 *
 * ONE surface that absorbs the scattered worklists. Items are produced
 * by PROVIDERS (a registry), never stored as their own rows: a DERIVED
 * provider runs a live DB query; an EVENT provider reads records that
 * already exist (Alerts, Inquiries, Orders, …). There is intentionally
 * no ActionItem table — the only persisted thing is a per-user
 * dismissal side-row (ActionItemDismissal) for DERIVED items.
 */

import type { UserRole } from '@prisma/client'

export type ActionItemPriority = 'high' | 'medium' | 'low'

export const PRIORITY_RANK: Record<ActionItemPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export interface ActionItem {
  /** Stable, provider-namespaced id, e.g. "payment:{alertId}" or
   *  "coi:{bookingId}". Used as the dismissal key and the React key. */
  id: string
  /** Machine type, e.g. 'payment_info' | 'coi_missing' | 'quote_aging'. */
  type: string
  title: string
  subtitle: string
  /** Roles that own this item — drives the mine/all scope filter. */
  ownerRole: UserRole[]
  priority: ActionItemPriority
  href: string | null
  occurredAt: Date
  /** Provider id that emitted the item. */
  source: string
  /** How dismissal is persisted for THIS item:
   *   - 'alert:<id>'  → append the user to Alert.dismissed_by
   *   - 'sideRow'     → write an ActionItemDismissal row keyed by item.id
   *  Providers set this so the dismiss route routes correctly. */
  dismissal: { kind: 'alert'; alertId: string } | { kind: 'sideRow' }
}

export interface ProviderContext {
  userId: string | null
  role: UserRole | null
  /** 'TEAM' = privileged/all, 'OWN' = scoped — from resolveDataScope(). */
  scope: 'TEAM' | 'OWN'
  userEmail: string
}

export interface ActionItemProvider {
  id: string
  kind: 'DERIVED' | 'EVENT'
  fetch(ctx: ProviderContext): Promise<ActionItem[]>
}
