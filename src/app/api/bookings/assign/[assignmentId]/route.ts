import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(req: NextRequest, { params }: { params: { assignmentId: string } }) {
  try {
    await prisma.bookingAssignment.delete({ where: { id: params.assignmentId } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
