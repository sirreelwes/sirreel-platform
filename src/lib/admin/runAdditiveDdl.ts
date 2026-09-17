/**
 * Run an `AdditiveDdl` against the live database — the server half.
 *
 * Refuses (TaskRefused) before touching anything if a statement fails
 * `isAdditiveStatement`; the registry test guards the same thing at build
 * time, this guards it at run time. A dry run only reads
 * information_schema and says which tables exist and which would be
 * created. A real run executes the statements in order and re-reads the
 * catalog, so the log ends with the columns each table actually has —
 * which is how a phone screen proves the run took.
 */
import { prisma } from '@/lib/prisma'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { isAdditiveStatement, statementHeadline, type AdditiveDdl } from '@/lib/admin/additiveDdl'

export interface AdditiveDdlResult {
  log: string[]
  /** Tables already present before the run. */
  existedBefore: string[]
  /** Tables the run created (empty on a dry run). */
  created: string[]
  /** Tables still absent after the run — non-empty means a statement did not do what it says. */
  missingAfter: string[]
}

async function existingTables(names: readonly string[]): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [...names],
  )
  return names.filter((n) => rows.some((r) => r.table_name === n))
}

async function columnsOf(table: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    table,
  )
  return rows.map((r) => r.column_name)
}

export async function runAdditiveDdl(ddl: AdditiveDdl, opts: { dryRun: boolean }): Promise<AdditiveDdlResult> {
  const bad = ddl.statements.filter((s) => !isAdditiveStatement(s))
  if (bad.length) {
    throw new TaskRefused(
      `Refusing: ${bad.length} statement${bad.length === 1 ? ' is' : 's are'} not CREATE … IF NOT EXISTS (${statementHeadline(bad[0])}).`,
      'Only additive, idempotent DDL runs from here. Anything else stays a laptop job.',
    )
  }

  const log: string[] = []
  const before = await existingTables(ddl.tables)
  const absent = ddl.tables.filter((t) => !before.includes(t))
  for (const t of ddl.tables) log.push(before.includes(t) ? `= ${t} already exists` : `+ ${t} would be created`)

  if (opts.dryRun) {
    log.push('', absent.length ? `Dry run — ${absent.length} table${absent.length === 1 ? '' : 's'} to create. Nothing written.` : 'Dry run — nothing to create.')
    return { log, existedBefore: before, created: [], missingAfter: absent }
  }

  log.push('')
  for (const sql of ddl.statements) {
    await prisma.$executeRawUnsafe(sql)
    log.push(`✓ ${statementHeadline(sql)}`)
  }

  const after = await existingTables(ddl.tables)
  const created = after.filter((t) => !before.includes(t))
  const missingAfter = ddl.tables.filter((t) => !after.includes(t))
  log.push('')
  for (const t of after) log.push(`${t}: ${(await columnsOf(t)).join(', ')}`)
  for (const t of missingAfter) log.push(`! ${t} is STILL missing — a statement did not create it`)
  return { log, existedBefore: before, created, missingAfter }
}
