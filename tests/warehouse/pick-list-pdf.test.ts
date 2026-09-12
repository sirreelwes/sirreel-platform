/**
 * The pick list PDF, rendered offline and read back.
 *
 * Run: npm run test:pick-list-pdf
 *
 * Renders PickListDocument via @react-pdf/renderer with hand-built lines
 * (no DB), extracts the text with pdf-parse, and asserts on what the
 * floor would read. Born 2026-09-12: the per-unit checks row ("Each
 * unit: ( ) Antenna × 1") had been built by renderPickListPdf and then
 * silently dropped — PickListLine never declared the field, so the
 * document never printed it. This pins that the row prints, and that a
 * check which is already its own line on the sheet is suppressed.
 */

import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { PDFParse } from 'pdf-parse'
import {
  PickListDocument,
  printableUnitChecks,
  type PickListDocumentProps,
  type PickListLine,
} from '../../src/lib/warehouse/PickListDocument'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
}

function checkContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) failures.push(`${label}: expected to contain "${needle}"`)
}

function checkNotContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) failures.push(`${label}: expected NOT to contain "${needle}"`)
}

// pdf-parse may split glyph runs; collapse whitespace before matching.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

async function renderText(lines: PickListLine[]): Promise<string> {
  const props: PickListDocumentProps = {
    orderNumber: 'S260912-001',
    description: 'ZZTEST walkie pull',
    companyName: 'ZZTEST Productions',
    jobCode: 'SR-JOB-0000',
    jobName: 'ZZTEST Job',
    deliveryType: 'WILL CALL',
    assignedToName: null,
    agentName: 'Jose Pacheco',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    pickDate: '2026-09-14',
    lines,
    generatedAt: new Date('2026-09-12T17:00:00Z'),
  }
  const element = React.createElement(PickListDocument, props) as React.ReactElement<DocumentProps>
  const pdf = await renderToBuffer(element)
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  const result = await parser.getText()
  return normalize(result.text)
}

const radio: PickListLine = {
  department: 'COMMUNICATIONS',
  code: '104387',
  description: 'CP200 Radio',
  notes: null,
  type: 'RENT',
  ordered: 15,
  out: 0,
  picked: false,
  unitChecks: ['Antenna', 'Battery'],
}

const antennaLine: PickListLine = {
  department: 'COMMUNICATIONS',
  code: '104388',
  description: 'CP200 - Antenna',
  notes: null,
  type: 'RENT',
  ordered: 15,
  out: 0,
  picked: false,
  includedAccessory: true,
}

const cooler: PickListLine = {
  department: 'PRO_SUPPLIES',
  code: '100001',
  description: 'Cooler, 48qt',
  notes: 'Check for Drain Plug ( ) Initial.',
  type: 'RENT',
  ordered: 2,
  out: 0,
  picked: false,
}

async function main() {
  // ── The pure rule ──────────────────────────────────────────────────
  check(
    printableUnitChecks(['Antenna', 'Battery'], ['CP200 Radio']).join('|') === 'Antenna|Battery',
    'rule: nothing suppressed when no line names a check',
  )
  check(
    printableUnitChecks(['Antenna', 'Battery'], ['CP200 Radio', 'CP200 - Antenna']).join('|') === 'Battery',
    'rule: a check that is its own line on the sheet is suppressed',
  )
  check(
    printableUnitChecks(['antenna'], ['CP200 - ANTENNA (incl.)']).length === 0,
    'rule: suppression is case- and punctuation-insensitive',
  )
  check(
    printableUnitChecks([' ', ''], ['CP200 Radio']).length === 0,
    'rule: blank names never print',
  )

  // ── Rendered: both checks print under the radio ────────────────────
  const withChecks = await renderText([radio, cooler])
  checkContains(withChecks, 'Each unit', 'render: Each unit row prints')
  checkContains(withChecks, '( ) Antenna × 1', 'render: Antenna check box prints')
  checkContains(withChecks, '( ) Battery × 1', 'render: Battery check box prints')
  checkContains(withChecks, 'Notes: Check for Drain Plug', 'render: Notes row still prints')
  check(
    withChecks.indexOf('CP200 Radio') < withChecks.indexOf('Each unit'),
    'render: Each unit row sits under its line',
  )

  // ── Rendered: a check that is already a line is suppressed ─────────
  const withAntennaLine = await renderText([radio, antennaLine, cooler])
  checkContains(withAntennaLine, 'CP200 - Antenna', 'render: the antenna line itself prints')
  checkContains(withAntennaLine, '( ) Battery × 1', 'render: Battery still prints when only Antenna is a line')
  checkNotContains(withAntennaLine, '( ) Antenna', 'render: Antenna check suppressed — it is its own line')

  // ── Rendered: a sheet with no checks carries no Each-unit row ──────
  const plain = await renderText([cooler])
  checkNotContains(plain, 'Each unit', 'render: no Each unit row without checks')

  if (failures.length) {
    console.error(`\n✗ ${failures.length} failure(s):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('✓ pick-list-pdf: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
