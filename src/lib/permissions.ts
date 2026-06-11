import { UserRole } from '@prisma/client';
import { isAllowedHrEmail } from '@/lib/hr/allowlist';

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
  dispatch: boolean;
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
  canManageClaims: boolean;
  canSendEmail: boolean;
  canEditCompany: boolean;
  canManageUsers: boolean;
}

const ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  // Wes, Dani — sees everything
  ADMIN: {
    calendar: true, gantt: true, bookings: true, pipeline: true, maintenance: true,
    fleet: true, dispatch: true, crm: true, claims: true,
    reporting: true, ai: true, tasks: true, inspections: true, coverage: true,
    warehouse: true, billing: true,
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
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: true, billing: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
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
    fleet: false, dispatch: false, crm: true, claims: false,
    reporting: false, ai: true, tasks: false, inspections: false, coverage: false,
    warehouse: false, billing: true,
    seeClientNames: true, seeClientContact: true, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: true,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: true, canEditCompany: false, canManageUsers: false,
  },

  // Julian, Chris — fleet associates. Calendar/gantt with production co + job visible, NOT client contacts
  FLEET_TECH: {
    calendar: true, gantt: true, bookings: false, pipeline: false, maintenance: true,
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: false, billing: false,
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
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true, coverage: false,
    warehouse: false, billing: false,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  DRIVER: {
    calendar: false, gantt: false, bookings: false, pipeline: false, maintenance: false,
    fleet: false, dispatch: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: true, inspections: true, coverage: false,
    warehouse: false, billing: false,
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
    fleet: false, dispatch: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: false, inspections: false, coverage: false,
    warehouse: false, billing: false,
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
  const base = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.CLIENT;
  if (!user.salesOnly) return base;
  // Sales-only override: a reduced surface. Keep the rest of the
  // AGENT perms intact (pipeline, crm, seePricing, seeClientNames,
  // canSendEmail, etc — the whole sales loop).
  return {
    ...base,
    fleet: false,
    dispatch: false,
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

export function defaultLandingPath(input: UserRole | PermissionsUser): string {
  const role = typeof input === 'string' ? input : input.role;
  if (isSalesRole(role)) return '/sales/pipeline';
  return '/dashboard';
}

export function getNavSections(input: UserRole | PermissionsUser): NavSection[] {
  const user: PermissionsUser =
    typeof input === 'string' ? { role: input, salesOnly: false } : input;
  const perms = getPermissions(user);
  const sections: NavSection[] = [];
  const sales = isSalesRole(user.role);
  const salesOnly = user.salesOnly;

  // Main — daily operations. Sales agents get Pipeline at the top and
  // no Dashboard item; everyone else keeps the historical ordering.
  const main: NavItem[] = [];
  if (sales && perms.pipeline) {
    main.push({ id: 'pipeline', label: 'Pipeline', icon: '', href: '/sales/pipeline' });
  }
  if (!sales) {
    main.push({ id: 'dashboard', label: 'Dashboard', icon: '', href: '/dashboard' });
  }
  // Phase 7 consolidation — Calendar + Timeline collapsed into a
  // single "Schedule" nav entry landing on /gantt. Both pages still
  // exist as routes and read the same /api/timeline-native data; the
  // pages cross-link via an in-page view-toggle so the operator can
  // flip between month-view and gantt-view without two tabs. Hidden
  // for salesOnly users — schedule views aren't a sales step.
  if ((perms.calendar || perms.gantt) && !salesOnly) {
    main.push({ id: 'schedule', label: 'Schedule', icon: '', href: '/gantt' });
  }
  if (perms.bookings) main.push({ id: 'jobs', label: 'Jobs', icon: '', href: '/jobs' });
  // Phase 7 consolidation — /bookings retired. Page was titled
  // "Jobs" but read Booking rows (~89/105 Planyo backfill) with
  // zero linkage to the Phase 1 Order/Job spine. Booking model
  // stays — used by scheduling, portal flows, claims, etc. The
  // page + its admin endpoints were removed; deep-linking /bookings
  // now 404s.
  if (!sales && perms.pipeline) {
    main.push({ id: 'pipeline', label: 'Pipeline', icon: '', href: '/sales/pipeline' });
  }
  // Phase 6.5b — Inquiries folded into the Sales Pipeline as its
  // "New inbound" first column. The /inquiries route stays
  // accessible by deep-link (and the detail page /inquiries/[id]
  // remains canonical for triage), but the standalone tab goes
  // away for everyone — agents triage on the Pipeline now.
  if (perms.seePricing) main.push({ id: 'orders', label: 'Orders', icon: '', href: '/orders' });
  if (perms.fleet) main.push({ id: 'fleet', label: 'Fleet', icon: '', href: '/fleet' });
  // /dispatch now owns the staff dispatch board (Phase 4). The legacy
  // RentalWorks-linkage tool was relocated to /dispatch/rentalworks
  // and reached from the Admin section below.
  if (perms.dispatch) main.push({ id: 'dispatch', label: 'Dispatch', icon: '', href: '/dispatch' });
  if (perms.coverage) main.push({ id: 'coverage', label: 'Coverage', icon: '', href: '/exec/coverage' });
  sections.push({ label: null, items: main });

  // Warehouse — picking floor. Phase 2 ships /warehouse/pick; future
  // surfaces (receiving, cycle counts) join the same section.
  const warehouse: NavItem[] = [];
  if (perms.warehouse) warehouse.push({ id: 'warehouse-pick', label: 'Pick', icon: '', href: '/warehouse/pick' });
  if (warehouse.length > 0) sections.push({ label: 'Warehouse', items: warehouse });

  // Admin — management & configuration. SalesOnly users keep only
  // Clients (CRM). Operational tooling (Inventory, Sub-Rentals,
  // Maintenance, COI Check, Contract Review, Contract History,
  // Scheduling, RW Linkage) drops.
  const admin: NavItem[] = [];
  // Phase 7 — Inventory gated to ADMIN/MANAGER (catalog admin is
  // ops/management, not sales/billing). Can't anchor on seePricing
  // because that perm also gates Orders, which AGENTs need.
  const isAdminOrManager = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
  if (isAdminOrManager) admin.push({ id: 'inventory', label: 'Inventory', icon: '', href: '/inventory' });
  if (user.role === UserRole.ADMIN) admin.push({ id: 'locations', label: 'Locations', icon: '', href: '/admin/locations' });
  if (perms.crm) admin.push({ id: 'crm', label: 'Clients', icon: '', href: '/crm' });
  // Phase 7 consolidation — Sub-Rentals nav entry dropped. The
  // /sub-rentals route never existed on disk (dead link). When the
  // feature is built, restore this line with the new route.
  if (perms.maintenance && !salesOnly) admin.push({ id: 'maintenance', label: 'Maintenance', icon: '', href: '/maintenance' });
  // Phase 7 consolidation — three paperwork tools (COI Check,
  // Contract Review, Contract History) collapsed into one nav
  // entry landing on a picker page at /admin/paperwork. The
  // individual /tools/* + /admin/contract-review/history routes
  // stay accessible and are linked from the picker.
  // Gated to ADMIN/MANAGER — bookings perm also drives Jobs in
  // main nav, which AGENT needs; can't share that gate here.
  if (isAdminOrManager) admin.push({ id: 'paperwork', label: 'Paperwork tools', icon: '', href: '/admin/paperwork' });
  if (perms.bookings && !salesOnly) admin.push({ id: 'scheduling', label: 'Scheduling', icon: '', href: '/scheduling' });
  // Phase 7 consolidation — RW Linkage nav entry dropped.
  // RentalWorks billing was off-ramped in Phase 5. The route
  // /dispatch/rentalworks stays accessible by deep-link for any
  // straggler legacy reconciliation work, just not surfaced in nav.
  // Phase Incidents — nav label renamed Claims → Incidents. The
  // /claims route stays alive (redirects to /incidents); deep links
  // to /claims/[id] keep resolving against the claim detail page.
  // claims-perm gates incidents identically — the same people who see
  // claims today see incidents tomorrow.
  if (perms.claims) admin.push({ id: 'incidents', label: 'Incidents', icon: '', href: '/incidents' });
  if (perms.reporting) admin.push({ id: 'reporting', label: 'Reporting', icon: '', href: '/reporting' });
  // HR nav entry. Gated on the hardcoded allowlist (Wes + Dani) +
  // HR_ALLOWLIST env override — NOT on role. Other ADMINs see no HR
  // entry. Cosmetic only; the page + every HR API route does its own
  // requireHrAccess() check so a bypass here would still 403.
  if (user.email && isAllowedHrEmail(user.email)) {
    admin.push({ id: 'hr', label: 'HR', icon: '', href: '/hr' });
  }
  if (admin.length > 0) sections.push({ label: 'Admin', items: admin });

  return sections;
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
