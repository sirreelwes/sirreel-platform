'use client'

/**
 * /jobs is a split surface: a persistent dark index on the left, the
 * selected job's detail on the right.
 *
 * The list is in the LAYOUT rather than the page so that clicking
 * from one job to the next swaps only the right panel — the list
 * keeps its fetched rows, filter, and scroll position, and the URL
 * stays the real selection (deep links and Back still work).
 *
 * The shell's <main> owns the page padding; the split needs the full
 * bleed, so it cancels the p-4 and grows back the height it took.
 */

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { JobsListProvider } from '@/components/jobs/JobsListProvider'
import { JobsSidebar } from '@/components/jobs/JobsSidebar'

function JobsSplit({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Below `md` there isn't room for both panes, so the URL picks one:
  // /jobs is the list, /jobs/[id] is the detail — and /jobs?panel=incoming
  // is the landing workspace (the sidebar's Incoming strip links there),
  // which claims the viewport the same way a detail does.
  const selected =
    (!!pathname && pathname.startsWith('/jobs/')) || searchParams?.get('panel') === 'incoming'

  return (
    <JobsListProvider>
      <div className="-m-4 h-[calc(100%+2rem)] flex overflow-hidden">
        <JobsSidebar />
        <div className={`${selected ? 'block' : 'hidden md:block'} flex-1 min-w-0 overflow-y-auto p-4`}>
          {children}
        </div>
      </div>
    </JobsListProvider>
  )
}

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <JobsSplit>{children}</JobsSplit>
    </Suspense>
  )
}
