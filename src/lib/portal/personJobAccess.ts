/**
 * "May this PERSON read this SHOW?" — the gate behind /portal/account/job/[jobId]
 * and its PDF routes.
 *
 * A person is attached to a job three ways (the same union
 * buildPersonAccount lists from, so a show they can see they can open):
 * the roster (JobContact), the booking contact (Booking.personId), or a
 * portal link they were sent (PortalAccess.contactId). Any one is enough.
 *
 * Misses are 404, never 403 — a 403 confirms the job exists.
 */

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PERSON_SESSION_COOKIE, verifyPersonSessionCookieValue } from '@/lib/portal/personSession'

export interface PersonJobAccess {
  personId: string
  jobId: string
  companyId: string
}

/** The job, if the person is attached to it and it belongs to a company. */
export async function findAttachedJob(personId: string, jobId: string): Promise<PersonJobAccess | null> {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      status: { not: 'LOST' },
      OR: [
        { jobContacts: { some: { personId } } },
        { bookings: { some: { personId } } },
        { orders: { some: { portalAccesses: { some: { contactId: personId } } } } },
      ],
    },
    select: { id: true, companyId: true },
  })
  if (!job?.companyId) return null
  return { personId, jobId: job.id, companyId: job.companyId }
}

/** The signed-in person behind the sr_person_session cookie, or null. */
async function personIdFromCookie(cookieValue: string | undefined): Promise<string | null> {
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) return null
  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: { personId: true, revokedAt: true },
  })
  if (!session || session.revokedAt) return null
  return session.personId
}

/** Server components: cookies() from next/headers. */
export async function getPersonJobAccess(jobId: string): Promise<PersonJobAccess | null> {
  const personId = await personIdFromCookie(cookies().get(PERSON_SESSION_COOKIE)?.value)
  if (!personId) return null
  return findAttachedJob(personId, jobId)
}

/** Route handlers: the cookie off the request. */
export async function getPersonJobAccessFromRequest(
  req: NextRequest,
  jobId: string,
): Promise<PersonJobAccess | null> {
  const personId = await personIdFromCookie(req.cookies.get(PERSON_SESSION_COOKIE)?.value)
  if (!personId) return null
  return findAttachedJob(personId, jobId)
}

/** The person-scoped twins of the company portal's PDF routes. */
export function personJobLinks(jobId: string) {
  return {
    home: '/portal/account',
    homeLabel: 'Your portal',
    invoicePdf: (inv: { id: string; pdfHref?: string }) => {
      const rw = inv.pdfHref?.match(/\/rw-invoice\/([^/]+)\/pdf/)
      return rw
        ? `/api/portal/account/job/${jobId}/rw-invoice/${rw[1]}/pdf`
        : `/api/portal/account/job/${jobId}/invoice/${inv.id}/pdf`
    },
    signedAgreementPdf: (agreementId: string) =>
      `/api/portal/account/job/${jobId}/agreement/${agreementId}/pdf?kind=signed`,
  }
}
