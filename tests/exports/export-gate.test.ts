/**
 * Data-export gate tests — who may release the client book, and what the
 * CSV does with hostile input.
 *
 *   npx tsx tests/exports/export-gate.test.ts
 *   npm run test:export-gate
 *
 * Pure + offline: no DB, no session, no env beyond what each case sets.
 *
 * These guard Wes's standing rule (2026-08-26). The failure directions are
 * asymmetric and both bad:
 *   - a FALSE approver lets someone else release the entire client list
 *   - a FALSE non-approver locks Wes out of his own data
 * The first is the one that cannot be undone, so the default must be "no".
 */

import { isExportApprover } from '../../src/lib/exports/approver'
import { effectiveStatus, isDownloadable } from '../../src/lib/exports/requestStatus'
import { normalizeFilters, escapeCsvCell } from '../../src/lib/exports/clientListCsv'

const failures: string[] = []

function eq(got: unknown, want: unknown, why: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}

// ── Approver identity ────────────────────────────────────────────────
console.log('Who may approve an export\n')

eq(isExportApprover('wes@sirreel.com'), true, 'Wes approves')
eq(isExportApprover('WES@SirReel.com'), true, 'case-insensitive — Google can hand back mixed case')

// The whole reason this is not a role check. Dani is ADMIN.
eq(isExportApprover('dani@sirreel.com'), false, 'Dani is ADMIN but NOT an approver')
eq(isExportApprover('hugo@sirreel.com'), false, 'GM is not an approver')
eq(isExportApprover('jose@sirreel.com'), false, 'sales is not an approver')
eq(isExportApprover(null), false, 'null email is never an approver')
eq(isExportApprover(undefined), false, 'undefined email is never an approver')
eq(isExportApprover(''), false, 'empty email is never an approver')
// Substring/prefix confusion — an attacker-controlled Google Workspace
// account must not slip through a sloppy comparison.
eq(isExportApprover('wes@sirreel.com.evil.com'), false, 'suffix-extended domain rejected')
eq(isExportApprover('notwes@sirreel.com'), false, 'prefix-extended local part rejected')

// ── Approval lifecycle ───────────────────────────────────────────────
console.log('\nWhen an approval is spendable\n')

const hourAgo = new Date(Date.now() - 3_600_000)
const hourAhead = new Date(Date.now() + 3_600_000)

eq(effectiveStatus({ status: 'PENDING', expiresAt: null }), 'PENDING', 'pending stays pending')
eq(effectiveStatus({ status: 'DENIED', expiresAt: null }), 'DENIED', 'denied stays denied')
eq(effectiveStatus({ status: 'APPROVED', expiresAt: hourAhead }), 'APPROVED', 'approved inside window')
eq(effectiveStatus({ status: 'APPROVED', expiresAt: hourAgo }), 'EXPIRED', 'approved past window → EXPIRED')
eq(effectiveStatus({ status: 'FULFILLED', expiresAt: hourAgo }), 'EXPIRED', 'fulfilled past window → EXPIRED')
eq(effectiveStatus({ status: 'FULFILLED', expiresAt: hourAhead }), 'FULFILLED', 're-download allowed inside window')

eq(isDownloadable({ status: 'PENDING', expiresAt: null }), false, 'pending never downloads')
eq(isDownloadable({ status: 'DENIED', expiresAt: null }), false, 'denied never downloads')
eq(isDownloadable({ status: 'APPROVED', expiresAt: hourAgo }), false, 'expired never downloads')
eq(isDownloadable({ status: 'APPROVED', expiresAt: hourAhead }), true, 'live approval downloads')

// ── Scope snapshot ───────────────────────────────────────────────────
console.log('\nWhat scope gets snapshotted\n')

eq(normalizeFilters({ search: 'acme', tier: 'VIP', segment: 'quiet' }),
   { search: 'acme', tier: 'VIP', segment: 'quiet' }, 'known filters survive')
// topClients is defined against a live spend cutoff, so the approved set and
// the delivered set could differ. It must degrade to "all", never silently
// re-run as a moving target.
eq(normalizeFilters({ segment: 'topClients' }),
   { search: null, tier: null, segment: null }, 'topClients segment dropped')
eq(normalizeFilters({ segment: 'made-up' }),
   { search: null, tier: null, segment: null }, 'unknown segment dropped')
eq(normalizeFilters(null), { search: null, tier: null, segment: null }, 'null body → all clients')
eq(normalizeFilters({ search: '   ' }), { search: null, tier: null, segment: null }, 'blank search normalized away')
eq(normalizeFilters({ search: 'x'.repeat(500) }).search?.length, 200, 'search is length-capped')

// ── CSV shape + injection ────────────────────────────────────────────
// Company notes, addresses and contact names are free text a client can
// influence. Excel/Sheets execute a leading = + - @ on open, so an export of
// our own book must not become a payload delivered to whoever opens it.
console.log('\nCSV escaping\n')

eq(escapeCsvCell('Acme Films'), 'Acme Films', 'plain value untouched')
eq(escapeCsvCell(null), '', 'null → empty cell')
eq(escapeCsvCell(undefined), '', 'undefined → empty cell')
eq(escapeCsvCell(0), '0', 'zero is not blank')
eq(escapeCsvCell('Smith, John'), '"Smith, John"', 'comma forces quoting')
eq(escapeCsvCell('He said "hi"'), '"He said ""hi"""', 'quotes are doubled')
eq(escapeCsvCell('line1\nline2'), '"line1\nline2"', 'newline forces quoting')
eq(escapeCsvCell('=1+1'), "'=1+1", 'leading = neutralized')
eq(escapeCsvCell('+1-555-0100'), "'+1-555-0100", 'leading + neutralized')
eq(escapeCsvCell('-lookup'), "'-lookup", 'leading - neutralized')
eq(escapeCsvCell('@SUM(A1)'), "'@SUM(A1)", 'leading @ neutralized')
// The nasty combination: a formula that also contains a comma must be BOTH
// de-fanged and quoted, or the row silently splits into two columns.
eq(
  escapeCsvCell('=HYPERLINK("http://x","a,b")'),
  '"\'=HYPERLINK(""http://x"",""a,b"")"',
  'formula + comma + quotes handled together',
)

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('All export-gate tests passed.')
