/**
 * The local end of the bug hand-off: pull whatever Wes queued on
 * /admin/bugs and print it as a work order for Claude Code.
 *
 * HQ runs on Vercel and Claude Code runs on this Mac, so the board cannot
 * start a session here. It queues; this collects. Reads the same database
 * the app writes, through the DATABASE_URL already in .env.local — no new
 * auth, no token to leak.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/fix-queue.ts                 # the newest batch Wes handed over
 *   npx tsx scripts/fix-queue.ts --batch <id>    # a specific one
 *   npx tsx scripts/fix-queue.ts --open          # everything open, batch or not
 *   npx tsx scripts/fix-queue.ts --done <report id> --note "what you did"
 *
 * `/fix-bugs` in Claude Code runs the first form and works what it prints.
 */
import { prisma } from '../src/lib/prisma'
import { composeFixBrief, type BriefReport } from '../src/lib/bugs/fixBrief'
import { SEVERITY_RANK, OPEN_STATUSES } from '../src/lib/bugs/vocab'

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function markDone(id: string, note: string | null) {
  const existing = await prisma.bugReport.findUnique({ where: { id } })
  if (!existing) {
    console.error(`No report ${id}.`)
    process.exit(1)
  }
  await prisma.bugReport.update({
    where: { id },
    data: {
      status: 'FIXED',
      resolvedAt: new Date(),
      resolvedByEmail: 'claude-code',
      resolutionNote: note ?? existing.resolutionNote,
    },
  })
  console.log(`✓ ${existing.title ?? id} marked FIXED${note ? ` — ${note}` : ''}`)
}

async function main() {
  const doneId = arg('--done')
  if (doneId) return markDone(doneId, arg('--note'))

  const wantOpen = process.argv.includes('--open')
  const batch = arg('--batch')

  let batchId = batch
  if (!batchId && !wantOpen) {
    const newest = await prisma.bugReport.findFirst({
      where: { fixBatchId: { not: null }, status: 'IN_PROGRESS' },
      orderBy: { queuedForFixAt: 'desc' },
      select: { fixBatchId: true },
    })
    batchId = newest?.fixBatchId ?? null
    if (!batchId) {
      console.log(
        'Nothing has been handed over yet.\n\n' +
          'Tick the issues you want on https://hq.sirreel.com/admin/bugs and press\n' +
          '"Hand to Claude", then run this again. Or pass --open to take everything\n' +
          'that is currently open.',
      )
      return
    }
  }

  const rows = await prisma.bugReport.findMany({
    where: wantOpen
      ? { duplicateOfId: null, status: { in: OPEN_STATUSES } }
      : { fixBatchId: batchId! },
    include: { _count: { select: { duplicates: true } } },
  })
  if (rows.length === 0) {
    console.log('Nothing in that batch.')
    return
  }

  const ordered: BriefReport[] = rows
    .map((r) => ({ ...r, duplicateCount: r._count.duplicates }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  console.log(composeFixBrief(ordered, batchId ?? 'everything currently open'))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
