import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const resend = new Resend(process.env.RESEND_API_KEY)

const COI_PROMPT = `You are reviewing a Certificate of Insurance (COI) for SirReel Production Vehicles Inc.

CERTIFICATE HOLDER REQUIRED:
- SirReel Production Vehicles Inc. (also: SirReel Production Vehicles, Inc. dba SirReel Studio Rentals)
- 8500 Lankershim Blvd, Sun Valley, CA 91352

CRITICAL REQUIREMENTS (must all pass — cannot be waived):
1. Certificate Holder = SirReel with correct address
2. Named insured must match the rental agreement company name exactly
3. General Liability - Each Occurrence min $1,000,000 AND General Aggregate min $2,000,000
4. Automobile Liability - CSL min $1,000,000, must cover Hired AND Non-Owned Autos
5. Additional Insured - SirReel named as Additional Insured
6. Loss Payee - SirReel named as Loss Payee
7. Coverage dates must cover the rental period
8. Policy not expired

ALERT REQUIREMENTS (admin judgment call):
A. Primary & Non-Contributory language
B. Waiver of Subrogation - if SUBR WVD column shows "Y" on ANY policy row, this passes
C. Umbrella/Excess Liability $1M
D. Workers Compensation - may be on separate payroll company certificate
E. 30-day cancellation notice clause
F. Independent contractor coverage on workers comp

Return ONLY valid JSON, no markdown:
{
  "criticalPass": true,
  "alertPass": true,
  "overallPass": true,
  "certificateHolder": { "pass": true, "found": "", "note": "" },
  "insuredName": { "pass": true, "found": "", "note": "" },
  "generalLiability": {
    "pass": true,
    "perOccurrence": { "pass": true, "found": "", "required": "$1,000,000" },
    "aggregate": { "pass": true, "found": "", "required": "$2,000,000" },
    "note": ""
  },
  "autoLiability": {
    "pass": true,
    "combinedSingleLimit": { "pass": true, "found": "", "required": "$1,000,000" },
    "hiredAutos": { "pass": true, "found": "" },
    "nonOwnedAutos": { "pass": true, "found": "" },
    "note": ""
  },
  "additionalInsured": { "pass": true, "found": "", "note": "" },
  "lossPayee": { "pass": true, "found": "", "note": "" },
  "coverageDates": { "pass": true, "found": "", "note": "" },
  "policyExpiry": { "pass": true, "date": "", "expired": false },
  "primaryNonContributory": { "pass": true, "found": "", "note": "" },
  "waiverOfSubrogation": { "pass": true, "found": "", "note": "" },
  "umbrella": { "pass": true, "found": "", "note": "" },
  "workersComp": { "pass": true, "found": "", "note": "" },
  "cancellationNotice": { "pass": true, "found": "", "note": "" },
  "contractorCoverage": { "pass": true, "found": "", "note": "" },
  "criticalIssues": [],
  "alertIssues": [],
  "notes": ""
}`

