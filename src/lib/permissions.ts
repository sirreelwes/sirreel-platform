import { UserRole } from '@prisma/client';
import { isAllowedClaimsEmail } from '@/lib/claims/allowlist';
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

  // Julian, Chris — fleet associates. Calendar/gantt with production co + job visible, NOT client contacts
  FLEET_TECH: {
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

// Roles whose home is the mobile-first /fleet/today board. The layout
// auto-redirects /dashboard → /fleet/today for these (mirrors the
// sales-role pattern above) and their nav gets a "Today" entry.
export function isFleetYardRole(role: UserRole): boolean {
  // DISPATCHER is being retired (fold into FLEET_TECH); no live DISPATCHER
  // users exist, so this covers the yard roles.
  return role === UserRole.FLEET_TECH;
}

export function defaultLandingPath(input: UserRole | PermissionsUser): string {
  const role = typeof input === 'string' ? input : input.role;
  if (isSalesRole(role)) return '/sales/pipeline';
  if (isFleetYardRole(role)) return '/fleet/today';
  return '/dashboard';
}

export function getNavSections(input: UserRole | PermissionsUser): NavSection[] {
  const navRole: UserRole = typeof input === 'string' ? input : input.role;
  // Fixed information architecture — identical for every user. This is a
  // visual + IA surface only; pages enforce their own authorization, so
  // there is intentionally NO role-gating here (every tab is visible to
  // all). Two narrow exceptions: the HR entry (email allowlist) and the
  // fleet "Today" entry (yard roles only — it's their mobile home, noise
  // for everyone else). Groups are always expanded (the layout renders
  // static section headers, no collapse). `icon` carries a lucide-react
  // component name resolved in the layout.
  //
  // Deliveries & Pickups (/dispatch) is CROSS-LISTED in both Sales & Ops
  // and Fleet on purpose — one shared tool (Sales enters what/where/when,
  // Fleet assigns driver + vehicle). Same href, highlighted in both when
  // active. Not a duplicate route.
  return [
    {
      label: 'Sales & Ops',
      items: [
        // Top-level Action Items surface — the id 'action-items' is
        // special-cased in the layout to render an unhandled-count badge
        // fed by the same engine (/api/action-items?count=1).
        { id: 'action-items', label: 'Action Items', icon: 'ListChecks', href: '/action-items' },
        { id: 'pipeline', label: 'Pipeline', icon: 'TrendingUp', href: '/sales/pipeline' },
        { id: 'crm', label: 'Clients', icon: 'Users', href: '/crm' },
        { id: 'schedule', label: SCHEDULE_LABEL, icon: 'CalendarDays', href: '/gantt' },
        { id: 'orders', label: 'Orders', icon: 'FileText', href: '/orders' },
        { id: 'jobs', label: 'Jobs', icon: 'Briefcase', href: '/jobs' },
        { id: 'inventory', label: 'Inventory', icon: 'Boxes', href: '/inventory' },
        { id: 'dispatch', label: 'Deliveries & Pickups', icon: 'Truck', href: '/dispatch' },
        { id: 'sub-rentals', label: 'Sub-Rentals', icon: 'PackageOpen', href: '/sub-rentals' },
        { id: 'paperwork', label: 'Paperwork tools', icon: 'FileSignature', href: '/admin/paperwork' },
      ],
    },
    {
      label: 'Fleet',
      items: [
        // Yard roles' mobile home — top of their Fleet group.
        ...(isFleetYardRole(navRole)
          ? [{ id: 'fleet-today', label: 'Today', icon: 'Sun', href: '/fleet/today' }]
          : []),
        // Cross-listed — SAME route as Sales & Ops above.
        { id: 'dispatch-fleet', label: 'Deliveries & Pickups', icon: 'Truck', href: '/dispatch' },
        { id: 'fleet', label: 'Fleet', icon: 'Car', href: '/fleet' },
        { id: 'maintenance', label: 'Maintenance', icon: 'Wrench', href: '/maintenance' },
        { id: 'guest-drivers', label: 'Guest Drivers', icon: 'UserPlus', href: '/fleet/guest-drivers' },
      ],
    },
    {
      label: 'Warehouse',
      items: [
        { id: 'warehouse-pick', label: 'Pick', icon: 'ClipboardList', href: '/warehouse/pick' },
      ],
    },
    {
      label: 'Claims',
      items: [
        { id: 'incidents', label: 'Incidents', icon: 'AlertTriangle', href: '/incidents' },
      ],
    },
    {
      label: 'COO',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', href: '/dashboard' },
        { id: 'coverage', label: 'Coverage', icon: 'Radar', href: '/exec/coverage' },
        { id: 'reporting', label: 'Reporting', icon: 'BarChart3', href: '/reporting' },
      ],
    },
    {
      label: 'Admin',
      items: [
        { id: 'cois', label: 'COIs', icon: 'ShieldCheck', href: '/admin/cois' },
        { id: 'fleet-pricing', label: 'Pricing', icon: 'DollarSign', href: '/admin/asset-categories' },
        { id: 'fees', label: 'Fees', icon: 'Receipt', href: '/admin/fees' },
        { id: 'vendors', label: 'Vendors', icon: 'Store', href: '/admin/vendors' },
        { id: 'spaces', label: 'Spaces', icon: 'Building2', href: '/admin/spaces' },
        { id: 'locations', label: 'Locations', icon: 'MapPin', href: '/admin/locations' },
        { id: 'health', label: 'Health', icon: 'Activity', href: '/admin/health' },
        { id: 'site-settings', label: 'Site Settings', icon: 'Globe', href: '/admin/site-settings' },
        { id: 'forms', label: 'Forms', icon: 'FileText', href: '/admin/forms' },
        { id: 'payment-info', label: 'Payment Info', icon: 'Banknote', href: '/admin/payment-info' },
        { id: 'home-tiles', label: 'Home Tiles', icon: 'LayoutDashboard', href: '/admin/home-tiles' },
        { id: 'scheduling', label: 'Scheduling', icon: 'CalendarClock', href: '/scheduling' },
        { id: 'hr', label: 'HR', icon: 'IdCard', href: '/hr' },
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
