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
import { seedVsmPlanet, SeedRefused, RECEIVE_METHODS, type ReceiveMethodKey } from '@/lib/sub-rentals/seedVsmPlanet'

export { SeedRefused }

export interface MaintenanceRunInput {
  dryRun: boolean
  params: Record<string, string>
}

export interface MaintenanceRunResult {
  /** What happened, in order — rendered straight onto the screen. */
  log: string[]
  /** Ids created this run. What a later cleanup is allowed to delete BY. */
  createdIds: string[]
  /** One line for the audit row and the top of the result card. */
  headline: string
}

export type MaintenanceRunner = (input: MaintenanceRunInput) => Promise<MaintenanceRunResult>

const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

const RUNNERS: Record<string, MaintenanceRunner> = {
  'seed-vsm-planet-roster': async ({ dryRun, params }) => {
    const receive = clean(params.receiveMethod)
    if (receive && !RECEIVE_METHODS.includes(receive as ReceiveMethodKey)) {
      throw new SeedRefused(
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
