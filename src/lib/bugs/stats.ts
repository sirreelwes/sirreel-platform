/**
 * The running tally on the side of the bug board: what people have found,
 * and what has actually been done about it.
 *
 * Wes 2026-09-19: "keep a stat on the side: tiles that show bugs found or
 * fixes you've made in HQ."
 *
 * Every number here is defined once, in this file, because the two halves
 * of the tally are easy to quietly overstate:
 *
 * - "Found" counts REPORTS, not issues. Four people hitting one broken
 *   button is four reports and one thing to fix, and both numbers are
 *   true — the tile says which it is showing rather than picking the
 *   flattering one.
 * - "Fixed" counts only reports a person marked FIXED. It does NOT count
 *   the ones the agent answered and closed, because nothing was repaired
 *   there — those get their own tile. Rolling them together would let the
 *   fix count climb on a week when nothing was actually fixed.
 *
 * Duplicates never count as their own issue anywhere. A report that joined
 * another counts once toward "reports", never toward open work.
 */

import { prisma } from '@/lib/prisma'
import { OPEN_STATUSES } from '@/lib/bugs/vocab'

export interface BugStats {
  /** Every report anyone has sent, duplicates included. */
  reports: number
  /** Reports sent in the last 30 days. */
  reportsRecent: number
  /** Distinct issues — reports that are not a repeat of another. */
  issues: number
  /** Still to do: open or being fixed, duplicates excluded. */
  open: number
  /** Of those, the ones the agent called blocking. */
  openBlocking: number
  /** Marked FIXED by a person. */
  fixed: number
  /** Fixed in the last 30 days. */
  fixedRecent: number
  /** Closed by the agent's own answer — nothing needed repairing. */
  answered: number
  /** Pushed to Wes rather than queued. */
  escalated: number
  /** Median days from report to fixed. Null until 3 have been fixed. */
  medianDaysToFix: number | null
  /**
   * Reports the AGENT decided needed nothing (answered, or folded into
   * another) that no person has looked at yet.
   *
   * Wes 2026-09-19 did not want the AI quietly shutting reports down: if
   * somebody typed, the friction was real. This number is the guard — it
   * is the count of decisions taken without a human, sitting in plain
   * sight until someone agrees with them.
   */
  awaitingGlance: number
}

export const EMPTY_STATS: BugStats = {
  reports: 0, reportsRecent: 0, issues: 0, open: 0, openBlocking: 0,
  fixed: 0, fixedRecent: 0, answered: 0, escalated: 0, medianDaysToFix: null,
  awaitingGlance: 0,
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Never throws: the table arrives by additive SQL, and a board that 500s
 * because a tally could not be computed is worse than a board with no
 * tally. Falls back to zeros, which the tiles render as "nothing yet".
 */
export async function bugStats(): Promise<BugStats> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const notDuplicate = { duplicateOfId: null }

    const [reports, reportsRecent, issues, open, openBlocking, answered, escalated, awaitingGlance, fixedRows] =
      await Promise.all([
        prisma.bugReport.count(),
        prisma.bugReport.count({ where: { createdAt: { gte: since } } }),
        prisma.bugReport.count({ where: notDuplicate }),
        prisma.bugReport.count({ where: { ...notDuplicate, status: { in: OPEN_STATUSES } } }),
        prisma.bugReport.count({
          where: { ...notDuplicate, status: { in: OPEN_STATUSES }, severity: 'BLOCKER' },
        }),
        prisma.bugReport.count({ where: { ...notDuplicate, status: 'ANSWERED' } }),
        prisma.bugReport.count({ where: { ...notDuplicate, routing: 'ESCALATED' } }),
        // Closed by the agent alone. Duplicates count too — being folded
        // into another report is also a decision nobody checked.
        prisma.bugReport.count({
          where: { status: { in: ['ANSWERED', 'DUPLICATE'] }, reviewedAt: null },
        }),
        prisma.bugReport.findMany({
          where: { ...notDuplicate, status: 'FIXED' },
          select: { createdAt: true, resolvedAt: true },
        }),
      ])

    const spans = fixedRows
      .filter((r) => r.resolvedAt)
      .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 86_400_000)
      .filter((d) => d >= 0)

    return {
      reports,
      reportsRecent,
      issues,
      open,
      openBlocking,
      fixed: fixedRows.length,
      fixedRecent: fixedRows.filter((r) => r.resolvedAt && r.resolvedAt >= since).length,
      answered,
      escalated,
      awaitingGlance,
      // Three is the floor for a median that means anything; below that the
      // number is one lucky afternoon, and a tile that says "half a day"
      // on a sample of one is a promise nobody made.
      medianDaysToFix: spans.length >= 3 ? median(spans) : null,
    }
  } catch {
    return EMPTY_STATS
  }
}

/** "4 hours" / "1.5 days" / "3 days" — a span people say out loud. */
export function humanDays(days: number): string {
  if (days < 1 / 24) return 'minutes'
  if (days < 1) {
    const h = Math.round(days * 24)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = days < 10 ? Math.round(days * 10) / 10 : Math.round(days)
  return `${d} day${d === 1 ? '' : 's'}`
}
