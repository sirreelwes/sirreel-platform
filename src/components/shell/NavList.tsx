'use client';

/**
 * The nav item list, extracted from the dashboard layout so the desktop
 * sidebar and the mobile sheet render the SAME markup from the SAME
 * `getNavSections()` output.
 *
 * The extraction is the point: the nav is role-branched into eight
 * sections and up to 44 items, and a second hand-maintained copy for
 * phones would drift the first time a nav entry moved. One component,
 * two mounts.
 *
 * `onNavigate` is how the sheet closes itself on tap — the desktop
 * sidebar passes nothing.
 */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import type { NavSection } from '@/lib/permissions';
import { AdminHealthDot } from '@/components/shell/AdminHealthDot';
import { IncomingPill } from '@/components/jobs/IncomingPill';
import {
  TrendingUp, Users, CalendarDays, FileText, Briefcase, Boxes, Truck,
  PackageOpen, FileSignature, Car, Wrench, UserPlus, ClipboardList,
  AlertTriangle, LayoutDashboard, Radar, BarChart3, MapPin, Activity,
  CalendarClock, IdCard, ShieldCheck, DollarSign, Receipt, Globe, Sun, Store,
  Building2, Circle, Banknote, ListChecks, CreditCard, RefreshCw,
  Inbox, FileDown, Send, Copy, Mail, BookOpen, Clock, Eye, type LucideIcon,
} from 'lucide-react';

// Maps the `icon` name carried by each NavItem to its lucide component.
const NAV_ICONS: Record<string, LucideIcon> = {
  TrendingUp, Users, CalendarDays, FileText, Briefcase, Boxes, Truck,
  PackageOpen, FileSignature, Car, Wrench, UserPlus, ClipboardList,
  AlertTriangle, LayoutDashboard, Radar, BarChart3, MapPin, Activity,
  CalendarClock, IdCard, ShieldCheck, DollarSign, Receipt, Globe, Sun, Store,
  Building2, Banknote, ListChecks, CreditCard, RefreshCw, Inbox, FileDown, Send, Copy, Mail,
  BookOpen, Clock, Eye,
};

export function NavList({
  sections,
  activeHref,
  role,
  actionItemCount,
  onNavigate,
  touch = false,
}: {
  sections: NavSection[];
  activeHref: string | null;
  role: UserRole;
  actionItemCount: number;
  onNavigate?: () => void;
  /** Sheet mount: pad rows out to a 44px tap target. */
  touch?: boolean;
}) {
  // The Incoming strip, copied out of the /jobs toolbar and pinned
  // above the first section header (Wes, 2026-09-09) — the inbound
  // queue is the front of the funnel and was only reachable from
  // /jobs. Same component, dark skin.
  //
  // Shown only to navs that carry /jobs: the yard-crew branch has no
  // sales surface, and the pill's destination would 403-shaped
  // redirect them out of the one view they were given.
  const hasJobs = sections.some((s) => s.items.some((i) => i.href === '/jobs'));

  return (
    <>
      {hasJobs && (
        <div className="px-1 pt-1 pb-2">
          <IncomingPill variant="nav" onNavigate={onNavigate} touch={touch} className="w-full" />
        </div>
      )}
      {sections.map((section, si) => (
        <div key={si} className={si === 0 ? 'mt-1' : 'mt-4'}>
          {/* Static section divider — NOT a toggle. */}
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
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
                onClick={onNavigate}
                className={`group relative flex items-center gap-3 pl-3 pr-2 rounded-lg mb-0.5 transition-all duration-150 ${
                  touch ? 'py-2.5 min-h-[44px] text-[14px]' : 'py-2 text-[13px]'
                } ${
                  isActive
                    ? 'bg-amber-400 text-[#1a1a1a] font-semibold shadow-sm'
                    : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                {/* Left accent bar on the active route. */}
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#1a1a1a]" />
                )}
                <Icon
                  size={touch ? 18 : 16}
                  strokeWidth={2.1}
                  className={`flex-shrink-0 ${
                    isActive ? 'text-[#1a1a1a]' : 'text-slate-400 group-hover:text-amber-400 transition-colors'
                  }`}
                />
                <span className="truncate">{item.label}</span>
                {/* Unhandled-count badge, fed by the Action Items
                    engine. Only the 'action-items' entry carries it. */}
                {item.id === 'action-items' && actionItemCount > 0 && (
                  <span className={`ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    isActive ? 'bg-[#1a1a1a] text-amber-400' : 'bg-red-500 text-white'
                  }`}>
                    {actionItemCount > 99 ? '99+' : actionItemCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
