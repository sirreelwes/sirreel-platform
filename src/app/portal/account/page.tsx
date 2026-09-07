/**
 * /portal/account — the signed-in Person's portal home.
 *
 * A thin door: auth (sr_person_session cookie → HMAC verify →
 * PersonSession, re-checking revokedAt) and then the shared body,
 * `PersonAccountView`. HQ's "see what they see" at
 * /crm/portals/preview/person/[personId] renders the same body without a
 * session, so what staff check is what the client gets.
 *
 * The body carries every show the person has touched across every
 * company — current work first, then the history (Wes 2026-09-07).
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PERSON_SESSION_COOKIE, verifyPersonSessionCookieValue } from '@/lib/portal/personSession'
import { buildPersonAccount } from '@/lib/portal/personAccount'
import { PersonAccountView } from '@/components/portal/PersonAccountView'

export const dynamic = 'force-dynamic'

export default async function PortalAccountPage() {
  const cookieValue = cookies().get(PERSON_SESSION_COOKIE)?.value
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) redirect('/portal/auth/sign-in')

  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: { id: true, revokedAt: true, personId: true },
  })
  if (!session || session.revokedAt) redirect('/portal/auth/sign-in')

  const account = await buildPersonAccount(session.personId)
  if (!account) redirect('/portal/auth/sign-in')

  return <PersonAccountView account={account} />
}
