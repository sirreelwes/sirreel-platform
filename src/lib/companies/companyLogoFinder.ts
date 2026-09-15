/**
 * The database half of "pull their logo from their website": which
 * addresses a company's people use, and how a found logo is saved.
 *
 * Shared by the staff route (/api/crm/companies/[id]/logo/from-website) and
 * the backfill (scripts/fetch-company-logos.ts), so a logo found by either
 * lands on the row the same way. Pure rules live in `logoFromWebsite.ts`.
 */

import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { rankCompanyDomains, type FoundLogo, type RankedDomain } from './logoFromWebsite'

/** Every address we have for people at this company: job contacts on its
 *  jobs, the order contact, portal seats, inquiry senders, billing. */
export async function companyEmailDomains(companyId: string): Promise<{
  companyName: string
  domains: RankedDomain[]
} | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      website: true,
      billingEmail: true,
      jobs: { select: { jobContacts: { select: { person: { select: { email: true } } } } }, take: 200, orderBy: { createdAt: 'desc' } },
      orders: { select: { jobContact: { select: { email: true } } }, take: 200, orderBy: { createdAt: 'desc' } },
      portalAccesses: { select: { person: { select: { email: true } } } },
      inquiries: { select: { person: { select: { email: true } } }, take: 100, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!company) return null
  const emails = [
    company.billingEmail,
    ...company.jobs.flatMap((j) => j.jobContacts.map((c) => c.person.email)),
    ...company.orders.map((o) => o.jobContact?.email),
    ...company.portalAccesses.map((a) => a.person.email),
    ...company.inquiries.map((i) => i.person?.email),
  ]
  return {
    companyName: company.name,
    domains: rankCompanyDomains({ companyName: company.name, website: company.website, emails }),
  }
}

/**
 * Save a found logo onto the company. A vector mark is kept inline
 * (`logoSvg`, which the portal serves first and needs no blob token); a
 * raster one goes to the private blob store like a staff upload.
 * `logoUploadedById` records who pressed the button — null from the backfill.
 */
export async function saveFoundLogo(companyId: string, logo: FoundLogo, userId: string | null) {
  const ext = logo.contentType.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')
  if (logo.contentType === 'image/svg+xml' && logo.bytes.length <= 256 * 1024) {
    return prisma.company.update({
      where: { id: companyId },
      data: { logoSvg: logo.bytes.toString('utf8'), logoUrl: null, logoUploadedAt: new Date(), logoUploadedById: userId },
      select: { id: true, logoUploadedAt: true },
    })
  }
  const { fileUrl } = await uploadPrivateImage({
    keyPrefix: 'company-logos',
    ownerId: companyId,
    filename: `${logo.domain}-logo.${ext}`,
    contentType: logo.contentType,
    data: logo.bytes,
  })
  return prisma.company.update({
    where: { id: companyId },
    data: { logoUrl: fileUrl, logoSvg: null, logoUploadedAt: new Date(), logoUploadedById: userId },
    select: { id: true, logoUploadedAt: true },
  })
}
