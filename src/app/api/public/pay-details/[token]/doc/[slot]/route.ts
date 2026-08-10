/**
 * GET /api/public/pay-details/[token]/doc/[slot] — stream the ACH form or
 * bank-info PDF behind a share token.
 *
 * These files used to ride along as email attachments, which is where the
 * banking details were leaving the building. Serving them behind the same
 * token keeps parity — an A/P department that needs the signed bank letter
 * for their vendor file still gets it — without putting a copy in a message
 * anyone in the thread can swap.
 *
 * paymentInfoAttachments carried the note "there is NO public route or proxy
 * that serves them". That is now this route, and it is not a weakening: the
 * blobs stay private, and reaching them requires an unguessable, revocable,
 * expiring token that SirReel issued to a specific address.
 */

import { NextResponse } from 'next/server'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'
const SLOTS = ['ach-form', 'bank-info'] as const
type Slot = (typeof SLOTS)[number]

export async function GET(
  _req: Request,
  { params }: { params: { token: string; slot: string } },
) {
  // One uniform failure for every reason — bad token, expired, revoked,
  // unknown slot, missing file. Distinguishing them confirms which tokens
  // are real.
  const gone = NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 404 })

  const token = (params.token || '').trim()
  if (!/^[a-f0-9]{16,96}$/.test(token)) return gone
  if (!SLOTS.includes(params.slot as Slot)) return gone

  const share = await prisma.paymentDetailsShare.findUnique({
    where: { token },
    select: { expiresAt: true, revokedAt: true },
  })
  if (!share || share.revokedAt || share.expiresAt < new Date()) return gone

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      paymentAchFormKey: true,
      paymentAchFormFilename: true,
      paymentBankInfoKey: true,
      paymentBankInfoFilename: true,
    },
  })
  const key = params.slot === 'ach-form' ? s?.paymentAchFormKey : s?.paymentBankInfoKey
  const filename =
    (params.slot === 'ach-form' ? s?.paymentAchFormFilename : s?.paymentBankInfoFilename) ||
    `sirreel-${params.slot}.pdf`
  if (!key) return gone

  try {
    const blob = await getBlob(key, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) return gone
    return new NextResponse(blob.stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/pdf',
        // `inline` so it opens in the browser — an A/P clerk checking a
        // routing number should not have to find it in their downloads.
        'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    // Filenames only, never contents.
    console.error('[pay-details doc] could not stream %s: %s', filename, err)
    return gone
  }
}
