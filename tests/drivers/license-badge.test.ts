/**
 * The licence verdict: what the chip says, and what the gate does.
 *
 * Origin (2026-09-16): a Class A CDL valid through 07/08/2029 was
 * photographed sideways on a check-out sheet; the extraction read
 * 02/08/2025 and the roster went red with "Expired". Nothing could clear
 * it — "Mark checked" only flips a boolean, re-uploading re-runs the same
 * read — so a driver holding a current licence was unbookable and his own
 * pickup page withheld the gate code.
 *
 * Two rules come out of that, and this guards both:
 *   1. WORDING follows who confirmed the date. An unchecked read that
 *      looks expired says "Check date"; only a date a human has signed
 *      off on is allowed to say "Expired".
 *   2. The BLOCK never softens. Both cases still refuse the handover —
 *      a genuinely expired card must not walk out on a maybe.
 *
 * Run: npm run test:license-badge
 */
import { evaluateLicenseGate, licenseBadge } from '../../src/lib/drivers/licenseGate'

const NOW = new Date('2026-09-18T12:00:00Z')
const onFile = { licenseFrontUrl: 'front', licenseBackUrl: 'back' }

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

// ── The chip ─────────────────────────────────────────────────────────
console.log('CHIP:')
const misread = { ...onFile, licenseExpiry: '2025-02-08T00:00:00.000Z', licenseExpired: true, licenseVerified: false }
eq('  read expired, nobody looked  ', licenseBadge(misread, NOW).label, 'Check date')
eq('    tone is a warning, not red ', licenseBadge(misread, NOW).tone, 'attention')

const confirmedExpired = { ...misread, licenseVerified: true }
eq('  expired, staff confirmed     ', licenseBadge(confirmedExpired, NOW).label, 'Expired')
eq('    tone is red                ', licenseBadge(confirmedExpired, NOW).tone, 'expired')

const corrected = { ...onFile, licenseExpiry: '2029-07-08T00:00:00.000Z', licenseExpired: true, licenseVerified: false }
eq('  date fixed, stale flag       ', licenseBadge(corrected, NOW).label, 'Needs check')
eq('  date fixed and checked       ', licenseBadge({ ...corrected, licenseVerified: true }, NOW).label, 'Checked')

// Expiry day itself: a licence is good THROUGH the printed date.
const today = { ...onFile, licenseExpiry: '2026-09-18T00:00:00.000Z', licenseVerified: true }
eq('  expires today, still good    ', licenseBadge(today, NOW).label, 'Checked')

// No date read at all — the boolean is all there is.
eq('  no date, flag says expired   ', licenseBadge({ ...onFile, licenseExpired: true, licenseVerified: true }, NOW).label, 'Expired')
eq('  no date, no flag             ', licenseBadge({ ...onFile, licenseVerified: true }, NOW).label, 'Checked')

// ── The gate ─────────────────────────────────────────────────────────
console.log('\nGATE (the block never softens):')
const g1 = evaluateLicenseGate(misread, NOW)
eq('  unconfirmed expiry blocked   ', g1.ok, false)
eq('    code still EXPIRED         ', g1.code, 'EXPIRED')
eq('    flagged unconfirmed        ', g1.unconfirmedDate, true)
eq('    copy does not accuse       ', /expired\./.test(g1.message), false)

const g2 = evaluateLicenseGate(confirmedExpired, NOW)
eq('  confirmed expiry blocked     ', g2.ok, false)
eq('    not flagged unconfirmed    ', g2.unconfirmedDate, undefined)

const g3 = evaluateLicenseGate({ ...corrected, licenseVerified: true }, NOW)
eq('  corrected + checked passes   ', g3.ok, true)
eq('  corrected, unchecked blocked ', evaluateLicenseGate(corrected, NOW).code, 'NOT_CHECKED')
eq('  nothing on file blocked      ', evaluateLicenseGate({ licenseVerified: true }, NOW).code, 'NO_LICENSE')

console.log(fail === 0 ? '\nAll good.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
