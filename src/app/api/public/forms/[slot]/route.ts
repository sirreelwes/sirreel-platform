/**
 * GET /api/public/forms/[slot] — PUBLIC proxy for the downloadable
 * marketing forms (PDF), stored in the PRIVATE Vercel Blob store (a
 * direct fetch of the raw blob URL 403s).
 *
 * Deliberately narrow — it resolves ONLY these four designated
 * SiteSetting form fields and streams them; it can never serve an
 * arbitrary blob:
 *
 *   slot=coi              → SiteSetting.formCoiUrl
 *   slot=w9               → SiteSetting.formW9Url
 *   slot=rental-agreement → SiteSetting.formRentalAgreementUrl
 *   slot=studio-contract  → SiteSetting.formStudioContractUrl
 *
 * There is intentionally NO slot for ACH / wire / payment info (those
 * are request-only, routed through the contact intake) and NO slot for
 * Credit-Card Authorization (CardPointe's domain — SirReel never stores
 * or serves card data). Any other slot / unset field → 404, so a Forms
 * menu link 404s gracefully until an admin uploads the PDF.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { get as getBlob } from '@vercel/blob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slot: string }> }

const SLOT_FIELD = {
  coi: 'formCoiUrl',
  w9: 'formW9Url',
  'rental-agreement': 'formRentalAgreementUrl',
  'studio-contract': 'formStudioContractUrl',
} as const

const SLOT_FILENAME = {
  coi: 'SirReel-Sample-COI.pdf',
  w9: 'SirReel-W9.pdf',
  'rental-agreement': 'SirReel-Rental-Agreement.pdf',
  'studio-contract': 'SirReel-Studio-Contract.pdf',
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const { slot } = await params
  const key = slot as keyof typeof SLOT_FIELD
  const field = SLOT_FIELD[key]
  if (!field) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { formCoiUrl: true, formW9Url: true, formRentalAgreementUrl: true, formStudioContractUrl: true },
  })
  const fileUrl = settings?.[field]
  if (!fileUrl) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let blob
  try {
    blob = await getBlob(fileUrl, { access: 'private' })
  } catch {
    return NextResponse.json({ error: 'blob unreachable' }, { status: 502 })
  }
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return new Response(blob.stream, {
    status: 200,
    headers: {
      'Content-Type': blob.blob.contentType || 'application/pdf',
      // Inline so the PDF opens in a tab; the filename is the download name.
      'Content-Disposition': `inline; filename="${SLOT_FILENAME[key]}"`,
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
