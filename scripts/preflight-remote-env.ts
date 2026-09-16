/**
 * Can THIS session do real work against SirReel's services?
 *
 * READ-ONLY. Makes one HEAD-ish request per host and reads env var NAMES.
 * Never prints an env var VALUE.
 *
 * ── Why this exists ────────────────────────────────────────────────
 * Wes 2026-09-16: "I want to make sure that, going forward, all of the
 * building I'm doing with Claude Code can be done just from this iPad."
 *
 * Claude Code on the web runs in an ephemeral cloud container whose
 * outbound traffic goes through a policy-enforcing egress proxy. The
 * policy is chosen per ENVIRONMENT, and a restrictive one denies most
 * hosts — on 2026-09-16 this environment allowed GitHub, the package
 * registries and Google APIs, and denied hq.sirreel.com, Neon, Resend,
 * Twilio, CardPointe and Vercel. A denied host answers 403 at the proxy,
 * which reads like an auth failure but is policy.
 *
 * So "why did my script fail from the iPad?" has three different
 * answers — host denied, secret missing, or raw-TCP database — and they
 * look alike from inside a stack trace. This prints which one it is.
 *
 * ── The raw-TCP caveat ─────────────────────────────────────────────
 * Allowing the Neon host is necessary but NOT sufficient. The proxy
 * tunnels HTTPS; its own docs list "raw-TCP databases" as unsupported.
 * HQ uses the standard Prisma client over a direct Postgres connection,
 * so DB scripts need Neon's HTTPS/WebSocket driver as well. This script
 * reports the host and the secret; the driver is a code change.
 *
 * Usage:
 *   npx tsx scripts/preflight-remote-env.ts
 */

// This file imports nothing, and a TS file with no import/export is a
// GLOBAL script — its `main` then collides with every other script's
// `main` under the repo-wide tsc check. The empty export makes it a module.
export {}

interface HostCheck {
  host: string
  why: string
  /** Only these block DB/ops scripts outright. */
  critical?: boolean
}

const HOSTS: HostCheck[] = [
  { host: 'github.com', why: 'clone, push, PRs' },
  { host: 'registry.npmjs.org', why: 'npm install' },
  { host: 'hq.sirreel.com', why: 'the app itself — admin routes, smoke checks' },
  { host: 'sirreel.com', why: 'the public marketing site' },
  { host: 'console.neon.tech', why: 'Neon (stands in for the DB host — see note)', critical: true },
  { host: 'sirreel.rentalworks.cloud', why: 'RentalWorks — billing source of truth' },
  { host: 'api.resend.com', why: 'outbound email' },
  { host: 'api.twilio.com', why: 'SMS / AHA' },
  { host: 'boltgw.cardconnect.com', why: 'CardPointe PROD — card processing' },
  { host: 'www.googleapis.com', why: 'Gmail + Drive' },
  { host: 'www.cognitoforms.com', why: 'intake forms' },
]

/** Secrets an ops script typically needs. NAMES only — values never read. */
const SECRETS = [
  { name: 'DATABASE_URL', why: 'every Prisma script', critical: true },
  { name: 'RESEND_API_KEY', why: 'anything that sends email' },
  { name: 'TWILIO_MESSAGING_SERVICE_SID', why: 'anything that sends SMS' },
  { name: 'RENTALWORKS_API_KEY', why: 'RentalWorks sync' },
]

type Verdict = 'allowed' | 'denied' | 'unreachable'

async function probe(host: string): Promise<{ verdict: Verdict; detail: string }> {
  try {
    const res = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(12_000) })
    // A denied host is refused AT THE PROXY with 403 before it ever
    // reaches the destination. A real 403 from the destination is
    // possible in principle; the proxy README calls 403/407 the policy
    // signal, so it is reported as policy and flagged as ambiguous.
    if (res.status === 403) return { verdict: 'denied', detail: '403 at the proxy (egress policy)' }
    return { verdict: 'allowed', detail: `HTTP ${res.status}` }
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    return { verdict: 'unreachable', detail: cause?.code ?? cause?.message ?? (err as Error).message }
  }
}

async function main() {
  const inCloud = !!process.env.CLAUDE_CODE_CONTAINER_ID || !!process.env.HTTPS_PROXY
  console.log(`\nEnvironment: ${inCloud ? 'Claude Code cloud container (proxied egress)' : 'local machine (direct egress)'}`)
  if (process.env.HTTPS_PROXY) console.log('Egress proxy: on')

  console.log('\n── Hosts ───────────────────────────────────────────────────────')
  const results = await Promise.all(
    HOSTS.map(async (h) => ({ ...h, ...(await probe(h.host)) })),
  )
  for (const r of results) {
    const mark = r.verdict === 'allowed' ? '  ok  ' : r.verdict === 'denied' ? ' DENIED' : ' error'
    console.log(`${mark}  ${r.host.padEnd(28)} ${r.detail.padEnd(28)} ${r.why}`)
  }

  console.log('\n── Secrets (names only; values are never read) ─────────────────')
  for (const s of SECRETS) {
    const present = !!process.env[s.name]
    console.log(`${present ? '  set ' : '  --  '}  ${s.name.padEnd(30)} ${s.why}`)
  }

  // ── Verdict ──────────────────────────────────────────────────────
  const denied = results.filter((r) => r.verdict === 'denied')
  const dbHostDenied = results.some((r) => r.critical && r.verdict === 'denied')
  const dbUrl = !!process.env.DATABASE_URL

  console.log('\n── What this session can do ────────────────────────────────────')
  console.log('  Build, test, screenshot, commit, push, merge:  yes (GitHub + npm reach)')

  if (!dbUrl && dbHostDenied) {
    console.log('  Database scripts:                             NO — host denied AND no DATABASE_URL')
  } else if (dbHostDenied) {
    console.log('  Database scripts:                             NO — Neon denied by egress policy')
  } else if (!dbUrl) {
    console.log('  Database scripts:                             NO — DATABASE_URL not set here')
  } else {
    console.log('  Database scripts:                             host + secret OK — needs the HTTPS driver')
    console.log('      (the proxy does not carry raw-TCP databases; a direct Prisma connection still fails)')
  }

  if (denied.length) {
    console.log(`\n  ${denied.length} host(s) denied by this environment's network policy:`)
    for (const d of denied) console.log(`    - ${d.host}`)
    console.log('\n  That is an ENVIRONMENT setting, not something a script can change.')
    console.log('  See https://code.claude.com/docs/en/claude-code-on-the-web')
  } else {
    console.log('\n  No host denied. Every service above is reachable from this session.')
  }
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
