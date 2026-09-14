/**
 * Planyo mirror kill switch — the cutover control.
 *
 * WHAT THIS TURNS OFF. The daily Planyo→HQ mirror: the maintenance sync
 * (date drift, line adds, cancellation RELEASE_CANDIDATEs), the new-cart
 * importer, and auto-release. It is the ONLY thing that pulled Planyo's
 * book into HQ, and the `/api/planyo/*` helpers that still reach the
 * Planyo REST API from staff surfaces.
 *
 * WHY IT IS OFF. The team cut over to booking reservations exclusively in
 * HQ (Wes, 2026-09-14). Past that line the mirror stops being a safety net
 * and becomes a hazard: every cart it imports is either a duplicate of a
 * reservation a human already entered here, or a resurrection of one they
 * deliberately cancelled. HQ is the book now; Planyo is history.
 *
 * DEFAULT OFF, NO ENV REQUIRED. `PLANYO_MIRROR` is unset in Vercel, so
 * shipping this file IS the cutover — nothing to click in the dashboard,
 * nothing to forget. Rolling back is `PLANYO_MIRROR=1` in Production, one
 * env var, no deploy and no code review, which is what you want at 2am on
 * day two of a cutover if the team asks for the old surface back.
 *
 * THE CRON STAYS SCHEDULED ON PURPOSE. `/api/cron/planyo-sync` still ticks
 * daily and returns immediately; a retired job that costs nothing is worth
 * more than one that needs a deploy to resurrect. If it is still dark in a
 * month, delete the vercel.json entry and this module together.
 *
 * IT CANNOT RUN IN THE DARK. When the override is set, the mirror posts a
 * Slack line saying so on every run. A flag flipped for one bad morning and
 * then forgotten is the failure mode this exists to prevent — silent
 * imports resuming weeks later against a book nobody is reconciling.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. Historical rows keep their
 * `PLANYO_BACKFILL` source and `planyoCartId`; the audit tables
 * (`PlanyoSyncRun` / `PlanyoSyncEvent`) keep every run ever made; the
 * `/planyo-cancellations` queue still works on the last run's candidates
 * so a residual backlog stays clearable. And `scripts/scheduling-planyo-migration.ts`
 * is NOT gated — a human running the importer by hand is a deliberate act,
 * and it is the recovery path if something turns out to have been left
 * behind in Planyo.
 */

/** The day HQ became the only place reservations are made. */
export const PLANYO_MIRROR_RETIRED_ON = '2026-09-14'

/**
 * True only when someone has deliberately set `PLANYO_MIRROR=1` to
 * resurrect the mirror. Unset — the production state — means off.
 */
export function planyoMirrorEnabled(): boolean {
  return process.env.PLANYO_MIRROR === '1'
}

/** One sentence, used by every surface that has to explain the silence. */
export const PLANYO_MIRROR_RETIRED_NOTE =
  `Planyo mirroring was retired on ${PLANYO_MIRROR_RETIRED_ON} — reservations are made in HQ only. ` +
  `Historical Planyo-imported rows are untouched. Set PLANYO_MIRROR=1 to resume the daily sync.`
