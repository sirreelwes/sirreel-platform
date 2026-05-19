import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put } from '@vercel/blob'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateStageContractPdf } from '@/lib/contracts/generateStageContractPdf'

export const dynamic = 'force-dynamic'

const PDF_MIME = 'application/pdf'

/**
 * POST /api/orders/[id]/generate-stage-contract
 *
 * Renders the SirReel stage contract PDF using:
 *   - StageBookingTerms (negotiated rate, dates, spaces, etc.)
 *   - Order.company / Order.job (for project framing)
 *   - The PRODUCER-role JobContact (for producer name/phone/email)
 *
 * The output PDF is Wes-pre-signed (typed name in the Licensor signature
 * block) and uploaded to Vercel Blob. A SignedAgreement row with
 * contractType=STAGE_CONTRACT is created (or updated) pointing at the
 * blob URL with status=PORTAL_GENERATED — the client portal then
 * surfaces it for countersigning at /api/portal/[token]/stage-agreement/sign.
 *
 * Idempotent: calling this endpoint multiple times for the same Order
 * regenerates the PDF (e.g. after terms are renegotiated) and updates
 * the existing SignedAgreement row's documentToSignUrl.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      company: { select: { name: true, billingAddress: true } },
      job: {
        select: {
          name: true,
          jobCode: true,
          jobContacts: {
            // Match the canonical producer role first; fall back to the
            // primary contact if no PRODUCER row exists on this job.
            select: {
              role: true,
              isPrimary: true,
              person: {
                select: { firstName: true, lastName: true, email: true, phone: true },
              },
            },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
      jobContact: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const terms = await prisma.stageBookingTerms.findUnique({ where: { orderId: params.id } })
  if (!terms) {
    return NextResponse.json(
      { error: 'Stage booking terms not yet saved — fill them in before generating the contract' },
      { status: 409 },
    )
  }

  const producerJobContact =
    order.job?.jobContacts.find((c) => c.role === 'PRODUCER') ?? order.job?.jobContacts[0] ?? null
  const producer = producerJobContact?.person ?? null

  // The "Contact" / "Your Name" block on the form defaults to the producer
  // when there's no separate contact specified — matches the docx's
  // "Same as producer [yes]/[no]" toggle behavior.
  const contactPerson = order.jobContact ?? producer

  const fullProducerName = producer
    ? `${producer.firstName} ${producer.lastName}`.trim()
    : ''
  const fullContactName = contactPerson
    ? `${contactPerson.firstName} ${contactPerson.lastName}`.trim()
    : fullProducerName

  const dailyRate = Number(terms.dailyRate.toString())
  const formattedRate = dailyRate.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  const pdfBuffer = await generateStageContractPdf({
    party: {
      clientCompany: order.company?.name ?? '',
      projectName: order.job?.name ?? '',
      clientAddress: order.company?.billingAddress ?? '',
      producerName: fullProducerName,
      producerPhone: producer?.phone ?? '',
      producerEmail: producer?.email ?? '',
      contactName: fullContactName,
      contactPhone: contactPerson?.phone ?? '',
      contactEmail: contactPerson?.email ?? '',
    },
    terms: {
      rentalDates: Array.isArray(terms.rentalDates) ? (terms.rentalDates as string[]) : [],
      dailyRate: formattedRate,
      productionOfficeRental: terms.productionOfficeRental,
      specificSpaces: terms.specificSpaces,
      securityGuardRequired: terms.securityGuardRequired,
    },
    generatedAt: new Date(),
  })

  const blobKey = `stage-contracts/${order.id}/baseline-${Date.now()}.pdf`
  const uploaded = await put(blobKey, pdfBuffer, { access: 'public', contentType: PDF_MIME })

  const today = new Date().toISOString().slice(0, 10)
  const saved = await prisma.signedAgreement.upsert({
    where: { orderId_contractType: { orderId: order.id, contractType: 'STAGE_CONTRACT' } },
    create: {
      orderId: order.id,
      contractType: 'STAGE_CONTRACT',
      documentType: 'BASELINE',
      status: 'PORTAL_GENERATED',
      baselineVersion: today,
      documentToSignUrl: uploaded.url,
    },
    update: {
      // Re-gen replaces the unsigned baseline. If the client has already
      // counter-signed (status === SIGNED_BASELINE) we still update the
      // URL — but a follow-up commit should treat that as a versioning
      // event and lock the prior signed copy. Out of scope for MVP.
      documentToSignUrl: uploaded.url,
      baselineVersion: today,
    },
    select: {
      id: true,
      contractType: true,
      status: true,
      documentToSignUrl: true,
      baselineVersion: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ ok: true, agreement: saved })
}
