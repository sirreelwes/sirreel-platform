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
  seeClientNames: boolean;
  seeClientContact: boolean;
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
  ADMIN: {
    calendar: true, gantt: true, bookings: true, maintenance: true,
    fleet: true, dispatch: true, crm: true, claims: true,
    reporting: true, ai: true, tasks: true, inspections: true,
    seeClientNames: true, seeClientContact: true, seePricing: true,
    seeRevenue: true, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: true, canCancelBooking: true,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: true,
    canSendEmail: true, canEditCompany: true, canManageUsers: true,
  },

  MANAGER: {
    calendar: true, gantt: true, bookings: true, maintenance: true,
    fleet: true, dispatch: true, crm: true, claims: true,
    reporting: true, ai: true, tasks: true, inspections: true,
    seeClientNames: true, seeClientContact: true, seePricing: true,
    seeRevenue: true, seeAllBookings: true, seeOtherAgents: true,
    seeMaintCost: true, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: true, canCancelBooking: true,
    canAssignAssets: true, canChangeAssetStatus: true, canCreateMaintenance: true,
    canManageDrivers: true, canProcessCheckout: true, canManageClaims: true,
    canSendEmail: true, canEditCompany: true, canManageUsers: false,
  },

  AGENT: {
    calendar: true, gantt: true, bookings: true, maintenance: false,
    fleet: false, dispatch: false, crm: true, claims: false,
    reporting: false, ai: true, tasks: false, inspections: false,
    seeClientNames: true, seeClientContact: true, seePricing: true,
    seeRevenue: false, seeAllBookings: false, seeOtherAgents: false,
    seeMaintCost: false, seeEmailHistory: true,
    canCreateBooking: true, canConfirmBooking: false, canCancelBooking: false,
    canAssignAssets: false, canChangeAssetStatus: false, canCreateMaintenance: false,
    canManageDrivers: false, canProcessCheckout: false, canManageClaims: false,
    canSendEmail: true, canEditCompany: false, canManageUsers: false,
  },

  FLEET_TECH: {
    calendar: true, gantt: true, bookings: false, maintenance: true,
    fleet: true, dispatch: true, crm: false, claims: false,
    reporting: false, ai: true, tasks: true, inspections: true,
    seeClientNames: false, seeClientContact: false, seePricing: false,
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
    seeClientNames: false, seeClientContact: false, seePricing: false,
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
    seeClientNames: false, seeClientContact: false, seePricing: false,
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
    seeClientNames: false, seeClientContact: false, seePricing: true,
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

  if (perms.calendar) items.push({ id: 'calendar', label: 'Calendar', icon: '📅', href: '/calendar' });
  if (perms.gantt) items.push({ id: 'gantt', label: 'Gantt', icon: '📊', href: '/gantt' });
  if (perms.bookings) items.push({ id: 'bookings', label: 'Bookings', icon: '📋', href: '/bookings' });
  if (perms.maintenance) items.push({ id: 'maintenance', label: 'Maintenance', icon: '🔧', href: '/maintenance' });
  if (perms.fleet) items.push({ id: 'fleet', label: 'Fleet Status', icon: '🚛', href: '/fleet' });
  if (perms.dispatch) items.push({ id: 'dispatch', label: 'Dispatch', icon: '📦', href: '/dispatch' });
  if (perms.crm) items.push({ id: 'crm', label: 'Clients', icon: '👥', href: '/crm' });
  if (perms.claims) items.push({ id: 'claims', label: 'Claims', icon: '🛡️', href: '/claims' });
  if (perms.reporting) items.push({ id: 'reporting', label: 'Reporting', icon: '📈', href: '/reporting' });
  if (perms.tasks) items.push({ id: 'tasks', label: 'My Tasks', icon: '📋', href: '/tasks' });
  if (perms.inspections) items.push({ id: 'inspections', label: 'Inspections', icon: '📷', href: '/inspections' });

  return items;
}

// Redact client name for fleet/warehouse roles
export function displayClientName(name: string, role: UserRole): string {
  if (getPermissions(role).seeClientNames) return name;
  // Generate consistent hash-based ID
  const hash = name.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
  return `Production #${Math.abs(hash).toString(36).slice(0, 4).toUpperCase()}`;
}
