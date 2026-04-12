import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const BASE_URL = process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const jobs = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM paperwork_requests WHERE LOWER(sent_to) = LOWER(${email})
    `
    if (Number(jobs[0]?.count) === 0) {
      return NextResponse.json({ error: 'No jobs found for this email address' }, { status: 404 })
    }

    const result = await prisma.$queryRaw<any[]>`
      INSERT INTO client_sessions (email) VALUES (${email.toLowerCase()}) RETURNING token
    `
    const token = result[0]?.token
    const loginUrl = BASE_URL + '/client/dashboard?token=' + token

    await resend.emails.send({
      from: 'SirReel HQ <notifications@sirreel.com>',
      to: email,
      subject: 'Your SirReel job history link',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <div style="background:#1f3d5c;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
            <div style="color:white;font-size:18px;font-weight:bold;">SirReel Studio Services</div>
          </div>
          <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <h2 style="margin:0 0 8px;font-size:18px;">View your job history</h2>
            <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Click the button below to access your SirReel job history. This link expires in 24 hours.</p>
            <a href="${loginUrl}" style="display:block;background:#1f3d5c;color:white;padding:14px;border-radius:8px;text-decoration:none;text-align:center;font-weight:bold;font-size:15px;">
              View My Jobs &rarr;
            </a>
            <p style="color:#9ca3af;font-size:11px;margin:16px 0 0;text-align:center;">If you did not request this, you can ignore this email.</p>
          </div>
        </div>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
