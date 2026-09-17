/**
 * The ONE shape of schema change a phone button may run: additive,
 * idempotent DDL — `CREATE TABLE / INDEX … IF NOT EXISTS`, nothing else.
 *
 * Wes 2026-09-17, on being told the Conversation tables needed a laptop:
 * "It's not possible to do any of this from my phone." The 2026-09-16 rule
 * kept EVERY migration off /admin/maintenance because the live DB carries
 * objects no schema file knows and a half-run ALTER wants a person at a
 * keyboard. A CREATE … IF NOT EXISTS of a brand-new table has no half-run
 * state: each statement stands alone, a failure leaves nothing partial, and
 * running it again finishes the job. So that class — and only that class —
 * is allowed through, and `isAdditiveStatement` is the gate the runner and
 * the registry test both apply to every statement.
 *
 * Plain data: no Prisma, so the registry (imported by a client component)
 * can carry the statements.
 */

export interface AdditiveDdl {
  /** Tables the statements create — checked in information_schema before and after. */
  tables: readonly string[]
  /** Every one must satisfy `isAdditiveStatement`. */
  statements: readonly string[]
}

const ALLOWED = /^\s*CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\s+IF\s+NOT\s+EXISTS\b/i
const FORBIDDEN = /\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE)\b/i

/** True only for a `CREATE TABLE|INDEX … IF NOT EXISTS` with no destructive word anywhere in it. */
export function isAdditiveStatement(sql: string): boolean {
  return ALLOWED.test(sql) && !FORBIDDEN.test(sql)
}

/** The first line of a statement, for a log. */
export function statementHeadline(sql: string): string {
  return sql.split('\n')[0].trim().replace(/\s*\($/, '')
}
