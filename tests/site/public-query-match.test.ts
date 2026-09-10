/**
 * Guards the PUBLIC search boxes against the plural gap.
 *
 * Two surfaces, one promise: the Home hero pill lands the client on the
 * order form, so a query that finds a thing in the hero has to find it on
 * the form. The form's own field used to substring-match the WHOLE raw
 * query, which failed every plural — the catalog names things in the
 * singular and the alias seed deliberately keeps only singular aliases
 * (scripts/seed-catalog-aliases.ts strips "walkies"/"radios" so a bare
 * walkie resolves to the digital row). Typing "walkies" returned nothing
 * and the form told the client we don't rent them.
 *
 *   npm run test:public-query
 */
import { haystack, matchesQuery, placement, queryVariants } from '@/lib/site/publicTextMatch'

let fail = 0
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// A row as the public surfaces build it: name + code + category + aliases.
const walkie = haystack(
  'Motorola CP200  UHF Radio (Digital)',
  'CP200D',
  'Communications',
  ['walkie', 'walkie talkie', 'handheld', 'two-way radio', 'radio', 'cp200'].join(' '),
)
const table6 = haystack("Table, 6' Folding", 'TBL6', 'Basecamp Furniture', '')
const cooler = haystack('Cooler, 100 qt', 'CLR100', 'Basecamp Furniture', '')

const hits = (q: string, hay: string) => matchesQuery(hay, queryVariants(q))

console.log('— the plural a crew actually types —')
ok('walkies → the walkie row', hits('walkies', walkie))
ok('walkie → the walkie row', hits('walkie', walkie))
ok('radios → the walkie row', hits('radios', walkie))
ok('walkie talkies → the walkie row', hits('walkie talkies', walkie))
ok('handhelds → the walkie row', hits('handhelds', walkie))

console.log('\n— and it stays a filter, not a firehose —')
ok('walkies does NOT match a table', !hits('walkies', table6))
ok('unknown word matches nothing', !hits('forklift', walkie))
ok('every token has to hit', !hits('walkie forklift', walkie))

console.log('\n— measurements and plurals compose —')
ok("6 tables → Table, 6' Folding", hits('6 tables', table6))
ok("6ft tables → Table, 6' Folding", hits('6ft tables', table6))
ok('100qt cooler → the cooler', hits('100qt cooler', cooler))
ok("6 tables does NOT match the cooler", !hits('6 tables', cooler))

console.log('\n— an empty query filters nothing out —')
ok('empty matches everything', matchesQuery(walkie, queryVariants('')))

console.log('\n— ranking sees through the plural too —')
// Scored per token and summed; lower is better. A plural query must still
// rank the row whose NAME carries the word above one that only matched on
// an alias, which whole-string ranking could not do.
const score = (q: string, name: string) =>
  queryVariants(q).reduce((sum, vs) => sum + placement(name, vs), 0)
ok('"tables" ranks a Table row at the top', score('tables', "Table, 6' Folding") === 0,
  `score ${score('tables', "Table, 6' Folding")}`)
ok('"walkies" beats an alias-only hit', score('walkies', 'Walkie, Digital') < score('walkies', 'Motorola CP200  UHF Radio (Digital)'))

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed')
process.exit(fail ? 1 : 0)
