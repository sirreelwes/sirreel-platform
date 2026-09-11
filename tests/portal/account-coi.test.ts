/**
 * What a production company is told about its certificates in the account
 * portal.
 *
 *   npx tsx tests/portal/account-coi.test.ts
 *   npm run test:account-coi
 *
 * Pure + offline: no DB, no env. Two directions of wrongness:
 *
 *   - Telling a client a certificate "covers your shows" when the carry-
 *     forward will not use it (unreviewed, undated, declined or lapsed).
 *     Rules 1 and 3 of lib/coi/companyCoi.ts, said out loud to the client.
 *
 *   - Hiding what they just sent. The uploader must see their certificate
 *     land at the top, in review, the moment the upload returns.
 */

import {
  accountCoiSummary,
  clientCoiStatus,
  groupStaffAccountCois,
  selectClientCois,
  type RawAccountCoi,
  type RawStaffAccountCoi,
} from '../../src/lib/portal/companyPortalCois'
import { coiDocumentKind } from '../../src/lib/coi/coverageKind'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const d = (s: string) => new Date(s)
const now = d('2026-09-11T18:00:00Z')

let n = 0
const cert = (humanDecision: string, expiry: string | null, created = '2026-09-01T00:00:00Z', source = 'CLIENT_UPLOAD'): RawAccountCoi => ({
  id: `c${++n}`,
  originalFilename: `cert-${n}.pdf`,
  createdAt: d(created),
  source,
  clientUploaderName: source === 'CLIENT_UPLOAD' ? 'Nancy' : null,
  namedInsured: 'Happy Place LLC',
  policyExpiryDate: expiry ? d(expiry) : null,
  humanDecision,
})

console.log('status')
check('PENDING is in review, never accepted', clientCoiStatus(cert('PENDING', '2027-03-01'), now) === 'IN_REVIEW')
check('COUNTERED is in review', clientCoiStatus(cert('COUNTERED', '2027-03-01'), now) === 'IN_REVIEW')
check('APPROVED + future expiry is accepted', clientCoiStatus(cert('APPROVED', '2027-03-01'), now) === 'ACCEPTED')
check('APPROVED expiring TODAY still counts (calendar date)', clientCoiStatus(cert('APPROVED', '2026-09-11T00:00:00Z'), now) === 'ACCEPTED')
check('APPROVED but lapsed is expired', clientCoiStatus(cert('APPROVED', '2026-09-10'), now) === 'EXPIRED')
check('REJECTED is not accepted even when dated ahead', clientCoiStatus(cert('REJECTED', '2027-03-01'), now) === 'NOT_ACCEPTED')

console.log('covers your shows')
{
  const rows = selectClientCois([cert('PENDING', '2027-03-01'), cert('APPROVED', null), cert('APPROVED', '2027-01-01')], now)
  const pending = rows.find((r) => r.status === 'IN_REVIEW')!
  const undated = rows.find((r) => r.status === 'ACCEPTED' && !r.policyExpiry)!
  const dated = rows.find((r) => r.status === 'ACCEPTED' && r.policyExpiry)!
  check('an unreviewed certificate never covers shows', pending.coversShows === false)
  check('an undated approval never covers shows (rule 3)', undated.coversShows === false)
  check('an approved, dated, current certificate covers shows', dated.coversShows === true)
}

console.log('selection + order')
{
  const justSent = cert('PENDING', '2027-06-01', '2026-09-11T17:59:00Z')
  const annual = cert('APPROVED', '2027-03-08', '2026-09-02T00:00:00Z', 'EMAIL_HARVEST')
  const oldExpired = cert('APPROVED', '2025-10-01', '2024-10-01T00:00:00Z')
  const oldRejected = cert('REJECTED', '2027-01-01', '2026-06-01T00:00:00Z')
  const rows = selectClientCois([annual, oldExpired, oldRejected, justSent], now)
  check('what they just sent is first', rows[0]?.id === justSent.id)
  check('the accepted annual is listed', rows.some((r) => r.id === annual.id))
  check('a harvested cert reads as filed by SirReel', rows.find((r) => r.id === annual.id)?.uploadedBy === null)
  check('an expired cert is hidden while a live one is on file', !rows.some((r) => r.id === oldExpired.id))
  check('a declined cert older than 60 days drops off', !rows.some((r) => r.id === oldRejected.id))
}
{
  const lapsedNewer = cert('APPROVED', '2025-10-01')
  const lapsedOlder = cert('APPROVED', '2024-10-01')
  const rows = selectClientCois([lapsedOlder, lapsedNewer], now)
  check('with nothing live, the newest lapsed policy is shown (send the renewal)', rows.length === 1 && rows[0].id === lapsedNewer.id)
}
{
  const recentRejected = cert('REJECTED', '2027-01-01', '2026-09-05T00:00:00Z')
  const lapsed = cert('APPROVED', '2025-10-01')
  const rows = selectClientCois([recentRejected, lapsed], now)
  check('a recent decline is shown', rows.some((r) => r.id === recentRejected.id))
  check('a decline is not "live" — the lapsed policy still shows beside it', rows.some((r) => r.id === lapsed.id))
}

console.log('terms-block summary')
{
  check('nothing on file → null (caller falls back to the cached columns)', accountCoiSummary([]) === null)
  const inReview = selectClientCois([cert('PENDING', '2027-01-01')], now)
  const s1 = accountCoiSummary(inReview)
  check('only an unreviewed cert → "in review", never a date', !!s1 && 'inReview' in s1)
  const both = selectClientCois([cert('APPROVED', '2027-01-01'), cert('APPROVED', '2027-05-01'), cert('PENDING', '2028-01-01')], now)
  const s2 = accountCoiSummary(both)
  check('the latest ACCEPTED expiry wins, not the pending one', !!s2 && 'through' in s2 && s2.through.startsWith('2027-05-01'))
}

