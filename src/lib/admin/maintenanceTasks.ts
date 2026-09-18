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
 * 2. **No schema changes — with ONE named exception.** `category: 'schema'`
 *    (2026-09-17, Wes: "It's not possible to do any of this from my phone")
 *    is allowed ONLY for `CREATE TABLE / INDEX … IF NOT EXISTS`: a task in
 *    that category carries its statements as `ddl` and every one must pass
 *    `isAdditiveStatement` (additiveDdl.ts) — the registry test checks it at
 *    build time, the runner refuses at run time. A brand-new table has no
 *    half-run state, so the reason the rule existed does not apply to it.
 *    The `add-*-columns` / `ALTER TYPE` scripts STAY on a laptop: the live
 *    DB carries objects no schema file knows, their failure mode is a
 *    half-migrated production database, and they are the class of change
 *    that genuinely wants someone at a keyboard who can read the error and
 *    act on it. Tasks that DEPEND on such a migration say so and refuse
 *    (see the enum preflight in seedVsmPlanet.ts).
 *
 * Every task is idempotent, supports a dry run, and reports what it did.
 */

import type { AdditiveDdl } from '@/lib/admin/additiveDdl'
import { JOB_THREAD_TABLES_DDL } from '@/lib/email/jobThreadTableSql'
import { DATE_CHANGE_REQUEST_TABLE_DDL } from '@/lib/portal/dateChangeTableSql'

export type MaintenanceCategory = 'seed' | 'backfill' | 'schema'

export interface MaintenanceParam {
  key: string
  label: string
  placeholder?: string
  /** Pre-filled in the form. Only for a value someone has CONFIRMED — a
   *  guess that arrives pre-typed is a guess nobody re-reads. */
  defaultValue?: string
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
  /** ONLY on a `schema` task: the additive statements it runs, verbatim. */
  ddl?: AdditiveDdl
}

