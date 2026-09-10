#!/usr/bin/env tsx
/**
 * Why is the RentalWorks sync not running? — the read-only answer, in one
 * command.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * Every RentalWorks stall so far (invoice mirror 2026-07-27, quote +
 * order mirrors 2026-08-22, order mirror again 2026-09-03) was found by
 * a person going to look, days or weeks late. The detectors that exist
 * are all PUSH: /api/cron/rw-mirror-freshness emails the `rw-token`
 * channel, and reportRwSyncFailure() raises an Alert. Both are useful
 * and both share one hole — they only speak when they themselves run.
 * A cron that is unscheduled, unauthorised, or killed at the function
 * ceiling has nothing to say, which is the exact shape of all four
 * incidents.
 *
 * There was no PULL. `checkRwMirrorFreshness()` had a single caller (the
 * cron), the /collections meter reports the TOKEN and not the mirrors,
 * and no script read either. So "is the sync running?" could not be
 * answered without prod access and a Prisma REPL.
 *
 * This is that pull. It reads and prints; it writes NOTHING — no
 * recordVerify(), no Alert row, no email, and deliberately not rwFetch()
 * (which stamps the credential EXPIRED on a 401 and would turn a
 * diagnostic into a state change).
 *
 * ── Usage ──────────────────────────────────────────────────────────
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/rw-sync-status.ts          # mirrors + credential row
 *   npx tsx scripts/rw-sync-status.ts --ping   # also exercise the token live
 *
 * Exit codes:
 *   0  every mirror inside its threshold and the credential verifies OK
 *   1  something is stale or the credential is not green
 *   2  could not reach the database
 *
 * ── The one thing it cannot tell you ───────────────────────────────
 *
 * Env vars are reported for the shell it runs in. Run locally, that is
 * `.env.local` — NOT Vercel Production, which is where the crons live.
 * A CRON_SECRET that is set here and unset there still breaks
 * /api/admin/rw-invoice-sync (that route, unlike the other RW crons,
 * requires the secret to be both set AND matching — no secret means the
 * request falls through to a session check and 401s). Confirm the Vercel
 * side with `vercel env ls production`.
 */

import { checkRwMirrorFreshness, describeMirror } from '../src/lib/rentalworks/mirrorFreshness'
import { pingRwToken, readRwToken, rwCredentialStatus, ROTATE_AFTER_DAYS } from '../src/lib/rentalworks/credential'
import { prisma } from '../src/lib/prisma'

/** Schedules as declared in vercel.json, so the report can name the gap. */
const SCHEDULES: Record<string, string> = {
  invoice: '/api/admin/rw-invoice-sync — */15 * * * * (every 15 min)',
  quote: '/api/cron/rw-quote-sync — 20 */2 * * * (every 2h)',
  orderRef: '/api/cron/rw-order-refs — 50 1-23/2 * * * (every 2h)',
}

function ageWords(iso: Date | null): string {
  if (!iso) return 'never'
  const h = (Date.now() - iso.getTime()) / 3_600_000
  const stamp = iso.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  if (h < 48) return `${stamp} (${h.toFixed(1)}h ago)`
  return `${stamp} (${Math.floor(h / 24)}d ago)`
}

/** Presence only. A secret's VALUE never reaches stdout from here. */
function envReport(): string[] {
  const names = [
    'DATABASE_URL',
    'RW_TOKEN_KEY',
    'CRON_SECRET',
    'RENTALWORKS_TOKEN',
    'RENTALWORKS_USERNAME',
    'RENTALWORKS_PASSWORD',
    'RW_USERNAME',
    'RW_PASSWORD',
  ]
  return names.map((n) => `  ${process.env[n]?.trim() ? 'set    ' : 'MISSING'}  ${n}`)
}

