'use client';

/**
 * The signed-in-user block at the foot of the nav: avatar, name, role,
 * the admin View-As selector, and Sign out.
 *
 * Extracted from the dashboard layout alongside NavList so the mobile
 * sheet carries the same controls the sidebar does — View-As in
 * particular, because an admin previewing a role on a phone otherwise
 * has no way back out of the preview.
 *
 * Auth is untouched: this still calls the same `signOut` and the same
 * `writeViewAsCookie` + hard reload the sidebar always did.
 */

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { writeViewAsCookie } from '@/lib/auth/viewAs';

export const ROLE_LABELS: Record<string, string> = {
  ADMIN:      'Admin',
  MANAGER:    'Manager',
  AGENT:      'Sales',
  BILLING:    'Billing',
  FLEET_TECH: 'Fleet',
  DISPATCHER: 'Deliveries & Pickups',
  DRIVER:     'Driver',
  CLIENT:     'Client',
};

export function UserMenu({
  user,
  role,
  actualRole,
  viewAsRole,
  /** Sheet mount: the menu drops DOWN, since the sheet foot is not at the viewport foot. */
  dropUp = true,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null };
  role: UserRole;
  actualRole: UserRole;
  viewAsRole: UserRole | null;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-2 py-2 min-h-[44px] rounded-xl hover:bg-white/[0.07] transition-colors"
      >
        {user.image ? (
          <img src={user.image} alt={user.name || ''} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[#c9a24b] flex items-center justify-center text-[11px] font-bold text-[#1a1a1a] flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="text-left flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white truncate">{user.name}</div>
          <div className="text-[10px] text-[#c9a24b]/80 truncate">{ROLE_LABELS[role] || role}</div>
        </div>
        <span className="text-[9px] text-slate-400">▼</span>
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50 ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="px-3 py-2.5 border-b border-gray-100">
            <div className="text-[12px] font-semibold text-gray-900">{user.name}</div>
            <div className="text-[10px] text-gray-400">{user.email}</div>
          </div>

          {actualRole === 'ADMIN' && (
            <div className="px-3 py-2.5 border-b border-gray-100 bg-amber-50/50">
              <label className="block text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-1">
                View As {viewAsRole ? `(${ROLE_LABELS[viewAsRole] || viewAsRole})` : ''}
              </label>
              <select
                value={viewAsRole || ''}
                onChange={(e) => {
                  const val = e.target.value as UserRole | '';
                  writeViewAsCookie(val || null);
                  // Full reload on purpose: pages and API responses read
                  // the cookie at request time, so this flips nav, page
                  // controls, AND server-redacted data in one motion.
                  window.location.reload();
                }}
                // bg-white with no text colour inherited the menu's muted
                // grey, so the current selection read as light-on-white.
                // Both the control and the options are pinned explicitly.
                className="w-full px-2 py-1.5 text-[11px] border border-amber-300 rounded bg-white text-gray-900"
              >
                <option value="" className="text-gray-900">Admin (default)</option>
                <option value="MANAGER" className="text-gray-900">Manager</option>
                <option value="AGENT" className="text-gray-900">Sales Agent</option>
                <option value="BILLING" className="text-gray-900">Billing</option>
                <option value="FLEET_TECH" className="text-gray-900">Fleet Tech</option>
                <option value="WAREHOUSE" className="text-gray-900">Warehouse</option>
                <option value="DRIVER" className="text-gray-900">Driver</option>
                <option value="CLIENT" className="text-gray-900">Client</option>
              </select>
            </div>
          )}

          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-left px-3 py-3 text-[12px] text-red-600 hover:bg-red-50 transition-colors font-medium"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