console.log("workers' comp on its own")
{
  const full = { generalLiability: { pass: true, perOccurrence: { found: '$1,000,000' } }, autoLiability: { found: '$1,000,000 CSL' }, workersComp: { found: 'Policy 7997-9687' } }
  const neon = { generalLiability: { pass: false, found: '' }, workersComp: { pass: true, found: 'Policy WC 080772104, E.L. $1,000,000' } }
  const wordy = { generalLiability: { found: 'Not listed' }, autoLiability: { found: 'None' }, workersComp: { found: 'WC PI 1476810-002' } }
  const preChecklist = { coverageVerified: true, workersComp: { found: 'WC on file' } }
  check('a full certificate that also lists WC is a COI', coiDocumentKind(full) === 'COI')
  check('no GL, no auto, WC present → workers’ comp (Neon / EP payroll cert)', coiDocumentKind(neon) === 'WORKERS_COMP')
  check('"Not listed" / "None" read as absent', coiDocumentKind(wordy) === 'WORKERS_COMP')
  check('a review that never recorded GL stays a COI — never mislabel real insurance', coiDocumentKind(preChecklist) === 'COI')
  check('no review at all is a COI', coiDocumentKind(null) === 'COI')

  const wcApproved = { ...cert('APPROVED', '2027-05-09'), aiResponse: neon }
  const rows = selectClientCois([wcApproved], now)
  check('an approved workers’ comp cert is labelled as one', rows[0]?.kind === 'WORKERS_COMP')
  check('an approved workers’ comp cert never "covers your shows"', rows[0]?.coversShows === false)
  check('…and never sets "Insurance on file"', accountCoiSummary(rows) === null)
}

console.log('duplicate copies of an accepted policy')
{
  const approved = cert('APPROVED', '2027-05-15', '2026-09-10T23:28:00Z', 'INTERNAL')
  const pendingCopy = cert('PENDING', '2027-05-15', '2026-09-10T23:26:00Z', 'INTERNAL')
  const rejectedCopy = cert('REJECTED', '2027-05-15', '2026-09-10T23:27:00Z', 'INTERNAL')
  const renewal = cert('PENDING', '2028-05-15', '2026-09-11T10:00:00Z')
  const rows = selectClientCois([approved, pendingCopy, rejectedCopy, renewal], now)
  check('the pending copy of an accepted policy is hidden (Happy Place)', !rows.some((r) => r.id === pendingCopy.id))
  check('a rejected copy of an accepted policy is hidden too', !rows.some((r) => r.id === rejectedCopy.id))
  check('a renewal (different expiry) still shows in review', rows.some((r) => r.id === renewal.id && r.status === 'IN_REVIEW'))
  check('the accepted one shows', rows.some((r) => r.id === approved.id))
  const approvedCopy = cert('APPROVED', '2027-05-15', '2026-09-10T23:26:00Z', 'INTERNAL')
  const both = selectClientCois([approvedCopy, approved], now)
  check('two ACCEPTED copies of one policy show once — the newest filed', both.length === 1 && both[0].id === approved.id)
}

console.log('staff grouping (/crm/portals)')
{
  const staff = (c: RawAccountCoi, fileSize: number, companyId = 'co1'): RawStaffAccountCoi => ({ ...c, companyId, fileSize, jobCode: 'SR-JOB-0351', uploaderName: 'Oliver Carlson' })
  const approved = staff({ ...cert('APPROVED', '2027-05-15', '2026-09-10T23:28:00Z', 'INTERNAL'), originalFilename: 'COI_SirReel-6.pdf' }, 1449031)
  const copy = staff({ ...cert('PENDING', '2027-05-15', '2026-09-10T23:26:00Z', 'INTERNAL'), originalFilename: 'COI_SirReel.pdf' }, 1449031)
  const different = staff(cert('PENDING', '2027-05-15'), 900)
  const wcApproved = staff({ ...cert('APPROVED', '2028-01-01'), aiResponse: { generalLiability: { found: '' }, workersComp: { found: 'WC 1' } } }, 10)
  const lapsed = staff(cert('PENDING', '2026-01-01'), 5)
  const s = groupStaffAccountCois([approved, copy, different, wcApproved, lapsed], now).get('co1')!
  check('pending certificates are awaiting approval', s.awaiting.length === 2)
  check('the byte-identical copy names the approved original', s.awaiting.find((a) => a.id === copy.id)?.duplicateOf === 'COI_SirReel-6.pdf')
  check('a different file with the same policy is NOT called a duplicate', s.awaiting.find((a) => a.id === different.id)?.duplicateOf === null)
  check('a lapsed pending cert is not awaiting anything', !s.awaiting.some((a) => a.id === lapsed.id))
  check('"COI through" comes from the full certificate, not the longer workers’ comp', s.coveringThrough?.toISOString().startsWith('2027-05-15') === true)
  check('no byte count leaks into the rows', !('fileSize' in s.awaiting[0]))
  const original = staff({ ...cert('APPROVED', '2027-05-15', '2026-09-10T23:26:00Z', 'INTERNAL'), originalFilename: 'COI_SirReel.pdf' }, 1449031)
  const s2 = groupStaffAccountCois([approved, original], now).get('co1')!
  check('an approved copy names the earlier approved original', s2.approved.find((a) => a.filename === 'COI_SirReel-6.pdf')?.duplicateOf === 'COI_SirReel.pdf')
  check('the original itself is not called a duplicate', s2.approved.find((a) => a.filename === 'COI_SirReel.pdf')?.duplicateOf === null)
}

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall passed')
