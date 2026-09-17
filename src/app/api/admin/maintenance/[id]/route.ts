/**
 * POST /api/admin/maintenance/[id] — run one registered maintenance task.
 *
 * Wes 2026-09-16, needing to seed a roster from an iPad. The shape of this
 * endpoint is the whole safety story, so it is worth reading once:
 *
 *   · ADMIN ONLY. requireAdmin on every call, dry run included — a dry run
 *     still reads production.
 *   · ALLOWLIST. `[id]` is looked up in the registry and resolved to a named
 *     function. It is never a path, a command or a script name. An unknown
 *     id is a 404 before anything else happens.
 *   · DRY RUN IS THE DEFAULT. A write needs `dryRun: false` AND
 *     `confirm: <the task id>` in the body. Fat-fingering a button on a
 *     phone should not write to the live database, and an omitted field
 *     should fail CLOSED.
 *   · AUDITED. Every real run writes an AuditLog row carrying the ids it
 *     created — which is what makes the "cleanup by captured id only" rule
 *     workable when the run happened on a phone with no journal file.
 *   · NO SCHEMA CHANGES, bar one class: a `schema` task runs only the
 *     CREATE … IF NOT EXISTS statements it carries in the registry, gated
 *     by `isAdditiveStatement` at run time. See maintenanceTasks.ts for why
 *     ALTERs and column adds stay on a laptop.
 *
 * A refusal the operator can act on (`SeedRefused`) comes back as a 409 with
 * a `fix` line, not a stack trace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { maintenanceTask, MAINTENANCE_RUN_ACTION } from '@/lib/admin/maintenanceTasks'
import { maintenanceRunner, SeedRefused } from '@/lib/admin/maintenanceRunners'

export const dynamic = 'force-dynamic'
// These write in a loop over a roster; the default 10s is not enough headroom.
export const maxDuration = 60

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const task = maintenanceTask(params.id)
  const runner = maintenanceRunner(params.id)
  if (!task || !runner) {
    return NextResponse.json({ error: 'No such maintenance task.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  // Fails CLOSED: anything other than an explicit `false` is a dry run.
  const dryRun = body.dryRun !== false
  if (!dryRun && body.confirm !== task.id) {
    return NextResponse.json(
      { error: 'A real run has to be confirmed.', fix: `Send confirm: "${task.id}" alongside dryRun: false.` },
      { status: 400 },
    )
  }

  // Only the params the task declared, only as strings.
  const declared = new Set((task.params ?? []).map((p) => p.key))
  const raw = (body.params ?? {}) as Record<string, unknown>
  const safeParams: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (declared.has(k) && typeof v === 'string') safeParams[k] = v
  }

  try {
    const result = await runner({ dryRun, params: safeParams, actorUserId: user.id })

    if (!dryRun) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: MAINTENANCE_RUN_ACTION,
          entityType: 'MaintenanceTask',
          entityId: task.id,
          newValues: {
            by: user.email,
            task: task.id,
            headline: result.headline,
            // The captured ids. Without the journal file a phone run would
            // otherwise leave no record of what it made.
            createdIds: result.createdIds,
            touchedIds: result.touchedIds ?? [],
            params: Object.keys(safeParams),
            ranFrom: 'hq-web',
          },
        },
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true, dryRun, task: task.id, ...result })
  } catch (e) {
    if (e instanceof SeedRefused) {
      return NextResponse.json({ error: e.message, fix: e.fix }, { status: 409 })
    }
    console.error(`[maintenance:${task.id}]`, e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The task failed.', fix: 'Nothing further was written. Check the server logs.' },
      { status: 500 },
    )
  }
}
