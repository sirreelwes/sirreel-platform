/**
 * GET /api/portal/job/agreement/download — native rental .docx download.
 *
 * Cookie-auth'd sibling of /api/portal/[token]/agreement/download.
 * Streams a freshly-rendered .docx of the rental agreement (template
 * filled with the order's company/job/contact placeholders) so the
 * client's legal team can mark it up in Word and upload a redline via
 * the sibling upload-redline endpoint.
 *
 * KEY DIFFERENCES from the legacy [token] download:
 *   1. Auth via JOB_SESSION_COOKIE rather than PaperworkRequest.token.
 *   2. Does NOT transition status. The legacy endpoint moved
 *      PORTAL_GENERATED → DOWNLOAD_SENT as a side effect of download
 *      (a "delivered" marker for the legacy flow). In the native
 *      flow, status is owned by the agent's release-gate +
 *      sign/upload-redline events; downloading is a read-only act.
 *   3. No sales-notification email — the agent already knows they
 *      released, and the native portal surfaces activity inline.
 *      Skipped to keep the click cheap; can be re-added behind a
 *      "first download" detector if useful.
 *
 * Permitted source states are the released-and-not-yet-signed set:
 * PORTAL_RELEASED, DOWNLOAD_SENT (legacy rows), REDLINE_UPLOADED,
 * UNDER_REVIEW, NEGOTIATED_READY. PORTAL_GENERATED is rejected — the
 * agent must release first. Signed states are rejected — download
 * the signed PDF, not the unsigned template.
 *
 * Body fill logic copied verbatim from the legacy route so the .docx
 * output is byte-identical; a future refactor can extract the
 * template-fill into a shared helper once the legacy route is
 * sunset.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { put } from '@vercel/blob'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'public',
  'contracts',
  'sirreel-rental-agreement-template.docx',
)

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function fmtDate(d: Date | null): string {
  if (!d) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(d)
}

function safeFilenameSegment(s: string | null | undefined): string {
  if (!s) return 'order'
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'order'
}

interface TemplateData {
  companyName: string
  companyType: string
  companyAddress: string
  companyEmail: string
  companyPhone: string
  jobName: string
  jobNumber: string
  jobType: string
  rentalStart: string
  rentalEnd: string
  contactFirstName: string
  contactLastName: string
  contactPosition: string
  contactEmail: string
  contactPhone: string
  generatedDate: string
}

function buildTemplateData(args: {
  company: { name: string; industry: string; billingAddress: string | null; billingEmail: string | null }
  job: { name: string | null; jobCode: string | null; productionType: string | null }
  order: { orderNumber: string; startDate: Date | null; endDate: Date | null }
  contact: { firstName: string; lastName: string; role: string; email: string; phone: string | null } | null
}): TemplateData {
  return {
    companyName: args.company.name || '',
    companyType: args.company.industry || '',
    companyAddress: args.company.billingAddress || '',
    companyEmail: args.company.billingEmail || '',
    companyPhone: '',
    jobName: args.job.name || '',
    jobNumber: args.job.jobCode || args.order.orderNumber || '',
    jobType: args.job.productionType || '',
    rentalStart: fmtDate(args.order.startDate),
    rentalEnd: fmtDate(args.order.endDate),
    contactFirstName: args.contact?.firstName || '',
    contactLastName: args.contact?.lastName || '',
    contactPosition: args.contact?.role || '',
    contactEmail: args.contact?.email || '',
    contactPhone: args.contact?.phone || '',
    generatedDate: fmtDate(new Date()),
  }
}

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolvedSession = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolvedSession) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: {
      orderId_contractType: {
        orderId: resolvedSession.orderId,
        contractType: 'RENTAL_AGREEMENT',
      },
    },
    select: { id: true, status: true },
  })
  if (!agreement) {
    return NextResponse.json(
      { error: 'No rental agreement has been generated for this order yet' },
      { status: 404 },
    )
  }

  // Released-but-not-signed only. PORTAL_GENERATED rejects: agent must
  // release before clients can download. SIGNED_* rejects: the signed
  // PDF (signedDocumentUrl) is the document of record, not the
  // unsigned template.
  const ALLOWED = new Set(['PORTAL_RELEASED', 'DOWNLOAD_SENT', 'REDLINE_UPLOADED', 'UNDER_REVIEW', 'NEGOTIATED_READY'])
  if (!ALLOWED.has(agreement.status)) {
    return NextResponse.json(
      { error: 'Download not available in current state', currentStatus: agreement.status },
      { status: 409 },
    )
  }

  const orderRow = await prisma.order.findUnique({
    where: { id: resolvedSession.orderId },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      company: {
        select: { name: true, industry: true, billingAddress: true, billingEmail: true },
      },
      job: { select: { name: true, jobCode: true, productionType: true } },
      jobContact: {
        select: { firstName: true, lastName: true, role: true, email: true, phone: true },
      },
    },
  })
  if (!orderRow || !orderRow.company) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  let templateBuffer: Buffer
  try {
    templateBuffer = await readFile(TEMPLATE_PATH)
  } catch (err) {
    console.error('[portal/job/agreement/download] template missing at', TEMPLATE_PATH, err)
    return NextResponse.json(
      { error: 'Agreement template not available on server' },
      { status: 500 },
    )
  }

  let filledBuffer: Buffer
  try {
    const zip = new PizZip(templateBuffer)
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    })
    doc.render(
      buildTemplateData({
        company: {
          name: orderRow.company.name,
          industry: orderRow.company.industry as unknown as string,
          billingAddress: orderRow.company.billingAddress,
          billingEmail: orderRow.company.billingEmail,
        },
        job: orderRow.job
          ? {
              name: orderRow.job.name,
              jobCode: orderRow.job.jobCode,
              productionType: orderRow.job.productionType as unknown as string,
            }
          : { name: null, jobCode: null, productionType: null },
        order: {
          orderNumber: orderRow.orderNumber,
          startDate: orderRow.startDate,
          endDate: orderRow.endDate,
        },
        contact: orderRow.jobContact
          ? {
              firstName: orderRow.jobContact.firstName,
              lastName: orderRow.jobContact.lastName,
              role: orderRow.jobContact.role as unknown as string,
              email: orderRow.jobContact.email,
              phone: orderRow.jobContact.phone,
            }
          : null,
      }),
    )
    filledBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  } catch (err) {
    console.error('[portal/job/agreement/download] docxtemplater render failed:', err)
    return NextResponse.json({ error: 'Failed to fill agreement template' }, { status: 500 })
  }

  const jobNumberSlug = safeFilenameSegment(orderRow.job?.jobCode || orderRow.orderNumber)
  const filename = `sirreel-rental-agreement-${jobNumberSlug}.docx`
  const blobKey = `word-downloads/${orderRow.id}/${Date.now()}-${filename}`

  // Persist the rendered .docx (non-fatal: client still gets the bytes
  // even if blob upload fails) so the agent has a downloadable copy
  // server-side too.
  try {
    const uploaded = await put(blobKey, filledBuffer, { access: 'private', contentType: DOCX_MIME })
    await prisma.signedAgreement.update({
      where: { id: agreement.id },
      data: { wordDocumentUrl: uploaded.url },
    })
  } catch (err) {
    console.error('[portal/job/agreement/download] blob upload failed (non-fatal):', err)
  }

  const headers = new Headers()
  headers.set('Content-Type', DOCX_MIME)
  headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  headers.set('Content-Length', String(filledBuffer.length))
  headers.set('Cache-Control', 'no-store')

  return new NextResponse(new Uint8Array(filledBuffer), { status: 200, headers })
}
