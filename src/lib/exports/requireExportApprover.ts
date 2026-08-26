/**
 * Server-side guards for /api/exports/*.
 *
 * Two levels, kept in one module so the request path and the approval path
 * can never drift onto different notions of identity:
 *
 *   requireExportRequester() — an authenticated user who can see the client
 *                              book at all (the `crm` permission).
 *   requireExportApprover()  — Wes, by email. The release control.
 *
 * Nav-hiding is not access control; both API layers enforce independently of
 * whatever the sidebar chose to render.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { isExportApprover, EXPORT_REQUEST_PERMISSION } from '@/lib/exports/approver'
import type { UserRole } from '@prisma/client'

export interface ExportGuardUser {
  id: string
  email: string
  name: string
  role: UserRole
  isApprover: boolean
}

export type ExportGuardResult =
  | { ok: true; user: ExportGuardUser }
  | { ok: false; response: NextResponse }

async function sessionUser(): Promise<ExportGuardUser | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, salesOnly: true },
  })
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isApprover: isExportApprover(user.email),
  }
}

const UNAUTH = () =>
  NextResponse.json({ error: 'unauthorized' }, { status: 401 })

export async function requireExportRequester(): Promise<ExportGuardResult> {
  const user = await sessionUser()
  if (!user) return { ok: false, response: UNAUTH() }
  // The approver always qualifies as a requester, even if a future
  // permissions edit were to drop `crm` from his role.
  if (!user.isApprover && !can(user.role, EXPORT_REQUEST_PERMISSION)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }
  return { ok: true, user }
}

export async function requireExportApprover(): Promise<ExportGuardResult> {
  const user = await sessionUser()
  if (!user) return { ok: false, response: UNAUTH() }
  if (!user.isApprover) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'forbidden', detail: 'Only Wes Bailey can approve data exports.' },
        { status: 403 },
      ),
    }
  }
  return { ok: true, user }
}
