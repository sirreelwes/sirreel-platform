/**
 * Action Items registry — the single engine.
 *
 * Every provider is registered here and called once per request for
 * the signed-in user. Results are aggregated, filtered by mine/all
 * role scope and per-user dismissals, and priority-sorted.
 *
 * Providers wired (framework proof — not all types):
 *   - payment-info (EVENT)  — payment_info_request Alerts, split by path
 *   - coi-missing  (DERIVED)— bookings still missing a COI
 *   - quote-aging  (DERIVED)— open quotes gone quiet
 *   - inquiry-untouched (DERIVED) — web-form inquiries past the
 *     first-response SLA (in-app twin of the safety-net email)
 *   - hold-unassigned (DERIVED) — a sent quote whose soft holds are not
 *     yet on specific units. Sending a quote reserves a CATEGORY; until
 *     someone picks the truck it appears on no unit row at all.
 *   - check-report-changes (DERIVED) — a yard check-out report that had
 *     to change the order (a swap, a short, something extra on the
 *     truck) and the agent has not acknowledged it. Clears on ack.
 *   - lcdw-unapplied (DERIVED) — the client's damage-waiver answer and
 *     the order's money disagree: elected but no fee line, or declined
 *     with the fee still on. Clears when the line matches the answer.
 *   - partner-coi-missing (DERIVED) — a vehicle partner signed the
 *     Partner Vehicle Agreement 7+ days ago and HQ holds no COI (or it
 *     expired). Clears when receipt is stamped on the Portals tab.
 *   - partner-intro-unanswered (DERIVED) — Wes introduced SirReel to a
 *     prospective partner 4+ days ago and nobody has marked them. Their
 *     reply lands in his inbox, not HQ, so only a person can know; the
 *     item is the reminder to look. Clears on "Mark as new partner".
 *   - card-required (DERIVED) — HQ sent the card link for an upcoming
 *     booking and no card arrived in either store. The yard's check-out
 *     refuses the same rows (lib/payments/cardGate.ts); this is the
 *     agent hearing about it first.
 *   - card-declined (DERIVED) — a card DID arrive and it will not charge:
 *     the bank refused the $0 check, or it has expired. Strictly the case
 *     card-required cannot see — that provider's condition is NOT EXISTS,
 *     and a dead card satisfies it, so the bad card silences the good
 *     warning. `cardGateForJob` has the same blind spot and will let the
 *     yard release it, which is why this row says so. Clears the moment any
 *     usable card exists on the job or the company. Never fires on a card
 *     HQ never validated (most Planyo-era rows) — see cardAsk.isCardUsable.
 *   - driver-hours-untrued (DERIVED) — a partner's driver logged their
 *     hours and the order still bills the quoted estimate. Clears when
 *     the desk applies them (lib/orders/driverTrueUp.ts).
 *   - annual-requested (DERIVED) — a client asked, from their portal, to
 *     be set up on an annual rental agreement. Clears when the annual is
 *     offered for signature (or a master is already pending/covering).
 *   - partner-cancelled-off-pick-list (DERIVED) — a partner's booking on a
 *     line was cancelled while the order is booked (or its pull order is out),
 *     and the line, kept off the pick list as a partner line, never went on
 *     it. Clears when put on the list from the order page or the line goes.
 *   - replacement-cost-missing (DERIVED) — a catalog row going out on an
 *     upcoming order with no replacement cost, so the order cannot tell
 *     the client's broker what to insure it for. A VEHICLE row going out
 *     inside the week is its own item; every other catalog row folds into
 *     ONE backlog item that links to the pricing wizard (Wes 2026-09-17:
 *     71 rows was the catalog chore, not 71 tasks). Clears when the row
 *     (or its RentalWorks units) is priced.
 *   - dot-sheet-incomplete (DERIVED) — an order whose vehicles are picked
 *     but whose DOT record has blanks, so the client's sheet is being
 *     withheld. The complete case publishes itself and raises nothing.
 *
 * PICKUP WINDOW (rules.ts, Wes 2026-09-17): an item tied to a rental
 * going out carries `dueAt` = the pickup, shows only inside
 * PICKUP_WINDOW_DAYS of it, and is labelled by it. `occurredAt` is when
 * the record was made and is not urgency.
 *   - kit-incomplete (DERIVED) — an upcoming order whose radios (or any
 *     kitted item) are missing the pieces the catalog says ride with
 *     them, so they never print on the pull sheet. The early half of the
 *     check the yard's check-out sheet now enforces at the bay.
 *   - walkies-short (DERIVED) — committed walkie orders need more Motorola
 *     CP200s on some day than the pool (analog + digital stock + subbed in)
 *     holds. Says how many to sub; clears when the sub-rental is recorded.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (ruling B, load-bearing principle for
 * every provider): a billing/ops item is something the system COULD
 * NOT auto-clear. A path the system already handled never becomes a
 * task for the owning role — it is at most a low-priority FYI for the
 * originating team. The payment-info provider shows the shape: the
 * auto-sent path is a LOW sales FYI (ownerRole AGENT+admin), the
 * unmatched/exception path is a HIGH billing task (ownerRole
 * BILLING+admin). Future providers follow suit:
 *   - Shoot-days claims → only PENDING (agent hasn't ruled) escalate;
 *     APPROVED/ADJUSTED already handled, no item.
 *   - Overdue chase → only past-due-with-no-payment-plan escalate;
 *     paid / on-plan invoices never create a billing task.
 * The rule keeps each role's "mine" tab to genuine exceptions, not a
 * log of the system doing its job.
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
import { compareActionItems } from '@/lib/actionItems/rules'
import { paymentInfoProvider } from '@/lib/actionItems/providers/paymentInfo'
import { coiMissingProvider } from '@/lib/actionItems/providers/coiMissing'
import { quoteAgingProvider } from '@/lib/actionItems/providers/quoteAging'
import { inquiryUntouchedProvider } from '@/lib/actionItems/providers/inquiryUntouched'
import { rwTokenProvider } from '@/lib/actionItems/providers/rwToken'
import { holdUnassignedProvider } from '@/lib/actionItems/providers/holdUnassigned'
import { checkReportChangesProvider } from '@/lib/actionItems/providers/checkReportChanges'
import { lcdwUnappliedProvider } from '@/lib/actionItems/providers/lcdwUnapplied'
import { partnerCoiMissingProvider } from '@/lib/actionItems/providers/partnerCoiMissing'
import { partnerIntroUnansweredProvider } from '@/lib/actionItems/providers/partnerIntroUnanswered'
import { partnerPhotosAddedProvider } from '@/lib/actionItems/providers/partnerPhotosAdded'
import { cardRequiredProvider } from '@/lib/actionItems/providers/cardRequired'
import { cardDeclinedProvider } from '@/lib/actionItems/providers/cardDeclined'
import { driverHoursUntruedProvider } from '@/lib/actionItems/providers/driverHoursUntrued'
import { clientCreatedUnquotedProvider } from '@/lib/actionItems/providers/clientCreatedUnquoted'
import { possibleDuplicateJobProvider } from '@/lib/actionItems/providers/possibleDuplicateJob'
import { annualRequestedProvider } from '@/lib/actionItems/providers/annualRequested'
import { replacementCostMissingProvider } from '@/lib/actionItems/providers/replacementCostMissing'
import { dotSheetIncompleteProvider } from '@/lib/actionItems/providers/dotSheetIncomplete'
import { kitIncompleteProvider } from '@/lib/actionItems/providers/kitIncomplete'
import { walkiesShortProvider } from '@/lib/actionItems/providers/walkiesShort'
import { partnerCancelledOffPickListProvider } from '@/lib/actionItems/providers/partnerCancelledOffPickList'

const PROVIDERS: ActionItemProvider[] = [
  // A client set up their own job on the public agreement page and may
  // already have signed. Nothing else fires on these: the inquiry is
  // born CONVERTED (so every SLA surface skips it) and quote-aging
  // counts from a quote that was never sent (Wes 2026-09-07).
  clientCreatedUnquotedProvider,
  // The yard changed a booked order at the dock and the agent hasn't
  // seen it yet — the money moved without them.
  checkReportChangesProvider,
  // A partner's booking was cancelled and SirReel is filling the line — but
  // partner lines are kept off the pick list, so the warehouse was never told.
  partnerCancelledOffPickListProvider,
  // HQ sent the card link, nothing came back, and the yard will refuse
  // to release the vehicle until the agent keys a signed authorization.
  cardRequiredProvider,
  // The client DID give us a card and it will not charge — refused, or
  // expired. The one above cannot see it: its condition is NOT EXISTS, and
  // a dead card satisfies every existence check in HQ, the yard's gate
  // included. Nothing chased these before (Wes 2026-09-18).
  cardDeclinedProvider,
  // A driver logged their hours and the order still bills the estimate —
  // catch it before the invoice goes out.
  driverHoursUntruedProvider,
  // The client answered the waiver question and the quote's money
  // doesn't match the answer — usually the auto-apply could not run.
  lcdwUnappliedProvider,
  // The nightly Planyo import landed a booking beside a job that may be
  // the same production. It has always flagged this; the flag went only
  // to Slack until 2026-09-09, and work got split across both twins.
  possibleDuplicateJobProvider,
  // A client asked, in their own portal, to be set up on an annual
  // agreement. Answering is one click on the company page; nothing else in
  // HQ fires on the ask.
  annualRequestedProvider,
  holdUnassignedProvider,
  paymentInfoProvider,
  coiMissingProvider,
  quoteAgingProvider,
  inquiryUntouchedProvider,
  rwTokenProvider,
  // A partner signed a week+ ago and we hold no certificate of insurance
  // (or it expired). The welcome email deliberately does not ask.
  partnerCoiMissingProvider,
  partnerIntroUnansweredProvider,
  // A partner put photos on a unit from their page. Live at once, no gate
  // (Wes 2026-09-11) — this is the glance HQ owes them.
  partnerPhotosAddedProvider,
  // A catalog row on an upcoming order has no replacement cost, so the
  // order's COI figure for the client's broker is a floor, not a total.
  replacementCostMissingProvider,
  dotSheetIncompleteProvider,
  kitIncompleteProvider,
  // Committed walkie orders overrun the CP200 pool on some day — HQ says
  // how many to sub (Wes 2026-09-15: the "(Sub)" catalog row is gone).
  walkiesShortProvider,
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

  // Priority, then soonest pickup (items that carry a dueAt), then
  // most-recent-first — see rules.ts.
  items.sort(compareActionItems)

  return { items, canSeeAll, role }
}

/**
 * Nav-badge count for the current user — always 'mine', and ONLY the
 * 'high' priority items. The badge used to be the whole list, which
 * read "99+" on the phone hamburger every day (2026-09-12: 123 items
 * for Wes, 24 of them high) — a number that never changes is not a
 * signal. Medium/low items still show on the Action Items panel; they
 * just don't light the red dot. (Wes: the badge is for critical
 * warnings only.)
 */
export async function getActionItemCount(userEmail: string): Promise<number> {
  const { items } = await getActionItemsForUser(userEmail, 'mine')
  return items.filter((it) => it.priority === 'high').length
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
