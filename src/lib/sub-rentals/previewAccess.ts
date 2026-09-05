/**
 * Page-side gate for the HQ portal previews — the same rule as
 * requireSubRentalAccess (the API version), for a server component.
 */
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export async function requireSubRentalPageAccess() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) redirect('/api/auth/signin')
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, salesOnly: true, email: true } })
  if (!user) redirect('/api/auth/signin')
  const perms = getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email })
  if (!perms.subRentals) redirect('/')
  return user
}