async function main() {
  const ping = process.argv.includes('--ping')

  console.log('RentalWorks sync status — READ ONLY, nothing below writes.\n')

  console.log('ENVIRONMENT (this shell — NOT Vercel Production)')
  console.log(envReport().join('\n'))
  console.log(
    '\n  Crons run in Vercel Production. An env var set here and unset there\n' +
      '  still breaks the job. Cross-check with: vercel env ls production\n',
  )

  let status
  try {
    status = await rwCredentialStatus()
  } catch (e) {
    console.error(`\n✗ Could not read the credential row: ${(e as Error).message}`)
    console.error('  Is DATABASE_URL exported? See the usage block at the top of this file.')
    process.exit(2)
  }

  console.log('CREDENTIAL (sr_integration_credentials, provider=RENTALWORKS)')
  console.log(`  health          ${status.health.toUpperCase()}`)
  console.log(`  last verified   ${status.lastVerifiedAt ? ageWords(new Date(status.lastVerifiedAt)) : 'never'} — ${status.lastVerifyStatus ?? 'no result recorded'}`)
  console.log(`  last rotated    ${status.lastRotatedAt ? ageWords(new Date(status.lastRotatedAt)) : 'never through HQ'}`)
  console.log(`  renews at       ${status.rotateDueAt ? status.rotateDueAt.slice(0, 10) : `n/a (${ROTATE_AFTER_DAYS}d after a rotation)`}`)
  console.log(`  last changed by ${status.updatedBy ?? '—'}`)
  if (status.usingEnvFallback) {
    console.log('  NOTE            no stored credential — still on the RENTALWORKS_TOKEN env var')
  }

  if (ping) {
    const token = await readRwToken()
    if (!token) {
      console.log('  live ping       no token to ping')
    } else {
      // pingRwToken() is a bare fetch and records nothing. Deliberately
      // not rwFetch(), which would stamp the credential EXPIRED on a 401.
      const r = await pingRwToken(token)
      console.log(`  live ping       ${r.ok ? 'accepted' : 'REJECTED'} (HTTP ${r.httpStatus || 'network error'})`)
    }
  }

  const health = await checkRwMirrorFreshness()
  console.log('\nMIRRORS')
  for (const h of health) {
    console.log(`\n  [${h.stale ? 'STALE' : ' ok  '}] ${describeMirror(h).split('\n').join('\n  ')}`)
    console.log(`    schedule: ${SCHEDULES[h.mirror] ?? 'unknown'}`)
  }

  const stale = health.filter((h) => h.stale)
  console.log('\n' + '─'.repeat(64))
  if (stale.length === 0 && status.health === 'green') {
    console.log('Everything is current.')
    await prisma.$disconnect()
    process.exit(0)
  }

  // Name the next move rather than the symptom — this is read by someone
  // who just found out the data is stale and wants the fix, not a metric.
  console.log('WHAT TO CHECK NEXT\n')
  if (status.health !== 'green') {
    console.log('  · The credential is not green. Rotate it on the RentalWorks card')
    console.log('    at /collections, or run scripts/rotate-rw-token.ts.')
    console.log('    Runbook: docs/runbooks/rentalworks-token-rotation.md')
  }
  for (const h of stale) {
    console.log(`  · ${h.label} is stale. Its cron is ${SCHEDULES[h.mirror] ?? 'unscheduled'}.`)
    if (h.cursor?.lastError) {
      // A cursor still holding its "run started" note means the function
      // was killed before it could report — see pagedSync.ts.
      console.log(`    Cursor says: ${h.cursor.lastError}`)
    }
    console.log('    Run it by hand to see the real error:')
    console.log(
      `      curl -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com${
        (SCHEDULES[h.mirror] ?? '').split(' ')[0]
      }`,
    )
  }
  console.log(
    '\n  If a hand-run succeeds but the schedule does not, the job is not being\n' +
      '  invoked at all: check Vercel → Project → Cron Jobs for the last run of\n' +
      '  each path, and confirm CRON_SECRET is set in Production.',
  )

  await prisma.$disconnect()
  process.exit(1)
}

main().catch(async (e) => {
  console.error('\n✗ rw-sync-status failed:', e)
  await prisma.$disconnect().catch(() => {})
  process.exit(2)
})
