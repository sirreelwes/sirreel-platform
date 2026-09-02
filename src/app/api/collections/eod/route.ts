import { NextRequest, NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { computeEodFigures, pacificToday } from '@/lib/collections/eodReport'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/collections/eod — the figures for tonight's report, plus who it
 * will go to and whether it has already been sent today.
 *
 * Read-only. Everything it returns is editable in the panel before sending;
 * see the reasoning in src/lib/collections/eodReport.ts.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('date')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q ?? '') ? (q as string) : pacificToday()

  const [figures, recipients, existing] = await Promise.all([
    computeEodFigures(date),
    channelRecipients('eod-collections'),
    prisma.dailyCollections.findUnique({
      where: { date: new Date(`${date}T00:00:00.000Z`) },
      select: { sentAt: true, sentBy: true },
    }),
  ])

  return NextResponse.json({
    ok: true,
    figures,
    recipients,
    alreadySentAt: existing?.sentAt ?? null,
    alreadySentBy: existing?.sentBy ?? null,
  })
}
