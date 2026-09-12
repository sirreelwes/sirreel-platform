'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { getPermissions, getNavSections, defaultLandingPath } from '@/lib/permissions';
import { readViewAsCookie, writeViewAsCookie, previewSalesOnly } from '@/lib/auth/viewAs';
import AIChat from '@/components/ai/AIChat';
import InboxBell from '@/components/ui/InboxBell';
import { NavList } from '@/components/shell/NavList';
import { UserMenu, ROLE_LABELS } from '@/components/shell/UserMenu';
import { MobileNav } from '@/components/shell/MobileNav';
import { PAPERWORK_QUEUE_EVENT } from '@/lib/paperwork/reviewQueueClient';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [aiOpen, setAiOpen] = useState(false);
  const [viewAsRole, setViewAsRole] = useState<UserRole | null>(null);
  // Action Items unhandled-count badge — same engine as the tab.
  const [actionItemCount, setActionItemCount] = useState(0);
  // Paperwork alert — COIs and client redlines nobody has ruled on
  // (Wes 2026-09-11). Same derivation the /admin/paperwork feed renders.
  const [paperworkCount, setPaperworkCount] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Heal the legacy localStorage override (banned by CLAUDE.md, and
      // it once left Wes silently browsing as Billing for days). One-way:
      // read nothing from it, just delete it.
      try { localStorage.removeItem('viewAsRole'); } catch { /* ignore */ }
      const saved = readViewAsCookie();
      if (saved) setViewAsRole(saved as UserRole);
    }
  }, []);

  // Poll the badge count. Refetch on navigation so a dismiss on the
  // Action Items page updates the sidebar without a reload.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/action-items?count=1')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok) setActionItemCount(d.count || 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status, pathname]);

  // Same poll for the paperwork queue.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/paperwork/review-queue')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok) setPaperworkCount(d.count || 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status, pathname]);

  // …and a live drop when the paperwork page itself clears something. The
  // page already knows the new number; without this the badge would keep
  // claiming work that was just skipped until the next navigation.
  useEffect(() => {
    const onQueue = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setPaperworkCount(n);
    };
    window.addEventListener(PAPERWORK_QUEUE_EVENT, onQueue);
    return () => window.removeEventListener(PAPERWORK_QUEUE_EVENT, onQueue);
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

  // No HQ user row for this email (Hugo, 2026-09-11: warehouse@ "is
  // presenting as a sales view"). Sign-in only gates on the email DOMAIN
  // — see the signIn callback — so any @sirreel.com Google account gets a
  // session whether or not anyone provisioned it. The role fallback below
  // then read it as AGENT, which is the SALES surface: client contacts,
  // pricing, CRM, none of which an unprovisioned account should see, and
  // none of which its API calls would actually return (every route looks
  // the row up and 401s). So the shell says so instead of rendering a
  // department this person was never given.
  if (user.provisioned === false) {
    return (
      <div className="min-h-screen bg-lt-page flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lt-fg text-lg font-semibold mb-2">This account isn&apos;t set up yet</h1>
          <p className="text-lt-fg2 text-sm">
            You&apos;re signed in as <span className="font-semibold text-lt-fg">{user.email}</span>, but it has no
            HQ account, so there is nothing to show you. Ask Wes to add it and say which team you&apos;re on.
          </p>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="mt-4 text-[13px] font-semibold px-3 py-2 rounded-lg border border-lt-hairline text-lt-fg hover:bg-lt-inner"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const actualRole: UserRole = user.role || UserRole.AGENT;
  const actualSalesOnly: boolean = !!user.salesOnly;

  const role: UserRole = (actualRole === 'ADMIN' && viewAsRole) ? viewAsRole : actualRole;
  // Admins using viewAsRole inherit the target role's default surface
  // (non-sales-only) — they're previewing a baseline operational view.
  // Their actual sales-only flag only applies when not impersonating.
  // Previewing a role reproduces that DEPARTMENT, salesOnly strip included
  // (every real AGENT is salesOnly) — otherwise the preview shows a shape
  // nobody on the roster actually has.
  const salesOnly: boolean = actualRole === 'ADMIN' && viewAsRole ? previewSalesOnly(viewAsRole) : actualSalesOnly;
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

  // Dashboard is in the ADMIN nav and nobody else's. Anyone who lands
  // on it without a tab for it — sales, billing, the yard crew — gets
  // bounced to their default view, which since 2026-09-03 is
  // Reservations for everyone. Three near-identical role checks used to
  // live here, one per department, each naming its destination twice
  // (here and in defaultLandingPath) and drifting the moment either
  // moved. One rule now, keyed on the nav itself: no Dashboard tab, no
  // Dashboard page. Respects the admin view-as toggle, so previewing a
  // role reproduces its bounce.
  const hasDashboardTab = sections.some((s2) => s2.items.some((i) => i.id === 'dashboard'));
  if (typeof window !== 'undefined' && !hasDashboardTab && pathname === '/dashboard') {
    router.replace(defaultLandingPath(permsUser));
  }

  // Make Reservation + New Order are the app's create entry points
  // ("+ New Job" retired 2026-09-10) and they live in the /jobs
  // toolbar — which yields the viewport on a phone whenever a job is
  // selected. The mobile bar carries its own copy, gated on the same
  // thing the nav is: whether this role has Jobs at all.
  const canCreateJob = sections.some((s2) => s2.items.some((i) => i.id === 'jobs'));

  // Keyed by nav item id — NavList badges whichever entries carry a count.
  const badgeCounts: Record<string, number> = {
    'action-items': actionItemCount,
    paperwork: paperworkCount,
  };

  return (
    // Column on a phone (top bar over content), row on desktop
    // (sidebar beside content). 100dvh where supported so iOS Safari's
    // collapsing address bar doesn't clip the last row of the nav;
    // h-screen is the fallback for browsers without dvh.
    <div className="hq-shell flex flex-col md:flex-row h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden bg-[#F7F6F3]">
      <MobileNav
        sections={sections}
        activeHref={activeHref}
        role={role}
        actualRole={actualRole}
        viewAsRole={viewAsRole}
        badgeCounts={badgeCounts}
        user={user}
        canCreateJob={canCreateJob}
      />

      {/* Sidebar — desktop only; the phone gets MobileNav's sheet,
          which renders the same NavList from the same sections. */}
      <aside className="hidden md:flex w-60 flex-shrink-0 bg-[#1a1a1a] text-slate-200 flex-col">
        {/* Brand — real SirReel "S" mark (white transparent PNG on the dark chrome) */}
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/s-logo-white.png" alt="" aria-hidden="true" className="w-9 h-9 flex-shrink-0 object-contain" />
            <div className="leading-tight">
              <div className="font-bold text-[15px] text-white tracking-tight">SirReel</div>
              <div className="text-[8px] font-semibold text-amber-300 tracking-[0.22em] uppercase">SirReel HQ</div>
            </div>
          </Link>
        </div>

        {/* Navigation — fixed groups, always expanded (no collapse). The
            body scrolls vertically if the full list runs past the viewport. */}
        <nav className="flex-1 py-2 overflow-y-auto px-2">
          <NavList
            sections={sections}
            activeHref={activeHref}
            role={role}
            badgeCounts={badgeCounts}
          />
        </nav>

        {/* User section */}
        <div className="border-t border-white/10 p-3">
          <UserMenu user={user} role={role} actualRole={actualRole} viewAsRole={viewAsRole} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* No global top bar on desktop (Wes 2026-08-28: "remove the new
            job row from all pages") — the h-12 header's only content was
            the create launcher, which now lives in the JobsToolbar on
            /jobs as Make Reservation + New Order ("+ New Job" retired
            2026-09-10; a job is born from its first reservation or
            order, and more are added from INSIDE the Job — see
            JobQuickActions). StatBadge
            (below) stays for the someday-KPI use it was kept for. The
            PHONE does get a bar — see MobileNav above — because the
            /jobs toolbar isn't reachable from every surface there. */}

        {/* Content + AI */}
        <div className="flex flex-1 overflow-hidden">
          {/* overflow-x-hidden is the app-wide sideways-scroll containment:
              a page that overflows scrolls its own wide element, it does
              not drag the whole shell sideways. */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
            {/* Unmissable while previewing another role — the old tiny
                footer label let an override go unnoticed for days. */}
            {actualRole === 'ADMIN' && viewAsRole && (
              <div className="mb-3 flex items-center gap-2 md:gap-3 flex-wrap rounded-lg border border-amber-400 bg-amber-50 px-3 py-2">
                <span className="text-[12px] font-bold text-amber-900">
                  Previewing as {ROLE_LABELS[viewAsRole] || viewAsRole}
                </span>
                <span className="hidden sm:inline text-[11px] text-amber-800">
                  Nav, pages, and data render as that role sees them. Clears when you close the browser.
                </span>
                <button
                  onClick={() => {
                    writeViewAsCookie(null);
                    window.location.reload();
                  }}
                  className="ml-auto text-[11px] font-bold px-2.5 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white"
                >
                  Back to Admin
                </button>
              </div>
            )}
            {children}
          </main>
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
