/**
 * /portal/account — Phase 1 stub for the person-scoped portal.
 *
 * Server component. Reads sr_person_session cookie, HMAC-verifies it,
 * loads the PersonSession (which carries the Person FK), and shows a
 * "Signed in as {email}" page. Anything more substantive lives in
 * Phase 2.
 *
 * Unauthorized / expired / revoked → redirect to /portal/auth/sign-in.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  PERSON_SESSION_COOKIE,
  verifyPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

export default async function PortalAccountPage() {
  const cookieValue = cookies().get(PERSON_SESSION_COOKIE)?.value
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) redirect('/portal/auth/sign-in')

  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: {
      id: true,
      revokedAt: true,
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  // Cookie alone is not authorization — re-check the row.
  if (!session || session.revokedAt) redirect('/portal/auth/sign-in')

  const person = session.person
  const fullName = `${person.firstName} ${person.lastName}`.trim()

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-12">
      <div className="max-w-2xl mx-auto bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Signed in</div>
        <h1 className="text-2xl font-semibold text-zinc-900 mt-1">{fullName || person.email}</h1>
        <p className="text-sm text-zinc-600 mt-1">{person.email}</p>

        <div className="mt-6 text-sm text-zinc-600">
          Your portal home will show your jobs, quotes, and supply orders here.
          That view ships in Phase 2 — for now you're just signed in.
        </div>
      </div>
    </div>
  )
}
