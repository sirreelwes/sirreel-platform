/**
 * Guards the measurement-notation search fix.
 *
 * The catalog writes "Table, 4' Folding"; crews type "4ft table", "4 ft table"
 * or "4-foot table". Search is `contains` per token with every token AND-ed,
 * so one mismatched spelling empties the dropdown entirely.
 *
 *   npm run test:measure-tokens
 */
import { tokenVariants, mergeMeasureTokens, measureVariants } from '@/lib/sales/catalogMatcher'

let fail = 0
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const has = (t: string, want: string) => tokenVariants(t).includes(want)

console.log("— every feet spelling reaches the catalog's 4' —")
for (const t of ["4ft", "4'", "4-ft", "4foot", "4-foot", "4feet"]) {
  ok(`${t} → 4'`, has(t, "4'"), JSON.stringify(tokenVariants(t)))
}
console.log("\n— and the reverse: catalog notation reaches what crews type —")
ok(`4' → 4ft`, has("4'", '4ft'))
ok(`6' → 6ft`, has("6'", '6ft'))

console.log('\n— split tokens are merged before matching —')
ok('4 ft table', JSON.stringify(mergeMeasureTokens(['4', 'ft', 'table'])) === '["4ft","table"]',
  JSON.stringify(mergeMeasureTokens(['4', 'ft', 'table'])))
ok('100 qt cooler', JSON.stringify(mergeMeasureTokens(['100', 'qt', 'cooler'])) === '["100qt","cooler"]')
ok('leaves plain words alone', JSON.stringify(mergeMeasureTokens(['folding', 'table'])) === '["folding","table"]')
ok('trailing number kept', JSON.stringify(mergeMeasureTokens(['table', '4'])) === '["table","4"]')

console.log('\n— inches are not feet —')
ok('30in → 30"', has('30in', '30"'))
ok(`30in does NOT claim 30'`, !has('30in', "30'"))
ok(`6'' is inches, not feet`, measureVariants("6''").includes('6"'))

console.log('\n— ordinary words are untouched —')
ok('table still singularises', tokenVariants('tables').includes('table'))
ok('non-measure returns []', measureVariants('table').length === 0)

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed')
process.exit(fail ? 1 : 0)
