import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from './auth';
import { prisma } from './prisma';

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, name: true },
  });
}

// For API route handlers — returns the user if admin, otherwise a NextResponse
// to short-circuit with. Usage:
//   const gate = await requireAdmin();
//   if (gate instanceof NextResponse) return gate;
//   const { user } = gate;
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return { user };
}
