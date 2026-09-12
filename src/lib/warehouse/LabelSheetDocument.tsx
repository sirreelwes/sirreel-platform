import React from 'react'
import { Document, Page, Text, View, Svg, Rect, StyleSheet } from '@react-pdf/renderer'
import { code39Geometry } from './code39'
import { LABEL_STOCKS, labelCells, type LabelStockId } from './unitLabels'
import type { LabelUnit } from './mintUnits'

// Shared hyphenation policy — registered once, see that module.
import '@/lib/pdf/hyphenation'

/**
 * SR unit labels on Avery-compatible sheets — Code 39, the symbology on
 * every RentalWorks label the yard already scans, so a label printed
 * here reads exactly like one RW printed. `*` start/stop is added by the
 * encoder; the human-readable line prints the bare barcode.
 *
 * Each label: barcode band across the top, the number in bold under it,
 * then the catalog code and name (one line each, cut to the stock's
 * budget), and the serial when there is one. Cells are absolutely
 * positioned from the stock's measured origin + pitch, so the sheet goes
 * through the printer at 100% — never "fit to page".
 */

export interface LabelSheetProps {
  stock: LabelStockId
  /** Cells to leave empty at the top of the first sheet. */
  skip: number
  units: LabelUnit[]
}

// Type budgets per stock: how big the text can be and how many glyphs
// of name fit on one line at that size. Measured, not derived.
const TYPE: Record<LabelStockId, { code: number; text: number; nameChars: number; barcodeH: number; pad: number; lines: number }> = {
  avery5160: { code: 9, text: 6.5, nameChars: 40, barcodeH: 26, pad: 5, lines: 3 },
  avery5163: { code: 14, text: 9, nameChars: 48, barcodeH: 58, pad: 10, lines: 3 },
  avery5167: { code: 6.5, text: 5, nameChars: 34, barcodeH: 14, pad: 3, lines: 1 },
}

// Widest a narrow bar should get, so a 4" label does not print a fat,
// hard-to-read code — 3.5 pt ≈ 48 mil.
const MAX_UNIT = 3.5

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', color: '#111111' },
  cell: { position: 'absolute', overflow: 'hidden' },
  code: { fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.1 },
  text: { textAlign: 'center', lineHeight: 1.15 },
})

function cut(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…`
}

function Barcode({ value, width, height }: { value: string; width: number; height: number }) {
  const geo = code39Geometry(value)
  const unit = Math.min(MAX_UNIT, width / geo.totalWidth)
  const drawn = geo.totalWidth * unit
  const offset = (width - drawn) / 2
  return (
    <Svg width={width} height={height}>
      {geo.bars.map((b, i) => (
        <Rect key={i} x={offset + b.x * unit} y={0} width={b.width * unit} height={height} fill="#111111" />
      ))}
    </Svg>
  )
}

export function LabelSheetDocument({ stock: stockId, skip, units }: LabelSheetProps) {
  const stock = LABEL_STOCKS[stockId]
  const t = TYPE[stockId]
  const cells = labelCells(stock, units.length, skip)
  const pageCount = units.length ? cells[cells.length - 1].page + 1 : 1
  const inner = stock.label.width - t.pad * 2

  return (
    <Document title={`SR labels · ${stock.compatible}`} author="SirReel Studio Services">
      {Array.from({ length: pageCount }, (_, p) => (
        <Page key={p} size={[stock.page.width, stock.page.height]} style={styles.page}>
          {units.map((u, i) => {
            const c = cells[i]
            if (c.page !== p) return null
            const showName = t.lines >= 2
            const showSerial = t.lines >= 3 && !!u.serialNumber
            return (
              <View
                key={u.id}
                style={[styles.cell, {
                  left: c.x, top: c.y, width: stock.label.width, height: stock.label.height,
                  paddingHorizontal: t.pad, paddingTop: t.pad * 0.8,
                }]}
              >
                <Barcode value={u.barcode} width={inner} height={t.barcodeH} />
                <Text style={[styles.code, { fontSize: t.code, marginTop: 1.5 }]}>{u.barcode}</Text>
                {showName ? (
                  <Text style={[styles.text, { fontSize: t.text }]}>
                    {cut(`${u.itemCode ? `${u.itemCode} · ` : ''}${u.name}`, t.nameChars)}
                  </Text>
                ) : null}
                {showSerial ? (
                  <Text style={[styles.text, { fontSize: t.text }]}>{cut(`S/N ${u.serialNumber}`, t.nameChars)}</Text>
                ) : null}
              </View>
            )
          })}
        </Page>
      ))}
    </Document>
  )
}
