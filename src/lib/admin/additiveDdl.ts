/**
 * The schema changes a phone button may run: additive, idempotent DDL with
 * NO half-run state. Two shapes, and nothing else.
 *
 *   1. `CREATE TABLE / INDEX … IF NOT EXISTS` — a brand-new table.
 *   2. `ALTER TYPE "X" ADD VALUE IF NOT EXISTS 'Y'` — one new enum value.
 *
 * Wes 2026-09-17, on being told the Conversation tables needed a laptop:
 * "It's not possible to do any of this from my phone." The 2026-09-16 rule
 * kept EVERY migration off /admin/maintenance because the live DB carries
 * objects no schema file knows and a half-run ALTER wants a person at a
 * keyboard. A CREATE … IF NOT EXISTS of a brand-new table has no half-run
 * state: each statement stands alone, a failure leaves nothing partial, and
 * running it again finishes the job.
 *
 * **Shape 2 was added 2026-09-18 (Wes, on the INSURANCE lost reason) on
 * exactly that reasoning, not as a relaxation of it.** `ADD VALUE IF NOT
 * EXISTS` is ONE statement that adds ONE label to an enum: it cannot half-
 * apply, it rewrites no row, it drops nothing, and a second run is a no-op.
 * The regex is anchored at BOTH ends around a quoted type and a quoted
 * value, so nothing can ride along after it — an `ALTER TYPE … RENAME`, an
 * `ALTER TABLE … ADD COLUMN`, a second statement behind a semicolon are all
 * still refused. **This is not a door for ALTER generally.** `ALTER TABLE
 * … ADD COLUMN` STAYS a laptop job: it touches an existing table in a
 * database with known drift, which is the failure mode the rule exists for.
 *
 * Plain data: no Prisma, so the registry (imported by a client component)
 * can carry the statements.
 */

export interface AdditiveEnumValues {
  /** The Postgres enum type, exactly as it is spelled in the DB. */
  type: string
  /** Labels the statements add — checked in pg_enum before and after. */
  values: readonly string[]
}

export interface AdditiveDdl {
  /** Tables the statements create — checked in information_schema before and after. */
  tables: readonly string[]
  /** Enum values the statements add. A task declares tables, enums, or both. */
  enums?: readonly AdditiveEnumValues[]
  /** Every one must satisfy `isAdditiveStatement`. */
  statements: readonly string[]
}

const ALLOWED_CREATE = /^\s*CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\s+IF\s+NOT\s+EXISTS\b/i
const FORBIDDEN = /\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE)\b/i

/**
 * Anchored at both ends: the WHOLE statement is one `ADD VALUE IF NOT
 * EXISTS`, with a double-quoted type and a single-quoted label and nothing
 * else — no second statement, no trailing clause, no unquoted identifier.
 */
const ALLOWED_ADD_ENUM_VALUE =
  /^\s*ALTER\s+TYPE\s+"[A-Za-z_][A-Za-z0-9_]*"\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'[A-Za-z0-9_]+'\s*;?\s*$/i

/** True for exactly one `ALTER TYPE … ADD VALUE IF NOT EXISTS`, whole statement. */
export function isAddEnumValueStatement(sql: string): boolean {
  return ALLOWED_ADD_ENUM_VALUE.test(sql)
}

/** True only for the two allowed shapes — see the file comment. */
export function isAdditiveStatement(sql: string): boolean {
  if (isAddEnumValueStatement(sql)) return true
  return ALLOWED_CREATE.test(sql) && !FORBIDDEN.test(sql)
}

/** The first line of a statement, for a log. */
export function statementHeadline(sql: string): string {
  return sql.split('\n')[0].trim().replace(/\s*\($/, '')
}
