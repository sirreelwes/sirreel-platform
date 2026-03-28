import { UserRole } from '@prisma/client';

// ═══════════════════════════════════════
// SIRREEL — Role-Based Permissions
// ═══════════════════════════════════════

export interface Permissions {
  // Views
  calendar: boolean;
  gantt: boolean;
  bookings: boolean;
  maintenance: boolean;
  fleet: boolean;
  dispatch: boolean;
  crm: boolean;
  claims: boolean;
  reporting: boolean;
  ai: boolean;
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
    calendar: true, gantt: true, bookings: true, maintenance: true,
    fleet: true, dispatch: true, crm: true, claims: true,
    reporting: true, ai: true, tasks: true, inspections: true,
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
    calendar: true, gantt: true, bookings: false, maintenance: true,
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true,
    seeClientNames: false, seeClientContact: false, seeProductionInfo: true,
    seeDriverInfo: true, seePricing: false,
    seeRevenue: false, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: false,
    canCreateBooking: false, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: false,
    canSendEmail: false, canEditCompany: false, canManageUsers: false,
  },

  // Jose, Oliver — agents. Full client + booking + fleet/dispatch view access
  AGENT: {
    calendar: true, gantt: true, bookings: true, maintenance: true,
    fleet: true, dispatch: true, crm: true, claims: false,
    reporting: false, ai: true, tasks: false, inspections: false,
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
    calendar: true, gantt: true, bookings: false, maintenance: true,
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true,
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
    calendar: true, gantt: true, bookings: false, maintenance: true,
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true,
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
    calendar: false, gantt: false, bookings: false, maintenance: false,
    fleet: false, dispatch: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: true, inspections: true,
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
    calendar: false, gantt: false, bookings: true, maintenance: false,
    fleet: false, dispatch: false, crm: false, claims: false,
    reporting: false, ai: false, tasks: false, inspections: false,
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

export function getPermissions(role: UserRole): Permissions {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.CLIENT;
}

export function can(role: UserRole, permission: keyof Permissions): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

// Navigation items per role
export function getNavItems(role: UserRole) {
  const perms = getPermissions(role);
  const items: { id: string; label: string; icon: string; href: string }[] = [];

  // Dashboard is first for Admin
  items.push({ id: 'dashboard', label: 'Dashboard', icon: '', href: '/dashboard' });
  if (perms.calendar) items.push({ id: 'calendar', label: 'Calendar', icon: '', href: '/calendar' });
  if (perms.gantt) items.push({ id: 'gantt', label: 'Timeline', icon: '', href: '/gantt' });
  if (perms.bookings) items.push({ id: 'bookings', label: 'Jobs', icon: '', href: '/bookings' });
  if (perms.crm) items.push({ id: 'crm', label: 'Clients', icon: '', href: '/crm' });
  if (perms.fleet) items.push({ id: 'fleet', label: 'Fleet', icon: '', href: '/fleet' });
  if (perms.maintenance) items.push({ id: "maintenance", label: "Maintenance", icon: "🔧", href: "/maintenance" });
  if (perms.bookings) items.push({ id: "coi-check", label: "COI Check", icon: "🔍", href: "/tools/coi-check" });
  if (perms.bookings) items.push({ id: "contract-review", label: "Contract Review", icon: "📝", href: "/tools/contract-review" });
  if (perms.dispatch) items.push({ id: 'dispatch', label: 'Dispatch', icon: '', href: '/dispatch' });
  if (perms.claims) items.push({ id: 'claims', label: 'Claims', icon: '', href: '/claims' });
  if (perms.reporting) items.push({ id: 'reporting', label: 'Reporting', icon: '', href: '/reporting' });

  return items;
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
