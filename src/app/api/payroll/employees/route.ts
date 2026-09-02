/**
 * The payroll roster.
 *
 * Reads Employee (hr_employees) — the SAME roster HR uses. There is no second
 * employee table; PayrollProfile only says whether a person appears on the
 * timesheet and, for Phase 2, what they earn.
 *
 * hourlyRate is NEVER selected here. v1 has no surface that shows a rate, and
 * the way to keep it that way is for the route that feeds every payroll screen
 * to be incapable of returning one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePayrollAccess } from '@/lib/payroll/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: {
      id: true, fullName: true, title: true, department: true,
      payrollProfile: { select: { onPayroll: true } },
    },
    orderBy: { fullName: 'asc' },
  })

  return NextResponse.json({
    employees: employees.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      title: e.title,
      department: e.department,
      onPayroll: e.payrollProfile?.onPayroll ?? false,
    })),
  })
}

/** Add or remove someone from the timesheet grid. */
export async function PATCH(req: NextRequest) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const body = await req.json().catch(() => null)
  if (!body?.employeeId || typeof body.onPayroll !== 'boolean') {
    return NextResponse.json({ error: 'employeeId and onPayroll are required' }, { status: 400 })
  }

  const employee = await prisma.employee.findUnique({
    where: { id: String(body.employeeId) }, select: { id: true },
  })
  if (!employee) return NextResponse.json({ error: 'unknown employee' }, { status: 404 })

  // Upsert, not update: most Employees have no PayrollProfile yet, and
  // toggling someone on for the first time should just work.
  await prisma.payrollProfile.upsert({
    where: { employeeId: employee.id },
    create: { employeeId: employee.id, onPayroll: body.onPayroll },
    update: { onPayroll: body.onPayroll },
  })

  return NextResponse.json({ ok: true })
}
