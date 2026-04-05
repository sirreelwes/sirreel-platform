import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const userEmail = new URL(req.url).searchParams.get('user') || ''

  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, type, title, body, severity, link, expires_at, dismissed_by, created_at
    FROM alerts
    WHERE (expires_at IS NULL OR expires_at > now())
      AND NOT (dismissed_by @> ARRAY[${userEmail}]::text[])
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 50
  `

  return NextResponse.json({ ok: true, alerts: rows })
}

export async function POST(req: NextRequest) {
  const { type, title, body, severity, link, expiresAt } = await req.json()
  if (!type || !title) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  await prisma.$executeRaw`
    INSERT INTO alerts (type, title, body, severity, link, expires_at)
    VALUES (${type}, ${title}, ${body || ''}, ${severity || 'medium'}, ${link || null}, ${expiresAt ? new Date(expiresAt) : null})
  `
  return NextResponse.json({ ok: true })
}
