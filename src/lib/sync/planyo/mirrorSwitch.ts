/**
 * Planyo mirror kill switch — now the retirement record.
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
 * THE ROLLBACK IS GONE, AND THAT IS THE POINT OF THIS FILE TODAY.
 * Until 2026-09-19 the mirror was one env var from coming back:
 * `PLANYO_MIRROR=1` in Production, no deploy — which is what you want on
 * day two of a cutover. **Wes cancelled the Planyo account on
 * 2026-09-19.** There is no longer an upstream to mirror. The site (ID
 * 36171), its API key and its book are gone, so the override cannot
 * restore anything: setting it would only point a live importer at a dead
 * account. `planyoMirrorEnabled()` therefore returns false unconditionally
 * and reads no environment at all.
 *
 * WHAT WOULD HAPPEN IF THE GATE EVER REOPENED. Nothing silent, which is
 * worth knowing before anyone tries: a cancelled account fails the pull
 * (`FAILED_PULL` on a rejected key) or returns an empty book, which the
 * suspicious-low guard in runSync catches — both abort before a single
 * write. So the failure mode is a red run and a Slack alert, never a
 * wrongly-released truck. The gate stays shut anyway: a red cron every
 * morning is still a cost, and a staff surface that reaches a cancelled
 * vendor is still a bug.
 *
 * SETTING THE VARIABLE IS NOT SILENT. It no longer does anything, so the
 * daily no-op tick says so in Slack (see the cron route) rather than
 * leaving someone to believe a rollback took. The old switch alerted
 * because an override could run in the dark; this one alerts because an
 * override can be believed in the dark.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. Historical rows keep their
 * `PLANYO_BACKFILL` source and `planyoCartId`; the audit tables
 * (`PlanyoSyncRun` / `PlanyoSyncEvent`) keep every run ever made; and the
 * `/planyo-cancellations` queue still works on the last run's candidates,
 * so the residual backlog stays clearable. Clearing that queue is the
 * remaining step — only once it is empty is the sync code itself safe to
 * delete, because the queue reads those audit rows and releases through
 * `settleCancellation`.
 *
 * NO LONGER A RECOVERY PATH. `scripts/scheduling-planyo-migration.ts` and
 * the `backfill-planyo-*` / `planyo-unit-alignment` scripts all read the
 * Planyo REST API. With the account closed they cannot run, whoever runs
 * them. Nothing in Planyo can be re-imported; if something was left
 * behind there, it was left behind for good.
 */

/** The day HQ became the only place reservations are made. */
export const PLANYO_MIRROR_RETIRED_ON = '2026-09-14'

/** The day the Planyo account itself was cancelled — no upstream left. */
export const PLANYO_ACCOUNT_CLOSED_ON = '2026-09-19'

/**
 * Always false. The Planyo account is closed, so there is nothing to
 * mirror and no env var that can change that — see the header.
 *
 * Typed `boolean` rather than `false` on purpose: the gates downstream
 * stay live code rather than collapsing into branches the compiler prunes
 * and a reader stops maintaining.
 */
export function planyoMirrorEnabled(): boolean {
  return false
}

/**
 * True when someone has set `PLANYO_MIRROR=1` expecting the old rollback.
 * It changes nothing — it exists so the surfaces that notice can TELL
 * them it changed nothing, instead of letting a flipped variable read as
 * a mirror quietly coming back.
 */
export function planyoMirrorOverrideIgnored(): boolean {
  return process.env.PLANYO_MIRROR === '1'
}

/** One sentence, used by every surface that has to explain the silence. */
export const PLANYO_MIRROR_RETIRED_NOTE =
  `Planyo mirroring was retired on ${PLANYO_MIRROR_RETIRED_ON} — reservations are made in HQ only — ` +
  `and the Planyo account was cancelled on ${PLANYO_ACCOUNT_CLOSED_ON}, so there is no longer anything to ` +
  `mirror and no way to resume the sync. Historical Planyo-imported rows are untouched.`
