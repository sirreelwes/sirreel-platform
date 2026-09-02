/**
 * CSV export for ADP TotalSource.
 *
 * One row per employee per WORKWEEK, not per period. ADP prices overtime by
 * workweek; handing it two weeks summed together would understate OT exactly
 * the way averaging does in the math library. If a period ever holds one week
 * or three, this still emits one row each.
 *
 * CSV only — there is no ADP API integration here and none is planned for v1.
 * Somebody keys this file in, so the columns are named the way the ADP entry
 * screen reads and the numbers are already rounded to the hundredth.
 *
 * NO RATES AND NO DOLLARS. This file is hours. ADP holds the rates and does
 * the money; a rate column here would be a second place for them to disagree.
 *
 * Downloading is what marks the period EXPORTED — see the note below.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePayrollAccess } from '@/lib/payroll/access'
import { loadPeriodGrid } from '@/lib/payroll/period'

export const dynamic = 'force-dynamic'

/** RFC-4180 quoting. Names with commas are the reason this exists. */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADER = [
  'Employee', 'Week Start', 'Week End',
  'Regular Hrs', 'OT Hrs', 'Double Time Hrs',
  'Sick Hrs', 'PTO Hrs', 'Meal Premium Hrs',
]

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const grid = await loadPeriodGrid(params.id)
  if (!grid) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // A DRAFT period has not been reviewed. Exporting one would send ADP
  // half-keyed numbers with nothing recording that they were provisional.
  if (grid.status === 'DRAFT') {
    return NextResponse.json({ error: 'lock the period before exporting' }, { status: 409 })
  }

  const lines: string[] = [HEADER.join(',')]
  let rowsWritten = 0

  for (const row of grid.rows) {
    for (const week of row.totals.weeks) {
      const weekStart = week.weekStart.toISOString().slice(0, 10)
      const weekEndDate = new Date(week.weekStart)
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)

      // Skip an employee-week with nothing in it. Nine people × two weeks of
      // zeros is eighteen rows for ADP to key past to find the real ones.
      const anything = week.totalHrs || week.sickHrs || week.ptoHrs || week.mealPremiumHrs
      if (!anything) continue

      lines.push([
        csvCell(row.fullName),
        csvCell(weekStart),
        csvCell(weekEndDate.toISOString().slice(0, 10)),
        week.regHrs.toFixed(2),
        week.otHrs.toFixed(2),
        week.dtHrs.toFixed(2),
        week.sickHrs.toFixed(2),
        week.ptoHrs.toFixed(2),
        week.mealPremiumHrs.toFixed(2),
      ].join(','))
      rowsWritten += 1
    }
  }

  if (rowsWritten === 0) {
    return NextResponse.json({ error: 'nothing to export — this period has no hours' }, { status: 409 })
  }

  // Downloading IS the export. The stamp goes on here rather than behind a
  // separate "mark exported" button because the two must not drift: a period
  // marked EXPORTED that nobody downloaded, or a file in ADP that HQ still
  // shows as merely LOCKED, are both worse than a status that follows the
  // file. Re-downloading a period already EXPORTED is fine and refreshes the
  // stamp — that is a re-send to ADP, which is a real thing that happens.
  await prisma.payPeriod.update({
    where: { id: grid.id },
    data: { status: 'EXPORTED', exportedAt: new Date(), exportedById: me.id },
  })

  const filename = `sirreel-payroll-${grid.startDate}-to-${grid.endDate}.csv`
  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
