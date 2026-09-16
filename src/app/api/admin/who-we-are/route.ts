/**
 * /api/admin/who-we-are — team roster for the public "Who we are" section.
 * requireAdmin on every method.
 *
 *  GET  → { enabled, members[], users[] }
 *
 * `users` is the HQ-login picker behind each roster row. Linking the two
 * (TeamMember.userId) is what lets CLIENT EMAIL show the same photo and
 * title the public site shows — see src/lib/email/repCard.ts.
 *  POST → { action: 'create', name, title }
 *         { action: 'set-enabled', enabled }      — public Who-we-are section
 *         { action: 'set-rep-card', enabled }     — the rep card on client
 *           EMAIL. Off until Wes has sent himself one and read it in a real
 *           inbox; while off only a tester's own jobs carry it. See
 *           src/lib/email/repCardRollout.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'
const SINGLETON = 'singleton'

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const [members, settings, users] = await Promise.all([
    // userId is a newer column (scripts/add-team-member-user-column.ts).
    // Until it exists the roster still loads, just without the link.
    prisma.teamMember
      .findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          title: true,
          published: true,
          sortOrder: true,
          photoUrl: true,
          userId: true,
        },
      })
      .catch(() =>
        prisma.teamMember.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, title: true, published: true, sortOrder: true, photoUrl: true },
        }),
      ),
    prisma.siteSetting
      .findFirst({ select: { whoWeAreEnabled: true, repCardEnabled: true } })
      // rep_card_enabled is a newer column — until the additive SQL has run
      // the page still loads and the rep card simply reads as off.
      .catch(() => prisma.siteSetting.findFirst({ select: { whoWeAreEnabled: true } })),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    }),
  ])

  return NextResponse.json({
    enabled: settings?.whoWeAreEnabled ?? false,
    repCardEnabled:
      settings && 'repCardEnabled' in settings ? (settings.repCardEnabled ?? false) : false,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      title: m.title,
      published: m.published,
      sortOrder: m.sortOrder,
      hasPhoto: Boolean(m.photoUrl),
      userId: 'userId' in m ? (m.userId ?? null) : null,
    })),
    users,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as
    | { action?: string; name?: string; title?: string; enabled?: boolean }
    | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  if (body.action === 'create') {
    const name = (body.name || '').trim().slice(0, 120)
    const title = (body.title || '').trim().slice(0, 120)
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    const max = await prisma.teamMember.aggregate({ _max: { sortOrder: true } })
    const m = await prisma.teamMember.create({
      data: { name, title, sortOrder: (max._max.sortOrder ?? 0) + 1 },
      select: { id: true },
    })
    return NextResponse.json({ ok: true, id: m.id })
  }

  if (body.action === 'set-rep-card') {
    const enabled = Boolean(body.enabled)
    try {
      await prisma.siteSetting.upsert({
        where: { id: SINGLETON },
        create: { id: SINGLETON, repCardEnabled: enabled },
        update: { repCardEnabled: enabled },
      })
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2022') {
        return NextResponse.json(
          { error: 'Run scripts/add-rep-card-rollout-column.ts first.' },
          { status: 409 },
        )
      }
      throw err
    }
    return NextResponse.json({ ok: true, repCardEnabled: enabled })
  }

  if (body.action === 'set-enabled') {
    const enabled = Boolean(body.enabled)
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, whoWeAreEnabled: enabled },
      update: { whoWeAreEnabled: enabled },
    })
    return NextResponse.json({ ok: true, enabled })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
