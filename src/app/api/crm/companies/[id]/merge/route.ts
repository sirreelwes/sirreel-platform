/**
 * Merge another Company into this one — the endpoint behind the
 * "Merge duplicate…" button on the CRM company page.
 *
 *   GET  ?q=…   candidate picker: near-duplicate suggestions first,
 *               then name/email search. Read-only.
 *   POST        { duplicateId, apply }. With apply !== true this is a
 *               DRY RUN — the same plan the CLI prints, nothing written.
 *               With apply: true it commits in one transaction.
 *
 * The keeper is always the company in the URL, so the caller cannot
 * accidentally invert a merge by posting the wrong pair: the UI asks
 * which side survives and posts to THAT company's route.
 *
 * Gated by the dedup allowlist (Wes + Dani), not the ADMIN role — same
 * ceiling as the people dedup queue, for the same reason: the merge is
 * audited-reversible but easy to fire and tedious to un-fire.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import {
  planCompanyMerge,
  applyCompanyMerge,
  isNearDuplicateName,
} from '@/lib/companies/mergeCompanies'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  const keeper = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!keeper) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim()

  // Suggestions run over the whole table. companyNameKey's own comment
  // makes the call: hundreds of companies, an in-memory pass is fine.
  const all = await prisma.company.findMany({
    where: { id: { not: id } },
    select: { id: true, name: true, tier: true, billingEmail: true, createdAt: true, rentalworksCustomerId: true },
    orderBy: { name: 'asc' },
  })

  const suggested = all.filter((c) => isNearDuplicateName(c.name, keeper.name))
  const suggestedIds = new Set(suggested.map((c) => c.id))
  const needle = q.toLowerCase()
  const matches = q
    ? all.filter((c) => !suggestedIds.has(c.id) && (
      c.name.toLowerCase().includes(needle) ||
      (c.billingEmail ?? '').toLowerCase().includes(needle)
    )).slice(0, 20)
    : []

  return NextResponse.json({ keeper, suggested, matches })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate
  const { id: keeperId } = await params

  const body = (await req.json().catch(() => ({}))) as {
    duplicateId?: unknown
    duplicateIds?: unknown
    apply?: unknown
  }
  const duplicateIds = Array.isArray(body.duplicateIds)
    ? body.duplicateIds.filter((x): x is string => typeof x === 'string')
    : typeof body.duplicateId === 'string'
      ? [body.duplicateId]
      : []
  if (!duplicateIds.length) {
    return NextResponse.json({ error: 'duplicateId required' }, { status: 400 })
  }
  if (duplicateIds.includes(keeperId)) {
    return NextResponse.json({ error: 'a company cannot be merged into itself' }, { status: 400 })
  }

  try {
    // Always re-planned server-side. The client's preview is a picture,
    // never an instruction — rows can move between preview and apply.
    const plan = await planCompanyMerge({ keeperId, duplicateIds })

    const preview = {
      keeper: { id: plan.keeper.id, name: plan.keeper.name },
      duplicates: plan.duplicates.map((d) => ({ id: d.id, name: d.name })),
      counts: plan.counts,
      totalRows: plan.totalRows,
      affiliationsDeleted: plan.affiliationsDeleted.length,
      backfillFields: Object.keys(plan.backfill).filter((k) => k !== 'notes'),
    }

    if (body.apply !== true) {
      return NextResponse.json({ ok: true, applied: false, ...preview })
    }

    const result = await applyCompanyMerge({ plan, mergedById: gate.id, via: 'crm-ui' })
    return NextResponse.json({ ok: true, applied: true, ...preview, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 404-shaped: a stale id list (the other tab already merged it).
    const stale = /not found/i.test(message)
    return NextResponse.json({ error: message }, { status: stale ? 409 : 500 })
  }
}
