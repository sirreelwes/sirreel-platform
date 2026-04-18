'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { getPermissions, getNavItems, getNavSections } from '@/lib/permissions';
import AIChat from '@/components/ai/AIChat';
import InboxBell from '@/components/ui/InboxBell';

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      'Admin',
  MANAGER:    'Manager',
  AGENT:      'Sales',
  FLEET_TECH: 'Fleet',
  DISPATCHER: 'Dispatch',
  DRIVER:     'Driver',
  CLIENT:     'Client',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [aiOpen, setAiOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [viewAsRole, setViewAsRole] = useState<UserRole | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('viewAsRole');
      if (saved) setViewAsRole(saved as UserRole);
    }
  }, []);
  const [adminOpen, setAdminOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      return ['/inventory','/crm','/sub-rentals','/maintenance','/tools/','/claims','/reporting'].some(a => p.startsWith(a));
    }
    return false;
  });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Sync role to localStorage for components that still use it
  useEffect(() => {
    if (session?.user) {
      const role = (session.user as any).role || UserRole.AGENT;
      const name = session.user.name || '';
      try {
        localStorage.setItem('sirreel_demo_name', name);
        localStorage.setItem('sirreel_demo_role', role);
        window.dispatchEvent(new Event('sirreel_role_change'));
      } catch {}
    }
  }, [session]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          <div className="text-sm text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const user = session.user as any;
  const actualRole: UserRole = user.role || UserRole.AGENT;

  const role: UserRole = (actualRole === 'ADMIN' && viewAsRole) ? viewAsRole : actualRole;
  const perms = getPermissions(role);
  const navItems = getNavItems(role);
  const activeNav = navItems.find((n) => pathname.startsWith(n.href))?.id || (pathname.startsWith('/jobs') ? 'bookings' : 'dashboard');

  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F6F3]">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col shadow-sm">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <img src="/s-logo.jpg" alt="SirReel" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <div className="font-bold text-sm text-gray-900 tracking-tight">SirReel</div>
              <div className="text-[8px] font-semibold text-gray-400 tracking-[0.15em] uppercase">SirReel HQ</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto px-2">
          {getNavSections(role).map((section, si) => (
            <div key={si}>
              {section.label ? (
                <>
                  <button
                    onClick={() => setAdminOpen(!adminOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 mt-3 mb-0.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors"
                  >
                    <span>{section.label}</span>
                    <span className={`text-[10px] transition-transform ${adminOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                  </button>
                  {adminOpen && section.items.map((item) => {
                    const isActive = activeNav === item.id;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] mb-0.5 transition-all ${
                          isActive
                            ? 'bg-gray-900 text-white font-semibold'
                            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                      >
                        <span className="text-[13px] font-medium">{item.label}</span>
                      </Link>
                    );
                  })}
                </>
              ) : (
                section.items.map((item) => {
                  const isActive = activeNav === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] mb-0.5 transition-all ${
                        isActive
                          ? 'bg-gray-900 text-white font-semibold'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <span className="text-[13px] font-medium">{item.label}</span>
                    </Link>
                  );
                })
              )}
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-gray-100 p-3">
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-gray-100 transition-colors"
            >
              {user.image ? (
                <img src={user.image} alt={user.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-600 flex-shrink-0">
                  {initials}
                </div>
              )}
              <div className="text-left flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-gray-900 truncate">{user.name}</div>
                <div className="text-[10px] text-gray-400">{ROLE_LABELS[role] || role}</div>
              </div>
              <span className="text-[9px] text-gray-400">▼</span>
            </button>

            {showUserMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
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
                        if (val) {
                          localStorage.setItem('viewAsRole', val);
                        } else {
                          localStorage.removeItem('viewAsRole');
                        }
                        window.location.reload();
                      }}
                      className="w-full px-2 py-1 text-[11px] border border-amber-300 rounded bg-white"
                    >
                      <option value="">Admin (default)</option>
                      <option value="MANAGER">Manager</option>
                      <option value="AGENT">Sales Agent</option>
                      <option value="DISPATCHER">Dispatcher</option>
                      <option value="FLEET_TECH">Fleet Tech</option>
                      <option value="DRIVER">Driver</option>
                      <option value="CLIENT">Client</option>
                    </select>
                  </div>
                )}

                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-red-600 hover:bg-red-50 transition-colors font-medium"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 px-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div className="flex gap-1.5">
            <StatBadge label="Fleet" value="137" />
            <StatBadge label="Active" value="10" highlight />
            {perms.bookings && <StatBadge label="Pending" value="2" warn />}
            <StatBadge label="Maint" value="9" />
            {perms.seePricing && <StatBadge label="Revenue" value="$46.9K" />}
          </div>
          <div className="flex gap-2 items-center" />
        </header>

        {/* Content + AI */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4">{children}</main>
          {aiOpen && perms.ai && (
            <AIChat role={role} userName={user.name} onClose={() => setAiOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatBadge({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 rounded-lg border border-gray-100">
      <span className="text-[9px] font-semibold text-gray-400 uppercase">{label}</span>
      <span className={`text-[13px] font-extrabold ${highlight ? 'text-emerald-600' : warn ? 'text-amber-500' : 'text-gray-800'}`}>{value}</span>
    </div>
  );
}
