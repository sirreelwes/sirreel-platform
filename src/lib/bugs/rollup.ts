/**
 * The aggregate view: everything open, grouped by the part of HQ it lives
 * in.
 *
 * Wes 2026-09-19: "we should also have an aggregation ability to look at
 * all bugs and be able to send that to Claude and push a fix for that."
 *
 * A flat list of thirty improvements is thirty decisions. Grouped by area
 * it is usually four or five, and the groups are the useful unit of work —
 * seven things wrong with Jobs/Orders are far better fixed in one pass by
 * someone already in that code than one at a time across a week.
 *
 * Areas are written by the triage agent in free text, so they are
 * normalised here rather than trusted: "Jobs / Orders", "jobs/orders" and
 * "Jobs / orders" are one group.
 */

import type { BugKind, BugSeverity } from '@prisma/client'
import { SEVERITY_RANK } from '@/lib/bugs/vocab'

export interface RollupInput {
  id: string
  area: string | null
  severity: BugSeverity
  kind: BugKind
  duplicateCount: number
}

export interface AreaGroup {
  area: string
  ids: string[]
  count: number
  /** How many separate people are waiting on this group. */
  people: number
  worst: BugSeverity
  /** True when something in here is blocking someone right now. */
  blocking: boolean
}

/** "Jobs / Orders" and "jobs/orders" are the same place. */
export function normalizeArea(raw: string | null): string {
  const a = (raw ?? '').trim()
  if (!a) return 'Unsorted'
  return a
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' / ')
}

export function rollupByArea(rows: RollupInput[]): AreaGroup[] {
  const byArea = new Map<string, AreaGroup>()
  for (const r of rows) {
    const area = normalizeArea(r.area)
    const g = byArea.get(area) ?? {
      area, ids: [], count: 0, people: 0, worst: 'LOW' as BugSeverity, blocking: false,
    }
    g.ids.push(r.id)
    g.count += 1
    g.people += 1 + r.duplicateCount
    if (SEVERITY_RANK[r.severity] < SEVERITY_RANK[g.worst]) g.worst = r.severity
    if (r.severity === 'BLOCKER') g.blocking = true
    byArea.set(area, g)
  }
  // Worst first, then the biggest pile — that is the order you would work
  // them in, so it is the order they are listed in.
  return [...byArea.values()].sort((a, b) => {
    const rank = SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst]
    if (rank !== 0) return rank
    return b.count - a.count
  })
}
