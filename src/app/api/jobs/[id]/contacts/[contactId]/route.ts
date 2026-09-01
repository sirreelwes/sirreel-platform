import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { JobRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_ROLES: JobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'OTHER']

/**
 * PATCH  /api/jobs/[id]/contacts/[contactId]  { isPrimary?, role? }
 * DELETE /api/jobs/[id]/contacts/[contactId]
 *
 * Wes, 2026-08-31: "somehow the primary contact got corrupted or the
 * client entered something wrong … I added another contact but I need a
 * way to either modify the primary contact or remove her after adding a
 * correct one."
 *
 * Contacts could be ADDED to a job but never re-pointed or removed, so a
 * wrong primary was permanent. That stopped being cosmetic on 2026-08-18
 * when the final-invoice payment-options email began routing by it: a
 * bad primary silently decides who gets told how to pay. On SR-JOB-0268
 * the primary was a Person whose email column held the literal string
 * "martinez" — nothing that address could ever reach.
 *
 * ── What DELETE does and does not delete ───────────────────────────
 *
 * It removes the JobContact LINK, never the Person. A Person is a CRM
 * record with its own history, affiliations and email threads, and may
 * be on other jobs; deleting it to tidy one job's contact list would
 * destroy all of that. The bad row is unlinked here and dealt with in
 * the CRM if it needs dealing with.
 *
 * ── Primary is a job-wide invariant ────────────────────────────────
 *
 * At most one primary per job, so promoting one demotes the rest in the
 * same transaction. Removing the primary promotes the next contact
 * rather than leaving the job with none — a job with contacts but no
 * primary routes mail nowhere, which is the failure this endpoint
 * exists to fix, not one to introduce.
 */

async function loadLink(jobId: string, contactId: string) {
  return prisma.jobContact.findFirst({
    where: { id: contactId, jobId },
    select: { id: true, jobId: true, isPrimary: true, role: true, personId: true },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; contactId: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const link = await loadLink(params.id, params.contactId)
  if (!link) return NextResponse.json({ error: 'Contact not on this job' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { isPrimary?: unknown; role?: unknown }
  const wantsPrimary = body.isPrimary === true
  const roleInput = typeof body.role === 'string' ? body.role : null
  if (roleInput !== null && !(VALID_ROLES as readonly string[]).includes(roleInput)) {
    return NextResponse.json({ error: `role must be one of ${VALID_ROLES.join(', ')}` }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    if (wantsPrimary) {
      // Demote every OTHER contact on this job first — "primary" is a
      // job-wide invariant, not a per-row flag, and two of them routes
      // mail by whichever the query happens to return first.
      await tx.jobContact.updateMany({
        where: { jobId: link.jobId, id: { not: link.id } },
        data: { isPrimary: false },
      })
    }
    await tx.jobContact.update({
      where: { id: link.id },
      data: {
        ...(wantsPrimary ? { isPrimary: true } : {}),
        ...(roleInput ? { role: roleInput as JobRole } : {}),
      },
    })
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; contactId: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const link = await loadLink(params.id, params.contactId)
  if (!link) return NextResponse.json({ error: 'Contact not on this job' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.jobContact.delete({ where: { id: link.id } })
    if (!link.isPrimary) return
    // The primary just left. Promote by the same precedence the job page
    // reads with — PRODUCER, then PM, then PC — rather than whoever
    // happens to be oldest, so the promotion is the one a human would
    // have made.
    const rest = await tx.jobContact.findMany({
      where: { jobId: link.jobId },
      select: { id: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    if (rest.length === 0) return
    const rank = (r: string) => ['PRODUCER', 'PM', 'PC'].indexOf(r)
    const next =
      rest.find((c) => rank(c.role) === 0) ??
      rest.find((c) => rank(c.role) === 1) ??
      rest.find((c) => rank(c.role) === 2) ??
      rest[0]
    await tx.jobContact.update({ where: { id: next.id }, data: { isPrimary: true } })
  })

  return NextResponse.json({ ok: true })
}
