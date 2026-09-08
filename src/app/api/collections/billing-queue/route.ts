import { NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import { billingQueue } from '@/lib/collections/billingQueue'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/billing-queue — orders due to be invoiced.
 *
 * Derived on every read (see src/lib/collections/billingQueue.ts): an order
 * that came back and has no SENT rental invoice is due the next day. Nothing
 * is stored except Ana's snooze/dismiss rulings, which the POST sibling
 * writes.
 *
 * Same gate as the rest of the workspace — the page and the endpoint call
 * one resolver, so a UI mistake cannot grant what the API wouldn't.
 */
export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const queue = await billingQueue()
  return NextResponse.json({ ok: true, ...queue })
}
