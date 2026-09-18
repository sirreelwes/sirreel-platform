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
 * 2. **No schema changes — except TWO named statement shapes.**
 *    `category: 'schema'` (2026-09-17, Wes: "It's not possible to do any of
 *    this from my phone") is allowed ONLY for `CREATE TABLE / INDEX … IF NOT
 *    EXISTS` and `ALTER TYPE "X" ADD VALUE IF NOT EXISTS 'Y'` (2026-09-18):
 *    a task in that category carries its statements as `ddl` and every one
 *    must pass `isAdditiveStatement` (additiveDdl.ts) — the registry test
 *    checks it at build time, the runner refuses at run time. Both shapes
 *    qualify for the same reason: ONE statement, nothing partial if it
 *    fails, a no-op if it is run twice. The `add-*-columns` scripts — and
 *    every other ALTER — STAY on a laptop: the live DB carries objects no
 *    schema file knows, their failure mode is a half-migrated production
 *    database, and they are the class of change that genuinely wants
 *    someone at a keyboard who can read the error and act on it. Tasks that
 *    DEPEND on such a migration say so and refuse (see the enum preflight
 *    in seedVsmPlanet.ts).
 *
 * Every task is idempotent, supports a dry run, and reports what it did.
 */

import type { AdditiveDdl } from '@/lib/admin/additiveDdl'
import { JOB_THREAD_TABLES_DDL } from '@/lib/email/jobThreadTableSql'
import { DATE_CHANGE_REQUEST_TABLE_DDL } from '@/lib/portal/dateChangeTableSql'
import { BROKER_TABLES_DDL } from '@/lib/coi/brokerTableSql'
import { INSURANCE_LOST_REASON_DDL } from '@/lib/orders/lostReasonEnumSql'

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
    id: 'df50-cord-to-machine',
    title: 'DF-50: the power cord belongs to the machine',
    summary: 'Moves the IEC power cord off the hazer fluid and onto all three DF-50 machine rows.',
    detail:
      'Wes 2026-09-17: "The IEC POWER CORD EDISON is attached to the DF50 Hazer Fluid 1 Gallon. It should be attached to the DF50 Hazer." A jug of fluid has no socket, so every order that took the fluid pulled a cord with it, and every order that took only the machine — which happens, the DF-50 goes out pre-juiced — got none. The cord goes on all three machine rows, keeping whatever ratio and billing it already had; the wrong link is DEACTIVATED, never deleted, because it carries the order lines it generated and those orders really did go out that way. Undo it by setting that link active again. Running it twice changes nothing. Orders already quoted are not touched.',
    category: 'seed',
    writes: 'inventory_kit_pieces (up to 3 created, one per DF-50 machine row; the misplaced link deactivated) · sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/move-df50-cord.ts',
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
    id: 'file-negotiated-agreement',
    title: 'File a negotiated agreement as the client\u2019s annual master',
    summary:
      'Renders the client\u2019s own negotiated redline on SirReel paper and files it as their annual agreement, so every job they book is papered by it.',
    detail:
      'Wes 2026-09-18, on Party Giraffes and Graduation Day: "make those negotiated agreements standard for each job as an annual agreement." Their counsel\u2019s redline is already transcribed word-for-word; this renders it for each company and files it TWO ways. As their ANNUAL master it covers every job inside the agreed window \u2014 nothing to sign per job, the portal asks only for the damage-waiver election. As their STANDING terms it becomes the document that goes out whenever an agreement is released for signature anyway, so they are never handed our standard template after their lawyer redlined it. Companies are matched by exact name and it refuses to guess: 0 or 2+ matches are skipped and the near-misses printed. A company already covered by a current master is skipped for a person to supersede by hand, and standing terms already on file are never overwritten. Run the dry run first \u2014 it names the exact company row each name resolved to.',
    category: 'seed',
    writes:
      'sr_company_agreements (one row per company, annual + auto-covering) \u00b7 companies (the standing negotiated terms fields, only where there are none) \u00b7 sr_audit_logs \u00b7 the rendered PDF in the private blob store',
    cliEquivalent: 'npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026 --write',
    params: [
      // One option today. The test holds this list against the agreements
      // registry, so a second negotiated document cannot ship without a
      // picker entry \u2014 and a typo here fails the build, not the run.
      {
        key: 'key',
        label: 'Which negotiated agreement',
        options: ['graduation-day-2026'],
        defaultValue: 'graduation-day-2026',
        help: 'Graduation Day Productions and Party Giraffes, LLC \u2014 their May redline, effective 5/15 through 12/31.',
      },
      {
        key: 'alias',
        label: 'Company name overrides',
        placeholder: 'Party Giraffes=Party Giraffes, LLC',
        help: 'Only if the dry run says a name did not match. One per line, Registry Name=Exact DB Name \u2014 never comma-separated, because the DB names carry commas. The confirmed ones are already built in.',
      },
    ],
  },
  {
    id: 'offer-annual-for-signature',
    title: 'Offer the negotiated annual for signature \u2014 and invite the signer',
    summary:
      'Puts the filed negotiated agreement in the client\u2019s account portal for an executive to sign, gives that person portal access, and emails them the link.',
    detail:
      'Wes 2026-09-18: "An executive at the company wants to sign these agreements \u2026 I need it on the Production company portal and a way to send it to Haylea." The masters filed on 9/18 COVER every job with nobody\u2019s name on them; this is the offer that collects the signature, and it does all three acts at once so none of it needs a laptop or a wide screen: it offers the agreement in each company\u2019s portal, grants the signer account access as an EXECUTIVE, and emails them the invite \u2014 which names the document and links straight to the signing page. Leave the email blank to file the offers and invite nobody. It is idempotent: an offer already waiting is reused, and a person who already has access is not re-granted. It SKIPS rather than guesses \u2014 a company with nothing filed yet (run the filing task first), one whose agreement is already signed, a name that matches 0 or 2+ company rows, or a name the registry does not map to this agreement (which would render our baseline clauses instead of theirs). Run the dry run first: it names the exact company row, whether an offer already exists, and who would be emailed.',
    category: 'seed',
    writes:
      'sr_company_agreements (one pending, non-covering offer per company) \u00b7 sr_company_portal_access + people (the signer\u2019s access, only if they have none) \u00b7 sr_audit_logs \u00b7 the rendered PDF in the private blob store \u00b7 one invite email per company',
    cliEquivalent:
      'npx tsx scripts/offer-annual-for-signature.ts --key graduation-day-2026 --email \u2026 --write (needs vercel env run \u2014 the blob token and the mailer live in the deployed runtime)',
    params: [
      // Same picker as the filing task, pinned against the registry by
      // npm run test:maintenance-tasks.
      {
        key: 'key',
        label: 'Which negotiated agreement',
        options: ['graduation-day-2026'],
        defaultValue: 'graduation-day-2026',
        help: 'Graduation Day Productions and Party Giraffes, LLC \u2014 their redline with \u00a732 as agreed 9/18. Both get their own offer; one signature does not paper the other.',
      },
      {
        key: 'signerEmail',
        label: 'Who is signing (email)',
        placeholder: 'haylea@\u2026',
        help: 'They get account-portal access as an EXECUTIVE and an email with the link. Blank files the offers and sends nothing.',
      },
      {
        key: 'signerName',
        label: 'Their name',
        placeholder: 'Haylea',
        help: 'Used in the greeting, and to create the contact if they are not in HQ yet.',
      },
      {
        key: 'signerTitle',
        label: 'Their title (optional)',
        placeholder: 'Head of Production',
      },
      {
        key: 'sendInvite',
        label: 'Email them the invite',
        options: ['yes', 'no'],
        defaultValue: 'yes',
        help: '"no" grants access without mailing them \u2014 send it later from /crm with a preview you can edit.',
      },
    ],
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
  {
    id: 'broker-directory-tables',
    title: 'Create the broker directory tables',
    summary: 'Adds the two tables that keep the list of insurance brokers and which client each one acts for.',
    detail:
      'Wes 2026-09-17: "Please start keeping a list of brokers." Until these exist a broker is only ever read off the certificate in front of you, so nothing can answer "who is this client\u2019s broker" when the producer box did not read. sr_brokers is one row per broker keyed by EMAIL (the person, the agency, the phone, when we last saw or wrote to them); sr_broker_clients ties a broker to the clients they act for. Once they exist the list fills itself \u2014 every certificate we review records the broker it names, and every review link we send records who we wrote to. Until then everything behaves exactly as it does today and /admin/brokers says this task is needed. Nothing existing is touched; running it twice changes nothing.',
    category: 'schema',
    writes: 'sr_brokers, sr_broker_clients (each created only if absent, with its indexes) \u00b7 sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/add-broker-tables.ts',
    ddl: BROKER_TABLES_DDL,
  },
  {
    id: 'insurance-lost-reason',
    title: 'Add the insurance lost reason',
    summary: 'Adds INSURANCE to the LostReason enum, so "Insurance requirements not met" can be saved when a job is marked lost.',
    detail:
      'Wes 2026-09-18: "We\u2019ve lost a couple of jobs because of improper insurance from the Production. I\u2019d like to have this as an option." The option is in the Mark lost picker (and the one on /orders) as soon as the code is deployed, but Postgres types that column as an enum \u2014 until this has run, picking it and pressing Mark lost fails. This runs one statement, ALTER TYPE "LostReason" ADD VALUE IF NOT EXISTS \u2018INSURANCE\u2019, and then prints the type\u2019s whole label list so you can see it took. No row is read or rewritten, nothing else on the enum moves, and running it twice changes nothing. Dry run only reads the catalog and says whether the label is there.',
    category: 'schema',
    writes: 'the LostReason enum type (one new label) \u00b7 sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/add-insurance-lost-reason.ts',
    ddl: INSURANCE_LOST_REASON_DDL,
  },
  {
    id: 'seed-known-brokers',
    title: 'File the brokers we already know',
    summary: 'Puts the hand-named brokers (today: Barbara Wagner) into the directory so it does not start empty.',
    detail:
      'The directory fills itself from certificates and from review links we send, which means it only knows brokers we have met SINCE it shipped. This files the ones Wes named by hand first \u2014 today that is Barbara Wagner (barbara@worthingtoninsur.com), the broker on the Mega COI review. Matched on email, so running it twice never duplicates; it fills blanks and never overwrites a name someone has corrected on the page. Her agency is deliberately left blank rather than guessed from her email domain \u2014 it fills in from the producer box of the next certificate she issues. Each broker is tied to a client only when the name hint matches exactly one; an ambiguous or missing match is reported and left alone. Refuses with a fix line if the tables do not exist yet.',
    category: 'seed',
    writes: 'sr_brokers, sr_broker_clients \u00b7 sr_audit_logs',
    cliEquivalent: 'npx tsx scripts/seed-known-brokers.ts [--write]',
  },
] as const

export function maintenanceTask(id: string): MaintenanceTaskMeta | null {
  return MAINTENANCE_TASKS.find((t) => t.id === id) ?? null
}

/** AuditLog action for a task that actually wrote. */
export const MAINTENANCE_RUN_ACTION = 'admin.maintenance_run'
