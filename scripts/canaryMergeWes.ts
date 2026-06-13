/**
 * Canary protocol for the Person merge primitive.
 *
 * The Wes dupe (survivor "Wes@" / loser "wes@") is the perfect first
 * exercise: clean Method-A email match, both rows have refs, zero
 * JobContact/Affiliation unique collisions, alias path is the
 * "skip — emails normalize to the same value" branch.
 *
 * Protocol:
 *   1) Snapshot every FK count for both rows pre-merge.
 *   2) Merge.
 *   3) Verify: loser deleted; survivor's email lowercased; refs
 *      consolidated; alias skipped (emails matched post-normalize);
 *      PersonMerge row recorded with snapshot + repointLog.
 *   4) Reverse.
 *   5) Verify: loser restored with ORIGINAL id; refs back to pre-merge
 *      counts; PersonMerge.reversedAt stamped.
 *   6) Re-merge — proves the primitive is idempotent in both directions
 *      and the reversal didn't leave residue.
 *
 * STOP on any verification failure — never re-merge after a bad
 * reversal.
 *
 * No --apply gate — this script ALWAYS writes. The Wes canary is the
 * smoke test for the primitive itself. Re-running after the first
 * successful round-trip is safe (it'll re-merge + re-reverse + re-merge
 * again — every step is auditable on PersonMerge).
 */
import { prisma } from '../src/lib/prisma'
import { mergePersons } from '../src/lib/people/mergePersons'
import { reverseMerge } from '../src/lib/people/reverseMerge'

const SURVIVOR_ID = '04a27d0d-' // prefix — we resolve to full id below
const LOSER_ID = 'bc19098c-'

async function resolveById(prefix: string): Promise<string | null> {
  const row = await prisma.person.findFirst({
    where: { id: { startsWith: prefix } },
    select: { id: true },
  })
  return row?.id ?? null
}

interface FkCounts {
  bookings: number
  referredBookings: number
  jobContacts: number
  orderContacts: number
  affiliations: number
  outreach: number
  activities: number
  emails: number
  inquiries: number
  inquiryCaptures: number
  personSessions: number
  portalAccesses: number
  user: number
  worksWithBack: number
}

async function fkCounts(personId: string): Promise<FkCounts> {
  const [bookings, referredBookings, jobContacts, orderContacts, affiliations, outreach, activities, emails, inquiries, inquiryCaptures, personSessions, portalAccesses, users, worksWithBack] = await Promise.all([
    prisma.booking.count({ where: { personId } }),
    prisma.booking.count({ where: { referredById: personId } }),
    prisma.jobContact.count({ where: { personId } }),
    prisma.order.count({ where: { jobContactId: personId } }),
    prisma.affiliation.count({ where: { personId } }),
    prisma.outreachActivity.count({ where: { personId } }),
    prisma.activity.count({ where: { personId } }),
    prisma.emailMessage.count({ where: { personId } }),
    prisma.inquiry.count({ where: { personId } }),
    prisma.inquiryCapture.count({ where: { personId } }),
    prisma.personSession.count({ where: { personId } }),
    prisma.portalAccess.count({ where: { contactId: personId } }),
    prisma.user.count({ where: { personId } }),
    prisma.person.count({ where: { worksWithId: personId } }),
  ])
  return { bookings, referredBookings, jobContacts, orderContacts, affiliations, outreach, activities, emails, inquiries, inquiryCaptures, personSessions, portalAccesses, user: users, worksWithBack }
}

function sumCounts(c: FkCounts): number {
  return Object.values(c).reduce((s, v) => s + v, 0)
}

function diffCounts(label: string, before: FkCounts, after: FkCounts) {
  for (const k of Object.keys(before) as (keyof FkCounts)[]) {
    if (before[k] !== after[k]) {
      console.log(`    ${label} ${k}: ${before[k]} → ${after[k]}`)
    }
  }
}

