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
  /** Enum labels the run added, as "Type.VALUE" (empty on a dry run). */
  enumValuesAdded: string[]
  /** Enum labels still absent after the run. */
  enumValuesMissingAfter: string[]
}

/** The labels a Postgres enum type currently carries, in sort order. */
async function enumLabels(type: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    type,
  )
  return rows.map((r) => r.enumlabel)
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
      `Refusing: ${bad.length} statement${bad.length === 1 ? ' is' : 's are'} neither CREATE … IF NOT EXISTS nor ALTER TYPE … ADD VALUE IF NOT EXISTS (${statementHeadline(bad[0])}).`,
      'Only additive, idempotent DDL runs from here. Anything else stays a laptop job.',
    )
  }

  const log: string[] = []
  const before = await existingTables(ddl.tables)
  const absent = ddl.tables.filter((t) => !before.includes(t))
  for (const t of ddl.tables) log.push(before.includes(t) ? `= ${t} already exists` : `+ ${t} would be created`)

  // An enum value is checked the same way a table is: read the catalog
  // before, read it again after, and say which labels are still missing.
  const enums = ddl.enums ?? []
  const labelsBefore = new Map<string, string[]>()
  for (const e of enums) {
    const have = await enumLabels(e.type)
    labelsBefore.set(e.type, have)
    for (const v of e.values) {
      log.push(have.includes(v) ? `= ${e.type} already has ${v}` : `+ ${e.type} would gain ${v}`)
    }
  }
  const enumsAbsent = enums.flatMap((e) =>
    e.values.filter((v) => !(labelsBefore.get(e.type) ?? []).includes(v)).map((v) => `${e.type}.${v}`),
  )

  if (opts.dryRun) {
    const todo = absent.length + enumsAbsent.length
    log.push('', todo ? `Dry run — ${todo} change${todo === 1 ? '' : 's'} to make. Nothing written.` : 'Dry run — nothing to do.')
    return {
      log, existedBefore: before, created: [], missingAfter: absent,
      enumValuesAdded: [], enumValuesMissingAfter: enumsAbsent,
    }
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

  const enumValuesAdded: string[] = []
  const enumValuesMissingAfter: string[] = []
  for (const e of enums) {
    const have = await enumLabels(e.type)
    // The whole label list, so a phone screen proves the run took.
    log.push(`${e.type}: ${have.join(', ')}`)
    for (const v of e.values) {
      if (!have.includes(v)) enumValuesMissingAfter.push(`${e.type}.${v}`)
      else if (!(labelsBefore.get(e.type) ?? []).includes(v)) enumValuesAdded.push(`${e.type}.${v}`)
    }
  }
  for (const v of enumValuesMissingAfter) log.push(`! ${v} is STILL missing — a statement did not add it`)

  return { log, existedBefore: before, created, missingAfter, enumValuesAdded, enumValuesMissingAfter }
}
