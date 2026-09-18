/**
 * The broker DIRECTORY's rules — who gets on the list, and what a second
 * sighting is allowed to change.
 *
 *   npx tsx tests/coi/broker-directory.test.ts
 *   npm run test:broker-directory
 *
 * Pure + offline: no DB, no AI, no env. Two rules carry the weight and both
 * fail in ways nobody would notice for months:
 *
 *  1. **The email is the identity.** A row keyed on a name the model read
 *     off a scan is a list of misspellings that looks like a directory.
 *  2. **A typed fact outranks a read one.** A person who corrects "Barbara
 *     Wagner" must not have it reverted by the next certificate whose
 *     producer box says "Certificates Dept" — the silent kind of wrong,
 *     because the row still looks filled in.
 */

import {
  brokerFactsFromReview,
  mergeBrokerFacts,
  normalizeBrokerFacts,
} from '../../src/lib/coi/brokerDirectory'
import { KNOWN_BROKERS } from '../../src/lib/coi/knownBrokers'
import { BROKER_TABLES_DDL } from '../../src/lib/coi/brokerTableSql'
import { isAdditiveStatement } from '../../src/lib/admin/additiveDdl'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

console.log('COI broker directory\n')

// ── Who gets on the list ───────────────────────────────────────────────────
console.log('— the identity —')

check(
  'an address is lower-cased and trimmed',
  normalizeBrokerFacts({ email: '  Barbara@WorthingtonInsur.com ' })?.email === 'barbara@worthingtoninsur.com',
)
check('no email, no row', normalizeBrokerFacts({ email: '', name: 'Barbara Wagner' }) === null)
check('a non-address is not an identity', normalizeBrokerFacts({ email: 'call the office' }) === null)
check('null input is not a throw', normalizeBrokerFacts(null) === null)
check(
  'the other fields survive normalization',
  normalizeBrokerFacts({ email: 'a@b.com', name: '  Barbara   Wagner ', phone: ' (213) 555-0134 ' })?.name ===
    'Barbara Wagner',
)

// Off a stored review, through the same reader the desk uses.
const fromCert = brokerFactsFromReview({
  producer: {
    agency: 'Worthington Insurance',
    contactName: 'Barbara Wagner',
    email: 'Barbara@worthingtoninsur.com',
    phone: '(213) 555-0134',
  },
})
check('a producer block becomes a directory row', fromCert?.email === 'barbara@worthingtoninsur.com')
check('the agency comes with it', fromCert?.agency === 'Worthington Insurance')
check(
  'a producer block with no email is not filed',
  brokerFactsFromReview({ producer: { agency: 'Some Agency' } }) === null,
)
check(
  'a placeholder producer box is not filed',
  brokerFactsFromReview({ producer: { email: 'N/A', agency: 'same as insured' } }) === null,
)
check('a review with no producer key at all is not filed', brokerFactsFromReview({ namedInsured: 'X' }) === null)

// ── What a second sighting may change ──────────────────────────────────────
console.log('\n— a typed fact outranks a read one —')

const onFile = { name: 'Barbara Wagner', agency: null, phone: null, address: null }

// A certificate FILLS blanks…
const filled = mergeBrokerFacts(
  onFile,
  { email: 'b@w.com', name: 'Certificates Dept', agency: 'Worthington Insurance', phone: '(213) 555-0134' },
  'CERTIFICATE',
)
check('a certificate fills a blank agency', filled.agency === 'Worthington Insurance')
check('a certificate fills a blank phone', filled.phone === '(213) 555-0134')
// …and never overwrites.
check('a certificate does NOT overwrite a name on file', filled.name === undefined)

// A person editing the row may replace anything.
const edited = mergeBrokerFacts(onFile, { email: 'b@w.com', name: 'Barbara J. Wagner' }, 'MANUAL')
check('a hand edit replaces the name', edited.name === 'Barbara J. Wagner')
check(
  'a hand edit that changes nothing writes nothing',
  Object.keys(mergeBrokerFacts(onFile, { email: 'b@w.com', name: 'Barbara Wagner' }, 'MANUAL')).length === 0,
)
// A blank never wins, from either direction — the commonest way a good row
// would quietly empty itself.
check(
  'a blank never clears a field on file',
  Object.keys(mergeBrokerFacts(onFile, { email: 'b@w.com', name: null, agency: null }, 'MANUAL')).length === 0,
)
check(
  'nothing on file, nothing incoming, nothing written',
  Object.keys(
    mergeBrokerFacts({ name: null, agency: null, phone: null, address: null }, { email: 'b@w.com' }, 'CERTIFICATE'),
  ).length === 0,
)

// ── The rows we seed by hand ───────────────────────────────────────────────
console.log('\n— the brokers we already know —')

check('every hand-named broker has a usable email', KNOWN_BROKERS.every((b) => !!normalizeBrokerFacts(b)))
check('every hand-named broker has a name', KNOWN_BROKERS.every((b) => !!b.name?.trim()))
const barbara = KNOWN_BROKERS.find((b) => b.email === 'barbara@worthingtoninsur.com')
check('Barbara Wagner is on the list', barbara?.name === 'Barbara Wagner')
check('she is tied to the Mega COI by a client hint', !!barbara?.companyNameHint)
// The agency is deliberately NOT guessed from the email domain — the COI
// prompt forbids exactly that inference, and a guess in the row a rep reads
// before emailing a stranger is the same mistake with a hand on it.
check('her agency is not inferred from her email domain', !barbara?.agency)

// ── The tables ─────────────────────────────────────────────────────────────
console.log('\n— the schema task —')

check(
  'every statement is additive (the maintenance runner refuses anything else)',
  BROKER_TABLES_DDL.statements.every((st) => isAdditiveStatement(st)),
)
check(
  'no statement drops or alters anything',
  BROKER_TABLES_DDL.statements.every((st) => !/\b(DROP|ALTER|TRUNCATE|DELETE)\b/i.test(st)),
)
check(
  'the declared tables are the ones it creates',
  BROKER_TABLES_DDL.tables.every((t) =>
    BROKER_TABLES_DDL.statements.some((st) => st.includes(`CREATE TABLE IF NOT EXISTS "${t}"`)),
  ),
)
check(
  'the email is unique — one row per broker',
  BROKER_TABLES_DDL.statements.some((st) => /CREATE UNIQUE INDEX.*sr_brokers_email_key/.test(st)),
)
check(
  'a broker is linked to a client at most once',
  BROKER_TABLES_DDL.statements.some((st) =>
    /CREATE UNIQUE INDEX.*sr_broker_clients_broker_id_company_id_key/.test(st),
  ),
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All broker-directory checks passed.')
