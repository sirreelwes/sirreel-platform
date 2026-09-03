import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

/**
 * PATCH /api/collections/rw-review/note — the human note on an invoice.
 *
 * Separate from the triage ruling at /collections/aging-review on purpose: a
 * note is an observation ("client says AP runs on the 15th"), a ruling is a
 * decision with consequences. Requiring a decision in order to record a note
 * would push people into ruling early, and write-offs land in the tax ledger.
 *
 * Stamped with who wrote it, because "spoke to them" is worth much more when
 * you know who spoke.
 */

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId : ''
  if (!rwInvoiceId) return NextResponse.json({ error: 'rwInvoiceId required' }, { status: 400 })

  const raw = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : ''
  // Empty clears the note rather than storing "" — a blank note should read as
  // "nobody has written one", which is what null means everywhere else here.
  const note = raw || null
  const stamp = note ? { noteBy: user.email, noteAt: new Date() } : { noteBy: null, noteAt: null }

  const saved = await prisma.rwInvoiceReview.upsert({
    where: { rwInvoiceId },
    create: { rwInvoiceId, note, ...stamp },
    update: { note, ...stamp },
    select: { note: true, noteBy: true, noteAt: true },
  })

  return NextResponse.json({ ok: true, ...saved })
}
