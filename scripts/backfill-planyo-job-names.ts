/**
 * Clear the `Planyo import — cart <id>` placeholder out of the book.
 *
 * ── Why ────────────────────────────────────────────────────────────
 *
 * Wes, 2026-09-03: "A lot of the jobs being imported into HQ have the
 * name Planyo and some went to clients with that name."
 *
 * The cart importer minted that string whenever a Planyo cart carried
 * no `Job_Name` property, and `Booking.jobName` is the HEADLINE on the
 * client paperwork portal. On 2026-09-02 a portal went to a real client
 * (Supplying Demand Inc) titled with our cart id — while a human had
 * already renamed that job "Retirement" in HQ, which did nothing,
 * because `Job.name` and `Booking.jobName` are separate columns and
 * nothing synced them.
 *
 * ── What this does ─────────────────────────────────────────────────
 *
 * For every Booking and Job still carrying the placeholder:
 *
 *   1. Planyo's real `Job_Name`, fetched per reservation via
 *      `get_reservation_data`. The bulk `list_reservations` pull caps
 *      out and silently drops carts, so this probes the mirror's own
 *      reservation ids instead — 12 of 43 recovered that way.
 *   2. Else the parent Job's name, when a human already renamed it.
 *      This is the Supplying Demand case.
 *   3. Else EMPTY STRING — HQ's existing "not named yet" convention
 *      (lib/scheduling/infoGaps). Not the company name: inventing a
 *      second plausible-looking name is what caused this in the first
 *      place. Client surfaces fall back to the company through
 *      lib/jobs/displayName, and the blank makes the gap visible to
 *      staff so someone fills it in.
 *
 * `Job.name` is NOT NULL and is a human-owned field, so a Job with no
 * recoverable name takes the company name rather than a blank.
 *
 * ── Reversal ───────────────────────────────────────────────────────
 *
 * Every row is captured BY ID with its before/after to
 * journals/planyo-job-names-*.json, plus one AuditLog row each
 * (`booking.planyo_name_backfill` / `job.planyo_name_backfill`).
 * Nothing is deleted and nothing is matched by pattern at write time —
 * the updates run against captured ids only.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   export PLANYO_API_KEY=... PLANYO_SITE_ID=...
 *   npx tsx scripts/backfill-planyo-job-names.ts            # dry run
 *   npx tsx scripts/backfill-planyo-job-names.ts --apply
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'
import { getReservationData } from '../src/lib/sync/planyo/planyoClient'
import { isPlaceholderJobName } from '../src/lib/jobs/displayName'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const OPERATOR_EMAIL = 'wes@sirreel.com'

interface Change {
  kind: 'booking' | 'job'
  id: string
  ref: string
  company: string | null
  before: string
  after: string
  source: 'planyo' | 'job-rename' | 'company' | 'cleared'
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===\n')

  const operator = await prisma.user.findFirst({ where: { email: OPERATOR_EMAIL }, select: { id: true } })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const changes: Change[] = []

  // ── Bookings ──
  const bookings = await prisma.booking.findMany({
    where: { jobName: { contains: 'Planyo import', mode: 'insensitive' } },
    select: {
      id: true, bookingNumber: true, jobName: true, planyoCartId: true,
      company: { select: { name: true } },
      job: { select: { id: true, name: true } },
      reservations: { select: { planyoReservationId: true } },
    },
    orderBy: { startDate: 'asc' },
  })
  console.log(`Bookings carrying the placeholder: ${bookings.length}`)

  for (const b of bookings) {
    if (!isPlaceholderJobName(b.jobName)) continue

    // 1. Planyo's own Job_Name, probed per reservation.
    let planyoName = ''
    for (const r of b.reservations) {
      if (!r.planyoReservationId) continue
      const d = await getReservationData(r.planyoReservationId)
      if (!d.ok) continue
      const props = (d.data.properties ?? {}) as Record<string, string | undefined>
      const n = String(props.Job_Name ?? '').trim()
      if (n) { planyoName = n; break }
    }

    let after = ''
    let source: Change['source'] = 'cleared'
    if (planyoName) {
      after = planyoName
      source = 'planyo'
    } else if (b.job && !isPlaceholderJobName(b.job.name)) {
      // 2. A human already renamed the parent job — adopt it.
      after = b.job.name.trim()
      source = 'job-rename'
    }

    changes.push({
      kind: 'booking', id: b.id, ref: b.bookingNumber,
      company: b.company?.name ?? null,
      before: b.jobName, after, source,
    })
  }

  // ── Jobs ──
  const jobs = await prisma.job.findMany({
    where: { name: { contains: 'Planyo import', mode: 'insensitive' } },
    select: {
      id: true, jobCode: true, name: true,
      company: { select: { name: true } },
      bookings: { select: { jobName: true } },
    },
  })
  console.log(`Jobs carrying the placeholder:     ${jobs.length}\n`)

  for (const j of jobs) {
    if (!isPlaceholderJobName(j.name)) continue
    // Prefer a real name recovered onto one of this job's bookings in
    // the pass above — same cart, same show.
    const fromBooking = changes.find(
      (c) => c.kind === 'booking' && c.after && bookingBelongsTo(c.id, j.id, bookings),
    )?.after
    const after = fromBooking || j.company?.name?.trim() || ''
    if (!after) {
      console.log(`  SKIP ${j.jobCode} — no Planyo name and no company to fall back to`)
      continue
    }
    changes.push({
      kind: 'job', id: j.id, ref: j.jobCode,
      company: j.company?.name ?? null,
      before: j.name, after,
      source: fromBooking ? 'planyo' : 'company',
    })
  }

  const named = changes.filter((c) => c.source === 'planyo' || c.source === 'job-rename')
  const cleared = changes.filter((c) => c.source === 'cleared')
  const byCompany = changes.filter((c) => c.source === 'company')

  console.log('── recovered a real name ──')
  for (const c of named) console.log(`  ${c.kind.padEnd(7)} ${c.ref.padEnd(18)} "${c.before}"  →  "${c.after}"   [${c.source}]`)
  console.log('\n── Job renamed to the company (Job.name is NOT NULL) ──')
  for (const c of byCompany) console.log(`  ${c.kind.padEnd(7)} ${c.ref.padEnd(18)} →  "${c.after}"`)
  console.log('\n── cleared to "" (not named yet — needs a human) ──')
  for (const c of cleared) console.log(`  ${c.kind.padEnd(7)} ${c.ref.padEnd(18)} co="${c.company ?? '-'}"`)

  console.log(`\nTotal: ${changes.length}  (real name ${named.length}, company ${byCompany.length}, cleared ${cleared.length})`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write.')
    return
  }
  if (!changes.length) {
    console.log('\nNothing to change.')
    return
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/planyo-job-names-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ changedIds: changes.map((c) => c.id), changes }, null, 2))

  for (const c of changes) {
    if (c.kind === 'booking') {
      await prisma.booking.update({ where: { id: c.id }, data: { jobName: c.after } })
    } else {
      await prisma.job.update({ where: { id: c.id }, data: { name: c.after } })
    }
  }

  await prisma.auditLog.createMany({
    data: changes.map((c) => ({
      action: c.kind === 'booking' ? 'booking.planyo_name_backfill' : 'job.planyo_name_backfill',
      entityType: c.kind === 'booking' ? 'Booking' : 'Job',
      entityId: c.id,
      userId: operator.id,
      oldValues: { name: c.before },
      newValues: { name: c.after, source: c.source },
    })),
  }).catch((err) => console.error('[audit] write failed (changes stand):', err))

  console.log(`\nUpdated ${changes.length} rows.`)
  console.log(`Reversal list: ${path} — restore the "before" value BY THOSE IDS to undo.`)
}

/** Does booking id `bId` hang off job `jobId`? Answered from the list
 *  already in memory rather than a second query per job. */
function bookingBelongsTo(
  bId: string,
  jobId: string,
  bookings: { id: string; job: { id: string } | null }[],
): boolean {
  return bookings.some((b) => b.id === bId && b.job?.id === jobId)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
