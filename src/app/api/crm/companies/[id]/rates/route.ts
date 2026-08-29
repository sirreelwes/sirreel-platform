import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import { parseMoney } from '@/lib/pricing/resolveRate'

export const dynamic = 'force-dynamic'

/**
 * The client rate card — a company's negotiated per-item prices.
 *
 * GET  → every negotiated rate for this client, each carrying the CURRENT
 *        catalog rate beside it so the UI can show "list $170 → $130" and
 *        flag a deal that has drifted past list after a price rise.
 * POST → upsert one item's rate (unique on companyId+inventoryItemId, so
 *        re-sending an item edits it rather than stacking duplicates).
 *
 * Gate: reading rates needs `seePricing`; SETTING a client's standing
 * price is an ownership decision, so writes are ADMIN only (Wes / Dani).
 * Widening writes to AGENT is a one-line change here if sales should be
 * able to strike deals directly.
 */
async function gate(write: boolean) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, salesOnly: true },
  })
  if (!user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  const perms = getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email })
  if (!perms.seePricing) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  if (write && user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'forbidden', reason: 'Setting a client rate is admin-only.' }, { status: 403 }) }
  }
  return { user }
}

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const g = await gate(false)
  if (g.error) return g.error
  const { id: companyId } = await params

  const rates = await prisma.companyRate.findMany({
    where: { companyId },
    include: {
      inventoryItem: {
        select: { id: true, code: true, description: true, department: true, dailyRate: true, weeklyRate: true, isActive: true },
      },
      createdBy: { select: { name: true } },
    },
    orderBy: [{ inventoryItem: { department: 'asc' } }, { inventoryItem: { code: 'asc' } }],
  })

  return NextResponse.json({
    rates: rates.map((r) => ({
      id: r.id,
      inventoryItemId: r.inventoryItemId,
      code: r.inventoryItem.code,
      name: r.inventoryItem.description || r.inventoryItem.code,
      department: r.inventoryItem.department,
      itemActive: r.inventoryItem.isActive,
      dailyRate: r.dailyRate == null ? null : Number(r.dailyRate),
      weeklyRate: r.weeklyRate == null ? null : Number(r.weeklyRate),
      listDailyRate: Number(r.inventoryItem.dailyRate),
      listWeeklyRate: Number(r.inventoryItem.weeklyRate),
      note: r.note,
      setBy: r.createdBy?.name ?? null,
      updatedAt: r.updatedAt,
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const g = await gate(true)
  if (g.error) return g.error
  const { id: companyId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body.inventoryItemId !== 'string') {
    return NextResponse.json({ error: 'inventoryItemId required' }, { status: 400 })
  }

  const [company, item] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    prisma.inventoryItem.findUnique({
      where: { id: body.inventoryItemId },
      select: { id: true, code: true, description: true, dailyRate: true, weeklyRate: true },
    }),
  ])
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })
  if (!item) return NextResponse.json({ error: 'catalog item not found' }, { status: 404 })

  // An empty box clears that field back to "use the catalog value" — it
  // must NOT land as 0, which would quote the client a free van.
  const daily = body.dailyRate === '' || body.dailyRate == null ? null : parseMoney(body.dailyRate)
  const weekly = body.weeklyRate === '' || body.weeklyRate == null ? null : parseMoney(body.weeklyRate)
  if ((body.dailyRate != null && body.dailyRate !== '' && daily === null) ||
      (body.weeklyRate != null && body.weeklyRate !== '' && weekly === null)) {
    return NextResponse.json({ error: 'invalid rate' }, { status: 400 })
  }
  if (daily != null && daily.lessThanOrEqualTo(0)) {
    return NextResponse.json({ error: 'invalid rate', reason: 'A negotiated daily rate must be more than $0. Leave it blank to use the catalog rate.' }, { status: 400 })
  }
  if (weekly != null && weekly.lessThanOrEqualTo(0)) {
    return NextResponse.json({ error: 'invalid rate', reason: 'A negotiated weekly rate must be more than $0. Leave it blank to use the catalog rate.' }, { status: 400 })
  }
  if (daily == null && weekly == null) {
    return NextResponse.json({ error: 'invalid rate', reason: 'Set a daily or a weekly rate — a row with neither is not a deal.' }, { status: 400 })
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  const before = await prisma.companyRate.findUnique({
    where: { companyId_inventoryItemId: { companyId, inventoryItemId: item.id } },
    select: { id: true, dailyRate: true, weeklyRate: true, note: true },
  })

  const saved = await prisma.companyRate.upsert({
    where: { companyId_inventoryItemId: { companyId, inventoryItemId: item.id } },
    create: { companyId, inventoryItemId: item.id, dailyRate: daily, weeklyRate: weekly, note, createdById: g.user!.id },
    update: { dailyRate: daily, weeklyRate: weekly, note },
  })

  // Money columns get an audit row — same reasoning as the line-item
  // rate-override log: "who cut this client's price, from what, when".
  await prisma.auditLog.create({
    data: {
      userId: g.user!.id,
      action: before ? 'company.rate.update' : 'company.rate.set',
      entityType: 'CompanyRate',
      entityId: saved.id,
      oldValues: before
        ? { dailyRate: before.dailyRate?.toFixed(2) ?? null, weeklyRate: before.weeklyRate?.toFixed(2) ?? null, note: before.note }
        : { listDailyRate: item.dailyRate.toFixed(2), listWeeklyRate: item.weeklyRate.toFixed(2) },
      newValues: {
        companyId,
        companyName: company.name,
        item: item.description || item.code,
        dailyRate: daily?.toFixed(2) ?? null,
        weeklyRate: weekly?.toFixed(2) ?? null,
        note,
      },
    },
  })

  return NextResponse.json({ ok: true, id: saved.id })
}
