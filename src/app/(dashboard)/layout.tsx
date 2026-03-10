'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { getPermissions, getNavItems } from '@/lib/permissions';
import AIChat from '@/components/ai/AIChat';

// TODO: Replace with actual auth session
const MOCK_USER = {
  id: '1',
  name: 'Jose Pacheco',
  email: 'jose@sirreel.com',
  role: UserRole.AGENT,
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  FLEET_TECH: 'Fleet Tech',
  DISPATCHER: 'Dispatcher',
  DRIVER: 'Driver',
  CLIENT: 'Client',
};

// Demo role switcher — remove in production
const DEMO_USERS = [
  { name: 'Wes', role: UserRole.ADMIN, label: 'Owner' },
  { name: 'Dani Novoa', role: UserRole.ADMIN, label: 'COO' },
  { name: 'Hugo', role: UserRole.MANAGER, label: 'Fleet Mgr' },
  { name: 'Julian', role: UserRole.MANAGER, label: 'Fleet Dir' },
  { name: 'Jose Pacheco', role: UserRole.AGENT, label: 'Agent' },
  { name: 'Oliver Carlson', role: UserRole.AGENT, label: 'Agent' },
  { name: 'Christian DeAngelis', role: UserRole.AGENT, label: 'Billing' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState(MOCK_USER);
  const [aiOpen, setAiOpen] = useState(false);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);

  const perms = getPermissions(currentUser.role);
  const navItems = getNavItems(currentUser.role);

  const activeNav = navItems.find((n) => pathname.startsWith(n.href))?.id || 'calendar';

  return (
    <div className="flex h-screen overflow-hidden bg-sirreel-bg">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-[#0d0d0d] border-r border-sirreel-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-sirreel-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center font-black text-sm text-black">
              S
            </div>
            <div>
              <div className="font-extrabold text-sm text-white tracking-tight">
                SirReel
              </div>
              <div className="text-[8px] font-semibold text-sirreel-text-dim tracking-[0.15em] uppercase">
                Fleet Hub
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-2.5 px-4 py-2 text-[13px] border-l-2 transition-all ${
                  isActive
                    ? 'bg-sirreel-surface border-l-white text-white font-semibold'
                    : 'border-l-transparent text-sirreel-text-muted hover:bg-sirreel-surface/50'
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}

          {perms.ai && (
            <>
              <div className="mx-4 my-2 h-px bg-sirreel-border" />
              <button
                onClick={() => setAiOpen((v) => !v)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-[13px] border-l-2 transition-all ${
                  aiOpen
                    ? 'bg-sirreel-surface border-l-amber-500 text-amber-400 font-semibold'
                    : 'border-l-transparent text-sirreel-text-muted hover:bg-sirreel-surface/50'
                }`}
              >
                <span className="text-sm">⚡</span>
                <span>Ask AI</span>
              </button>
            </>
          )}
        </nav>

        {/* User / Role Switcher */}
        <div className="border-t border-sirreel-border">
          {/* Demo role switcher */}
          {showRoleSwitcher && (
            <div className="px-3 py-2 border-b border-sirreel-border bg-[#080808]">
              <div className="text-[9px] font-bold text-sirreel-text-dim uppercase tracking-wider mb-2">
                Demo: Switch Role
              </div>
              <div className="flex flex-col gap-1">
                {DEMO_USERS.map((u) => (
                  <button
                    key={u.name}
                    onClick={() => {
                      setCurrentUser({
                        id: '1',
                        name: u.name,
                        email: `${u.name.split(' ')[0].toLowerCase()}@sirreel.com`,
                        role: u.role,
                      });
                      setShowRoleSwitcher(false);
                    }}
                    className={`text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                      currentUser.name === u.name
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-sirreel-text-muted hover:bg-white/5'
                    }`}
                  >
                    {u.name}{' '}
                    <span className="text-sirreel-text-dim">· {u.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowRoleSwitcher((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-2.5 hover:bg-sirreel-surface/50 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-sirreel-border flex items-center justify-center text-[10px] font-bold text-sirreel-text-muted">
              {currentUser.name.charAt(0)}
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-sirreel-text truncate">
                {currentUser.name}
              </div>
              <div className="text-[9px] text-sirreel-text-dim">
                {ROLE_LABELS[currentUser.role] || currentUser.role}
              </div>
            </div>
            <span className="text-[9px] text-sirreel-text-dim">▼</span>
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 px-4 border-b border-sirreel-border flex items-center justify-between flex-shrink-0 bg-sirreel-bg">
          <div className="flex gap-1.5">
            <StatBadge label="Fleet" value="137" color="text-white" />
            <StatBadge label="Active" value="10" color="text-status-available" />
            {perms.bookings && (
              <StatBadge label="Pending" value="2" color="text-amber-400" />
            )}
            <StatBadge label="Maint" value="9" color="text-status-maintenance" />
            {perms.seePricing && (
              <StatBadge label="Revenue" value="$46.9K" color="text-tier-vip" />
            )}
          </div>

          <div className="flex gap-2 items-center">
            {perms.ai && (
              <button
                onClick={() => setAiOpen((v) => !v)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                  aiOpen
                    ? 'bg-amber-400 text-black'
                    : 'bg-sirreel-surface border border-sirreel-border text-sirreel-text-muted hover:border-sirreel-border-hover'
                }`}
              >
                ⚡ AI
              </button>
            )}
            {perms.canCreateBooking && (
              <Link
                href="/bookings/new"
                className="px-3 py-1.5 rounded-md bg-white text-black text-xs font-bold hover:bg-gray-100 transition-colors"
              >
                + New Booking
              </Link>
            )}
          </div>
        </header>

        {/* Role banner (non-admin roles) */}
        {!perms.seeClientNames && (
          <div className="px-4 py-1.5 bg-red-950/30 border-b border-red-900/30 flex items-center gap-2 text-[11px]">
            <span className="text-red-400">🔒</span>
            <span className="text-red-400/70">
              Client names and pricing hidden in this role
            </span>
          </div>
        )}

        {/* Content + AI panel */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4">{children}</main>

          {/* AI Chat Panel */}
          {aiOpen && perms.ai && (
            <AIChat
              role={currentUser.role}
              userName={currentUser.name}
              onClose={() => setAiOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="stat-card flex items-center gap-1.5">
      <span className="text-[9px] font-semibold text-sirreel-text-muted uppercase">
        {label}
      </span>
      <span className={`text-sm font-extrabold ${color}`}>{value}</span>
    </div>
  );
}
