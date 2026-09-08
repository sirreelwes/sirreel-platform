/**
 * /api/admin/notification-channels — who receives each class of internal
 * HQ notification email (requireAdmin on every method).
 *
 *   GET → { channels: [{ key, label, description, tier, tierReason,
 *           defaults, effective, overridden, updatedAt, updatedByEmail }],
 *           overriddenCount }
 *   PUT → { key, emails: string[] } sets the channel's whole audience
 *         (empty array = deliberately nobody — silences CC-type
 *         channels); { key, reset: true } deletes the override so the
 *         built-in default applies again. Audit-logged either way.
 *   DELETE → drops EVERY override at once, so all channels fall back to
 *         the built-in defaults. Added 2026-09-08 with Wes's quiet-down
 *         pass: that pass changed the defaults, and a channel someone had
 *         customised earlier would have kept its old, wider audience
 *         while looking dialled-back from the code. One audit row per
 *         override cleared, same action as a single reset.
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
        tier: def.tier,
        tierReason: def.tierReason,
        defaults,
        effective: row ? row.emails : defaults,
        overridden: !!row,
        updatedAt: row?.updatedAt ?? null,
        updatedByEmail: row?.updatedByEmail ?? null,
      }
    }),
    overriddenCount: rows.filter((r) => NOTIFICATION_CHANNELS.some((c) => c.key === r.key)).length,
  })
}

/** Drop every override — all channels back to their built-in defaults. */
export async function DELETE() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const rows = await prisma.notificationChannel.findMany()
  if (rows.length === 0) return NextResponse.json({ ok: true, cleared: 0 })

  await prisma.notificationChannel.deleteMany({
    where: { key: { in: rows.map((r) => r.key) } },
  })
  // One row per channel, carrying the audience we just removed — this is
  // the only record of what the override WAS, so it has to be per-channel
  // rather than one summary row. Deletes are by the keys read above.
  await prisma.auditLog.createMany({
    data: rows.map((row) => {
      const def = NOTIFICATION_CHANNELS.find((c) => c.key === row.key)
      return {
        action: 'notification_channel.update',
        entityType: 'NotificationChannel',
        entityId: row.key,
        userId: user.id,
        oldValues: { emails: row.emails, overridden: true },
        newValues: {
          emails: def ? def.defaults() : [],
          overridden: false,
          reset: true,
          resetAll: true,
        },
      }
    }),
  })

  return NextResponse.json({ ok: true, cleared: rows.length })
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
