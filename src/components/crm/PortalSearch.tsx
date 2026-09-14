'use client'

/**
 * Search across whichever Portals pane is showing.
 *
 * Wes 2026-09-14: "need a search field at the top of this, so I don't have
 * to scroll to find job names and job portals." The Jobs pane alone runs 68
 * rows deep, so finding one show was a scroll hunt.
 *
 * The panes are server-rendered, so the filter can't live inside them. The
 * page hands each list its rows as {key, text, node}: `text` is the haystack
 * (job name + code + client + order numbers + the people on it), `node` is
 * the same server-rendered row the pane would have rendered anyway. The
 * query arrives by context from the field in PortalsTabs, so the one input
 * filters whichever pane is open.
 */

import { createContext, Fragment, useContext, type ReactNode } from 'react'

const PortalQueryContext = createContext('')

export function PortalSearchProvider({ query, children }: { query: string; children: ReactNode }) {
  return <PortalQueryContext.Provider value={query}>{children}</PortalQueryContext.Provider>
}

/** Every whitespace-separated token must appear — "casiopea toboggan" works. */
export function matchesQuery(text: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const hay = text.toLowerCase()
  return tokens.every((t) => hay.includes(t))
}

export interface PortalSearchItem {
  key: string
  /** Everything someone might type to find this row. */
  text: string
  node: ReactNode
}

export function PortalFilterList({
  items,
  className,
  empty,
  noun,
}: {
  items: PortalSearchItem[]
  className?: string
  /** Shown when the pane itself is empty — nothing to do with the search. */
  empty: ReactNode
  /** "job portal" → No job portal matches "x". */
  noun: string
}) {
  const query = useContext(PortalQueryContext)
  if (items.length === 0) return <>{empty}</>

  const shown = items.filter((i) => matchesQuery(i.text, query))
  if (shown.length === 0) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
        <p className="text-sm text-lt-fg2">
          No {noun} matches <span className="font-semibold text-lt-fg">{query}</span>.
        </p>
      </div>
    )
  }
  return (
    <div className={className}>
      {/* Fragment, not a wrapper div: the lists style their rows with
          divide-y / space-y, which a wrapper element would silently break. */}
      {shown.map((i) => (
        <Fragment key={i.key}>{i.node}</Fragment>
      ))}
    </div>
  )
}
