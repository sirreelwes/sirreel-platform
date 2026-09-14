/**
 * Planyo mirror kill switch (cutover 2026-09-14) — the fences, asserted.
 *
 * The whole point of this switch is that OFF is the deployed default: no
 * env var is set in Production, so shipping the code is the cutover. A
 * regression that made the switch default ON would silently resume
 * importing Planyo carts into a native book — minting duplicate holds on
 * real trucks — and nothing else in the system would notice. So:
 *
 *   · unset means OFF (the production state)
 *   · only the exact string '1' turns it on — not 'true', not 'yes',
 *     not '0', not empty. A truthy-string check would have made
 *     `PLANYO_MIRROR=0` mean ON, which is the worst possible reading
 *     of an operator trying to confirm the mirror is off.
 *
 * Run: npm run test:planyo-mirror
 */
import {
  planyoMirrorEnabled,
  PLANYO_MIRROR_RETIRED_ON,
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

// ── The default IS the cutover ──────────────────────────────────────────────
withEnv(undefined, () => eq('unset → mirror OFF', planyoMirrorEnabled(), false))
withEnv('', () => eq('empty string → OFF', planyoMirrorEnabled(), false))

// ── Only an explicit '1' resurrects it ──────────────────────────────────────
withEnv('1', () => eq("'1' → mirror ON", planyoMirrorEnabled(), true))
withEnv('0', () => eq("'0' → OFF (never truthy-string)", planyoMirrorEnabled(), false))
withEnv('true', () => eq("'true' → OFF (exact match only)", planyoMirrorEnabled(), false))
withEnv('yes', () => eq("'yes' → OFF", planyoMirrorEnabled(), false))
withEnv(' 1', () => eq("' 1' → OFF (no trimming)", planyoMirrorEnabled(), false))

// ── The note staff and future sessions read ─────────────────────────────────
eq('retired-on date is the cutover day', PLANYO_MIRROR_RETIRED_ON, '2026-09-14')
eq(
  'note names the date',
  PLANYO_MIRROR_RETIRED_NOTE.includes(PLANYO_MIRROR_RETIRED_ON),
  true,
)
eq(
  'note names the rollback variable',
  PLANYO_MIRROR_RETIRED_NOTE.includes('PLANYO_MIRROR=1'),
  true,
)

console.log(fail === 0 ? '\nAll checks passed.' : `\n${fail} check(s) FAILED.`)
process.exit(fail === 0 ? 0 : 1)
