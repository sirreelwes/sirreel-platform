/**
 * Resumable paged pull from RentalWorks.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * RW's list endpoints get slower the deeper you page. Measured on the
 * quote endpoint 2026-09-03: 4.8s for page 1, 17.5s by page 6, 31s by
 * page 14 — 331.9s for the full 15 pages. The function ceiling is 300s.
 *
 * The old shape (pull everything into memory, then swap the table in one
 * transaction) cannot survive that: the process is killed mid-await, so
 * nothing commits AND nothing is logged, because the `catch` never runs
 * either. That is precisely how the quote mirror sat frozen from
 * 2026-08-22 to 2026-09-03 while the invoice mirror beside it stayed
 * current — the failure had no symptom at all.
 *
 * It is also not a problem that shrinks. Every quote RW gains makes the
 * pull longer, so a bigger `maxDuration` only buys months.
 *
 * ── The shape instead ──────────────────────────────────────────────
 *
 * Commit each page as it lands, stamped with the cycle's start time, and
 * persist a resume point. A run that reaches its time budget stops
 * CLEANLY and returns; the next run continues from that page. The mirror
 * is therefore never empty and never partial-looking — it holds a mix of
 * this cycle's rows and the previous cycle's until the cycle closes.
 *
 * Deletion only happens once a cycle actually completes: rows whose
 * `syncedAt` predates the cycle are gone from RW. That sweep is the one
 * destructive step here, and it is guarded (see SWEEP_FLOOR below).
 *
 * ── What a caller supplies ─────────────────────────────────────────
 *
 * `fetchPage` returns this page's rows and whether it was the last one.
 * `commitPage` writes them with the cycle stamp. `sweep` removes rows the
 * cycle never saw. `countExisting` backs the sweep guard.
 */

import { prisma } from '@/lib/prisma'
import { isRwAuthError } from '@/lib/rentalworks/rwClient'

/**
 * A completed cycle that pulled less than this fraction of what the
 * mirror already held is treated as suspect and does NOT sweep.
 *
 * Resumption is the reason. Pages are numbered, not keyed, so if RW
 * reorders rows between two runs of the same cycle a row can fall
 * through the seam and never get re-stamped. Duplicates are harmless
 * (upsert by id), but a missed row would be swept as "deleted in RW"
 * when it is nothing of the sort. A wholesale drop is the observable
 * symptom of that, so refuse to delete on one and say so.
 */
const SWEEP_FLOOR = 0.5

export interface PagedSyncSpec<T> {
  /** Cursor key. One row per mirror in RwSyncCursor. */
  mirror: string
  /** Hard stop on pages, so a broken `last` signal cannot loop forever. */
  maxPages: number
  /**
   * Wall-clock the run may spend fetching, in ms. Set it well below the
   * route's maxDuration: the last page started before the budget expires
   * still has to finish, and RW's slowest observed page is ~47s.
   */
  budgetMs: number
  fetchPage(page: number): Promise<{ rows: T[]; last: boolean }>
  commitPage(rows: T[], cycleStartedAt: Date): Promise<void>
  /** Rows not stamped with this cycle are gone from RW. Returns the count. */
  sweep(cycleStartedAt: Date): Promise<number>
  /** Current mirror size, for the sweep guard. */
  countExisting(): Promise<number>
}

export interface PagedSyncResult {
  ok: boolean
  /** True when this run closed the cycle (reached the last page). */
  complete: boolean
  /** True when this run picked up an unfinished cycle rather than starting one. */
  resumed: boolean
  pagesThisRun: number
  rowsThisRun: number
  rowsThisCycle: number
  /** Page the NEXT run will request. */
  nextPage: number
  swept: number
  elapsedMs: number
  error?: string
}

