/**
 * Who may change a client's terms — deals, portal access, logo.
 *
 * Wes 2026-09-04: "Only Wes and Jose and Dani can make changes to terms
 * etc." Not a role: ADMIN is Wes and Dani, and Jose is an AGENT. So this is
 * an email allowlist, the same shape as the Wes-only export approver and
 * the bank-details writers — the people are named, and adding one is a
 * code change someone reviews.
 *
 * Enforced on the WRITE routes (discounts, rates, portal access, logo),
 * not only on the panels' `canEdit` — a hidden button is not a permission.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const COMPANY_TERMS_EDITORS = new Set([
  'wes@sirreel.com',
  'dani@sirreel.com',
  'jose@sirreel.com',
])

export function canEditCompanyTerms(email: string | null | undefined): boolean {
  return !!email && COMPANY_TERMS_EDITORS.has(email.toLowerCase())
}

/**
 * Route guard. Returns the user, or the response to send back.
 *   401 — not signed in at all
 *   403 — signed in, not on the list (the reason names who is)
 */
export async function requireCompanyTermsEditor(): Promise<
  { user: { id: string; email: string; name: string } } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true },
  })
  if (!user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  if (!canEditCompanyTerms(user.email)) {
    return {
      error: NextResponse.json(
        { error: 'forbidden', reason: 'Client terms are changed by Wes, Dani or Jose.' },
        { status: 403 },
      ),
    }
  }
  return { user }
}
