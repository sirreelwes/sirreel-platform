'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { getPermissions, getNavSections, isSalesRole } from '@/lib/permissions';
import AIChat from '@/components/ai/AIChat';
import InboxBell from '@/components/ui/InboxBell';
import { QuickCreateMenu } from '@/components/shell/QuickCreateMenu';
import { AdminHealthDot } from '@/components/shell/AdminHealthDot';
import {
  TrendingUp, Users, CalendarDays, FileText, Briefcase, Boxes, Truck,
  PackageOpen, FileSignature, Car, Wrench, UserPlus, ClipboardList,
  AlertTriangle, LayoutDashboard, Radar, BarChart3, MapPin, Activity,
  CalendarClock, IdCard, Circle, type LucideIcon,
} from 'lucide-react';

// Maps the `icon` name carried by each NavItem to its lucide component.
const NAV_ICONS: Record<string, LucideIcon> = {
  TrendingUp, Users, CalendarDays, FileText, Briefcase, Boxes, Truck,
  PackageOpen, FileSignature, Car, Wrench, UserPlus, ClipboardList,
  AlertTriangle, LayoutDashboard, Radar, BarChart3, MapPin, Activity,
  CalendarClock, IdCard,
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      'Admin',
  MANAGER:    'Manager',
  AGENT:      'Sales',
  FLEET_TECH: 'Fleet',
  DISPATCHER: 'Deliveries & Pickups',
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
  const actualSalesOnly: boolean = !!user.salesOnly;

  const role: UserRole = (actualRole === 'ADMIN' && viewAsRole) ? viewAsRole : actualRole;
  // Admins using viewAsRole inherit the target role's default surface
  // (non-sales-only) — they're previewing a baseline operational view.
  // Their actual sales-only flag only applies when not impersonating.
  const salesOnly: boolean = actualRole === 'ADMIN' && viewAsRole ? false : actualSalesOnly;
  // email passed so getNavSections can gate the HR entry on the
  // hardcoded allowlist (Wes + Dani). Not used by getPermissions —
  // the HR API is the actual authorization gate.
  const permsUser = { role, salesOnly, email: user.email as string | undefined };
  const perms = getPermissions(permsUser);
  const sections = getNavSections(permsUser);
  // Longest-prefix match → the most specific route wins (so
  // /fleet/guest-drivers highlights Guest Drivers, not Fleet). Items that
  // share an href — the cross-listed Deliveries & Pickups — all light up
  // together by design.
  const activeHref =
    sections
      .flatMap((s) => s.items.map((i) => i.href))
      .filter((h) => pathname === h || pathname.startsWith(h + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  // Sales agents work primarily from /sales/pipeline — Dashboard isn't
  // in their nav, and `/` redirects to /dashboard by default. Bounce
  // them to the pipeline on any visit to /dashboard. Respects the
  // admin view-as toggle so previewing as AGENT routes correctly.
  if (typeof window !== 'undefined' && isSalesRole(role) && pathname === '/dashboard') {
    router.replace('/sales/pipeline');
  }

  const initials = user.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F6F3]">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-[#0b1f3a] text-slate-200 flex flex-col">
        {/* Brand — recolorable inline 'S' monogram (currentColor → gold) */}
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/" className="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="w-9 h-9 text-[#c9a24b] flex-shrink-0" aria-hidden="true">
              <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" opacity="0.16" />
              <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
              <text x="16" y="23" textAnchor="middle" fontSize="20" fontWeight="800" fill="currentColor" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif">S</text>
            </svg>
            <div className="leading-tight">
              <div className="font-bold text-[15px] text-white tracking-tight">SirReel</div>
              <div className="text-[8px] font-semibold text-[#c9a24b]/80 tracking-[0.22em] uppercase">SirReel HQ</div>
            </div>
          </Link>
        </div>

        {/* Navigation — fixed groups, always expanded (no collapse). The
            body scrolls vertically if the full list runs past the viewport. */}
        <nav className="flex-1 py-2 overflow-y-auto px-2">
          {sections.map((section, si) => (
            <div key={si} className={si === 0 ? 'mt-1' : 'mt-4'}>
              {/* Static section divider — NOT a toggle. */}
              <div className="flex items-center justify-between px-3 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c9a24b]/75">
                  {section.label}
                </span>
                {section.label === 'Admin' && role === UserRole.ADMIN && <AdminHealthDot />}
              </div>
              {section.items.map((item) => {
                const Icon = NAV_ICONS[item.icon] ?? Circle;
                const isActive = item.href === activeHref;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`group relative flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg text-[13px] mb-0.5 transition-all duration-150 ${
                      isActive
                        ? 'bg-[#c9a24b] text-[#0b1f3a] font-semibold shadow-sm'
                        : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                    }`}
                  >
                    {/* Left accent bar on the active route. */}
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#0b1f3a]" />
                    )}
                    <Icon
                      size={16}
                      strokeWidth={2.1}
                      className={`flex-shrink-0 ${
                        isActive ? 'text-[#0b1f3a]' : 'text-slate-400 group-hover:text-[#c9a24b] transition-colors'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-3">
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/[0.07] transition-colors"
            >
              {user.image ? (
                <img src={user.image} alt={user.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#c9a24b] flex items-center justify-center text-[11px] font-bold text-[#0b1f3a] flex-shrink-0">
                  {initials}
                </div>
              )}
              <div className="text-left flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white truncate">{user.name}</div>
                <div className="text-[10px] text-[#c9a24b]/80 truncate">{ROLE_LABELS[role] || role}</div>
              </div>
              <span className="text-[9px] text-slate-400">▼</span>
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
                      <option value="DISPATCHER">Deliveries &amp; Pickups</option>
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
        {/* Top bar — global chrome across all (dashboard) surfaces.
            Carries the global "+ New" entry point right-aligned. The
            left side previously held a row of placeholder KPI badges
            (Fleet/Active/Pending/Maint/Revenue) wired to hardcoded
            literals — pulled because the numbers were lies; real KPIs
            will land on the Dashboard page itself, not the global
            chrome. StatBadge (below) is intentionally kept for that
            future use. Height stays h-12 so main content doesn't
            reflow across every page. */}
        <header className="h-12 px-4 border-b border-gray-100 flex items-center justify-end flex-shrink-0 bg-white">
          <QuickCreateMenu />
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
