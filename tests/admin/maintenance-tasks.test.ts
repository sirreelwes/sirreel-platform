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
 *   · NO TASK CHANGES SCHEMA except a `schema` task, and that one may only
 *     carry CREATE … IF NOT EXISTS statements (`isAdditiveStatement`) —
 *     this catches anyone smuggling an ALTER or a DROP in behind the one
 *     door that was opened for brand-new tables;
 *   · every task says what it writes and names its CLI equivalent, so the
 *     two entry points can never drift apart unnoticed;
 *   · declared params are the only ones the route will forward, so each
 *     needs a key and a label.
 *
 * Run: npm run test:maintenance-tasks
 */
import { MAINTENANCE_TASKS, maintenanceTask, MAINTENANCE_RUN_ACTION } from '@/lib/admin/maintenanceTasks'
import { maintenanceRunner, runnableIds } from '@/lib/admin/maintenanceRunners'
import { isAdditiveStatement } from '@/lib/admin/additiveDdl'
import { NEGOTIATED_AGREEMENTS } from '@/lib/contracts/negotiatedAgreement'

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

// No migrations behind a phone button — except additive CREATEs, and only those.
yes('every category is a known one', MAINTENANCE_TASKS.every((t) => t.category === 'seed' || t.category === 'backfill' || t.category === 'schema'))
const nonSchema = MAINTENANCE_TASKS.filter((t) => t.category !== 'schema')
const schema = MAINTENANCE_TASKS.filter((t) => t.category === 'schema')
const prose = nonSchema.map((t) => `${t.title} ${t.summary} ${t.writes}`).join(' ')
yes('no seed/backfill advertises DDL', !/\bALTER\b|\bCREATE TABLE\b|\bDROP\b|add-.*-columns/i.test(prose))
yes('only a schema task carries statements', nonSchema.every((t) => t.ddl === undefined))
yes('every schema task carries statements', schema.every((t) => (t.ddl?.statements.length ?? 0) > 0 && (t.ddl?.tables.length ?? 0) > 0))
yes('every schema statement is CREATE … IF NOT EXISTS', schema.every((t) => t.ddl!.statements.every(isAdditiveStatement)))
yes('every schema statement names a table the task declares', schema.every((t) =>
  t.ddl!.statements.every((sql) => t.ddl!.tables.some((tbl) => sql.includes(`"${tbl}"`)))))

// The gate itself, both directions.
yes('gate: CREATE TABLE IF NOT EXISTS passes', isAdditiveStatement('CREATE TABLE IF NOT EXISTS "x" ("id" TEXT NOT NULL)'))
yes('gate: CREATE UNIQUE INDEX IF NOT EXISTS passes', isAdditiveStatement('CREATE UNIQUE INDEX IF NOT EXISTS "x_key" ON "x" ("id")'))
yes('gate: CREATE TABLE without IF NOT EXISTS is refused', !isAdditiveStatement('CREATE TABLE "x" ("id" TEXT)'))
yes('gate: ALTER is refused', !isAdditiveStatement('ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" TEXT'))
yes('gate: DROP is refused', !isAdditiveStatement('DROP TABLE IF EXISTS "x"'))
yes('gate: a CREATE hiding a DROP is refused', !isAdditiveStatement('CREATE TABLE IF NOT EXISTS "x" ("id" TEXT); DROP TABLE "y"'))
yes('gate: a CREATE hiding an UPDATE is refused', !isAdditiveStatement('CREATE INDEX IF NOT EXISTS "i" ON "x" ("id"); UPDATE "x" SET "id" = 1'))

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

// The "file a negotiated agreement" picker lists agreement KEYS, and the
// registry of agreements lives somewhere else entirely. Both directions are
// pinned: an offered key with no agreement behind it is a button that refuses
// when pressed, and a negotiated document missing from the picker is one
// nobody can file without a laptop — which is the whole point of the page.
const filing = maintenanceTask('file-negotiated-agreement')
const keyParam = (filing?.params ?? []).find((p) => p.key === 'key')
yes('the filing task offers a key picker', (keyParam?.options?.length ?? 0) > 0)
eq(
  'every offered key is a known negotiated agreement',
  (keyParam?.options ?? []).filter((k) => !NEGOTIATED_AGREEMENTS.some((a) => a.key === k)),
  [],
)
eq(
  'every negotiated agreement is offered',
  NEGOTIATED_AGREEMENTS.map((a) => a.key).filter((k) => !(keyParam?.options ?? []).includes(k)),
  [],
)

// The audit action is a stable string — old rows are read by it.
eq('audit action', MAINTENANCE_RUN_ACTION, 'admin.maintenance_run')

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
