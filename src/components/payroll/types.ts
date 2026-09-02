import type { PayPeriodStatus, TimeEntrySource } from '@prisma/client'

/** Mirrors src/lib/payroll/period.ts — the server computes, the UI renders. */
export interface GridCell {
  id: string
  date: string
  inClock: string | null
  outClock: string | null
  lunchMin: number
  sickHrs: number
  ptoHrs: number
  adjHrs: number
  mealPremium: boolean
  note: string | null
  source: TimeEntrySource
  workedHrs: number
  spanHrs: number
  incomplete: boolean
}

export interface WeekTotals {
  weekStart: string
  totalHrs: number
  regHrs: number
  otHrs: number
  dtHrs: number
  sickHrs: number
  ptoHrs: number
  mealPremiumHrs: number
}

export interface GridRow {
  employeeId: string
  fullName: string
  title: string | null
  department: string | null
  cells: Record<string, GridCell>
  totals: {
    weeks: WeekTotals[]
    totalHrs: number
    regHrs: number
    otHrs: number
    dtHrs: number
    sickHrs: number
    ptoHrs: number
    mealPremiumHrs: number
  }
  exceptions: Array<{ kind: string; date: string; detail: string }>
}

export interface PeriodGrid {
  id: string
  startDate: string
  endDate: string
  status: PayPeriodStatus
  note: string | null
  lockedAt: string | null
  exportedAt: string | null
  editable: boolean
  days: string[]
  weeks: Array<{ weekStart: string; days: string[] }>
  rows: GridRow[]
  totals: {
    regHrs: number
    otHrs: number
    dtHrs: number
    sickHrs: number
    ptoHrs: number
    mealPremiumHrs: number
    totalHrs: number
  }
  exceptionCount: number
}

/** What one cell edit sends. Omitted fields keep their stored value. */
export interface CellPatch {
  inClock?: string | null
  outClock?: string | null
  lunchMin?: number
  sickHrs?: number
  ptoHrs?: number
  adjHrs?: number
  mealPremium?: boolean
  note?: string | null
  clear?: true
}
