import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const req = await prisma.paperworkRequest.findFirst({
    select: { token: true, booking: { select: { jobName: true } } }
  });
  return NextResponse.json(req);
}
