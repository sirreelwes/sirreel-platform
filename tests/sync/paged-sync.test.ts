/**
 * Resumable paged-sync tests.
 *
 *   npx tsx tests/sync/paged-sync.test.ts
 *   npm run test:paged-sync
 *
 * Uses a stubbed RwSyncCursor + fake pages — no RW, no live DB writes.
 *
 * What matters here is what goes WRONG. This machinery exists because an
 * all-or-nothing pull silently lost twelve days of RentalWorks quote data
 * (2026-08-22 → 2026-09-03), so the cases worth pinning are the ones that
 * would lose or destroy data again:
 *
 *   · a run that hits its budget must leave a resume point, not restart
 *   · a resumed cycle must keep the ORIGINAL cycle stamp, or the sweep
 *     deletes everything the first run committed
 *   · a cycle that comes back suspiciously small must NOT sweep — pages
 *     are numbered, not keyed, so a row can slip through the seam between
 *     two runs and would otherwise be deleted as "gone from RW"
 */

import type { PagedSyncSpec } from '../../src/lib/rentalworks/pagedSync'

const failures: string[] = []
function check(cond: boolean, why: string, detail?: unknown): void {
  if (cond) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}${detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`)
    failures.push(why)
  }
}

// ── in-memory stand-in for the RwSyncCursor table ──
interface CursorRow {
  mirror: string
  cycleStartedAt: Date
  nextPage: number
  rowsThisCycle: number
  completedAt: Date | null
  lastError: string | null
}
const cursors = new Map<string, CursorRow>()

const fakePrisma = {
  rwSyncCursor: {
    findUnique: async ({ where }: { where: { mirror: string } }) => cursors.get(where.mirror) ?? null,
    upsert: async ({ where, create, update }: { where: { mirror: string }; create: CursorRow; update: Partial<CursorRow> }) => {
      const cur = cursors.get(where.mirror)
      cursors.set(where.mirror, cur ? { ...cur, ...update } : { ...create })
      return cursors.get(where.mirror)!
    },
    update: async ({ where, data }: { where: { mirror: string }; data: Partial<CursorRow> }) => {
      const cur = cursors.get(where.mirror)!
      cursors.set(where.mirror, { ...cur, ...data })
      return cursors.get(where.mirror)!
    },
  },
}

// Stub the two modules pagedSync imports before loading it.
const Module = require('module')
const origResolve = Module._load
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith('/prisma') || request === '@/lib/prisma') return { prisma: fakePrisma }
  if (request === '@/lib/rentalworks/rwClient') return { isRwAuthError: () => false }
  return origResolve.apply(this, [request, parent, isMain])
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runPagedSync } = require('../../src/lib/rentalworks/pagedSync') as {
  runPagedSync: <T>(s: PagedSyncSpec<T>) => Promise<{
    ok: boolean; complete: boolean; resumed: boolean; pagesThisRun: number
    rowsThisRun: number; rowsThisCycle: number; nextPage: number; swept: number; error?: string
  }>
}
Module._load = origResolve

/** A fake source of `totalPages` pages, each `perPage` rows, optionally slow. */
function source(totalPages: number, perPage: number, msPerPage = 0) {
  const committed: Array<{ page: number; stamp: number }> = []
  let sweptWith: Date | null = null
  return {
    committed,
    get sweptWith() { return sweptWith },
    spec(over: Partial<PagedSyncSpec<number>> = {}): PagedSyncSpec<number> {
      return {
        mirror: 'test',
        maxPages: 50,
        budgetMs: 10_000,
        async fetchPage(page) {
          if (msPerPage) await new Promise((r) => setTimeout(r, msPerPage))
          return { rows: Array.from({ length: perPage }, (_, i) => page * 1000 + i), last: page >= totalPages }
        },
        async commitPage(rows, cycleStartedAt) {
          committed.push({ page: Math.floor(rows[0] / 1000), stamp: cycleStartedAt.getTime() })
        },
        async sweep(cycleStartedAt) { sweptWith = cycleStartedAt; return 7 },
        countExisting: async () => 100,
        ...over,
      }
    },
  }
}

async function main() {
  console.log('\na clean full cycle')
  cursors.clear()
  {
    const s = source(3, 50)
    const r = await runPagedSync(s.spec())
    check(r.ok && r.complete, 'completes when every page fits the budget', r)
    check(r.pagesThisRun === 3, 'pulled all three pages', r.pagesThisRun)
    check(r.rowsThisCycle === 150, 'counted every row', r.rowsThisCycle)
    check(r.swept === 7, 'swept once the cycle closed', r.swept)
    check(cursors.get('test')!.completedAt !== null, 'cursor marked complete')
    check(cursors.get('test')!.nextPage === 1, 'next cycle starts at page 1')
  }

  console.log('\nbudget exhausted mid-pull')
  cursors.clear()
  {
    const s = source(10, 50, 60)
    const r = await runPagedSync(s.spec({ budgetMs: 150 }))
    check(r.ok, 'a budget stop is NOT an error — it is the design', r)
    check(!r.complete, 'cycle left open', r.complete)
    check(r.swept === 0, 'never sweeps on an unfinished cycle — that would delete live rows', r.swept)
    check(s.sweptWith === null, 'sweep not even called')
    check(cursors.get('test')!.completedAt === null, 'cursor left incomplete')
    check(cursors.get('test')!.nextPage > 1, 'resume point recorded', cursors.get('test')!.nextPage)
    check(
      (cursors.get('test')!.lastError ?? '').includes('budget'),
      'says why it stopped, for the freshness alarm to quote',
      cursors.get('test')!.lastError,
    )
  }

  console.log('\nresuming that cycle')
  {
    const before = cursors.get('test')!
    const resumeFrom = before.nextPage
    const stamp = before.cycleStartedAt.getTime()
    const s = source(10, 50)
    const r = await runPagedSync(s.spec({ budgetMs: 10_000 }))
    check(r.resumed, 'recognised an unfinished cycle', r.resumed)
    check(s.committed[0].page === resumeFrom, 'picked up at the recorded page, not page 1', s.committed[0].page)
    check(
      s.committed.every((c) => c.stamp === stamp),
      'kept the ORIGINAL cycle stamp — a new one would make the sweep delete run 1’s rows',
    )
    check(r.complete && r.rowsThisCycle === 500, 'cycle total spans both runs', r.rowsThisCycle)
  }

  console.log('\nthe sweep guard')
  cursors.clear()
  {
    // Cycle returns 100 rows against a mirror of 1000 — a 90% drop.
    const s = source(2, 50)
    const r = await runPagedSync(s.spec({ countExisting: async () => 1000 }))
    check(r.complete, 'cycle still completes', r.complete)
    check(r.swept === 0, 'refuses to sweep on a suspicious drop', r.swept)
    check(s.sweptWith === null, 'sweep never called')
    check((r.error ?? '').includes('sweep SKIPPED'), 'explains the refusal', r.error)
  }
  cursors.clear()
  {
    // 100 rows against 150 — a normal shrink, above the floor.
    const s = source(2, 50)
    const r = await runPagedSync(s.spec({ countExisting: async () => 150 }))
    check(r.swept === 7, 'a normal shrink still sweeps', r.swept)
  }
  cursors.clear()
  {
    // First ever run: empty mirror must not trip the guard.
    const s = source(2, 50)
    const r = await runPagedSync(s.spec({ countExisting: async () => 0 }))
    check(r.swept === 7, 'an empty mirror is not a suspicious drop', r.swept)
  }

  console.log('\na failing page')
  cursors.clear()
  {
    const s = source(5, 50)
    const r = await runPagedSync(
      s.spec({
        async fetchPage(page) {
          if (page === 3) throw new Error('RW HTTP 500')
          return { rows: Array.from({ length: 50 }, (_, i) => page * 1000 + i), last: false }
        },
      }),
    )
    check(!r.ok, 'reports failure', r.ok)
    check(r.swept === 0, 'does not sweep', r.swept)
    check(cursors.get('test')!.nextPage === 3, 'resumes at the page that failed', cursors.get('test')!.nextPage)
    check((cursors.get('test')!.lastError ?? '').includes('500'), 'records the reason', cursors.get('test')!.lastError)
  }

  console.log('\nmaxPages backstop')
  cursors.clear()
  {
    const s = source(999, 10)
    const r = await runPagedSync(s.spec({ maxPages: 4 }))
    check(!r.ok, 'a `last` that never arrives is a failure, not a silent stop', r.ok)
    check(r.swept === 0, 'and must not sweep — the pull is incomplete', r.swept)
  }

  console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
  process.exit(failures.length ? 1 : 0)
}

main()
