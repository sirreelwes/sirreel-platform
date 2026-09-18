/**
 * The server half of the maintenance registry — id → the function that does
 * the work. Kept apart from maintenanceTasks.ts so the page can import the
 * metadata without dragging Prisma into a client bundle.
 *
 * A runner takes the dry-run flag and whatever params the task declared, and
 * returns a log plus a structured summary. It never prints, never exits, and
 * never takes a command, a path or a script name from its caller — the only
 * thing the request chooses is WHICH id, out of this map.
 */

import { MAINTENANCE_TASKS, type MaintenanceTaskMeta } from '@/lib/admin/maintenanceTasks'
import { seedVsmPlanet, RECEIVE_METHODS, type ReceiveMethodKey } from '@/lib/sub-rentals/seedVsmPlanet'
import { moveCargoOffLiftGate } from '@/lib/fleet/moveCargoOffLiftGate'
import { seedDf50FluidKit } from '@/lib/inventory/seedDf50FluidKit'
import { seedKnownBrokers } from '@/lib/coi/seedKnownBrokers'
import { fileNegotiatedAgreement, parseAliasEntries } from '@/lib/contracts/fileNegotiatedAgreement'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { runAdditiveDdl } from '@/lib/admin/runAdditiveDdl'

// The one refusal class every task throws. `SeedRefused` is the name the
// route and the first CLI learned it under.
export { TaskRefused, TaskRefused as SeedRefused }

export interface MaintenanceRunInput {
  dryRun: boolean
  params: Record<string, string>
  /** The HQ user who pressed the button — for per-row audit entries a task
   *  writes itself. Null when there is no session (the CLI). */
  actorUserId?: string | null
}

export interface MaintenanceRunResult {
  /** What happened, in order — rendered straight onto the screen. */
  log: string[]
  /** Ids created this run. What a later cleanup is allowed to delete BY. */
  createdIds: string[]
  /** Existing rows this run changed (moved, folded, re-counted). A backfill
   *  creates nothing, so without this its audit row would say nothing. */
  touchedIds?: string[]
  /** One line for the audit row and the top of the result card. */
  headline: string
}

export type MaintenanceRunner = (input: MaintenanceRunInput) => Promise<MaintenanceRunResult>

const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