async function main() {
  const survivor = await resolveById(SURVIVOR_ID)
  const loser = await resolveById(LOSER_ID)
  if (!survivor || !loser) {
    console.error(`Could not resolve canary ids — survivor=${survivor} loser=${loser}`)
    console.error(`(If the canary already ran successfully, the loser may already be merged. Check person_merges.)`)
    process.exit(1)
  }
  console.log(`Canary subjects:`)
  console.log(`  survivor:  ${survivor}`)
  console.log(`  loser:     ${loser}`)

  // We need a User.id for mergedById / reversedById — use Wes's own.
  const wesUser = await prisma.user.findFirst({
    where: { email: { equals: 'wes@sirreel.com', mode: 'insensitive' } },
    select: { id: true },
  })
  if (!wesUser) {
    console.error(`No User row for wes@sirreel.com — canary needs an operator id.`)
    process.exit(1)
  }
  const operator = wesUser.id

  // ─── 1) Pre-merge snapshot ────────────────────────────────────
  const survivorBefore = await prisma.person.findUnique({ where: { id: survivor } })
  const loserBefore = await prisma.person.findUnique({ where: { id: loser } })
  if (!survivorBefore || !loserBefore) {
    console.error('Snapshot read failed.')
    process.exit(1)
  }
  const sFkBefore = await fkCounts(survivor)
  const lFkBefore = await fkCounts(loser)
  console.log(`\nPre-merge state:`)
  console.log(`  survivor email: "${survivorBefore.email}"  refs=${sumCounts(sFkBefore)}`)
  console.log(`  loser    email: "${loserBefore.email}"  refs=${sumCounts(lFkBefore)}`)
  console.log(`  expected post-merge survivor refs = ${sumCounts(sFkBefore) + sumCounts(lFkBefore)}`)

  // ─── 2) Merge ────────────────────────────────────────────────
  console.log(`\n[STEP 2] Merging…`)
  const mergeResult = await mergePersons({ survivorId: survivor, loserId: loser, mergedById: operator })
  console.log(`  mergeId:        ${mergeResult.mergeId}`)
  console.log(`  aliasInserted:  ${mergeResult.aliasInserted}`)
  console.log(`  repointCounts:`, mergeResult.repointCounts)

  // ─── 3) Verify post-merge ────────────────────────────────────
  console.log(`\n[STEP 3] Verifying post-merge state…`)
  const loserStillThere = await prisma.person.findUnique({ where: { id: loser } })
  if (loserStillThere) {
    console.error('FAIL: loser row still exists after merge')
    process.exit(2)
  }
  console.log(`  ✓ loser deleted`)
  const survivorAfter = await prisma.person.findUnique({ where: { id: survivor } })
  if (!survivorAfter) {
    console.error('FAIL: survivor row missing after merge')
    process.exit(2)
  }
  if (survivorAfter.email !== survivorAfter.email.toLowerCase()) {
    console.error(`FAIL: survivor email not lowercased: "${survivorAfter.email}"`)
    process.exit(2)
  }
  console.log(`  ✓ survivor email lowercased: "${survivorAfter.email}"`)
  if (mergeResult.aliasInserted) {
    console.error(`FAIL: alias was inserted but loser and survivor emails should normalize identically`)
    process.exit(2)
  }
  console.log(`  ✓ no alias inserted (loser.email normalized to survivor.email)`)
  const sFkAfterMerge = await fkCounts(survivor)
  const totalRefsAfter = sumCounts(sFkAfterMerge)
  const expected = sumCounts(sFkBefore) + sumCounts(lFkBefore)
  console.log(`  survivor refs: ${sumCounts(sFkBefore)} + ${sumCounts(lFkBefore)} = ${expected};  observed ${totalRefsAfter}`)
  if (totalRefsAfter !== expected) {
    console.error('FAIL: ref count mismatch post-merge')
    console.log(`  per-FK shifts:`)
    diffCounts('survivor', sFkBefore, sFkAfterMerge)
    process.exit(2)
  }
  console.log(`  ✓ ref counts consolidated correctly`)
  const personMergeRow = await prisma.personMerge.findUnique({ where: { id: mergeResult.mergeId } })
  if (!personMergeRow) {
    console.error('FAIL: PersonMerge audit row missing')
    process.exit(2)
  }
  if (personMergeRow.reversedAt) {
    console.error('FAIL: PersonMerge has reversedAt set immediately after creation')
    process.exit(2)
  }
  console.log(`  ✓ PersonMerge audit row written (snapshot + repointLog)`)

  // ─── 4) Reverse ──────────────────────────────────────────────
  console.log(`\n[STEP 4] Reversing…`)
  const reverseResult = await reverseMerge({ mergeId: mergeResult.mergeId, reversedById: operator })
  console.log(`  restored loser id: ${reverseResult.restoredLoserId}`)
  console.log(`  repointCounts:`, reverseResult.repointCounts)

  // ─── 5) Verify post-reverse ──────────────────────────────────
  console.log(`\n[STEP 5] Verifying post-reverse state…`)
  if (reverseResult.restoredLoserId !== loser) {
    console.error(`FAIL: restored loser id ${reverseResult.restoredLoserId} != original ${loser}`)
    process.exit(3)
  }
  const loserRestored = await prisma.person.findUnique({ where: { id: loser } })
  if (!loserRestored) {
    console.error(`FAIL: loser row not restored`)
    process.exit(3)
  }
  console.log(`  ✓ loser row restored with original id`)
  const sFkAfterReverse = await fkCounts(survivor)
  const lFkAfterReverse = await fkCounts(loser)
  if (sumCounts(sFkAfterReverse) !== sumCounts(sFkBefore)) {
    console.error(`FAIL: survivor ref count after reverse ${sumCounts(sFkAfterReverse)} != pre-merge ${sumCounts(sFkBefore)}`)
    diffCounts('survivor', sFkBefore, sFkAfterReverse)
    process.exit(3)
  }
  if (sumCounts(lFkAfterReverse) !== sumCounts(lFkBefore)) {
    console.error(`FAIL: loser ref count after reverse ${sumCounts(lFkAfterReverse)} != pre-merge ${sumCounts(lFkBefore)}`)
    diffCounts('loser', lFkBefore, lFkAfterReverse)
    process.exit(3)
  }
  console.log(`  ✓ ref counts restored to pre-merge values on BOTH rows`)
  const reversedRow = await prisma.personMerge.findUnique({ where: { id: mergeResult.mergeId } })
  if (!reversedRow?.reversedAt) {
    console.error('FAIL: PersonMerge.reversedAt not set')
    process.exit(3)
  }
  console.log(`  ✓ PersonMerge.reversedAt stamped`)

  // ─── 6) Re-merge ─────────────────────────────────────────────
  console.log(`\n[STEP 6] Re-merging (proves reversal left clean state)…`)
  const remerge = await mergePersons({ survivorId: survivor, loserId: loser, mergedById: operator })
  console.log(`  new mergeId: ${remerge.mergeId}`)
  const sFkFinal = await fkCounts(survivor)
  if (sumCounts(sFkFinal) !== expected) {
    console.error(`FAIL: re-merge ref count ${sumCounts(sFkFinal)} != expected ${expected}`)
    process.exit(4)
  }
  const loserGone = await prisma.person.findUnique({ where: { id: loser } })
  if (loserGone) {
    console.error(`FAIL: loser row exists after re-merge`)
    process.exit(4)
  }
  console.log(`  ✓ re-merge clean — survivor refs back to ${expected}, loser deleted`)

  console.log(`\n═════════════════════════════════════════════════════════`)
  console.log(` CANARY PASSED — merge primitive is round-trip safe`)
  console.log(` Survivor: ${survivor}  email="${(await prisma.person.findUnique({ where: { id: survivor }, select: { email: true } }))?.email}"`)
  console.log(` Final merge row: ${remerge.mergeId} (the canonical "Wes dedup")`)
  console.log(`═════════════════════════════════════════════════════════`)
}

main().catch((e) => {
  console.error('CANARY THREW:', e)
  process.exit(99)
}).finally(() => prisma.$disconnect())
