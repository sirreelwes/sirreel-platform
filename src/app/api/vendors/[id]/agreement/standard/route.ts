/** POST /api/vendors/[id]/agreement/standard — file SirReel's standard
 *  Partner Vehicle Agreement for this partner, pre-filled with their name and
 *  address, into the same sign flow a hand-uploaded PDF takes. Supersedes any
 *  live agreement (uploadVendorAgreement soft-deletes it). */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { uploadVendorAgreement } from '@/lib/sub-rentals/vendorAccountActions'
import { generateVendorAgreementPdf } from '@/lib/contracts/generateVendorAgreementPdf'
import { vendorAgreementFor } from '@/lib/contracts/vendorAgreementClauses'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const vendor = await prisma.vendor.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, address: true, lotAddress: true, contactName: true, email: true, partnerSharePercent: true, partnerMaxSharePercent: true, partnerKind: true },
  })
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  try {
    // The vendor's kind picks the body: Vehicle Agreement for King Kong,
    // Equipment Agreement for PowerTrip.
    const doc = vendorAgreementFor(vendor.partnerKind)
    const bytes = await generateVendorAgreementPdf({
      partner: { name: vendor.name, address: vendor.address ?? vendor.lotAddress, contactName: vendor.contactName, email: vendor.email, sharePercent: vendor.partnerSharePercent == null ? null : Number(vendor.partnerSharePercent), maxSharePercent: vendor.partnerMaxSharePercent == null ? null : Number(vendor.partnerMaxSharePercent) },
      kind: doc.kind,
    })
    const title = `SirReel ${doc.title}`
    const created = await uploadVendorAgreement({
      vendorId: vendor.id,
      title,
      filename: `SirReel-${doc.title.replace(/[^A-Za-z0-9]+/g, '-')}-${vendor.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
      bytes,
      effectiveDate: new Date(),
      byUserId: g.user.id,
    })
    return NextResponse.json({ ok: true, id: created.id, title, version: doc.version })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
