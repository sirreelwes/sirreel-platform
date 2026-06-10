/**
 * GET /api/hr/employees/[id]
 *
 * Single-employee detail: profile + filed HR mail grouped by category
 * + documents + a flat timeline (mail events). Allowlist-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireHrAccess } from '@/lib/hr/allowlist'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireHrAccess()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true, fullName: true, workEmail: true, personalEmails: true,
      title: true, department: true, isActive: true,
      startedOn: true, leftOn: true, notes: true, userId: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })
  if (!employee) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [mail, attachments] = await Promise.all([
    prisma.hrMail.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, category: true, disposition: true,
        parse: true, reason: true, dismissed: true,
        reviewedAt: true, createdAt: true,
        hrEmail: {
          select: {
            id: true, fromAddress: true, subject: true, sentAt: true,
            attachmentCount: true,
          },
        },
      },
    }),
    prisma.hrAttachment.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, category: true, title: true, fileUrl: true,
        mimeType: true, sizeBytes: true, createdAt: true,
        typeSource: true, typeConfidence: true,
      },
    }),
  ])

  return NextResponse.json({ employee, mail, attachments })
}