export async function runPagedSync<T>(spec: PagedSyncSpec<T>): Promise<PagedSyncResult> {
  const startedAt = Date.now()
  const existing = await prisma.rwSyncCursor.findUnique({ where: { mirror: spec.mirror } })

  // An unfinished cycle is resumed so its page numbering and sweep
  // boundary stay coherent; a finished one starts a fresh cycle.
  const resuming = !!existing && existing.completedAt == null
  const cycleStartedAt = resuming ? existing!.cycleStartedAt : new Date()
  let page = resuming ? existing!.nextPage : 1
  let rowsThisCycle = resuming ? existing!.rowsThisCycle : 0

  // Leave a trace BEFORE any page is fetched. A run that Vercel kills at
  // maxDuration executes no catch and no `stop()`, so without this it
  // vanishes without a word — which is exactly how the order mirror froze
  // for two days from 2026-09-03: five scheduled runs, each killed inside
  // page 1, and a cursor that still said nothing had ever run. Every
  // clean exit below overwrites this note; if it is still here the next
  // time anyone looks, the run died.
  const startedNote = `run started ${new Date(startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC at page ${page} — still running, or killed before it could report`
  await prisma.rwSyncCursor.upsert({
    where: { mirror: spec.mirror },
    create: { mirror: spec.mirror, cycleStartedAt, nextPage: page, rowsThisCycle, completedAt: null, lastError: startedNote },
    update: resuming
      ? { lastError: startedNote }
      : { cycleStartedAt, nextPage: 1, rowsThisCycle: 0, completedAt: null, lastError: startedNote },
  })

  let pagesThisRun = 0
  let rowsThisRun = 0
  let complete = false

  const stop = async (error: string | null): Promise<void> => {
    await prisma.rwSyncCursor.update({
      where: { mirror: spec.mirror },
      data: { nextPage: page, rowsThisCycle, lastError: error },
    })
  }

  while (page <= spec.maxPages) {
    // Budget is checked BEFORE starting a page, never mid-flight — a page
    // abandoned halfway would leave the cursor pointing at rows already
    // half-written. Stopping between pages is always consistent.
    if (Date.now() - startedAt > spec.budgetMs) {
      await stop(`budget reached; ${page - 1} pages done, resuming at page ${page}`)
      return {
        ok: true, complete: false, resumed: resuming, pagesThisRun, rowsThisRun,
        rowsThisCycle, nextPage: page, swept: 0, elapsedMs: Date.now() - startedAt,
      }
    }

    let batch: { rows: T[]; last: boolean }
    try {
      batch = await spec.fetchPage(page)
    } catch (e) {
      // A dead credential is not a transient blip and must not be folded
      // into a soft result for a caller to log and move past — that is
      // the swallow this whole module exists to undo. Record and rethrow.
      if (isRwAuthError(e) || (e as Error)?.name === 'RwNoCredentialError') {
        await stop(`auth: ${(e as Error).message}`)
        throw e
      }
      await stop(`page ${page}: ${(e as Error).message}`)
      return {
        ok: false, complete: false, resumed: resuming, pagesThisRun, rowsThisRun,
        rowsThisCycle, nextPage: page, swept: 0, elapsedMs: Date.now() - startedAt,
        error: `page ${page}: ${(e as Error).message}`,
      }
    }

    await spec.commitPage(batch.rows, cycleStartedAt)
    pagesThisRun++
    rowsThisRun += batch.rows.length
    rowsThisCycle += batch.rows.length
    page++
    await prisma.rwSyncCursor.update({
      where: { mirror: spec.mirror },
      data: { nextPage: page, rowsThisCycle, lastError: null },
    })

    if (batch.last) { complete = true; break }
  }

  if (!complete) {
    // Ran out of pages rather than time — the backstop tripped, which
    // means `last` never arrived. Leave the cycle open and say so.
    await stop(`hit maxPages (${spec.maxPages}) without a final page`)
    return {
      ok: false, complete: false, resumed: resuming, pagesThisRun, rowsThisRun,
      rowsThisCycle, nextPage: page, swept: 0, elapsedMs: Date.now() - startedAt,
      error: `hit maxPages (${spec.maxPages}) without a final page`,
    }
  }

  // Cycle closed. Sweep what RW no longer returns — guarded.
  let swept = 0
  let sweepNote: string | null = null
  const before = await spec.countExisting()
  if (before > 0 && rowsThisCycle < before * SWEEP_FLOOR) {
    sweepNote =
      `sweep SKIPPED: cycle pulled ${rowsThisCycle} rows against a mirror of ${before} ` +
      `(under ${SWEEP_FLOOR * 100}%) — refusing to delete on a suspicious drop`
  } else {
    swept = await spec.sweep(cycleStartedAt)
  }

  await prisma.rwSyncCursor.update({
    where: { mirror: spec.mirror },
    data: { nextPage: 1, rowsThisCycle, completedAt: new Date(), lastError: sweepNote },
  })

  return {
    ok: true, complete: true, resumed: resuming, pagesThisRun, rowsThisRun,
    rowsThisCycle, nextPage: 1, swept, elapsedMs: Date.now() - startedAt,
    error: sweepNote ?? undefined,
  }
}
