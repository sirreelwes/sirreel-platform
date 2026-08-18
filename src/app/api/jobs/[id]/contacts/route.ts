import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { JobRole } from '@prisma/client'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

export const dynamic = 'force-dynamic'

const VALID_ROLES: JobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'OTHER']

/**
 * POST /api/jobs/[id]/contacts — add a contact directly to a job.
 *
 * Until now contacts could only attach through order flows, so a job whose
 * contact set was wrong after creation had no fix — which stopped mattering
 * being cosmetic on 2026-08-18, when the final-invoice payment-options email
 * started routing by it (ACCOUNTING first, then the primary convention). A
 * missing or wrong contact now silently decides who is told how to pay.
 *
 * Same semantics as the order-page add (orders/[id]/contacts), minus the
 * portal-invite step — portal access is minted against an ORDER, and the act
 * of adding a routing contact should not email anyone by itself.
 *
 *   { email: string, firstName?: string, lastName?: string, role?: JobRole }
 *
 * Person is find-or-create via the alias-aware resolver (a merged loser's
 * email lands on the survivor). JobContact is find-or-create on the
 * (job, person, role) unique key, so re-adding is idempotent. First contact
 * on a job becomes primary, matching the order-page rule.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    firstName?: unknown
    lastName?: unknown
    role?: unknown
  }
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  const roleInput = typeof body.role === 'string' ? body.role : 'OTHER'
  const role: JobRole = (VALID_ROLES as readonly string[]).includes(roleInput)
    ? (roleInput as JobRole)
    : 'OTHER'

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const existingPerson = (await resolvePersonByEmail(email, {
    select: { id: true, firstName: true, lastName: true, email: true },
  })) as { id: string; firstName: string; lastName: string; email: string } | null

  let person: { id: string; firstName: string; lastName: string; email: string }
  if (existingPerson) {
    // Supplied names refine the record; absence leaves it alone.
    person =
      firstName || lastName
        ? await prisma.person.update({
            where: { id: existingPerson.id },
            data: { firstName: firstName || undefined, lastName: lastName || undefined },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : existingPerson
  } else {
    person = await prisma.person.create({
      data: { email, firstName: firstName || email.split('@')[0], lastName: lastName || '—' },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
  }

  const existing = await prisma.jobContact.findUnique({
    where: { jobId_personId_role: { jobId: job.id, personId: person.id, role } },
    select: { id: true },
  })
  if (!existing) {
    await prisma.jobContact.create({
      data: {
        jobId: job.id,
        personId: person.id,
        role,
        isPrimary: (await prisma.jobContact.count({ where: { jobId: job.id } })) === 0,
      },
    })
  }

  return NextResponse.json({ ok: true, person, jobContactCreated: !existing })
}