function buildEmailHtml(
  companyName: string,
  jobName: string,
  review: any,
  reviewUrl: string
): string {
  const criticalItems = [
    { label: 'Certificate Holder: SirReel', item: review.certificateHolder },
    { label: 'Named Insured matches company', item: review.insuredName },
    { label: 'General Liability ($1M/$2M)', item: review.generalLiability },
    { label: 'Auto Liability ($1M, Hired & Non-Owned)', item: review.autoLiability },
    { label: 'Additional Insured: SirReel', item: review.additionalInsured },
    { label: 'Loss Payee: SirReel', item: review.lossPayee },
    { label: 'Coverage Dates', item: review.coverageDates },
    { label: 'Policy Not Expired', item: review.policyExpiry },
  ]

  const alertItems = [
    { label: 'Primary & Non-Contributory', item: review.primaryNonContributory },
    { label: 'Waiver of Subrogation', item: review.waiverOfSubrogation },
    { label: 'Umbrella/Excess Liability', item: review.umbrella },
    { label: 'Workers Compensation', item: review.workersComp },
    { label: '30-Day Cancellation Notice', item: review.cancellationNotice },
    { label: 'Independent Contractor Coverage', item: review.contractorCoverage },
  ]

  const statusColor = review.criticalPass ? '#f59e0b' : '#dc2626'
  const statusText = review.criticalPass ? 'ALERT ITEMS NEED REVIEW' : 'CRITICAL ISSUES — ACTION REQUIRED'

  const renderRow = (label: string, item: any, isCritical: boolean) => {
    if (!item) return ''
    const pass = item.pass ?? true
    if (pass) return ''
    const color = isCritical ? '#dc2626' : '#d97706'
    const badge = isCritical ? '🔴 CRITICAL' : '🟡 ALERT'
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">
          <span style="color:${color};font-weight:600;font-size:12px;">${badge}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${item.note || item.found || ''}</td>
      </tr>`
  }

  const issueRows = [
    ...criticalItems.map(i => renderRow(i.label, i.item, true)),
    ...alertItems.map(i => renderRow(i.label, i.item, false)),
  ].filter(Boolean).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    
    <div style="background:#1f3d5c;padding:24px;text-align:center;">
      <div style="color:white;font-size:20px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:13px;margin-top:4px;">COI Review Notification</div>
    </div>

    <div style="background:${statusColor};padding:16px 24px;">
      <div style="color:white;font-weight:bold;font-size:15px;">⚠️ ${statusText}</div>
    </div>

    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Company</td>
          <td style="padding:6px 0;font-weight:600;font-size:13px;">${companyName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;">Job</td>
          <td style="padding:6px 0;font-weight:600;font-size:13px;">${jobName}</td>
        </tr>
      </table>

      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Issues Found:</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Severity</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Item</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Note</th>
          </tr>
        </thead>
        <tbody>
          ${issueRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#6b7280;font-size:13px;">No issues found</td></tr>'}
        </tbody>
      </table>

      <div style="margin-top:24px;text-align:center;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          Review COI in SirReel HQ →
        </a>
      </div>

      ${review.notes ? `<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px;font-size:12px;color:#6b7280;"><strong>AI Notes:</strong> ${review.notes}</div>` : ''}
    </div>

    <div style="padding:16px 24px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335
    </div>
  </div>
</body>
</html>`
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true, agent: true } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const isPdf = file.type === 'application/pdf'
    const mediaType = isPdf ? 'application/pdf' : file.type.includes('png') ? 'image/png' : 'image/jpeg'
    const companyName = request.booking?.company?.name || ''
    const jobName = request.booking?.jobName || ''

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: base64 } }
            : { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: base64 } },
          { type: 'text', text: `${COI_PROMPT}\n\nThe rental agreement company is "${companyName}". Return only JSON.` }
        ] as any
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const review = JSON.parse(text.replace(/```json|```/g, '').trim())

    // Enforce critical/alert logic
    const criticalItems = [
      review.certificateHolder?.pass,
      review.insuredName?.pass,
      review.generalLiability?.pass,
      review.autoLiability?.pass,
      review.additionalInsured?.pass,
      review.lossPayee?.pass,
      review.coverageDates?.pass,
      !review.policyExpiry?.expired,
    ]
    review.criticalPass = criticalItems.every(Boolean)

    const alertItems = [
      review.primaryNonContributory?.pass,
      review.waiverOfSubrogation?.pass,
      review.umbrella?.pass,
      review.workersComp?.pass,
      review.cancellationNotice?.pass,
      review.contractorCoverage?.pass,
    ]
    review.alertPass = alertItems.every(v => v !== false)
    review.overallPass = review.criticalPass && review.alertPass

    // Keep legacy fields for compatibility
    review.hardPass = review.criticalPass
    review.requiresAdminApproval = review.criticalPass && !review.alertPass

    // Save to DB
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS coi_ai_review JSONB`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS coi_review_at TIMESTAMP`)
    } catch {}

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET coi_ai_review=$1::jsonb, coi_review_at=$2, coi_received=$3 WHERE token=$4`,
      JSON.stringify(review), new Date(), review.overallPass, params.token
    )

    if (review.overallPass) {
      await prisma.booking.update({ where: { id: request.bookingId }, data: { coiReceived: true } })
    }

    // Send internal alert email if any issues found
    if (!review.overallPass && process.env.RESEND_API_KEY) {
      const reviewUrl = `https://sirreel-fleet.vercel.app/jobs/${request.bookingId}?tab=paperwork`
      const html = buildEmailHtml(companyName, jobName, review, reviewUrl)
      const subject = review.criticalPass
        ? `🟡 COI Alert — ${companyName} · ${jobName}`
        : `🔴 COI Critical Issues — ${companyName} · ${jobName}`

      await resend.emails.send({
        from: 'SirReel HQ <notifications@sirreel.com>',
        to: ['wes@sirreel.com', 'dani@sirreel.com', 'jose@sirreel.com', 'oliver@sirreel.com'],
        subject,
        html,
      })
    }

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    console.error('[coi-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
