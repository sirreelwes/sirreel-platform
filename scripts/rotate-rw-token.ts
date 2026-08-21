#!/usr/bin/env tsx
/**
 * Mint a fresh RentalWorks API token from credentials — no browser scrape.
 *
 * RentalWorks (a Database Works "FW" product) DOES expose a login endpoint,
 * POST /api/v1/jwt, taking { UserName, Password } and returning
 * { access_token, expires_in, resetpassword }. This is the call the SPA
 * makes at login; the 2026-08-16 walkthrough missed it (it probed
 * /login, /auth/login, /sessions, /token, /authentication/logon — all 404 —
 * but never /jwt). Discovered 2026-08-20 by probing /api/v1/jwt directly:
 * an empty body 500s on the SQL (@username/@usertype params), and a
 * junk credential returns a clean 401 in the documented shape.
 *
 * This turns rotation from a 10-minute DevTools scrape into one command,
 * and makes true automation possible (see the runbook's "automation"
 * section). It does NOT reduce the credential's blast radius — the minted
 * token is still full read/write — so treat the OUTPUT exactly like the
 * scraped bearer it replaces.
 *
 * Usage — credentials come from env or stdin, NEVER argv (argv is visible
 * in `ps aux` to any user on the box) and NEVER a file in the repo:
 *
 *   # From env (e.g. sourced from 1Password CLI):
 *   RW_USERNAME='...' RW_PASSWORD='...' npx tsx scripts/rotate-rw-token.ts
 *
 *   # From stdin as USERNAME<newline>PASSWORD:
 *   printf '%s\n%s\n' "$RW_USER" "$RW_PASS" | npx tsx scripts/rotate-rw-token.ts --stdin
 *
 *   # 1Password one-liner (nothing touches disk or shell history):
 *   op run --env-file=<(echo -e 'RW_USERNAME=op://Private/RentalWorks Admin/username\nRW_PASSWORD=op://Private/RentalWorks Admin/password') -- npx tsx scripts/rotate-rw-token.ts
 *
 * Flags:
 *   --stdin   read "username\npassword" from stdin instead of env
 *   --verify  after minting, GET /api/v1/item?pageSize=1 to confirm the
 *             token is accepted before you trust it
 *   --quiet   print ONLY the raw token on stdout (for piping into
 *             `vercel env add` etc.); diagnostics go to stderr
 *
 * Exit codes:
 *   0  token minted (and, with --verify, confirmed working)
 *   1  credentials rejected (HTTP 401 from /jwt) or verify failed
 *   2  unexpected response / network error — don't trust the result
 *
 * SECURITY: the token is a live full-access credential. With --quiet it is
 * the only thing on stdout so you can pipe it; otherwise it is printed for
 * you to copy into Vercel. Do not commit it, paste it into chat, or save it
 * to a tracked file. See docs/runbooks/rentalworks-token-rotation.md.
 *
 * Companion: scripts/verify-rw-token.ts (verify an existing token).
 */

// Prefixed const names: standalone scripts/ files share one TS scope in the
// build's typecheck, so bare RWT_PING_URL / RWT_TIMEOUT_MS collide with
// verify-rw-token.ts.
// `export {}` makes this file a MODULE, giving it its own scope. Without it
// the file is a global-scope script and its top-level `main`/`post`/`log`
// collide with the identically-named ones in verify-rw-token.ts (also a
// no-import script) during the build's typecheck. The RWT_ prefixes on the
// consts below are belt-and-suspenders for the same reason.
export {}

const RWT_JWT_URL = 'https://sirreel.rentalworks.cloud/api/v1/jwt'
const RWT_PING_URL = 'https://sirreel.rentalworks.cloud/api/v1/item?pageNo=1&pageSize=1'
const RWT_TIMEOUT_MS = 15000

const RWT_QUIET = process.argv.includes('--quiet')
const log = (...a: unknown[]) => { if (!RWT_QUIET) console.error(...a) }

interface JwtResponse {
  statuscode?: number
  statusmessage?: string
  access_token?: string | null
  expires_in?: number
  resetpassword?: boolean
}

async function readCreds(): Promise<{ username: string; password: string } | null> {
  if (process.argv.includes('--stdin')) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const lines = Buffer.concat(chunks).toString('utf8').split('\n')
    const username = (lines[0] ?? '').trim()
    const password = (lines[1] ?? '').replace(/\r?\n$/, '').trim()
    if (!username || !password) return null
    return { username, password }
  }
  const username = process.env.RW_USERNAME?.trim()
  const password = process.env.RW_PASSWORD?.trim()
  if (!username || !password) return null
  return { username, password }
}

async function post(url: string, body: unknown): Promise<{ status: number; json: JwtResponse }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RWT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = (await res.json().catch(() => ({}))) as JwtResponse
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const creds = await readCreds()
  if (!creds) {
    log('✗ No credentials. Set RW_USERNAME + RW_PASSWORD, or pass --stdin with "username\\npassword".')
    log('  See docs/runbooks/rentalworks-token-rotation.md')
    process.exit(2)
  }

  let mint
  try {
    // FW's /jwt returns HTTP 200 even on bad credentials — the real result
    // is in the body's statuscode, not the HTTP status.
    mint = await post(RWT_JWT_URL, { UserName: creds.username, Password: creds.password })
  } catch (err) {
    log(`✗ Network error reaching RentalWorks: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  const { access_token, statuscode, statusmessage, expires_in, resetpassword } = mint.json
  if (!access_token) {
    if (statuscode === 401) {
      log(`✗ Credentials rejected: ${statusmessage ?? 'Invalid user and/or password.'}`)
      process.exit(1)
    }
    log(`✗ Unexpected /jwt response (HTTP ${mint.status}, statuscode ${statuscode ?? '?'}): ${statusmessage ?? '(no message)'}`)
    process.exit(2)
  }
  if (resetpassword) {
    log('⚠ RentalWorks flagged this account for a password reset — the token minted, but log in via the web UI soon to clear it.')
  }

  // exp on FW tokens is cosmetic (300s claim, honored for weeks) — the
  // runbook documents this. Report it, but don't treat it as the lifetime.
  log(`✓ Token minted. RW reports expires_in=${expires_in ?? '?'} (cosmetic — FW honors these for weeks; rotate on the ~50-day cadence regardless).`)

  if (process.argv.includes('--verify')) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), RWT_TIMEOUT_MS)
    try {
      const res = await fetch(RWT_PING_URL, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }, signal: ctrl.signal })
      if (res.ok) {
        log(`✓ Verified against /api/v1/item — HTTP ${res.status}. Safe to deploy.`)
      } else {
        log(`✗ Minted token was REJECTED by /api/v1/item — HTTP ${res.status}. Do not deploy.`)
        process.exit(1)
      }
    } catch (err) {
      log(`✗ Verify request failed: ${err instanceof Error ? err.message : String(err)} — don't trust the result.`)
      process.exit(2)
    } finally {
      clearTimeout(timer)
    }
  }

  // The token is the ONLY thing on stdout, so `... --quiet | pbcopy` or a
  // pipe into `vercel env add` works. Diagnostics above went to stderr.
  process.stdout.write(access_token + '\n')
  process.exit(0)
}

main().catch((err) => {
  log(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
})