const RUNNERS: Record<string, MaintenanceRunner> = {
  'df50-fluid-kit': async ({ dryRun }) => {
    const r = await seedDf50FluidKit({ dryRun })
    const n = r.linked
    const nothing = n === 0 && r.touchedIds.length === 0
    const headline = nothing
      ? 'Already linked — a DF-50 already brings its fluid.'
      : dryRun
        ? `Dry run — ${n} DF-50 row${n === 1 ? '' : 's'} would get the fluid as a kit piece.`
        : `${n} DF-50 row${n === 1 ? '' : 's'} now bring the fluid with them.`
    const log = r.warnings.length ? [...r.log, '', 'Look at:', ...r.warnings.map((w) => `  ! ${w}`)] : r.log
    return { log, createdIds: r.createdIds, touchedIds: r.touchedIds, headline }
  },
  'seed-vsm-planet-roster': async ({ dryRun, params }) => {
    const receive = clean(params.receiveMethod)
    if (receive && !RECEIVE_METHODS.includes(receive as ReceiveMethodKey)) {
      throw new TaskRefused(
        `Unknown receive method "${receive}".`,
        `Pick one of ${RECEIVE_METHODS.join(' / ')}.`,
      )
    }
    const r = await seedVsmPlanet({
      dryRun,
      email: clean(params.email),
      phone: clean(params.phone),
      receiveMethod: (receive as ReceiveMethodKey | null) ?? null,
    })
    const made = dryRun ? r.wouldCreate.length : r.createdUnitIds.length
    // The skipped-roster case is the headline when it happens: "0 units
    // created" on its own reads like a failure, when in fact the vendor's
    // own fields were set and the roster was withheld on purpose.
    const headline = r.skippedRoster
      ? `Vendor "${r.matchedName}" updated. Roster left alone — it already has units this task did not create.`
      : dryRun
        ? `Dry run — ${made} unit${made === 1 ? '' : 's'} would be created, ${r.existingUnitIds.length} already there.`
        : `${made} unit${made === 1 ? '' : 's'} created, ${r.existingUnitIds.length} already there.`
    return { log: r.log, createdIds: r.createdUnitIds, headline }
  },

  'cargo-vans-no-lift-gate': async ({ dryRun, actorUserId }) => {
    const r = await moveCargoOffLiftGate({ dryRun, actorUserId: actorUserId ?? null })
    const moved = r.moves.length
    const folded = r.folds.length
    const planned = r.plan.filter((p) => p.action === 'move' || p.action === 'merge-and-move').length
    const toFold = r.plan.reduce((n, p) => n + p.foldIds.length, 0)
    const parts = (m: number, f: number) => [
      `${m} van${m === 1 ? '' : 's'} moved to w/o Liftgate`,
      f ? `${f} duplicate${f === 1 ? '' : 's'} folded` : null,
      r.classFlags.length ? `${r.classFlags.length} class flag${r.classFlags.length === 1 ? '' : 's'} fixed` : null,
      r.warnings.length ? `${r.warnings.length} thing${r.warnings.length === 1 ? '' : 's'} to look at` : null,
    ].filter(Boolean).join(', ')
    const nothing = r.touchedIds.length === 0 && r.classFlags.length === 0
    const headline = nothing
      ? 'Already filed this way — nothing to change.'
      : dryRun
        ? `Dry run — ${parts(planned, toFold)}.`
        : `${parts(moved, folded)}.`
    // Warnings are the part a person must read, so they ride at the END of
    // the log where a phone screen lands.
    const log = r.warnings.length ? [...r.log, '', 'Look at:', ...r.warnings.map((w) => `  ! ${w}`)] : r.log
    return { log, createdIds: [], touchedIds: r.touchedIds, headline }
  },

  'file-negotiated-agreement': async ({ dryRun, params, actorUserId }) => {
    const key = clean(params.key)
    if (!key) {
      throw new TaskRefused('No agreement chosen.', 'Pick which negotiated agreement to file.')
    }
    const r = await fileNegotiatedAgreement({
      key,
      dryRun,
      aliases: parseAliasEntries(params.alias),
      actorUserId: actorUserId ?? null,
    })
    const n = r.filed.length
    const who = r.filed.map((f) => f.companyName).join(' and ')
    const headline =
      n === 0
        ? `Nothing filed — ${r.skipped.length} compan${r.skipped.length === 1 ? 'y was' : 'ies were'} skipped. Read the log.`
        : dryRun
          ? `Dry run — would file ${r.title} for ${who}, covering through ${r.expiryDate}.`
          : `${r.title} filed for ${who}. Their jobs are papered by it through ${r.expiryDate}.`
    // A skip is the part a person must read — a company that quietly did
    // not get its contract is exactly what a headline count hides.
    const log = r.skipped.length
      ? [...r.log, '', 'Look at:', ...r.skipped.map((sk) => `  ! ${sk.registryName}: ${sk.reason} (${sk.detail})`)]
      : r.log
    return { log, createdIds: r.createdIds, touchedIds: r.touchedIds, headline }
  },

  'job-conversation-tables': async ({ dryRun }) => {
    const task = MAINTENANCE_TASKS.find((t) => t.id === 'job-conversation-tables')
    if (!task?.ddl) throw new TaskRefused('This task carries no statements.', 'Add `ddl` to its registry entry.')
    const r = await runAdditiveDdl(task.ddl, { dryRun })
    const n = dryRun ? r.missingAfter.length : r.created.length
    const headline = r.missingAfter.length && !dryRun
      ? `${r.missingAfter.join(', ')} still missing after the run — read the log.`
      : n === 0
        ? 'Every table already exists — nothing to do.'
        : dryRun
          ? `Dry run — ${n} table${n === 1 ? '' : 's'} would be created.`
          : `${n} table${n === 1 ? '' : 's'} created. Notes and the claim menu work now.`
    // A table is not a row: nothing to clean up by id. The audit row still
    // records the run and this headline; `touchedIds` names the tables made.
    return { log: r.log, createdIds: [], touchedIds: r.created, headline }
  },

  'date-change-request-table': async ({ dryRun }) => {
    const task = MAINTENANCE_TASKS.find((t) => t.id === 'date-change-request-table')
    if (!task?.ddl) throw new TaskRefused('This task carries no statements.', 'Add `ddl` to its registry entry.')
    const r = await runAdditiveDdl(task.ddl, { dryRun })
    const headline = r.missingAfter.length && !dryRun
      ? `${r.missingAfter.join(', ')} still missing after the run — read the log.`
      : r.created.length === 0
        ? 'The table already exists — nothing to do.'
        : dryRun
          ? 'Dry run — the table would be created.'
          : 'Table created. Clients can ask to move their dates from the portal now.'
    return { log: r.log, createdIds: [], touchedIds: r.created, headline }
  },
  'broker-directory-tables': async ({ dryRun }) => {
    const task = MAINTENANCE_TASKS.find((t) => t.id === 'broker-directory-tables')
    if (!task?.ddl) throw new TaskRefused('This task carries no statements.', 'Add `ddl` to its registry entry.')
    const r = await runAdditiveDdl(task.ddl, { dryRun })
    const n = dryRun ? r.missingAfter.length : r.created.length
    const headline = r.missingAfter.length && !dryRun
      ? `${r.missingAfter.join(', ')} still missing after the run — read the log.`
      : n === 0
        ? 'Both tables already exist — nothing to do.'
        : dryRun
          ? `Dry run — ${n} table${n === 1 ? '' : 's'} would be created.`
          : `${n} table${n === 1 ? '' : 's'} created. The broker list works now.`
    return { log: r.log, createdIds: [], touchedIds: r.created, headline }
  },
  'seed-known-brokers': async ({ dryRun }) => {
    const r = await seedKnownBrokers({ dryRun })
    const headline =
      r.created === 0 && r.updated === 0
        ? 'Every hand-named broker is already on file.'
        : dryRun
          ? `Dry run — ${r.created} to add, ${r.updated} to fill in.`
          : `${r.created} broker${r.created === 1 ? '' : 's'} added, ${r.updated} filled in.`
    const log = r.warnings.length ? [...r.log, '', 'Look at:', ...r.warnings.map((w) => `  ! ${w}`)] : r.log
    return { log, createdIds: r.createdIds, touchedIds: r.touchedIds, headline }
  },
}

/** The runner for a registered task, or null. Never resolves an id that is
 *  not in the metadata registry — the two have to agree. */
export function maintenanceRunner(id: string): MaintenanceRunner | null {
  if (!MAINTENANCE_TASKS.some((t: MaintenanceTaskMeta) => t.id === id)) return null
  return RUNNERS[id] ?? null
}

/** Ids with a runner behind them — the test holds this against the registry. */
export function runnableIds(): string[] {
  return Object.keys(RUNNERS)
}
