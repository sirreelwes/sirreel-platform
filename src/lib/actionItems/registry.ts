/**
 * Action Items registry — the single engine.
 *
 * Every provider is registered here and called once per request for
 * the signed-in user. Results are aggregated, filtered by mine/all
 * role scope and per-user dismissals, and priority-sorted.
 *
 * Providers wired this goal (framework proof — not all types):
 *   - payment-info (EVENT)  — payment_info_request Alerts
 *   - coi-missing  (DERIVED)— bookings still missing a COI
 *   - quote-aging  (DERIVED)— open quotes gone quiet
 *
 * MIGRATION PLAN for the remaining worklists (planned, NOT built here):
 *   - Stage-paperwork worklist (/api/admin/paperwork-summary raw SQL:
 *     incompleteJobs / coiQueue / redlines) → 3 DERIVED providers
 *     ('paperwork-incomplete', 'coi-review', 'redline-review') reading
 *     the same paperwork_requests joins; dismissal = sideRow. The
 *     DaniDashboard widgets then read the engine instead of calling
 *     paperwork-summary directly, and that endpoint can retire.
 *   - Fleet-readiness reminders (/api/cron/fleet-readiness digest) →
 *     one DERIVED provider 'fleet-readiness' reusing lib/fleet/todayBoard
 *     fleetMovementsOn() for vehicles departing today/tomorrow;
 *     ownerRole [ADMIN, MANAGER, FLEET_TECH]; dismissal = sideRow keyed
 *     per (assetId, date). The cron keeps sending the digest; the
 *     provider just surfaces the same items in the tab.
 *   - Shoot-days claims (OrderLineItem claimStatus=PENDING) and
 *     after-hours chatbot inquiries → future DERIVED/EVENT providers,
 *     same shape.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveDataScope } from '@/lib/auth/scope'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { PRIORITY_RANK } from '@/lib/actionItems/types'
import { paymentInfoProvider } from '@/lib/actionItems/providers/paymentInfo'
import { coiMissingProvider } from '@/lib/actionItems/providers/coiMissing'
import { quoteAgingProvider } from '@/lib/actionItems/providers/quoteAging'

const PROVIDERS: ActionItemProvider[] = [
  paymentInfoProvider,
  coiMissingProvider,
  quoteAgingProvider,
]

/** Privileged roles see the whole org (mirrors resolveDataScope). */
const PRIVILEGED: ReadonlyArray<UserRole> = ['ADMIN', 'MANAGER']

export interface ActionItemsResult {
  items: ActionItem[]
  /** True when the caller may use the "all" toggle (admin). */
  canSeeAll: boolean
  role: UserRole | null
}

/**
 * Fetch the current user's action items.
 *   view='mine' → items whose ownerRole includes the user's role
 *   view='all'  → every item (privileged only; ignored for others)
 */
export async function getActionItemsForUser(
  userEmail: string,
  view: 'mine' | 'all' = 'mine',
): Promise<ActionItemsResult> {
  const scope = await resolveDataScope()
  const role = scope.role
  const canSeeAll = !!role && PRIVILEGED.includes(role)
  const effectiveView = view === 'all' && canSeeAll ? 'all' : 'mine'

  const ctx: ProviderContext = {
    userId: scope.userId,
    role,
    scope: scope.scope,
    userEmail,
  }

  // Run providers; a single provider failure must not sink the tab.
  const settled = await Promise.allSettled(PROVIDERS.map((p) => p.fetch(ctx)))
  let items: ActionItem[] = []
  for (const [i, res] of settled.entries()) {
    if (res.status === 'fulfilled') items.push(...res.value)
    else console.error(`[action-items] provider ${PROVIDERS[i].id} failed:`, res.reason)
  }

  // Role scope — 'mine' keeps only items the user's role owns.
  if (effectiveView === 'mine' && role) {
    items = items.filter((it) => it.ownerRole.includes(role))
  }

  // Per-user dismissals: side-row keys (DERIVED) — alert dismissals are
  // already applied inside the payment provider's query.
  const sideRowKeys = items.filter((it) => it.dismissal.kind === 'sideRow').map((it) => it.id)
  if (sideRowKeys.length > 0) {
    const dismissed = await prisma.actionItemDismissal.findMany({
      where: { userEmail, itemKey: { in: sideRowKeys } },
      select: { itemKey: true },
    })
    const dismissedSet = new Set(dismissed.map((d) => d.itemKey))
    items = items.filter((it) => !dismissedSet.has(it.id))
  }

  // Priority, then most-recent-first.
  items.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (pr !== 0) return pr
    return b.occurredAt.getTime() - a.occurredAt.getTime()
  })

  return { items, canSeeAll, role }
}

/** Unhandled count for the current user (nav badge) — always 'mine'. */
export async function getActionItemCount(userEmail: string): Promise<number> {
  const { items } = await getActionItemsForUser(userEmail, 'mine')
  return items.length
}

/**
 * Dismiss one item for a user. Routes by the item's dismissal kind:
 * EVENT/alert → append to Alert.dismissed_by; DERIVED → side-row.
 * itemId is the provider-namespaced id; dismissalKind + alertId are
 * echoed from the item so the route need not re-derive them.
 */
export async function dismissActionItem(
  userEmail: string,
  itemId: string,
  dismissal: { kind: 'alert'; alertId: string } | { kind: 'sideRow' },
): Promise<void> {
  if (dismissal.kind === 'alert') {
    await prisma.$executeRaw`
      UPDATE alerts
      SET dismissed_by = array_append(dismissed_by, ${userEmail}), updated_at = now()
      WHERE id = ${dismissal.alertId}
        AND NOT (dismissed_by @> ARRAY[${userEmail}]::text[])
    `
    return
  }
  await prisma.actionItemDismissal.upsert({
    where: { itemKey_userEmail: { itemKey: itemId, userEmail } },
    create: { itemKey: itemId, userEmail },
    update: {},
  })
}
