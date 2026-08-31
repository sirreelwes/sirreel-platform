/**
 * /api/admin/notification-channels — who receives each class of internal
 * HQ notification email (requireAdmin on every method).
 *
 *   GET → { channels: [{ key, label, description, defaults, effective,
 *           overridden, updatedAt, updatedByEmail }] }
 *   PUT → { key, emails: string[] } sets the channel's whole audience
 *         (empty array = deliberately nobody — silences CC-type
 *         channels); { key, reset: true } deletes the override so the
 *         built-in default applies again. Audit-logged either way.
 *
 * The channel registry (labels, defaults, which sends read which key)
 * lives in src/lib/email/notificationChannels.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import {
  NOTIFICATION_CHANNELS,
  isNotificationChannelKey,
} from '@/lib/email/notificationChannels'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RECIPIENTS = 20

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const rows = await prisma.notificationChannel.findMany()
  const byKey = new Map(rows.map((r) => [r.key, r]))

  return NextResponse.json({
    channels: NOTIFICATION_CHANNELS.map((def) => {
      const row = byKey.get(def.key)
      const defaults = def.defaults()
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        defaults,
        effective: row ? row.emails : defaults,
        overridden: !!row,
        updatedAt: row?.updatedAt ?? null,
        updatedByEmail: row?.updatedByEmail ?? null,
      }
    }),
  })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = await req.json().catch(() => null)
  const key = typeof body?.key === 'string' ? body.key : null
  if (!key || !isNotificationChannelKey(key)) {
    return NextResponse.json({ error: 'Unknown channel key' }, { status: 400 })
  }
  const def = NOTIFICATION_CHANNELS.find((c) => c.key === key)!

  const existing = await prisma.notificationChannel.findUnique({ where: { key } })
  const oldEffective = existing ? existing.emails : def.defaults()

  // Reset: drop the override, the built-in default applies again.
  if (body?.reset === true) {
    if (existing) {
      await prisma.notificationChannel.delete({ where: { key } })
      await prisma.auditLog.create({
        data: {
          action: 'notification_channel.update',
          entityType: 'NotificationChannel',
          entityId: key,
          userId: user.id,
          oldValues: { emails: oldEffective, overridden: !!existing },
          newValues: { emails: def.defaults(), overridden: false, reset: true },
        },
      })
    }
    return NextResponse.json({ ok: true, effective: def.defaults(), overridden: false })
  }

  if (!Array.isArray(body?.emails)) {
    return NextResponse.json({ error: 'emails must be an array' }, { status: 400 })
  }
  const emails: string[] = []
  const seen = new Set<string>()
  for (const raw of body.emails) {
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: 'emails must be strings' }, { status: 400 })
    }
    const e = raw.trim()
    if (!e) continue
    if (!EMAIL_RE.test(e)) {
      return NextResponse.json({ error: `Not a valid address: ${e}` }, { status: 400 })
    }
    const norm = e.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    emails.push(e)
  }
  if (emails.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `${emails.length} addresses — ${MAX_RECIPIENTS} is the limit.` },
      { status: 400 }
    )
  }

  await prisma.notificationChannel.upsert({
    where: { key },
    create: { key, emails, updatedByEmail: user.email },
    update: { emails, updatedByEmail: user.email },
  })
  await prisma.auditLog.create({
    data: {
      action: 'notification_channel.update',
      entityType: 'NotificationChannel',
      entityId: key,
      userId: user.id,
      oldValues: { emails: oldEffective, overridden: !!existing },
      newValues: { emails, overridden: true },
    },
  })

  return NextResponse.json({ ok: true, effective: emails, overridden: true })
}
