/**
 * Maintenance tasks — the registry behind /admin/maintenance (2026-09-16,
 * so Wes can run a seed from an iPad).
 *
 * The safety of this feature is almost entirely in the registry's shape, so
 * that is what is asserted:
 *
 *   · ids are unique and URL-safe — they are a path segment AND the
 *     entityId on the audit row;
 *   · every registered task has a runner and every runner is registered —
 *     a runner with no metadata is an undocumented endpoint, and metadata
 *     with no runner is a button that 404s;
 *   · `maintenanceRunner` refuses an id that is not in the registry, which
 *     is the allowlist itself;
 *   · NO TASK CHANGES SCHEMA. `category` has no DDL member on purpose; this
 *     catches anyone widening it and quietly adding a migration button;
 *   · every task says what it writes and names its CLI equivalent, so the
 *     two entry points can never drift apart unnoticed;
 *   · declared params are the only ones the route will forward, so each
 *     needs a key and a label.
 *
 * Run: npm run test:maintenance-tasks
 */
import { MAINTENANCE_TASKS, maintenanceTask, MAINTENANCE_RUN_ACTION } from '@/lib/admin/maintenanceTasks'
import { maintenanceRunner, runnableIds } from '@/lib/admin/maintenanceRunners'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const ids = MAINTENANCE_TASKS.map((t) => t.id)
yes('there is at least one task', MAINTENANCE_TASKS.length > 0)
eq('ids unique', new Set(ids).size, ids.length)
yes('ids are url-safe path segments', ids.every((i) => /^[a-z0-9-]+$/.test(i)))

// The allowlist, both directions.
yes('every task has a runner', ids.every((i) => maintenanceRunner(i) !== null))
eq('every runner is a registered task', runnableIds().filter((i) => !ids.includes(i)), [])
eq('an unregistered id resolves to nothing', maintenanceRunner('rm-rf-slash'), null)
eq('an empty id resolves to nothing', maintenanceRunner(''), null)
// The id is a lookup key, never a path — a traversal attempt is simply absent
// from the registry, which is what makes this safe rather than sanitized.
eq('a traversal id resolves to nothing', maintenanceRunner('../../etc/passwd'), null)
eq('lookup by id round-trips', maintenanceTask(ids[0])?.id, ids[0])
eq('unknown lookup is null', maintenanceTask('nope'), null)

// No migrations behind a phone button.
yes('no task changes schema', MAINTENANCE_TASKS.every((t) => t.category === 'seed' || t.category === 'backfill'))
const prose = MAINTENANCE_TASKS.map((t) => `${t.title} ${t.summary} ${t.writes}`).join(' ')
yes('no task advertises DDL', !/\bALTER\b|\bCREATE TABLE\b|\bDROP\b|add-.*-columns/i.test(prose))

for (const t of MAINTENANCE_TASKS) {
  yes(`${t.id}: has a title`, t.title.length > 5)
  yes(`${t.id}: summarised in one line`, t.summary.length > 20 && !t.summary.includes('\n'))
  yes(`${t.id}: explains itself`, t.detail.length > 80)
  yes(`${t.id}: names what it writes`, t.writes.length > 5)
  yes(`${t.id}: names its CLI equivalent`, /^npx tsx scripts\//.test(t.cliEquivalent))
  const params = t.params ?? []
  eq(`${t.id}: param keys unique`, new Set(params.map((p) => p.key)).size, params.length)
  yes(`${t.id}: every param has a label`, params.every((p) => p.key.length > 0 && p.label.length > 2))
  yes(`${t.id}: option lists are non-empty`, params.every((p) => !p.options || p.options.length > 0))
  // A pre-filled value is submitted as typed, so it has to be plausible on
  // its face — a malformed default is worse than an empty box.
  yes(
    `${t.id}: any pre-filled email is well-formed`,
    params.every((p) => !(p.key === 'email' && p.defaultValue) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.defaultValue!)),
  )
  yes(`${t.id}: a default matching an option list is in it`, params.every((p) => !p.options || !p.defaultValue || p.options.includes(p.defaultValue)))
}

// The audit action is a stable string — old rows are read by it.
eq('audit action', MAINTENANCE_RUN_ACTION, 'admin.maintenance_run')

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