export const MAINTENANCE_TASKS: readonly MaintenanceTaskMeta[] = [
  {
    id: 'df50-fluid-kit',
    title: 'DF-50 hazer: fluid goes out with it',
    summary: 'Links the DF-50 hazer fluid to all three DF-50 catalog rows as a charged kit piece, so adding the hazer to an order adds its fluid.',
    detail:
      'Wes 2026-09-17: when the DF-50 is picked the fluid should come up at once — it always goes out, it is part of the kit. This does for the DF-50 what the 2026-09-15 script did for the Roscos: one bottle per machine, charged at the fluid\u2019s catalog price, printed on the quote, and skipped when the client listed fluid themselves. The fluid is \u201cDF50 Hazer Fluid, 1 Gallon\u201d (code DF50FLUID), on all three machines \u2014 Wes: the only option. It is moved to Expendables if it still bills per day; the older typo\u2019d fluid row is left alone and named in the log. Running it twice changes nothing. Orders already quoted are not touched.',
    category: 'seed',
    writes: 'inventory_kit_pieces (up to 3 rows, one per DF-50 machine row) · inventory_items (the fluid row\u2019s department, only if it is not an expendable yet) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/seed-df50-fluid-kit.ts',
  },
  {
    id: 'seed-vsm-planet-roster',
    title: 'Seed VSM Planet’s photo roster',
    summary: 'Creates the 14 Photo Shoot Rentals units on VSM Planet Rentals, and mints their account link.',
    detail:
      'Files VSM Planet as an EQUIPMENT partner in the Photo Shoot Rentals section with will-call handover, then adds any of the 14 roster units that are not already there — matched by name, so running it twice adds nothing. If the vendor carries no deal it seeds Wes\u2019s 35% to SirReel / 43% ceiling; it never overwrites one already there. Unit rates are left empty on purpose: Vic proposes them from his own page. Nothing reaches sirreel.com until a unit is listed, has a photo, and the agreement is signed.',
    category: 'seed',
    writes: 'vendors (one row, upserted — including the 35% / max 43% deal if it has none) · sub_contracted_vehicles (up to 14 rows) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/onboard-vsm-planet.ts',
    params: [
      // Confirmed by Wes 2026-09-16, so it is pre-filled — typing an address
      // on a phone keyboard is exactly where a typo goes unnoticed. Still
      // fill-if-empty: it never overwrites an address already on file.
      { key: 'email', label: 'Contact email', defaultValue: 'vic@vsmplanetrentals.com', placeholder: 'vic@vsmplanetrentals.com', help: 'Vic Hartounian. Only written if the vendor has no email yet — it never overwrites one.' },
      { key: 'phone', label: 'Contact phone', placeholder: '(323) 555-0142', help: 'Same — blank leaves the existing number alone.' },
      { key: 'receiveMethod', label: 'How gear changes hands', options: ['WILL_CALL', 'DELIVERY', 'DELIVER_TO_SIRREEL', 'PICKUP'], defaultValue: 'WILL_CALL', help: 'WILL_CALL: the production collects at their Hollywood counter (VSM\u2019s default). DELIVER_TO_SIRREEL: they drop it at Sun Valley and it goes out on our truck. DELIVERY: they take it to set. PICKUP: their driver takes it to set.' },
    ],
  },
  {
    id: 'cargo-vans-no-lift-gate',
    title: 'Cargo 20–25: file as Cargo Van w/o Liftgate',
    summary: 'Moves the six vans out of the w/ Liftgate class, folds any duplicate row (the second Cargo 25) into the original, and fixes both unit counts.',
    detail:
      'Wes 2026-09-16: Cargo 20 through 25 have no lift gate. They were seeded under "Cargo Van w/ Liftgate" and the first fix added a second Cargo 25 to the w/o class instead of moving the original. This re-files each ORIGINAL row (same id, same trips, same access code) into "Cargo Van w/o Liftgate"; where a duplicate exists it is folded into the original — every reservation, check-out, inspection and maintenance row re-pointed, missing facts copied over — and then retired under a name that says it was a duplicate. Nothing is deleted. The w/o class is un-archived if it was, and both classes’ unit counts are set to what is actually in them. A hold filed under w/ that is on one of these vans is NAMED in the log and left for a person to re-class. Running it twice changes nothing.',
    category: 'backfill',
    writes: 'assets (the six rows re-filed; a duplicate retired) · booking_assignments, checkout_records, maintenance_records, dispatch_tasks, inspections, insurance claims, incidents, lot checks, BIT inspections (re-pointed off a duplicate) · asset_categories + inventory_items (unit counts; the w/o class un-archived) · audit_log',
    cliEquivalent: 'npx tsx scripts/cargo-vans-no-lift-gate.ts',
  },
  {
    id: 'job-conversation-tables',
    title: 'Create the job Conversation tables',
    summary: 'Adds the three tables the job Conversation needs: internal notes, the "who is answering" claim, and the urgent-note alerts.',
    detail:
      'Phase 2 of one-thread-per-job (shipped 2026-09-17) reads and writes three new tables: sr_job_threads (one row per job — who is answering, or which desk it was handed to), sr_job_thread_notes (internal notes in the conversation, never sent) and sr_job_thread_alerts (who an URGENT note texted or emailed, added later the same day — re-run this task once to add it). Until they exist the panel still shows the emails, but posting a note or pressing Hand to Billing answers "the Conversation tables are not in the database yet", and an urgent note cannot record who it reached. This runs the CREATE … IF NOT EXISTS statements and then lists each table’s columns so you can see it took. No existing table is touched; running it twice changes nothing. Dry run only reads the catalog and says which tables are missing.',
    category: 'schema',
    writes: 'sr_job_threads, sr_job_thread_notes, sr_job_thread_alerts (each created only if absent, with its indexes) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/add-job-thread-tables.ts',
    ddl: JOB_THREAD_TABLES_DDL,
  },
  {
    id: 'date-change-request-table',
    title: 'Add the client date-change request table',
    summary:
      'Adds the table that holds "we need to move the pickup" — the ask a client can now raise from their portal.',
    detail:
      'Wes 2026-09-18, on the L\'anza job: "client said they wanted to change the pickup date but couldn\'t figure out how to do that." The portal\'s Schedule card now carries "Need to change these dates?", and the ask lands in sr_order_date_change_requests — a request only, which a rep answers with the existing "Change dates…" control. Until this table exists the portal does not offer the form at all (it fails soft and shows the rep\'s number instead), the order page shows no request, and nothing else on either page is affected. This runs one CREATE TABLE … IF NOT EXISTS plus its two indexes, then lists the table\'s columns so you can see it took. No existing table is touched; running it twice changes nothing. Dry run only reads the catalog and says whether the table is missing.',
    category: 'schema',
    writes: 'sr_order_date_change_requests (created only if absent, with its indexes) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/add-date-change-request-table.ts',
    ddl: DATE_CHANGE_REQUEST_TABLE_DDL,
  },
] as const

export function maintenanceTask(id: string): MaintenanceTaskMeta | null {
  return MAINTENANCE_TASKS.find((t) => t.id === id) ?? null
}

/** AuditLog action for a task that actually wrote. */
export const MAINTENANCE_RUN_ACTION = 'admin.maintenance_run'
