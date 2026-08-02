import { prisma } from '@/lib/prisma'
import type {
  StageBookingTermsForRender,
  StageContractPartyForRender,
} from './StageContractDocument'

/**
 * Assemble the party + terms a stage contract renders from, for one order.
 *
 * Shared by the staff generator (/api/orders/[id]/generate-stage-contract)
 * and the portal countersign route, so the signed PDF is the SAME document
 * the client reviewed — with a signature block added. Duplicating this
 * assembly is how the two copies would silently drift.
 *
 * Returns null when the order or its stage booking terms don't exist; the
 * caller decides the status code.
 */
export async function buildStageContractProps(orderId: string): Promise<{
  party: StageContractPartyForRender
  terms: StageBookingTermsForRender
} | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      company: { select: { name: true, billingAddress: true } },
      job: {
        select: {
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { firstName: true, lastName: true, email: true, phone: true } },
            },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
      jobContact: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  })
  if (!order) return null

  const terms = await prisma.stageBookingTerms.findUnique({ where: { orderId } })
  if (!terms) return null

  // Canonical producer first, else the primary contact — matches the
  // generator's original precedence.
  const producerJobContact =
    order.job?.jobContacts.find((c) => c.role === 'PRODUCER') ?? order.job?.jobContacts[0] ?? null
  const producer = producerJobContact?.person ?? null
  const contactPerson = order.jobContact ?? producer

  const fullProducerName = producer ? `${producer.firstName} ${producer.lastName}`.trim() : ''
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

  return {
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
  }
}
