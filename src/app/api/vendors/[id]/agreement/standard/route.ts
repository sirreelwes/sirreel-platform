/** POST /api/vendors/[id]/agreement/standard — file SirReel's standard
 *  Partner Vehicle Agreement for this partner, pre-filled with their name and
 *  address, into the same sign flow a hand-uploaded PDF takes. Supersedes any
 *  live agreement (uploadVendorAgreement soft-deletes it). */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { uploadVendorAgreement } from '@/lib/sub-rentals/vendorAccountActions'
import { generateVendorAgreementPdf } from '@/lib/contracts/generateVendorAgreementPdf'
import { VENDOR_AGREEMENT_TITLE, VENDOR_AGREEMENT_VERSION } from '@/lib/contracts/vendorAgreementClauses'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const vendor = await prisma.vendor.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, address: true, lotAddress: true, contactName: true, email: true },
  })
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  try {
    const bytes = await generateVendorAgreementPdf({
      partner: { name: vendor.name, address: vendor.address ?? vendor.lotAddress, contactName: vendor.contactName, email: vendor.email },
    })
    const title = `SirReel ${VENDOR_AGREEMENT_TITLE}`
    const created = await uploadVendorAgreement({
      vendorId: vendor.id,
      title,
      filename: `SirReel-Partner-Vehicle-Agreement-${vendor.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
      bytes,
      effectiveDate: new Date(),
      byUserId: g.user.id,
    })
    return NextResponse.json({ ok: true, id: created.id, title, version: VENDOR_AGREEMENT_VERSION })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
