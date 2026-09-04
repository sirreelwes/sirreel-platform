import { UserRole } from '@prisma/client';
import { isAllowedClaimsEmail } from '@/lib/claims/allowlist';
import { canUseCollections } from '@/lib/collections/allowlist';
import { isExportApprover } from '@/lib/exports/approver';
import { isAllowedPayrollEmail } from '@/lib/payroll/allowlist';
import { SCHEDULE_LABEL } from '@/lib/app-labels';

// ═══════════════════════════════════════
// SIRREEL — Role-Based Permissions
// ═══════════════════════════════════════

export interface Permissions {
  // Views
  calendar: boolean;
  gantt: boolean;
  bookings: boolean;
  pipeline: boolean;    // Sales pipeline kanban
  maintenance: boolean;
  fleet: boolean;
  crm: boolean;
  claims: boolean;
  reporting: boolean;
  ai: boolean;
  // Exec/Coverage dashboard — approvals queue, sales-execution hygiene,
  // (Phase 2) claims-$ + escalations. This is the single source of truth
  // for both nav visibility AND server-side /api/exec/* access via the
  // shared guard in src/lib/exec/requireCoverageAccess.ts.
  coverage: boolean;
  // Phase 2 warehouse picking floor. Gated to ADMIN/MANAGER for now —
  // a future WAREHOUSE role lands when a dedicated picker user is
  // provisioned. Drives both the /warehouse nav section visibility
  // and the server-side gate in src/lib/warehouse/requirePickerRole.ts.
  warehouse: boolean;
  // Phase 5 native invoicing. Gates the /billing nav surface AND the
  // order-detail invoice-generation block. True for ADMIN and AGENT
  // (Ana's role) — keeps fleet/dispatch staff out of money. Tighter
  // per-action perms (canVoidInvoice, canRecordPayment, etc) land in
  // their own commits.
  billing: boolean;
  // Sub-rentals — create/edit sub-rental records on order lines and view
  // the /sub-rentals returns board. Phase 1 gate: AGENT (Jose, Oliver,
  // Ana on sales/billing) + MANAGER (Hugo) + ADMIN. Phase 2+ receive-
  // from-vendor + return actions will narrow further to MANAGER+ADMIN
  // (Hugo's team only).
  subRentals: boolean;
  tasks: boolean;       // Driver task list
  inspections: boolean; // Driver inspections

  // Data access
  seeClientNames: boolean;     // UPM/producer names (Jose, Oliver, Dani only)
  seeClientContact: boolean;   // Phone, email of clients
  seeProductionInfo: boolean;  // Production company name + job name (fleet sees this)
  seeDriverInfo: boolean;      // Driver names, license, checkout records
  seePricing: boolean;
  seeRevenue: boolean;
  seeAllBookings: boolean;   // vs only own bookings
  seeOtherAgents: boolean;
  seeMaintCost: boolean;
  seeEmailHistory: boolean;

  // Actions
  canCreateBooking: boolean;
  canConfirmBooking: boolean;
  canCancelBooking: boolean;
  canAssignAssets: boolean;
  canChangeAssetStatus: boolean;
  canCreateMaintenance: boolean;
  canManageDrivers: boolean;
  canProcessCheckout: boolean;
  // "Claims" is the legacy term — these gates power the Incidents
  // worklist edits (severity override, assignee, next-action,
  // driverName) added in Phase 3 of the claims redesign.
  //
  // Phase 4a tightening: claims pod is ADMIN + email allowlist
  // (src/lib/claims/allowlist.ts — today: Ana). All other roles read
  // false from ROLE_PERMISSIONS; getPermissions() post-processes to
  // widen via the allowlist. Incident CREATION is NOT gated on this
  // perm (it's session-only), so Hugo's team retains RETURN_INSPECTION
  // incident creation; only severity/owner/next-action/driver EDITS
  // narrowed.
  canManageClaims: boolean;
  canSendEmail: boolean;
  canEditCompany: boolean;
  canManageUsers: boolean;
}

const ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  // Wes, Dani — sees everything
  ADMIN: {
    calendar: true, gantt: true, bookings: true, pipeline: true, maintenance: true,
    fleet: true, crm: true, claims: true,
    reporting: true, ai: true, tasks: true, inspections: true, coverage: true,
    warehouse: true, billing: true, subRentals: true,
    seeClientNames: true, seeClientContact: true, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: true,
    seeRevenue: true, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: true, canCancelBooking: true,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: true,
    canSendEmail: true, canEditCompany: true, canManageUsers: true,
  },

  // Hugo — warehouse + fleet manager. Sees production co + job, NOT client contacts
  MANAGER: {
    calendar: true, gantt: true, bookings: false, pipeline: true, maintenance: true,
    fleet: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: true, billing: false, subRentals: true,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    // canCreateBooking granted 2026-07 (Wes): Hugo gets sales-level reservation
    // control (holds, status, dates, unit assignment, promote/release, confirm)
    // ON TOP of fleet capabilities.
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  // Jose, Oliver, Ana — agents. Phase 7 tightened operational
  // visibility: fleet / dispatch / maintenance are now ops-team
  // surfaces (FLEET_TECH / DISPATCHER), not sales/billing concerns.
  // Inventory + Paperwork tools dropped at the nav-line level
  // since their perm anchors (seePricing, bookings) still gate
  // items AGENTs need (Orders, Jobs).
  AGENT: {
    calendar: true, gantt: true, bookings: true, pipeline: true, maintenance: false,
    fleet: false, crm: true, claims: false,
    reporting: false, ai: true, tasks: false, inspections: false, coverage: false,
    warehouse: false, billing: true, subRentals: true,
    seeClientNames: true, seeClientContact: true, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: true,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: true, canEditCompany: false, canManageUsers: false,
  },

  // Ana — collections / accounts-receivable. Same operational surface
  // as a non-salesOnly AGENT (billing, CRM, orders, pipeline visibility)
  // so moving her off AGENT loses nothing; the role exists so billing
  // Action Items scope to BILLING + admin, not to every sales agent.
  BILLING: {
    calendar: true, gantt: true, bookings: true, pipeline: true, maintenance: false,
    fleet: false, crm: true, claims: false,
    reporting: false, ai: true, tasks: false, inspections: false, coverage: false,
    warehouse: false, billing: true, subRentals: true,
    seeClientNames: true, seeClientContact: true, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: true,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: true, canEditCompany: false, canManageUsers: false,
  },

  // Julian, Chris — fleet associates. Calendar/gantt with production co + job visible, NOT client contacts.
  //
  // warehouse:true as of 2026-09-02 (Wes: "combine fleet and warehouse
  // into one view. no need to separate"). There is one yard crew, not
  // two: the same people who inspect the truck pull the carts that go on
  // it. Without this flag the merged /yard board would 403 half its own
  // cards for the people it was built for.
  FLEET_TECH: {
    calendar: true, gantt: true, bookings: false, pipeline: false, maintenance: true,
    fleet: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: true, billing: false, subRentals: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  DISPATCHER: {
    calendar: true, gantt: true, bookings: false, pipeline: false, maintenance: true,
    fleet: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: false, billing: false, subRentals: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  // Warehouse picking floor (Phase 2, 2026-08-21). Operates pick
  // sessions (requirePickerRole derives from the `warehouse` flag) and
  // OBSERVES the reservations board + deliveries board read-only.
  // Data scope per Wes 2026-08-21: company, job name, and drivers —
  // no client contacts, no pricing. Zero reservation mutations.
  // First intended holder: Chris (account deferred — on leave).
  //
  // fleet:true as of 2026-09-02 — the other half of the FLEET_TECH
  // widening above, so the merged /yard board reads the same for either
  // role. This is a VIEW flag: it opens the fleet roster and the yard
  // board, and nothing else. Every write still needs canAssignAssets /
  // canChangeAssetStatus / canCreateMaintenance, all still false here,
  // so a picker can see the units and change none of them.
  //
  // maintenance:true as of 2026-09-03 for the same reason, one step
  // further out: MANAGER / FLEET_TECH / WAREHOUSE now share ONE nav
  // (Wes: "one view for Manager, Warehouse and Fleet, no difference in
  // any"), and that nav carries Maintenance. Also a VIEW flag —
  // canCreateMaintenance stays false, so a picker reads the shop board
  // and writes nothing on it.
  WAREHOUSE: {
    calendar: true, gantt: true, bookings: false, pipeline: false, maintenance: true,
    fleet: true, crm: false, claims: false,
    reporting: false, ai: false, tasks: false, inspections: false, coverage: false,
    warehouse: true, billing: false, subRentals: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  DRIVER: {
    calendar: false, gantt: false, bookings: false, pipeline: false, maintenance: false,
    fleet: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: true, inspections: true, coverage: false,
    warehouse: false, billing: false, subRentals: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: false,
    seeDriverInfo: false, seePricing: false,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  CLIENT: {
    calendar: false, gantt: false, bookings: true, pipeline: false, maintenance: false,
    fleet: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: false, inspections: false, coverage: false,
    warehouse: false, billing: false, subRentals: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: false,
    seeDriverInfo: false, seePricing: true,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: false,
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: true,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },
};

// Phase 6.5 — narrow user shape carrying just the perms-relevant
// fields. Anywhere we have a User row (session lookup, server route)
// pass the whole record; UserRole-only callers keep working via the
// legacy overload below (defaults salesOnly=false).
export interface PermissionsUser {
  role: UserRole;
  salesOnly: boolean;
  // Optional. When passed, getNavSections uses it to decide HR nav
  // visibility via the code-reviewed allowlist (see
  // src/lib/hr/allowlist.ts). HR access is NOT role-based — it's a
  // distinct, narrower gate. Legacy callers that pass only role +
  // salesOnly still work; they just don't see the HR nav entry,
  // matching the safe default.
  email?: string;
}

/**
 * Phase 6.5: `getPermissions` now takes either a full PermissionsUser
 * or a bare UserRole (legacy callers — treated as salesOnly=false).
 *
 * When salesOnly is true, override OFF the operational + tooling
 * surfaces: fleet, dispatch, maintenance, billing, and the
 * bookings-gated tools (COI check, contract review, contract
 * history, scheduling). Ana stays salesOnly=false so her billing
 * access is unchanged.
 */
export function getPermissions(input: UserRole | PermissionsUser): Permissions {
  const user: PermissionsUser =
    typeof input === 'string' ? { role: input, salesOnly: false } : input;
  const baseRaw = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.CLIENT;
  // Phase 4a — claims-pod widening. ROLE_PERMISSIONS gives canManageClaims
  // to ADMIN only; the allowlist (src/lib/claims/allowlist.ts) brings in
  // specific non-admin handlers (Ana today). Single source for both API
  // gates and nav/UI — see assignable-users route, requireIncidentEditAccess,
  // and the (future) nav entry.
  const base: Permissions = {
    ...baseRaw,
    canManageClaims: baseRaw.canManageClaims || isAllowedClaimsEmail(user.email),
  };
  if (!user.salesOnly) return base;
  // Sales-only override: a reduced surface. Keep the rest of the
  // AGENT perms intact (pipeline, crm, seePricing, seeClientNames,
  // canSendEmail, etc — the whole sales loop).
  return {
    ...base,
    fleet: false,
    maintenance: false,
    billing: false,
    // The bookings-gated admin-section tools (COI Check, Contract
    // Review, Contract History, Scheduling) come from `bookings`.
    // Turning that off would also remove /jobs + /bookings from
    // main nav — sales needs /jobs but NOT /bookings. We split
    // bookings into "list" (kept) vs "tools" (dropped) below.
    // Cleanest: keep `bookings` true so /jobs renders, drop the
    // tools individually via canConfirmBooking / canCancelBooking
    // (already false for AGENT) — and a small nav-builder edit
    // below filters the tools when salesOnly.
  };
}

export function can(input: UserRole | PermissionsUser, permission: keyof Permissions): boolean {
  return getPermissions(input)[permission];
}

/**
 * Who may CREATE an order (or a quote, which is an order before it is
 * booked). Sales and admin only.
 *
 * Hugo, 2026-09-03: "create order should not be possible from
 * Fleet/Warehouse view/login. That is only for sales. Modifications to
 * that order can be done but only within Checkout report." The yard
 * crew has plenty of reasons to open an order and exactly none to
 * invent one — an order is a commercial commitment with a price on it,
 * and the yard cannot see the price.
 *
 * Derived rather than a new Permissions column so it cannot fall out of
 * step with the two flags that already say "this person does commerce":
 * `bookings` (the order/quote surfaces) AND `seePricing` (an order they
 * cannot price is an order they cannot write). That lands on ADMIN,
 * AGENT and BILLING, and excludes MANAGER / FLEET_TECH / WAREHOUSE /
 * DRIVER.
 *
 * This is a UI + page gate. It is NOT the write boundary: the order
 * create routes keep their own server-side checks.
 */
export function canCreateOrders(input: UserRole | PermissionsUser): boolean {
  const perms = getPermissions(input);
  // CLIENT holds both flags for the portal's own booking flow, and has
  // no business on a staff order form.
  const role = typeof input === 'string' ? input : input.role;
  if (role === UserRole.CLIENT) return false;
  return perms.bookings && perms.seePricing;
}

// After-hours Assistant config surface (standing gate code, per-job auth
// codes, release audit log). Full access for ADMIN, AGENT (sales — they
// hand the code to production), and MANAGER (Hugo). Kept as a standalone
// gate rather than a Permissions column so we don't thread a new field
// through every role object; the page/API enforce with it, and the server
// guard lives in src/lib/assistant/requireAssistantAccess.ts.
export function canAccessAssistantConfig(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.AGENT || role === UserRole.MANAGER;
}

// Navigation items per role
export type NavItem = { id: string; label: string; icon: string; href: string };
export type NavSection = { label: string | null; items: NavItem[] };

export function getNavItems(input: UserRole | PermissionsUser): NavItem[] {
  const sections = getNavSections(input);
  return sections.flatMap(s => s.items);
}

// Roles that work primarily from /sales/pipeline. Their sidebar nav is
// reordered (Pipeline up top) and Dashboard is hidden; the layout also
// auto-redirects /dashboard → /sales/pipeline for these roles.
export function isSalesRole(role: UserRole): boolean {
  return role === UserRole.AGENT;
}

// BILLING's home is the collections workspace — Dashboard is not in her
// nav (see getNavSections), and login lands on /dashboard by default, so
// the layout bounces her the same way it does sales and yard roles.
export function isBillingRole(role: UserRole): boolean {
  return role === UserRole.BILLING;
}

// The yard crew — whoever lives on the merged /yard board. The layout
// auto-redirects /dashboard → /yard for these (mirrors the sales-role
// pattern above), they all get the SAME trimmed nav (see
// getNavSections), and their nav opens on it.
//
// WAREHOUSE joined FLEET_TECH here on 2026-09-02: since the lanes
// merged there is one board and one crew, so there is no longer a
// reason for the picker and the fleet tech to land in different places.
//
// MANAGER joined them on 2026-09-03 (Wes: "Hugo is seeing way too many
// views. Let's change to one view for Manager, Warehouse and Fleet. No
// difference in any and just have the functions that are on fleet and
// warehouse views"). Hugo, Julian and Albert ARE the MANAGER role, and
// they run the yard — they were falling through to the full ~40-tab IA
// built for admin. One crew, one board, one nav.
export function isFleetYardRole(role: UserRole): boolean {
  // DISPATCHER is retired (folded into FLEET_TECH); no live DISPATCHER
  // users exist, but it is listed so a stray holder gets the yard nav
  // rather than the admin IA.
  return (
    role === UserRole.MANAGER ||
    role === UserRole.FLEET_TECH ||
    role === UserRole.WAREHOUSE ||
    role === UserRole.DISPATCHER
  );
}

export function defaultLandingPath(input: UserRole | PermissionsUser): string {
  // ONE default view for the whole company (Wes, 2026-09-03, after the
  // Hugo meeting: "move the Reservations tab to the top of the list and
  // have that be the default view for everyone").
  //
  // This replaces a per-role fan-out that had been rewritten twice in a
  // week — yard to /yard, billing to /collections, MANAGER to /orders,
  // everyone else to /jobs — each time because the previous answer was
  // wrong for somebody. The board is the one screen every department
  // reads the same way: sales see what is sold, the yard sees what is
  // going out, billing sees what actually shipped. Every one of those
  // old destinations is still one click away, first in its own section.
  //
  // The parameter is kept so callers don't churn, and so a future
  // per-role exception has somewhere to live.
  void input;
  return '/gantt';
}

export function getNavSections(input: UserRole | PermissionsUser): NavSection[] {
  const navRole: UserRole = typeof input === 'string' ? input : input.role;
  // Legacy callers pass a bare role and get no email — those users simply
  // don't see email-gated entries, which is the safe default.
  const navEmail: string | undefined = typeof input === 'string' ? undefined : input.email;
  // ONE view for the whole yard crew — MANAGER, FLEET_TECH, WAREHOUSE
  // (Wes, 2026-09-03: "Hugo is seeing way too many views. Let's change
  // to one view for Manager, Warehouse and Fleet. No difference in any
  // and just have the functions that are on fleet and warehouse
  // views").
  //
  // History: this branch shipped 2026-08-21 for WAREHOUSE alone, as the
  // one fully-gated nav — a brand-new pick-floor audience couldn't be
  // shown the fixed IA, most of which 403s for them and reads as "the
  // app is broken". MANAGER and FLEET_TECH kept falling through to that
  // fixed IA: ~40 tabs, the COO section and the whole Admin group
  // included, for people whose job is the truck and the carts. Same
  // problem, so now the same answer.
  //
  // The item list is exactly the union of what the two old views
  // carried: the full "Warehouse & Fleet" group from the fixed IA plus
  // Reservations. Deliberately NOT here: Jobs / Orders / Clients /
  // Billing / COO / Admin. Every write on these surfaces is still gated
  // on the per-role permission it always was (canAssignAssets,
  // canChangeAssetStatus, canCreateMaintenance, canCreateBooking), so
  // the three roles see the same nav and still do different things
  // through it — a picker reads what a manager can change.
  if (isFleetYardRole(navRole)) {
    return [
      {
        // Reservations is FIRST and is where everyone now lands (Wes,
        // 2026-09-03, after the Hugo meeting: "move the Reservations tab
        // to the top of the list and have that be the default view for
        // everyone"). It used to sit in a section of its own at the
        // bottom, under every lookup.
        //
        // Then the day's work: /yard is the board, and the two REPORTS
        // are the desks that digitize the paper. Everything below is a
        // lookup, not a daily surface.
        label: 'Warehouse & Fleet',
        items: [
          { id: 'schedule', label: SCHEDULE_LABEL, icon: 'CalendarDays', href: '/gantt' },
          { id: 'yard', label: 'Today', icon: 'Sun', href: '/yard' },
          // Hugo, 2026-09-03: the floor picks on PAPER, then walks the
          // paperwork to a supervisor who enters it here. Gear.
          { id: 'order-reports', label: 'Check In/Out Reports', icon: 'ClipboardList', href: '/reports/orders' },
          // The same idea for the truck itself — the DamageID walk-around
          // at both ends, off a list instead of a deep link.
          { id: 'vehicle-reports', label: 'Vehicle Check In/Out', icon: 'Car', href: '/reports/vehicles' },
          { id: 'warehouse-pick', label: 'All Pick Lists', icon: 'ListChecks', href: '/warehouse/pick' },
          { id: 'fleet', label: 'Vehicles', icon: 'Car', href: '/fleet' },
          { id: 'maintenance', label: 'Maintenance', icon: 'Wrench', href: '/maintenance' },
          { id: 'guest-drivers', label: 'Guest Drivers', icon: 'UserPlus', href: '/fleet/guest-drivers' },
          // Deliveries & Pickups pulled 2026-09-03 (Hugo): "remove
          // delivery/pickup from view for now — this needs to be worked
          // on before they see it." The ROUTE is untouched and still in
          // the admin nav; only the yard crew's entry is gone.
          //
          // The how-tos sit with the work they describe (same rule as
          // "How to collect"), and both are deliberately the SAME pages
          // sales gets: the handoff is the subject, and two versions of
          // it would let each side keep believing the other does
          // something it doesn't. Their own loop first, then what sales
          // owes them — which is what they quote back when a truck or a
          // cart never reached them.
          { id: 'guide-pull-sheets', label: 'How pull sheets work', icon: 'BookOpen', href: '/guides/pull-sheets' },
          { id: 'guide-sending-orders', label: 'How to send orders out', icon: 'BookOpen', href: '/guides/sending-orders' },
        ],
      },
    ];
  }
  // AGENT (the sales team: Jose, Oliver) gets a trimmed sales nav
  // (Wes 2026-08-21 pre-cutover simplification). The fixed IA below
  // showed them ~36 tabs for a 7-page job, four of which 403'd or
  // redirect-looped for their role. This is the whole sales journey:
  // inquiry → quote → reservation → job, plus lookups. Pipeline is
  // gone (redirects to /inquiries); Collections stays allowlist-gated.
  // BILLING (Ana) — collections + the sales context needed to bill it,
  // and nothing else (Wes, 2026-08-24). She previously fell through to
  // the full nav: Fleet, Warehouse, COO reporting, and ~15 Admin
  // entries, none of which her own ROLE_PERMISSIONS grant
  // (reporting/fleet/warehouse/coverage are all false for BILLING).
  // The pages already refused her; the tabs were just noise pointing at
  // redirects.
  //
  // Kept deliberately: Incidents (she is the claims-pod handler via the
  // email allowlist) and Payment Info (client bank details are billing's
  // to send). Inventory + Paperwork tools were added back at Wes's
  // request the same day — billing looks up what a line item is when an
  // invoice is disputed, chases COIs/contracts, and reads Reservations
  // to settle a disputed rental window, and watches Deliveries &
  // Pickups (read-only board data). Fleet, Warehouse and the COO
  // reporting section stay out — all map to permissions that are false
  // for BILLING, so those tabs would dead-end.
  if (navRole === 'BILLING') {
    return [
      {
        label: 'Billing & Collections',
        items: [
          ...(canUseCollections(navRole, navEmail)
            ? [{ id: 'collections', label: 'Collections', icon: 'CreditCard', href: '/collections' }]
            : []),
          { id: 'rw-invoices', label: 'Receivables (RW)', icon: 'Receipt', href: '/rentalworks/invoices' },
          // The evidence desk behind the aging review — email trail + AI
          // reading per invoice. Collections-gated like /collections itself.
          { id: 'rw-review', label: 'Aging review (RW)', icon: 'Search', href: '/collections/rw-review' },
          // Reconcile RW dropped 2026-09-03 (Wes, after a call with
          // Billing). It is an admin reconciliation tool, not part of
          // the collecting loop, and it sat between the two screens Ana
          // actually works. Still in the full nav for admin.
          { id: 'rw-invoice-sync', label: 'RW Sync', icon: 'RefreshCw', href: '/admin/rw-invoice-sync' },
          { id: 'incidents', label: 'Incidents', icon: 'AlertTriangle', href: '/incidents' },
          // Vendors joins Billing & Collections for admin, sales AND
          // billing (Wes, 2026-09-03) — a vendor is who we owe, so the
          // roster belongs with the money rather than buried in Admin.
          // /api/vendors already admits BILLING (the subRentals perm).
          { id: 'vendors', label: 'Vendors', icon: 'Store', href: '/admin/vendors' },
          { id: 'payment-info', label: 'Payment Info', icon: 'Banknote', href: '/admin/payment-info' },
          // The how-to sits with the work it describes rather than in a
          // docs section of its own — there is one guide, and a nav
          // branch for one page is worse than the page.
          { id: 'guide-collecting', label: 'How to collect', icon: 'BookOpen', href: '/guides/collecting' },
        ],
      },
      {
        label: 'Sales',
        items: [
          // Reservations first — it is the app's default view for
          // everyone as of 2026-09-03. Billing has had gantt:true since
          // 2026-08-24: seeing what actually went out, and when it came
          // back, is how a disputed rental window gets settled.
          { id: 'schedule', label: SCHEDULE_LABEL, icon: 'CalendarDays', href: '/gantt' },
          { id: 'jobs', label: 'Jobs', icon: 'Briefcase', href: '/jobs' },
          { id: 'orders', label: 'Orders', icon: 'FileText', href: '/orders' },
          // Sub-Rentals sits in Sales, not Ops (Wes 2026-08-28): the roster
          // exists to quote from — it is gated on seePricing, and its main
          // action is sending a client an estimate.
          { id: 'sub-rentals', label: 'Sub-Rentals', icon: 'PackageOpen', href: '/sub-rentals' },
          { id: 'crm', label: 'Clients', icon: 'Users', href: '/crm' },
          { id: 'account-portals', label: 'Company Portals', icon: 'Building2', href: '/crm/portals' },
          // Billing reads the OTHER end of this one: what sales did (or
          // didn't) do before the balance landed on Collections.
          { id: 'guide-finishing-a-job', label: 'How to finish a job', icon: 'BookOpen', href: '/guides/finishing-a-job' },
        ],
      },
      {
        label: 'Ops',
        items: [
          // Added back 2026-08-24 (Wes): billing needs to look up what a
          // line item IS and what it rents for when a client disputes an
          // invoice, and Paperwork tools covers the COI / contract-review
          // side of chasing a job's documents.
          { id: 'inventory', label: 'Inventory', icon: 'Boxes', href: '/inventory' },
          // Deliveries & Pickups added 2026-08-24 (Wes). READ-ONLY for
          // her by construction: /api/dispatch takes any signed-in staff
          // session (widened 2026-08-23 — it is the same movement data
          // the Reservations board already shows everyone), while the
          // fleet paperwork surfaces stay behind requireDispatchAccess
          // and task mutations behind canCreateBooking, which BILLING
          // does hold. Cross-listed with Fleet, same as the full nav.
          { id: 'dispatch', label: 'Deliveries & Pickups', icon: 'Truck', href: '/dispatch' },
          { id: 'paperwork', label: 'Paperwork', icon: 'FileSignature', href: '/admin/paperwork' },
        ],
      },
    ];
  }

  if (navRole === 'AGENT') {
    return [
      {
        label: 'Sales',
        items: [
          // Reservations first — the app's default view for everyone
          // as of 2026-09-03.
          { id: 'schedule', label: SCHEDULE_LABEL, icon: 'CalendarDays', href: '/gantt' },
          { id: 'jobs', label: 'Jobs', icon: 'Briefcase', href: '/jobs' },
          { id: 'orders', label: 'Orders', icon: 'FileText', href: '/orders' },
          // Sub-Rentals sits in Sales, not Ops (Wes 2026-08-28): the roster
          // exists to quote from — it is gated on seePricing, and its main
          // action is sending a client an estimate.
          { id: 'sub-rentals', label: 'Sub-Rentals', icon: 'PackageOpen', href: '/sub-rentals' },
          { id: 'crm', label: 'Clients', icon: 'Users', href: '/crm' },
          { id: 'account-portals', label: 'Company Portals', icon: 'Building2', href: '/crm/portals' },
          // The how-to sits with the work it describes (same rule as
          // "How to collect"): this is the flow that replaces emailing
          // the booking package, so it belongs in the sales list the
          // reps already live in.
          { id: 'guide-starting-a-job', label: 'How to start a job', icon: 'BookOpen', href: '/guides/starting-a-job' },
          { id: 'guide-finishing-a-job', label: 'How to finish a job', icon: 'BookOpen', href: '/guides/finishing-a-job' },
          // Sending is the rep's own half, and the two lanes do not
          // work the same way — the truck one has a second step that
          // gets skipped. Their guide comes before the floor's.
          { id: 'guide-sending-orders', label: 'How to send orders out', icon: 'BookOpen', href: '/guides/sending-orders' },
          { id: 'guide-pull-sheets', label: 'How pull sheets work', icon: 'BookOpen', href: '/guides/pull-sheets' },
        ],
      },
      {
        label: 'Ops',
        items: [
          { id: 'inventory', label: 'Inventory', icon: 'Boxes', href: '/inventory' },
        ],
      },
      // Collections was tacked onto the end of the sales list; with the
      // group split it gets the same header it carries in the full nav
      // rather than reading as a sales tab. The Collections entries stay
      // allowlist-gated; Vendors does not — Wes 2026-09-03 put the vendor
      // roster in front of admin, sales AND billing, and a rep sourcing a
      // sub-rental needs it whether or not they ever chase an invoice. So
      // the section renders for every agent, with Vendors as its floor.
      {
        label: 'Billing & Collections',
        items: [
          ...(canUseCollections(navRole, navEmail)
            ? [
                { id: 'collections', label: 'Collections', icon: 'CreditCard', href: '/collections' },
                { id: 'rw-review', label: 'Aging review (RW)', icon: 'Search', href: '/collections/rw-review' },
              ]
            : []),
          { id: 'vendors', label: 'Vendors', icon: 'Store', href: '/admin/vendors' },
          ...(canUseCollections(navRole, navEmail)
            ? [{ id: 'guide-collecting', label: 'How to collect', icon: 'BookOpen', href: '/guides/collecting' }]
            : []),
        ],
      },
    ];
  }
  // Fixed information architecture — identical for every user. This is a
  // visual + IA surface only; pages enforce their own authorization, so
  // there is intentionally NO role-gating here (every tab is visible to
  // all). Two narrow exceptions: the HR entry (email allowlist) and the
  // fleet "Today" entry (yard roles only — it's their mobile home, noise
  // for everyone else). Groups are always expanded (the layout renders
  // static section headers, no collapse). `icon` carries a lucide-react
  // component name resolved in the layout.
  //
  // Deliveries & Pickups (/dispatch) is CROSS-LISTED in both Ops and
  // Fleet on purpose — one shared tool (Ops enters what/where/when,
  // Fleet assigns driver + vehicle). Same href, highlighted in both when
  // active. Not a duplicate route.
  //
  // Split into Sales + Ops (Wes, 2026-08-26): the old "Sales & Ops"
  // group ran ten tabs deep and mixed the deal path with the tools that
  // execute it. Sales is now the funnel in the order the work happens
  // (what needs doing → the show → the inbound → the hold → the
  // invoiceable order → who it's for); Ops holds everything downstream.
  return [
    {
      label: 'Sales',
      items: [
        // Top-level Action Items surface — the id 'action-items' is
        // special-cased in the layout to render an unhandled-count badge
        // fed by the same engine (/api/action-items?count=1).
        // Action Items folded into /jobs (2026-08-27) — the landing panel
        // renders the same registry; /action-items redirects there.
        // Inquiries merged into /jobs (2026-08-27) — the landing panel
        // IS the inbound queue; /inquiries redirects there.
        // Reservations first — the app's default view for everyone as
        // of 2026-09-03 (Wes, after the Hugo meeting).
        { id: 'schedule', label: SCHEDULE_LABEL, icon: 'CalendarDays', href: '/gantt' },
        { id: 'jobs', label: 'Jobs', icon: 'Briefcase', href: '/jobs' },
        { id: 'orders', label: 'Orders', icon: 'FileText', href: '/orders' },
        // Sub-Rentals sits in Sales, not Ops (Wes 2026-08-28): the roster
        // exists to quote from — it is gated on seePricing, and its main
        // action is sending a client an estimate.
        { id: 'sub-rentals', label: 'Sub-Rentals', icon: 'PackageOpen', href: '/sub-rentals' },
        { id: 'crm', label: 'Clients', icon: 'Users', href: '/crm' },
          { id: 'account-portals', label: 'Company Portals', icon: 'Building2', href: '/crm/portals' },
        // Phase 3 composer. Safe to expose before the sending domain
        // exists — the guard closes every send and the page says so.
        { id: 'outreach', label: 'Outreach', icon: 'Send', href: '/outreach' },
        // Everyone who can start a job should be able to find out how.
        { id: 'guide-starting-a-job', label: 'How to start a job', icon: 'BookOpen', href: '/guides/starting-a-job' },
        { id: 'guide-finishing-a-job', label: 'How to finish a job', icon: 'BookOpen', href: '/guides/finishing-a-job' },
        { id: 'guide-sending-orders', label: 'How to send orders out', icon: 'BookOpen', href: '/guides/sending-orders' },
        { id: 'guide-pull-sheets', label: 'How pull sheets work', icon: 'BookOpen', href: '/guides/pull-sheets' },
      ],
    },
    {
      label: 'Ops',
      items: [
        { id: 'inventory', label: 'Inventory', icon: 'Boxes', href: '/inventory' },
        { id: 'dispatch', label: 'Deliveries & Pickups', icon: 'Truck', href: '/dispatch' },
        { id: 'paperwork', label: 'Paperwork', icon: 'FileSignature', href: '/admin/paperwork' },
      ],
    },
    {
      // Money in one place (Wes, 2026-08-19): everything about invoicing,
      // collecting, and reconciling against RentalWorks, plus Incidents —
      // which live here because a damage claim is a billing event by the
      // time anyone opens HQ for it.
      label: 'Billing & Collections',
      items: [
        // Narrow exception to "every tab visible to all": this one takes
        // client money, so showing it to Julian or Oliver would only offer a
        // tab that dead-ends in a redirect. Same predicate as the page gate
        // (src/lib/collections/allowlist.ts) so the two can't drift.
        ...(canUseCollections(navRole, navEmail)
          ? [{ id: 'collections', label: 'Collections', icon: 'CreditCard', href: '/collections' }]
          : []),
        { id: 'rw-invoices', label: 'Receivables (RW)', icon: 'Receipt', href: '/rentalworks/invoices' },
        // The evidence desk behind the aging review — email trail + AI reading
        // per invoice (Wes 2026-09-02: "for review by Ana and Admin").
        { id: 'rw-review', label: 'Aging review (RW)', icon: 'Search', href: '/collections/rw-review' },
        { id: 'rw-reconcile', label: 'Reconcile RW', icon: 'ListChecks', href: '/rentalworks/reconcile' },
        // Moved out of Admin: the sync IS a collections concern — when it
        // stops, every balance on these pages is stale. Still linked from
        // the rw_sync_failure alert.
        { id: 'rw-invoice-sync', label: 'RW Sync', icon: 'RefreshCw', href: '/admin/rw-invoice-sync' },
        { id: 'incidents', label: 'Incidents', icon: 'AlertTriangle', href: '/incidents' },
        // Moved out of Admin 2026-09-03 (Wes): a vendor is someone we owe,
        // so the roster reads as money, not configuration — and sales and
        // billing both needed it without an Admin section to find it in.
        { id: 'vendors', label: 'Vendors', icon: 'Store', href: '/admin/vendors' },
        // Everyone who can take money should be able to find out how.
        { id: 'guide-collecting', label: 'How to collect', icon: 'BookOpen', href: '/guides/collecting' },
      ],
    },
    {
      // ONE section for the yard (Wes, 2026-09-02: "combine fleet and
      // warehouse into one view. no need to separate"). It used to be
      // two adjacent groups — a five-item "Fleet" and a one-item
      // "Warehouse" — which read as two departments to a crew that is
      // one crew, and buried the fact that a show's truck and a show's
      // carts are the same morning's work.
      //
      // "Today" is first and is the board itself: /yard shows both
      // lanes grouped by show. Everything below it is a lookup, not a
      // daily surface. Deliveries & Pickups stays CROSS-LISTED with Ops
      // above — same route, highlighted in both.
      label: 'Warehouse & Fleet',
      items: [
        { id: 'yard', label: 'Today', icon: 'Sun', href: '/yard' },
        { id: 'dispatch-fleet', label: 'Deliveries & Pickups', icon: 'Truck', href: '/dispatch' },
        { id: 'warehouse-pick', label: 'All Pick Lists', icon: 'ClipboardList', href: '/warehouse/pick' },
        { id: 'fleet', label: 'Vehicles', icon: 'Car', href: '/fleet' },
        { id: 'maintenance', label: 'Maintenance', icon: 'Wrench', href: '/maintenance' },
        { id: 'guest-drivers', label: 'Guest Drivers', icon: 'UserPlus', href: '/fleet/guest-drivers' },
      ],
    },
    {
      label: 'COO',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', href: '/dashboard' },
        { id: 'coverage', label: 'Coverage', icon: 'Radar', href: '/exec/coverage' },
        { id: 'reporting', label: 'Reporting', icon: 'BarChart3', href: '/reporting' },
        // Approver-only (Wes). Everyone else reaches their own request
        // history from the Clients page; a queue tab they can't act on
        // would just be noise. Email-gated, NOT role-gated — ADMIN is
        // Wes AND Dani. See src/lib/exports/approver.ts.
        ...(isExportApprover(navEmail)
          ? [{ id: 'data-exports', label: 'Data Exports', icon: 'FileDown', href: '/exec/exports' }]
          : []),
      ],
    },
    {
      label: 'Admin',
      items: [
        { id: 'cois', label: 'COIs', icon: 'ShieldCheck', href: '/admin/cois' },
        { id: 'fleet-pricing', label: 'Pricing', icon: 'DollarSign', href: '/admin/asset-categories' },
        { id: 'fees', label: 'Fees', icon: 'Receipt', href: '/admin/fees' },
        { id: 'spaces', label: 'Spaces', icon: 'Building2', href: '/admin/spaces' },
        { id: 'locations', label: 'Locations', icon: 'MapPin', href: '/admin/locations' },
        { id: 'health', label: 'Health', icon: 'Activity', href: '/admin/health' },
        { id: 'site-settings', label: 'Site Settings', icon: 'Globe', href: '/admin/site-settings' },
        { id: 'notifications', label: 'Notifications', icon: 'Mail', href: '/admin/notifications' },
        { id: 'assistant', label: 'Assistant', icon: 'Bot', href: '/admin/assistant' },
        { id: 'who-we-are', label: 'Who We Are', icon: 'Users', href: '/admin/who-we-are' },
        { id: 'dedup', label: 'Duplicates', icon: 'Copy', href: '/admin/dedup' },
        { id: 'forms', label: 'Forms', icon: 'FileText', href: '/admin/forms' },
        { id: 'payment-info', label: 'Payment Info', icon: 'Banknote', href: '/admin/payment-info' },
        { id: 'gateway-calls', label: 'Gateway Calls', icon: 'CreditCard', href: '/admin/cardpointe-calls' },
        { id: 'home-tiles', label: 'Home Tiles', icon: 'LayoutDashboard', href: '/admin/home-tiles' },
        { id: 'scheduling', label: 'Scheduling', icon: 'CalendarClock', href: '/scheduling' },
        { id: 'hr', label: 'HR', icon: 'IdCard', href: '/hr' },
        // Payroll. Email-gated like Data Exports, NOT role-gated: ADMIN is
        // Wes AND Dani today, but the allowlist is the thing that decides,
        // and it is a separate list from HR's on purpose (personnel files
        // and compensation are different grants). See
        // src/lib/payroll/access.ts — the page and every API route enforce
        // it too; this only hides the nav row.
        ...(isAllowedPayrollEmail(navEmail)
          ? [{ id: 'payroll', label: 'Payroll', icon: 'Clock', href: '/payroll' }]
          : []),
      ],
    },
  ];
}

// Redact client name for fleet/warehouse roles
export function displayClientName(name: string, role: UserRole): string {
  if (getPermissions(role).seeClientNames) return name;
  // Fleet sees nothing — production company shown separately
  return 'Booking Contact';
}

// Production company + job name — visible to fleet team
export function displayProductionInfo(company: string, job: string, role: UserRole): { company: string; job: string } {
  if (getPermissions(role).seeProductionInfo) return { company, job };
  return { company: 'Production', job: 'Project' };
}

// Driver info — visible to fleet + agents
export function displayDriverInfo(name: string, role: UserRole): string {
  if (getPermissions(role).seeDriverInfo) return name;
  return 'Driver';
}
