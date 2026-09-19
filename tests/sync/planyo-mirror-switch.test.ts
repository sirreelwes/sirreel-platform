/**
 * Planyo mirror kill switch — the fences, asserted.
 *
 * ORIGINALLY (cutover 2026-09-14) this file pinned a two-state switch:
 * OFF by deployed default, back ON with `PLANYO_MIRROR=1`. The exact-'1'
 * match mattered because a truthy-string check would have made
 * `PLANYO_MIRROR=0` mean ON — the worst possible reading of an operator
 * confirming the mirror is off.
 *
 * SINCE 2026-09-19 THERE IS NO ON. Wes cancelled the Planyo account, so
 * no env var can resurrect a mirror of a book that no longer exists. What
 * this file pins now is the inversion:
 *
 *   · the mirror is off no matter what the environment says — including
 *     the one value that used to turn it on, which is the regression
 *     worth catching, because that string is written down in a year of
 *     comments, runbooks and Slack history as the way back;
 *   · the override is still RECOGNISED, so a surface can say "you set
 *     that and it did nothing" rather than going quiet on someone who
 *     believes they just rolled back;
 *   · the note staff read names the closure, not a rollback recipe.
 *
 * Run: npm run test:planyo-mirror
 */
import {
  planyoMirrorEnabled,
  planyoMirrorOverrideIgnored,
  PLANYO_MIRROR_RETIRED_ON,
  PLANYO_ACCOUNT_CLOSED_ON,
  PLANYO_MIRROR_RETIRED_NOTE,
} from '@/lib/sync/planyo/mirrorSwitch'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const withEnv = (value: string | undefined, fn: () => void) => {
  const prev = process.env.PLANYO_MIRROR
  if (value === undefined) delete process.env.PLANYO_MIRROR
  else process.env.PLANYO_MIRROR = value
  try { fn() } finally {
    if (prev === undefined) delete process.env.PLANYO_MIRROR
    else process.env.PLANYO_MIRROR = prev
  }
}

// ── There is no longer an ON ────────────────────────────────────────────────
withEnv(undefined, () => eq('unset → mirror OFF', planyoMirrorEnabled(), false))
withEnv('', () => eq('empty string → OFF', planyoMirrorEnabled(), false))
withEnv('0', () => eq("'0' → OFF", planyoMirrorEnabled(), false))
withEnv('true', () => eq("'true' → OFF", planyoMirrorEnabled(), false))
withEnv('yes', () => eq("'yes' → OFF", planyoMirrorEnabled(), false))
// The one that used to work. Everything written before 2026-09-19 —
// comments, the cutover note, Slack — points at this string as the way
// back, so this is the assertion that has to hold.
withEnv('1', () => eq("'1' → STILL OFF (account closed; no rollback)", planyoMirrorEnabled(), false))

// ── But the attempt is still recognised, so it can be answered ──────────────
withEnv('1', () => eq("'1' → override seen and reported as ignored", planyoMirrorOverrideIgnored(), true))
withEnv(undefined, () => eq('unset → nothing to report', planyoMirrorOverrideIgnored(), false))
withEnv('0', () => eq("'0' → not an override attempt", planyoMirrorOverrideIgnored(), false))
withEnv('true', () => eq("'true' → not an override attempt (exact match)", planyoMirrorOverrideIgnored(), false))
withEnv(' 1', () => eq("' 1' → not an override attempt (no trimming)", planyoMirrorOverrideIgnored(), false))

// ── The note staff and future sessions read ─────────────────────────────────
eq('retired-on date is the cutover day', PLANYO_MIRROR_RETIRED_ON, '2026-09-14')
eq('account-closed date is the cancellation day', PLANYO_ACCOUNT_CLOSED_ON, '2026-09-19')
eq(
  'note names the cutover date',
  PLANYO_MIRROR_RETIRED_NOTE.includes(PLANYO_MIRROR_RETIRED_ON),
  true,
)
eq(
  'note names the account closure',
  PLANYO_MIRROR_RETIRED_NOTE.includes(PLANYO_ACCOUNT_CLOSED_ON),
  true,
)
// The note is read by someone wondering why the sync is quiet. Offering
// them `PLANYO_MIRROR=1` now sends them to set a variable that does
// nothing against an account that no longer exists.
eq(
  'note no longer offers the dead rollback recipe',
  PLANYO_MIRROR_RETIRED_NOTE.includes('PLANYO_MIRROR=1'),
  false,
)

console.log(fail === 0 ? '\nAll checks passed.' : `\n${fail} check(s) FAILED.`)
process.exit(fail === 0 ? 0 : 1)
