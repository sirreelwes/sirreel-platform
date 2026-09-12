/**
 * HQ-printed SR labels — the numbering rule, the sheet geometry, and a
 * rendered sheet read back.
 *
 *   npx tsx tests/warehouse/unit-labels.test.ts
 *   npm run test:unit-labels
 *
 * Offline: the rule and the geometry are pure; the render goes through
 * @react-pdf/renderer and pdf-parse with a fixture. No DB.
 *
 * What is at stake: a number HQ prints that RentalWorks later issues
 * puts two pieces of gear under one barcode, and the desk counts the
 * wrong one out. A label that lands off its cell prints on the sheet's
 * backing and the piece goes out unlabelled.
 */

import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { PDFParse } from 'pdf-parse'
import {
  HQ_LABEL_FLOOR, HQ_LABEL_CEILING, LABEL_STOCKS, MAX_MINT_PER_BATCH,
  formatBarcode, parseBarcode, isHqBarcode, nextHqBarcodes, labelCells,
} from '../../src/lib/warehouse/unitLabels'
import { LabelSheetDocument } from '../../src/lib/warehouse/LabelSheetDocument'
import { code39Geometry } from '../../src/lib/warehouse/code39'

const failures: string[] = []
const ok = (why: string) => console.log(`  ok — ${why}`)
const fail = (why: string) => failures.push(why)
function eq<T>(got: T, want: T, why: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(why)
  else fail(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

console.log('\nThe SR shape — what the resolver and the scanners already read')
eq(formatBarcode(900001), 'SR900001', 'six digits, zero-padded')
eq(formatBarcode(4674), 'SR004674', 'an RW-era number formats the same way')
eq(parseBarcode('SR004674'), 4674, 'parses the RW label')
eq(parseBarcode('sr900001'), 900001, 'case-folded like a scan')
eq(parseBarcode('SR90001'), null, 'five digits is not a label')
eq(parseBarcode('CAT_CUBE_TRUCK'), null, 'a catalog code is not a label')
eq(isHqBarcode('SR900000'), true, 'the floor is ours')
eq(isHqBarcode('SR899999'), false, 'one below the floor is RW territory')

console.log('\nNumbering — HQ takes the block from the floor up, never guesses')
eq(nextHqBarcodes([], 3), { ok: true, barcodes: ['SR900000', 'SR900001', 'SR900002'] }, 'an empty block starts at the floor')
eq(
  nextHqBarcodes([{ barcode: 'SR900007', source: 'HQ' }, { barcode: 'SR900002', source: 'HQ' }], 2),
  { ok: true, barcodes: ['SR900008', 'SR900009'] },
  'continues after the highest HQ number, whatever order the rows come in',
)
{
  const r = nextHqBarcodes([{ barcode: 'SR900100', source: 'RW' }], 1)
  if (!r.ok && /RentalWorks has issued SR900100/.test(r.reason)) ok('an RW unit inside the block stops minting and names it')
  else fail(`RW intruder not refused: ${JSON.stringify(r)}`)
}
{
  const r = nextHqBarcodes([{ barcode: formatBarcode(HQ_LABEL_CEILING - 1), source: 'HQ' }], 2)
  if (!r.ok && /numbers left/.test(r.reason)) ok('refuses to run past SR999999')
  else fail(`ceiling not enforced: ${JSON.stringify(r)}`)
}
{
  const r = nextHqBarcodes([{ barcode: formatBarcode(HQ_LABEL_CEILING - 1), source: 'HQ' }], 1)
  eq(r, { ok: true, barcodes: ['SR999999'] }, 'the last number is still mintable')
}
eq(nextHqBarcodes([], 0).ok, false, 'zero labels is refused')
eq(nextHqBarcodes([], MAX_MINT_PER_BATCH + 1).ok, false, 'over the batch cap is refused')
eq(nextHqBarcodes([], MAX_MINT_PER_BATCH).ok, true, 'the batch cap itself is allowed')
{
  // A stray non-SR barcode in the block read (RW allows odd labels) is ignored, not a crash.
  const r = nextHqBarcodes([{ barcode: 'ODDBALL', source: 'RW' }, { barcode: 'SR900003', source: 'HQ' }], 1)
  eq(r, { ok: true, barcodes: ['SR900004'] }, 'a non-SR label in the read is ignored')
}
if (HQ_LABEL_FLOOR > 4674 * 10) ok('the floor sits far above where RW is (SR004674 in 2026-09)')
else fail('floor too close to RW numbering')

console.log('\nSheet geometry — every cell stays on the page and on its own label')
for (const stock of Object.values(LABEL_STOCKS)) {
  const perPage = stock.cols * stock.rows
  const cells = labelCells(stock, perPage + 1)
  const onPage = cells.slice(0, perPage)
  const inside = onPage.every(
    (c) => c.page === 0 && c.x >= 0 && c.y >= 0 && c.x + stock.label.width <= stock.page.width + 0.01 && c.y + stock.label.height <= stock.page.height + 0.01,
  )
  if (inside) ok(`${stock.compatible}: ${perPage} cells fit the page`)
  else fail(`${stock.compatible}: a cell runs off the page`)
  eq(cells[perPage].page, 1, `${stock.compatible}: cell ${perPage + 1} starts page 2`)
  eq(cells[perPage].x, cells[0].x, `${stock.compatible}: page 2 starts at the first column`)
  eq(cells[perPage].y, cells[0].y, `${stock.compatible}: page 2 starts at the first row`)
  const last = onPage[perPage - 1]
  eq(last.x, stock.origin.x + (stock.cols - 1) * stock.pitch.x, `${stock.compatible}: last cell is in the last column`)
  eq(last.y, stock.origin.y + (stock.rows - 1) * stock.pitch.y, `${stock.compatible}: last cell is in the last row`)
  const gap = stock.pitch.x - stock.label.width
  if (gap >= 0) ok(`${stock.compatible}: columns do not overlap (${gap.toFixed(1)}pt gutter)`)
  else fail(`${stock.compatible}: columns overlap`)
  // Barcode readability: a narrow bar of at least 7.5 mil (0.54pt) at the
  // label's printable width — below that commodity scanners give up.
  const pad = stock.id === 'avery5167' ? 3 : stock.id === 'avery5160' ? 5 : 10
  const unit = (stock.label.width - pad * 2) / code39Geometry('SR900000').totalWidth
  if (unit >= 0.54) ok(`${stock.compatible}: narrow bar ${(unit / 72 * 1000).toFixed(1)} mil`)
  else fail(`${stock.compatible}: narrow bar too thin (${(unit / 72 * 1000).toFixed(1)} mil)`)
}
{
  const stock = LABEL_STOCKS.avery5160
  const cells = labelCells(stock, 2, 29)
  eq(cells[0], { page: 0, x: stock.origin.x + 2 * stock.pitch.x, y: stock.origin.y + 9 * stock.pitch.y }, 'skip 29 lands on the last cell of sheet 1')
  eq(cells[1], { page: 1, x: stock.origin.x, y: stock.origin.y }, 'and the next label opens sheet 2')
  eq(labelCells(stock, 1, 999)[0].page, 0, 'skip is clamped to the sheet')
}

async function render() {
  console.log('\nA rendered sheet carries every number, readable')
  const units = [
    { id: 'u1', barcode: 'SR900000', serialNumber: '2211-0043', itemCode: '104387', name: 'Motorola CP200d Radio' },
    { id: 'u2', barcode: 'SR900001', serialNumber: null, itemCode: 'HAZER-DF50', name: 'Reel EFX DF-50 Diffusion Hazer with a description long enough to need cutting' },
    { id: 'u3', barcode: 'SR004674', serialNumber: null, itemCode: '104387', name: 'Motorola CP200d Radio' },
  ]
  for (const stock of Object.keys(LABEL_STOCKS) as Array<keyof typeof LABEL_STOCKS>) {
    const element = React.createElement(LabelSheetDocument, { stock, skip: 1, units }) as React.ReactElement<DocumentProps>
    const pdf = await renderToBuffer(element)
    const text = (await new PDFParse({ data: new Uint8Array(pdf) }).getText()).text
    for (const u of units) {
      if (text.includes(u.barcode)) ok(`${stock}: ${u.barcode} printed`)
      else fail(`${stock}: ${u.barcode} missing from the sheet`)
    }
    if (stock !== 'avery5167') {
      if (text.includes('104387')) ok(`${stock}: item code printed`)
      else fail(`${stock}: item code missing`)
      if (text.includes('…')) ok(`${stock}: a long name is cut, not wrapped over the next cell`)
      else fail(`${stock}: long name was not cut`)
    }
    if (stock === 'avery5160') {
      if (text.includes('S/N 2211-0043')) ok(`${stock}: serial printed`)
      else fail(`${stock}: serial missing`)
    }
  }
}

render()
  .then(() => {
    if (failures.length) {
      console.error(`\n✗ ${failures.length} failure(s):`)
      failures.forEach((f) => console.error(`   ${f}`))
      process.exit(1)
    }
    console.log('\n✓ unit labels hold\n')
  })
  .catch((e) => { console.error(e); process.exit(1) })
