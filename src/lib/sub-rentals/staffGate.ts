/** Route gate for partner-management writes: signed in + perms.subRentals. */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export async function requireSubRentalStaff(): Promise<{ user: { id: string; email: string } } | { error: NextResponse }> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, salesOnly: true, email: true } })
  if (!user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  if (!getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email }).subRentals) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { user: { id: user.id, email: user.email } }
}
