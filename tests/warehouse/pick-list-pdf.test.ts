/**
 * Pick list PDF — a long item code folds inside its column and still reads
 * as the code on the label.
 *
 *   npx tsx tests/warehouse/pick-list-pdf.test.ts
 *   npm run test:pick-list-pdf
 *
 * Offline: renders PickListDocument through @react-pdf/renderer with the
 * lines off Wes's photo of S260902-008 (2026-09-12) and reads the text back
 * with pdf-parse. No DB.
 *
 * Two regressions, one row:
 *  - "CAT_CUBE_TRUCK" (14 glyphs) printed straight over "SuperCube Truck"
 *    because the hyphenation policy only folded codes LONGER than 14.
 *  - Once folded, textkit adds a hyphen at every fold, so the column read
 *    "CAT_CUBE_-" / "TRUCK" and "VEH---" / "STRAPS---" — not the code.
 *    CodeText folds the parts as separate Texts so nothing is added.
 */

import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { PDFParse } from 'pdf-parse'
import { PickListDocument, type PickListLine } from '../../src/lib/warehouse/PickListDocument'

const failures: string[] = []

function line(department: PickListLine['department'], code: string, description: string): PickListLine {
  return {
    department, code, description, notes: null, type: 'RENT', ordered: 1, out: 0,
    picked: false, includedAccessory: false, unitChecks: [],
  }
}

const CODES = ['CAT_CUBE_TRUCK', 'VEH--STRAPS--RATCHET', 'TEN-CARAVAN-CANOPY-10X10', 'CAT_CARGO_VAN_LIFTGATE', 'CAT_VAN']

async function main() {
  const element = React.createElement(PickListDocument, {
    orderNumber: 'S260902-008',
    description: 'RB SG Concealer Campaign',
    companyName: 'Dunwell Productions LLC',
    jobCode: 'SR-JOB-0300',
    jobName: 'RB SG Concealer Campaign',
    deliveryType: 'WILL CALL',
    assignedToName: null,
    agentName: 'Jose Pacheco',
    startDate: new Date('2026-09-03T15:00:00Z'),
    endDate: new Date('2026-09-05T15:00:00Z'),
    pickDate: new Date('2026-09-03T15:00:00Z'),
    lines: [
      line('PRO_SUPPLIES', 'VEH--STRAPS--RATCHET', 'Straps, Ratchet'),
      line('COMMUNICATIONS', 'TEN-CARAVAN-CANOPY-10X10', 'Canopy 10x10'),
      line('VEHICLES', 'CAT_CUBE_TRUCK', 'SuperCube Truck'),
      line('VEHICLES', 'CAT_VAN', 'Cargo Van'),
      line('VEHICLES', 'CAT_CARGO_VAN_LIFTGATE', 'Cargo Van w/ Liftgate'),
    ],
    generatedAt: new Date('2026-09-12T16:43:00Z'),
    omittedLineCount: 0,
  }) as React.ReactElement<DocumentProps>

  const pdf = await renderToBuffer(element)
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  const text = (await parser.getText()).text
  const squashed = text.replace(/\s+/g, '')

  console.log('\nEvery code survives the fold — the glyphs on paper are the glyphs on the label')
  for (const code of CODES) {
    if (squashed.includes(code)) console.log(`  ok — ${code}`)
    else failures.push(`${code} not found once line breaks are removed`)
  }

  console.log('\nNo hyphen is added where a code folds')
  for (const bad of ['_-', '---', 'TEN--', 'CARAVAN--', 'CANOPY--']) {
    if (text.includes(bad)) failures.push(`found ${JSON.stringify(bad)} in the rendered text — the engine added a hyphen at a fold`)
    else console.log(`  ok — no ${JSON.stringify(bad)}`)
  }

  console.log('\nThe description beside the folded code is intact')
  for (const desc of ['SuperCube Truck', 'Straps, Ratchet', 'Cargo Van w/ Liftgate']) {
    if (text.includes(desc)) console.log(`  ok — ${desc}`)
    else failures.push(`description ${JSON.stringify(desc)} missing or broken`)
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length} failure(s):`)
    failures.forEach((f) => console.error(`   ${f}`))
    process.exit(1)
  }
  console.log('\n✓ pick list codes fold cleanly\n')
}

main().catch((err) => { console.error(err); process.exit(1) })
