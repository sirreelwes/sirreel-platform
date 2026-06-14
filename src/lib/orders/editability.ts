/**
 * Centralized editability gates for the post-BOOKED widening
 * (Phase 1 step 4).
 *
 * The gate is now THREE checks, not one:
 *
 *   1. `isOrderEditable(status)` — is the order in any of the
 *      lifecycle states where edits are allowed at all?
 *      Yes:  DRAFT, QUOTE_SENT, APPROVED,
 *            BOOKED, LOADED_READY, ON_JOB, RETURNED, LD_CHECK.
 *      No:   INVOICED, CLOSED, CANCELLED.
 *
 *   2. `isLineItemEditable(status, department)` — is the line edit
 *      ALSO unrestricted by the per-department Phase 1 scope?
 *      Phase 1 ships sync for non-hold categories only (WAREHOUSE
 *      lane). VEHICLES and STAGES stay locked post-BOOKED until
 *      Phase 2's #2 holds-sync lands.
 *
 *   3. `isMoneyEditable(status)` — money-only edits (discounts,
 *      tax-rate change) carry no hold/pick consequence; same
 *      editable-statuses set as (1), no per-dept restriction. The
 *      bookedTotal-tracks-live behavior from step 2 means money
 *      changes propagate cleanly to the invoice.
 *
 * Used by the order detail page (UI gate), the line-items route
 * handlers (backend gate), and the discounts route handlers
 * (backend gate). One source of truth; UI and API cannot drift.
 */

import type { OrderStatus, LineItemDepartment } from '@prisma/client'

/** Statuses where ANY edit is allowed. */
const EDITABLE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'DRAFT',
  'QUOTE_SENT',
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
])

/** Statuses where line-item adds/removes need the post-BOOKED
 *  per-dept gate. Anything in this set + a VEHICLES/STAGES line
 *  is REJECTED in Phase 1. */
const POST_BOOKED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
])

/** Departments whose adds/removes affect BookingItem holds and
 *  BookingAssignment availability. Phase 2 wires those up. Until
 *  then, these are locked post-BOOKED to prevent double-book bugs.
 *
 *  Departments NOT in this set route to WAREHOUSE
 *  (PRO_SUPPLIES, GE, EXPENDABLES, COMMUNICATIONS, ART) — no
 *  category-hold table, so Phase 1's PickList sync is the only
 *  propagation they need. */
const HOLD_TRACKED_DEPTS: ReadonlySet<LineItemDepartment> = new Set<LineItemDepartment>([
  'VEHICLES',
  'STAGES',
])

export function isOrderEditable(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.has(status)
}

export function isLineItemEditable(status: OrderStatus, department: LineItemDepartment): boolean {
  if (!isOrderEditable(status)) return false
  // Post-BOOKED + hold-tracked department → locked until Phase 2.
  if (POST_BOOKED_STATUSES.has(status) && HOLD_TRACKED_DEPTS.has(department)) {
    return false
  }
  return true
}

export function isMoneyEditable(status: OrderStatus): boolean {
  return isOrderEditable(status)
}

/** Why-is-this-locked reason for the UI. Used by tooltips and
 *  inline indicators on locked line items so the rep sees the
 *  cause, not a silently-disabled control. */
export function lineEditLockReason(status: OrderStatus, department: LineItemDepartment): string | null {
  if (!isOrderEditable(status)) {
    return `Order is ${status} — locked to reopen/credit only.`
  }
  if (POST_BOOKED_STATUSES.has(status) && HOLD_TRACKED_DEPTS.has(department)) {
    return 'Vehicle & stage edits on booked orders coming in the next release. Supplies, G&E, expendables, communications, and art are editable now.'
  }
  return null
}

/** Departments the rep can pick from when adding a line to a
 *  post-BOOKED order. Drives the new-line dept selector + the
 *  inventory combobox filter so VEHICLES/STAGES items don't even
 *  surface. Returns all departments for pre-BOOKED orders. */
export function addableDepartments(status: OrderStatus): LineItemDepartment[] {
  const ALL: LineItemDepartment[] = [
    'VEHICLES', 'STAGES', 'COMMUNICATIONS',
    'PRO_SUPPLIES', 'EXPENDABLES', 'GE', 'ART',
  ]
  if (!POST_BOOKED_STATUSES.has(status)) return ALL
  return ALL.filter((d) => !HOLD_TRACKED_DEPTS.has(d))
}

export const POST_BOOKED_LOCKED_DEPTS_PHASE_1: ReadonlySet<LineItemDepartment> = HOLD_TRACKED_DEPTS
