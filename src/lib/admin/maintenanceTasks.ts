/**
 * Maintenance tasks HQ can run from a phone — the registry.
 *
 * Wes 2026-09-16: "I need to be able to run these scripts from my iPad with
 * no access to my actual laptop." Everything seedable had exactly one way in
 * — `npx tsx scripts/…` on the laptop with `DATABASE_URL` exported by hand —
 * so being away from it meant the work simply waited.
 *
 * This is the metadata half: PLAIN DATA, no Prisma and no runners, so the
 * /admin/maintenance page (a client component) can import it. The functions
 * live in maintenanceRunners.ts, server-side, keyed by the same ids — same
 * split as partnerSections.ts, and for the same reason.
 *
 * TWO RULES, both deliberate:
 *
 * 1. **Allowlist, never arbitrary execution.** A task is a registry entry
 *    pointing at a named function. Nothing here takes a path, a command or
 *    a script name from the request. A web endpoint that runs whatever it is
 *    handed is a remote shell with a login page in front of it.
 *
 * 2. **No schema changes.** `category` has no DDL member on purpose, so the
 *    type system refuses one. The `add-*-columns` / `add-*-table` /
 *    `ALTER TYPE` scripts stay on a laptop: the live DB carries objects no
 *    schema file knows, their failure mode is a half-migrated production
 *    database, and they are the one class of change that genuinely wants
 *    someone at a keyboard who can read the error and act on it. Tasks that
 *    DEPEND on a migration having run say so and refuse (see the enum
 *    preflight in seedVsmPlanet.ts).
 *
 * Every task is idempotent, supports a dry run, and reports what it did.
 */

export type MaintenanceCategory = 'seed' | 'backfill'

export interface MaintenanceParam {
  key: string
  label: string
  placeholder?: string
  /** Shown under the field — why you would fill it in. */
  help?: string
  /** A fixed set renders as a picker instead of a text box. */
  options?: readonly string[]
}

export interface MaintenanceTaskMeta {
  /** URL segment and runner key. Stable — it ends up in AuditLog rows. */
  id: string
  title: string
  /** One line, read on a phone before pressing anything. */
  summary: string
  /** The longer why, for someone who did not write it. */
  detail: string
  category: MaintenanceCategory
  /** Exactly what it writes, named as tables. */
  writes: string
  /** The laptop equivalent, so the two are never confused for each other. */
  cliEquivalent: string
  params?: readonly MaintenanceParam[]
}

export const MAINTENANCE_TASKS: readonly MaintenanceTaskMeta[] = [
  {
    id: 'seed-vsm-planet-roster',
    title: 'Seed VSM Planet’s photo roster',
    summary: 'Creates the 14 Photo Shoot Rentals units on VSM Planet Rentals, and mints their account link.',
    detail:
      'Files VSM Planet as an EQUIPMENT partner in the Photo Shoot Rentals section with will-call handover, then adds any of the 14 roster units that are not already there — matched by name, so running it twice adds nothing. Rates are left empty on purpose: Vic proposes them from his own page. Nothing reaches sirreel.com until a unit is listed, has a photo, and the agreement is signed.',
    category: 'seed',
    writes: 'vendors (one row, upserted) · sub_contracted_vehicles (up to 14 rows) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/onboard-vsm-planet.ts',
    params: [
      { key: 'email', label: 'Contact email', placeholder: 'vic@vsmplanetrentals.com', help: 'Only written if given. Never overwrites what is already on file.' },
      { key: 'phone', label: 'Contact phone', placeholder: '(323) 555-0142', help: 'Same — blank leaves the existing number alone.' },
      { key: 'receiveMethod', label: 'How gear changes hands', options: ['WILL_CALL', 'DELIVERY', 'PICKUP'], help: 'Will-call: the production collects from their Hollywood counter. Change it if Vic says otherwise.' },
    ],
  },
] as const

export function maintenanceTask(id: string): MaintenanceTaskMeta | null {
  return MAINTENANCE_TASKS.find((t) => t.id === id) ?? null
}

/** AuditLog action for a task that actually wrote. */
export const MAINTENANCE_RUN_ACTION = 'admin.maintenance_run'
