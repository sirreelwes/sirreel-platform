/**
 * Job-as-root step 5 — one-shot backfill: resolve every jobId:null
 * Booking into a Job via the SAME module the daily import now uses.
 * DRY-RUN by default; pass --apply to write. Creates Jobs + sets
 * booking.jobId only — deletes nothing.
 */
import { prisma } from '../src/lib/prisma'
import { resolveJobForImportedBooking } from '../src/lib/sync/planyo/resolveJobForBooking'

const APPLY = process.argv.includes('--apply')

function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY-RUN (pass --apply to write) ===')
  const bookings = await prisma.booking.findMany({
    where: { jobId: null },
    orderBy: { startDate: 'asc' },
    select: { id: true, bookingNumber: true, planyoCartId: true, jobName: true, companyId: true },
  })
  console.log(`job-less bookings: ${bookings.length}\n`)

  const buckets: Record<string, number> = {}
  const rows: Array<Awaited<ReturnType<typeof resolveJobForImportedBooking>>> = []
  for (const b of bookings) {
    try {
      const r = await resolveJobForImportedBooking(b.id, { dryRun: !APPLY })
      rows.push(r)
      buckets[r.action] = (buckets[r.action] ?? 0) + 1
      const tag =
        r.action === 'ATTACHED_EXISTING' ? `→ [${r.jobCode}] "${r.jobName}" score=${r.score} (${(r.reasons ?? []).join(' | ')})`
        : r.action === 'CREATED_NEW' ? `→ would create "${r.jobName}"`
        : r.action === 'ATTACHED_AMBIGUOUS' ? `→ BEST [${r.jobCode}] "${r.jobName}" score=${r.score} AMBIGUOUS vs ${(r.candidates ?? []).slice(1).map(c => `[${c.jobCode}](${c.score})`).join(', ')}`
        : r.action === 'CREATED_NEW_SIBLING' ? `→ created NEW "${r.jobName}" — possible sibling of ${(r.candidates ?? []).map(c => `[${c.jobCode}] "${c.name}"(${c.score})`).join(', ')}`
        : ''
      console.log(`${r.action.padEnd(19)} ${b.bookingNumber} cart=${b.planyoCartId ?? '—'} · ${r.companyName ?? '?'} · "${b.jobName}" ${tag}`)
    } catch (e) {
      buckets.ERROR = (buckets.ERROR ?? 0) + 1
      console.log(`ERROR               ${b.bookingNumber} — ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`)

  if (!APPLY) {
    // Dry-run can't see cross-booking convergence (nothing is created),
    // so estimate: CREATED_NEW rows sharing (companyId, loose jobName)
    // would converge onto one Job in apply mode via resolver rung ③+⑤.
    const creates = rows
      .map((r, i) => ({ r, b: bookings[i] }))
      .filter((x) => x.r.action === 'CREATED_NEW')
    const groups = new Set(creates.map((x) => `${x.b.companyId ?? '?'}::${looseKey(x.b.jobName || '')}`))
    console.log(`  (apply-mode estimate: ${creates.length} creates converge to ~${groups.size} distinct Jobs — same-company same-name carts merge via the resolver)`)
  }
}
main().finally(() => prisma.$disconnect())
