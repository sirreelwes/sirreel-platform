'use client'

/**
 * Entry point to the dedup queue from the People tab.
 *
 * The queue at /admin/dedup — clustering, side-by-side diff, merge with
 * per-field overrides, one-click reversal — has existed for a while and was
 * reachable from NOWHERE: no nav section listed it and nothing in the app
 * linked to it. It was a finished tool you had to already know the URL of.
 * Meanwhile the duplicates it exists to fix are visible right here, three
 * "Abi Perl" rows deep in the contact list.
 *
 * Deliberately a LINK to the review queue, not a "merge selected" action on
 * the checkboxes beside it. The queue clusters by shared email and shared
 * phone and then classifies — same surname is a dupe candidate, three
 * surnames on one number is an office reception line and must not be merged.
 * A bulk-merge button driven by whatever a rep ticked would route around that
 * judgement entirely, and the rows most likely to be ticked together are
 * exactly the ones that look alike without being the same person.
 *
 * Rendered only for the dedup allowlist. The page can't call the gate (it
 * hits prisma), so the pure allowlist is checked here and ENFORCED again on
 * every route behind it.
 */

import Link from 'next/link'
import { isAllowedDedupEmail } from '@/lib/people/dedupAllowlist'

export function DedupeQueueLink({ viewerEmail }: { viewerEmail: string | null }) {
  if (!isAllowedDedupEmail(viewerEmail)) return null

  return (
    <Link
      href="/admin/dedup"
      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-lt-hairline bg-lt-card text-lt-fg2 hover:border-lt-fg2 hover:text-lt-fg transition-colors inline-flex items-center gap-1.5"
      title="Review contacts that look like the same person — clustered by shared email and phone, merged only after you confirm"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="9" cy="9" r="5" />
        <circle cx="15" cy="15" r="5" />
      </svg>
      Find duplicates
    </Link>
  )
}
