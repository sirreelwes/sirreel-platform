'use client';

/**
 * The phone shell: a slim top bar plus a left-edge navigation sheet.
 *
 * WHY A SHEET AND NOT A BOTTOM TAB BAR — the nav is role-branched and
 * runs to eight sections / 44 items for an admin. Five tabs cannot
 * carry that, so a tab bar would need a hand-picked item set per role
 * and would still bury the rest behind a "More" that is a sheet
 * anyway. The sheet renders `getNavSections()` verbatim through the
 * shared NavList, which means nav stays ONE code path on both
 * viewports and a new nav entry appears on phones for free.
 *
 * The two things that must not hide behind the hamburger:
 *   - the Action Items unhandled count — mirrored onto the hamburger
 *     as a badge, so the number is legible with the sheet shut;
 *   - "+ New Job" — the app's single create entry point, which as of
 *     2026-08-28 lives only in the /jobs toolbar. On a phone that
 *     toolbar yields the viewport whenever a job is selected, so the
 *     bar carries its own launcher.
 *
 * Desktop is untouched: everything here is `md:hidden`.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserRole } from '@prisma/client';
import type { NavSection } from '@/lib/permissions';
import { NavList } from '@/components/shell/NavList';
import { UserMenu } from '@/components/shell/UserMenu';
import { NewJobLauncher } from '@/components/jobs/NewJobLauncher';

export function MobileNav({
  sections,
  activeHref,
  role,
  actualRole,
  viewAsRole,
  actionItemCount,
  user,
  canCreateJob,
}: {
  sections: NavSection[];
  activeHref: string | null;
  role: UserRole;
  actualRole: UserRole;
  viewAsRole: UserRole | null;
  actionItemCount: number;
  user: { name?: string | null; email?: string | null; image?: string | null };
  canCreateJob: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on navigation — a Link inside the sheet also calls
  // onNavigate, but this catches Back/Forward and redirects too.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Top bar — the only chrome on a phone. */}
      <header className="md:hidden flex-shrink-0 flex items-center gap-2 h-14 px-2 bg-[#1a1a1a] text-white border-b border-white/10">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="relative w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/[0.15]"
        >
          <span aria-hidden="true" className="flex flex-col gap-[5px]">
            <span className="block w-5 h-[2px] rounded-full bg-white" />
            <span className="block w-5 h-[2px] rounded-full bg-white" />
            <span className="block w-5 h-[2px] rounded-full bg-white" />
          </span>
          {actionItemCount > 0 && (
            <span className="absolute top-1 right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
              {actionItemCount > 99 ? '99+' : actionItemCount}
            </span>
          )}
        </button>

        <Link href="/" className="flex items-center gap-2 min-w-0">
          <img src="/s-logo-white.png" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0 object-contain" />
          <span className="font-bold text-[14px] tracking-tight truncate">SirReel HQ</span>
        </Link>

        {canCreateJob && (
          <NewJobLauncher buttonClassName="ml-auto flex-shrink-0 bg-[#c9a24b] hover:bg-[#d8b263] text-[#1a1a1a] text-[12px] font-bold px-3 min-h-[38px] rounded-lg" />
        )}
      </header>

      {/* Sheet */}
      {open && (
        <div className="md:hidden fixed inset-0 z-[100] flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative w-[82vw] max-w-[320px] bg-[#1a1a1a] text-slate-200 flex flex-col shadow-2xl"
            role="dialog"
            aria-label="Navigation"
          >
            <div className="flex items-center gap-2.5 px-4 h-14 flex-shrink-0 border-b border-white/10">
              <img src="/s-logo-white.png" alt="" aria-hidden="true" className="w-8 h-8 flex-shrink-0 object-contain" />
              <div className="leading-tight flex-1 min-w-0">
                <div className="font-bold text-[15px] text-white tracking-tight">SirReel</div>
                <div className="text-[8px] font-semibold text-[#c9a24b]/80 tracking-[0.22em] uppercase">SirReel HQ</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-2 overscroll-contain">
              <NavList
                sections={sections}
                activeHref={activeHref}
                role={role}
                actionItemCount={actionItemCount}
                onNavigate={() => setOpen(false)}
                touch
              />
            </nav>

            <div className="border-t border-white/10 p-3 flex-shrink-0">
              <UserMenu
                user={user}
                role={role}
                actualRole={actualRole}
                viewAsRole={viewAsRole}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
