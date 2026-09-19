/**
 * The company Activity History shows THIS company's email.
 *
 *   npx tsx tests/crm/company-activity.test.ts
 *   npm run test:company-activity
 *
 * Pure + offline.
 *
 * Wes 2026-09-19, on the Party Giraffes page: "the activity tile
 * includes stuff that isn't party giraffe Job activity" — two other
 * productions' invoices were in the feed.
 *
 * The expensive direction is the one being fixed: a feed that shows
 * another client's mail leaks that client's job names, invoice subjects
 * and reply snippets onto a third party's page, and a rep reading it has
 * no way to tell which rows are real. The other direction — a row
 * missing from a company's own feed — is a gap in a convenience tile, so
 * the rules below stay inclusive wherever the evidence is merely thin
 * (an unfiled thread is kept, not dropped).
 */

import {
  clientMatchAddresses,
  fromAddressMatches,
  scopeEmailToCompany,
  scopeEmailsToCompany,
} from '../../src/lib/crm/companyEmailScope'

const failures: string[] = []

function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// ── 1. Internal addresses are never match keys ───────────────────────
// This is the hole that turns the feed into "the 50 most recent
// outbound messages in the system": outbound toAddresses carries the
// Cc: header, and every job-thread send Cc's jobs+<code>@sirreel.com
// plus the rentals@/billing@ team copy.
console.log('\nclientMatchAddresses — internal addresses dropped')
{
  const kept = clientMatchAddresses([
    'producer@partygiraffes.com',
    'rentals@sirreel.com',
    'jobs@sirreel.com',
    'billing@sirreel.com',
    'jose@sirreel.com',
    'coordinator@partygiraffes.com',
  ])
  ok(
    kept.length === 2 &&
      kept[0] === 'producer@partygiraffes.com' &&
      kept[1] === 'coordinator@partygiraffes.com',
    'the two client addresses survive and every @sirreel.com one is dropped',
  )
  ok(
    clientMatchAddresses(['rentals@sirreel.com']).length === 0,
    'a company whose only contact is an internal mailbox matches nothing at all',
  )
  ok(
    clientMatchAddresses(['JOSE@SirReel.com']).length === 0,
    'case does not smuggle an internal address through',
  )
}

console.log('\nclientMatchAddresses — blanks, junk, duplicates')
{
  ok(
    clientMatchAddresses([null, undefined, '', '   ']).length === 0,
    'empty values never become a match key (a blank one would match everything)',
  )
  ok(
    clientMatchAddresses(['not an address', 'Party Giraffes']).length === 0,
    'a name typed into the email field is not a match key',
  )
  const deduped = clientMatchAddresses([
    'Producer@PartyGiraffes.com',
    'producer@partygiraffes.com',
  ])
  ok(
    deduped.length === 1 && deduped[0] === 'producer@partygiraffes.com',
    'one address, lower-cased, however it was typed',
  )
}

// ── 2. From: is re-checked exactly ───────────────────────────────────
// The DB filter has to be `contains` (the header is in display-name
// form), and `contains` is a substring test.
console.log('\nfromAddressMatches — substring near-misses rejected')
{
  const wanted = ['sam@acme.com']
  ok(
    fromAddressMatches('"Sam Diaz" <sam@acme.com>', wanted),
    'the display-name form of the real address matches',
  )
  ok(
    !fromAddressMatches('"Not Sam" <notsam@acme.com>', wanted),
    'a longer local part that CONTAINS the address does not match',
  )
  ok(
    !fromAddressMatches('sam@acme.com.br', wanted),
    'a longer domain that contains the address does not match',
  )
  ok(!fromAddressMatches(null, wanted), 'a missing From: header matches nothing')
  ok(
    !fromAddressMatches('"Sam Diaz" <sam@acme.com>', []),
    'no candidates matches nothing — never "everything"',
  )
}

// ── 3. A thread filed to another company's Job is that company's ─────
console.log("\nscopeEmailToCompany — another company's job wins over a contact match")
{
  const PARTY = 'company-party-giraffes'
  const CONTRAST = 'company-contrast-film'
  const scope = {
    companyId: PARTY,
    threadCompanyId: new Map<string, string | null>([
      ['thread-contrast-invoice', CONTRAST],
      ['thread-party-quote', PARTY],
      ['thread-cold-inquiry', null],
    ]),
  }

  const contrast = scopeEmailToCompany({ threadId: 'thread-contrast-invoice' }, scope)
  ok(
    !contrast.keep && contrast.reason === 'other-company-job',
    "Contrast Film's final invoice stays off the Party Giraffes feed",
  )

  const own = scopeEmailToCompany({ threadId: 'thread-party-quote' }, scope)
  ok(
    own.keep && own.reason === 'own-job-thread',
    "a send on this company's own job thread is kept, whoever it was addressed to",
  )

  const unfiled = scopeEmailToCompany({ threadId: 'thread-cold-inquiry' }, scope)
  ok(
    unfiled.keep && unfiled.reason === 'contact-match',
    'an UNFILED thread is not foreign — the pre-job inquiry is the ordinary case',
  )

  const unknownThread = scopeEmailToCompany({ threadId: 'thread-never-seen' }, scope)
  ok(
    unknownThread.keep && unknownThread.reason === 'contact-match',
    'a thread missing from the map reads as unfiled, not as foreign',
  )

  const noThread = scopeEmailToCompany({ threadId: null }, scope)
  ok(
    noThread.keep && noThread.reason === 'contact-match',
    'a message on no thread at all is kept on its contact match',
  )

  const explicit = scopeEmailToCompany(
    { threadId: 'thread-contrast-invoice', companyId: PARTY },
    scope,
  )
  ok(
    explicit.keep && explicit.reason === 'explicit-company',
    'a row that names this company outranks the thread',
  )

  const explicitOther = scopeEmailToCompany(
    { threadId: 'thread-contrast-invoice', companyId: CONTRAST },
    scope,
  )
  ok(
    !explicitOther.keep,
    "a row naming ANOTHER company is not kept by that column either",
  )
}

// ── 4. Wes's screenshot, end to end ──────────────────────────────────
console.log("\nscopeEmailsToCompany — the feed Wes was looking at")
{
  const PARTY = 'company-party-giraffes'
  const scope = {
    companyId: PARTY,
    threadCompanyId: new Map<string, string | null>([
      ['t-contrast', 'company-contrast-film'],
      ['t-obb', 'company-obb'],
      ['t-party', PARTY],
    ]),
  }
  const feed = [
    { id: '1', threadId: 't-contrast' }, // Re: Contrast Film | Vevo | Final Invoice
    { id: '2', threadId: 't-contrast' }, // Re: Contrast Film | Vevo | Final Invoice
    { id: '3', threadId: 't-obb' }, //      Re: OBB x Cybmiotika // Truck
    { id: '4', threadId: 't-party' }, //    actually theirs
    { id: '5', threadId: null }, //         an inquiry reply, no thread filed
  ]
  const kept = scopeEmailsToCompany(feed, scope)
  ok(
    kept.map((m) => m.id).join(',') === '4,5',
    'the three foreign rows go and the two real ones stay, in order',
  )
}

// ── Result ───────────────────────────────────────────────────────────
console.log('')
if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All company Activity History scope checks passed.')
