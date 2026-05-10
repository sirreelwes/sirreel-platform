import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Marks an inbound email as "not an inquiry" by creating a placeholder
// Inquiry record with status=DISMISSED. Keeps a history of triage decisions
// without touching the email's own status (so the inbox view is unaffected).
//
// Body: { emailId: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const emailId = typeof body.emailId === 'string' ? body.emailId : '';
  if (!emailId) return NextResponse.json({ error: 'emailId required' }, { status: 400 });

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: { id: true, subject: true, fromAddress: true, companyId: true },
  });
  if (!email) return NextResponse.json({ error: 'email not found' }, { status: 404 });

  // Idempotent: if already considered, just return.
  const existing = await prisma.inquiry.findMany({
    select: { id: true, status: true, sourceMetadata: true },
  });
  const dupe = existing.find((i) => {
    const meta = i.sourceMetadata as Record<string, unknown> | null;
    return meta?.emailMessageId === email.id;
  });
  if (dupe) {
    return NextResponse.json({ inquiry: { id: dupe.id }, deduped: true });
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      title: (email.subject || 'Dismissed email').slice(0, 200),
      description: `Dismissed as inquiry from ${email.fromAddress}`,
      source: 'GMAIL',
      status: 'DISMISSED',
      companyId: email.companyId,
      assignedToId: userId,
      sourceMetadata: { emailMessageId: email.id, fromAddress: email.fromAddress, dismissed: true },
    },
    select: { id: true },
  });

  return NextResponse.json({ inquiry });
}
