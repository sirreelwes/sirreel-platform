/**
 * GET /api/hr/employees
 *
 * Lists all employees (active + inactive, sorted active-first then by
 * name). Counts filed mail + attachments per employee so the list
 * surface can render badges. Allowlist-gated — 401/403 for anyone
 * outside src/lib/hr/allowlist.ts's HR_ALLOWLIST.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireHrAccess } from '@/lib/hr/allowlist'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireHrAccess()
  if (gate instanceof NextResponse) return gate

  const employees = await prisma.employee.findMany({
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      workEmail: true,
      title: true,
      department: true,
      isActive: true,
      startedOn: true,
      leftOn: true,
      userId: true,
      _count: {
        select: {
          hrMail: true,
          hrAttachments: true,
        },
      },
    },
  })

  // Triage queue summary — count NEEDS_REVIEW items globally and per
  // employee. One groupBy + one count, not N queries.
  const [pendingTotal, pendingByEmployee] = await Promise.all([
    prisma.hrMail.count({ where: { disposition: 'NEEDS_REVIEW', dismissed: false } }),
    prisma.hrMail.groupBy({
      by: ['employeeId'],
      where: { disposition: 'NEEDS_REVIEW', dismissed: false, employeeId: { not: null } },
      _count: { _all: true },
    }),
  ])
  const pendingMap = new Map<string, number>()
  for (const row of pendingByEmployee) {
    if (row.employeeId) pendingMap.set(row.employeeId, row._count._all)
  }

  return NextResponse.json({
    employees: employees.map((e) => ({
      ...e,
      pendingReview: pendingMap.get(e.id) ?? 0,
    })),
    pendingTotal,
  })
}
