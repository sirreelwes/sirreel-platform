import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { put } from '@vercel/blob'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'
import { ensureSignedAgreementForOrder } from '@/lib/orders/signedAgreement'

export const dynamic = 'force-dynamic'

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'public',
  'contracts',
  'sirreel-rental-agreement-template.docx',
)

const SALES_EMAILS = ['jose@sirreel.com', 'oliver@sirreel.com']

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

async function sendSalesDownloadEmail(args: {
  companyName: string
  jobName: string
  jobNumber: string
  orderId: string
}) {
  if (!process.env.RESEND_API_KEY) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const adminUrl = `https://hq.sirreel.com/orders/${args.orderId}`
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1f3d5c;padding:20px;text-align:center;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Agreement download notification</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p><strong>${args.companyName}</strong> downloaded the rental agreement for legal review.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Job</td><td style="padding:4px 0;font-weight:600;">${args.jobName || '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Job #</td><td style="padding:4px 0;font-weight:600;">${args.jobNumber || '—'}</td></tr>
      </table>
      <p style="font-size:13px;color:#6b7280;">They&rsquo;ll either return with a redline or sign the original. Suggest following up in 2&ndash;3 days if you don&rsquo;t hear back.</p>
      <div style="margin-top:20px;text-align:center;">
        <a href="${adminUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open order in SirReel HQ &rarr;</a>
      </div>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
  try {
    await resend.emails.send({
      from: 'SirReel HQ <notifications@sirreel.com>',
      to: SALES_EMAILS,
      subject: `${args.companyName} downloaded agreement for review`,
      html,
    })
  } catch (err) {
    console.error('[portal/agreement/download] sales email failed:', err)
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  if (!resolved.agreement) {
    await ensureSignedAgreementForOrder(resolved.order.id)
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId: resolved.order.id },
    select: { id: true, status: true },
  })
  if (!agreement) {
    return NextResponse.json({ error: 'Agreement not initialized' }, { status: 500 })
  }

  // Only allow re-downloads while we're still in the pre-signature phase.
  // Once a signed PDF exists, the client should download THAT, not the
  // unsigned template.
  if (
    agreement.status !== 'PORTAL_GENERATED' &&
    agreement.status !== 'DOWNLOAD_SENT'
  ) {
    return NextResponse.json(
      {
        error: 'Download not available in current state',
        currentStatus: agreement.status,
      },
      { status: 409 },
    )
  }

  // Re-fetch the order with the fields we need for placeholder fills.
  const orderRow = await prisma.order.findUnique({
    where: { id: resolved.order.id },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      company: {
        select: {
          name: true,
          industry: true,
          billingAddress: true,
          billingEmail: true,
        },
      },
      job: { select: { name: true, jobCode: true, productionType: true } },
      jobContact: {
        select: {
          firstName: true,
          lastName: true,
          role: true,
          email: true,
          phone: true,
        },
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
    console.error('[portal/agreement/download] template missing at', TEMPLATE_PATH, err)
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
        },
      ),
    )
    filledBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  } catch (err) {
    console.error('[portal/agreement/download] docxtemplater render failed:', err)
    return NextResponse.json(
      { error: 'Failed to fill agreement template' },
      { status: 500 },
    )
  }

  const jobNumberSlug = safeFilenameSegment(orderRow.job?.jobCode || orderRow.orderNumber)
  const filename = `sirreel-rental-agreement-${jobNumberSlug}.docx`
  const blobKey = `word-downloads/${orderRow.id}/${Date.now()}-${filename}`

  let blobUrl: string | null = null
  try {
    const uploaded = await put(blobKey, filledBuffer, {
      access: 'private',
      contentType: DOCX_MIME,
    })
    blobUrl = uploaded.url
  } catch (err) {
    // Blob failure shouldn't block the download itself; record-keeping
    // suffers but the client still gets their .docx.
    console.error('[portal/agreement/download] blob upload failed:', err)
  }

  const isFirstDownload = agreement.status === 'PORTAL_GENERATED'
  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'DOWNLOAD_SENT',
      wordDocumentUrl: blobUrl ?? undefined,
    },
  })

  if (isFirstDownload) {
    await sendSalesDownloadEmail({
      companyName: orderRow.company.name,
      jobName: orderRow.job?.name || '',
      jobNumber: orderRow.job?.jobCode || orderRow.orderNumber,
      orderId: orderRow.id,
    })
  }

  const headers = new Headers()
  headers.set('Content-Type', DOCX_MIME)
  headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  headers.set('Content-Length', String(filledBuffer.length))
  headers.set('Cache-Control', 'no-store')

  return new NextResponse(new Uint8Array(filledBuffer), { status: 200, headers })
}
