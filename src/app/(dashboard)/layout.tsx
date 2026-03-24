'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { getPermissions, getNavItems } from '@/lib/permissions';
import AIChat from '@/components/ai/AIChat'
import InboxBell from '@/components/ui/InboxBell';

// TODO: Replace with actual auth session
const MOCK_USER: { id: string; name: string; email: string; role: UserRole } = {
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
  { name: 'Jose Pacheco', role: UserRole.AGENT, label: 'Sales Director' },
  { name: 'Oliver Carlson', role: UserRole.AGENT, label: 'Account Mgr' },
  { name: 'Hugo', role: UserRole.MANAGER, label: 'General Mgr' },
  { name: 'Julian Ponce', role: UserRole.FLEET_TECH, label: 'Fleet Director' },
  { name: 'Chris Valencia', role: UserRole.FLEET_TECH, label: 'Fleet Assoc' },
  { name: 'Ana DeAngelis', role: UserRole.AGENT, label: 'Billing' },
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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-[#1a1b2e] border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <img src="/s-logo.jpg" alt="SirReel" className="w-8 h-8 rounded-md object-cover invert" />
            <div>
              <div className="font-extrabold text-sm text-white tracking-tight">
                SirReel
              </div>
              <div className="text-[8px] font-semibold text-gray-400 tracking-[0.15em] uppercase">
                Team HQ
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
                    ? 'bg-white border-l-white text-gray-900 font-semibold'
                    : 'border-l-transparent text-gray-400 hover:bg-white/50'
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
                    ? 'bg-white border-l-amber-500 text-amber-400 font-semibold'
                    : 'border-l-transparent text-gray-400 hover:bg-white/50'
                }`}
              >
                <span className="text-sm">⚡</span>
                <span>Ask AI</span>
              </button>
            </>
          )}
        </nav>

        {/* User / Role Switcher */}
        <div className="border-t border-gray-200">
          {/* Demo role switcher */}
          {showRoleSwitcher && (
            <div className="px-3 py-2 border-b border-gray-200 bg-white">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">
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
                      try {
                        localStorage.setItem('sirreel_demo_name', u.name);
                        localStorage.setItem('sirreel_demo_role', u.role);
                        window.dispatchEvent(new Event('sirreel_role_change'));
                      } catch {}
                    }}
                    className={`text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                      currentUser.name === u.name
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {u.name}{' '}
                    <span className="text-gray-400">· {u.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setShowRoleSwitcher((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-2.5 hover:bg-gray-500 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-sirreel-border flex items-center justify-center text-[10px] font-bold text-gray-500">
              {currentUser.name.charAt(0)}
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-gray-300 truncate">
                {currentUser.name}
              </div>
              <div className="text-[9px] text-gray-500">
                {ROLE_LABELS[currentUser.role] || currentUser.role}
              </div>
            </div>
            <span className="text-[9px] text-gray-500">▼</span>
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 px-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <div className="flex gap-1.5">
            <StatBadge label="Fleet" value="137" color="text-gray-900" />
            <StatBadge label="Active" value="10" color="text-green-600" />
            {perms.bookings && (
              <StatBadge label="Pending" value="2" color="text-amber-400" />
            )}
            <StatBadge label="Maint" value="9" color="text-status-maintenance" />
            {perms.seePricing && (
              <StatBadge label="Revenue" value="$46.9K" color="text-tier-vip" />
            )}
          </div>

          <div className="flex gap-2 items-center">
            <InboxBell />
            {perms.ai && (
              <button
                onClick={() => setAiOpen((v) => !v)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                  aiOpen
                    ? 'bg-amber-500 text-white'
                    : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                ⚡ AI
              </button>
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
      <span className="text-[9px] font-semibold text-gray-500 uppercase">
        {label}
      </span>
      <span className={`text-sm font-extrabold ${color}`}>{value}</span>
    </div>
  );
}
