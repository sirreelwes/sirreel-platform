/**
 * The RW sync alert gate: which failure reasons count as transient (eligible
 * to be swallowed while the mirror is still fresh) and which must alert at
 * once. A dead token classified as jitter would be the 2026-08-22 outage
 * again; a 503 classified as an outage is the 2026-09-13 false alarm again.
 */
import assert from 'node:assert/strict'
import { isTransientRwFailure } from '@/lib/rentalworks/syncAlert'

const transient = [
  'RW HTTP 503',
  'RW HTTP 502',
  'RW HTTP 504',
  'page 7: RW HTTP 503 on GET /api/v1/quote',
  'network: fetch failed',
  'TypeError: fetch failed',
  'page 3: read ECONNRESET',
  'network: connect ETIMEDOUT 1.2.3.4:443',
  'Error: socket hang up',
  'TypeError: fetch failed (UND_ERR_CONNECT_TIMEOUT)',
]
const notTransient = [
  'RentalWorks rejected the token — rotate it: docs/runbooks/rentalworks-token-rotation.md',
  'auth: RentalWorks rejected the token (401) on /api/v1/quote?pageNo=1&pageSize=200.',
  'RW HTTP 404',
  'RW HTTP 400',
  'unexpected RW response shape',
  'unknown error',
  'PrismaClientKnownRequestError: Timed out fetching a new connection from the connection pool',
  'hit maxPages (40) without a final page',
  'RwNoCredentialError: no RentalWorks token stored',
]

for (const r of transient) assert.equal(isTransientRwFailure(r), true, `should be transient: ${r}`)
for (const r of notTransient) assert.equal(isTransientRwFailure(r), false, `should NOT be transient: ${r}`)
console.log(`rw-sync-alert-gate: ${transient.length} transient + ${notTransient.length} hard reasons classified correctly`)
