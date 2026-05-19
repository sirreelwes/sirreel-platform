#!/usr/bin/env tsx
/**
 * Verify a RentalWorks API token without ever logging its value. Makes
 * one cheap GET against /api/v1/item?pageNo=1&pageSize=1 and reports
 * back whether the token is accepted.
 *
 * Usage:
 *
 *   # Preferred — pass via env var so the token isn't in argv (visible
 *   # to other users via `ps aux`):
 *   RENTALWORKS_TOKEN=<paste-token> npx tsx scripts/verify-rw-token.ts
 *
 *   # Or read from stdin:
 *   echo "<paste-token>" | npx tsx scripts/verify-rw-token.ts --stdin
 *
 * Exit codes:
 *   0  token valid (HTTP 200)
 *   1  token rejected (HTTP 401 / 403)
 *   2  unexpected response or network error (don't trust the result)
 *
 * Companion runbook: docs/runbooks/rentalworks-token-rotation.md
 */

const PING_URL = 'https://sirreel.rentalworks.cloud/api/v1/item?pageNo=1&pageSize=1'
const TIMEOUT_MS = 10000

async function readToken(): Promise<string | null> {
  const useStdin = process.argv.includes('--stdin')
  if (useStdin) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const value = Buffer.concat(chunks).toString('utf8').trim()
    return value || null
  }
  const env = process.env.RENTALWORKS_TOKEN?.trim()
  return env || null
}

async function main() {
  const token = await readToken()
  if (!token) {
    console.error('✗ No token provided. Set RENTALWORKS_TOKEN or pass --stdin.')
    console.error('  See docs/runbooks/rentalworks-token-rotation.md')
    process.exit(2)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(PING_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })

    if (res.ok) {
      console.log(`✓ Token valid — safe to deploy (HTTP ${res.status}, ${res.statusText || 'OK'})`)
      process.exit(0)
    }
    if (res.status === 401 || res.status === 403) {
      console.log(`✗ Token rejected (HTTP ${res.status}). Regenerate via the RW admin UI.`)
      console.log(`  See docs/runbooks/rentalworks-token-rotation.md`)
      process.exit(1)
    }
    console.log(`✗ Unexpected response (HTTP ${res.status} ${res.statusText}). Cannot confirm token validity.`)
    process.exit(2)
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err?.message || String(err)
    console.log(`✗ Unexpected error: ${reason}`)
    process.exit(2)
  } finally {
    clearTimeout(timer)
  }
}

main()
