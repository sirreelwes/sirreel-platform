/**
 * Working one report on the board: change its status, write what was done,
 * or send it back through triage.
 *
 * ADMIN and MANAGER only — the board is where the fixing gets decided.
 * Reporters see their own rows read-only on HQ Help.
 */
import { NextRequest, NextResponse } from 'next/server'
import { BugSeverity, BugStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'
import { triageBugReport, type OpenIssue } from '@/lib/bugs/triage'
import { notifyBugEscalation } from '@/lib/bugs/notifyEscalation'
import { resolveBugContext, describeResolved } from '@/lib/bugs/resolveContext'
import { OPEN_STATUSES } from '@/lib/bugs/vocab'

export const dynamic = 'force-dynamic'

const CLOSED: BugStatus[] = ['FIXED', 'WONT_FIX', 'DUPLICATE', 'ANSWERED']

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const json = await req.json().catch(() => ({}))
  const existing = await prisma.bugReport.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // ADMIN/MANAGER only. Nothing on this route ever asks the reporter for
  // more — Wes 2026-09-19: questions back tax the one behaviour worth
  // encouraging, so the agent resolves context itself (resolveContext.ts).
  const isBoardUser = user.role === 'ADMIN' || user.role === 'MANAGER'
  if (!isBoardUser) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Re-triage: the agent reads it again, with whatever is on the board now.
  // Used when a report was mis-sorted, or when the first pass failed.
  if (json.retriage === true) {
    const openIssues: OpenIssue[] = await prisma.bugReport.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        duplicateOfId: null,
        triagedAt: { not: null },
        id: { not: existing.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, title: true, area: true, kind: true, severity: true },
    })
    const entities = await resolveBugContext((existing.context as never) ?? null)
    const { verdict, error } = await triageBugReport({
      body: existing.body,
      reporterName: existing.reportedByName,
      reporterRole: existing.reportedByRole,
      pagePath: existing.pagePath,
      openIssues,
      context: (existing.context as never) ?? null,
      resolved: describeResolved(entities),
    })
    if (!verdict) {
      await prisma.bugReport.update({ where: { id: existing.id }, data: { triageError: error } })
      return NextResponse.json({ error: error ?? 'triage failed' }, { status: 502 })
    }
    const updated = await prisma.bugReport.update({
      where: { id: existing.id },
      data: {
        title: verdict.title,
        area: verdict.area,
        severity: verdict.severity,
        kind: verdict.kind,
        routing: verdict.routing,
        reasoning: verdict.reasoning,
        response: verdict.response,
        suspects: verdict.suspects,
        duplicateOfId: verdict.duplicateOf,
        triagedAt: new Date(),
        triageModel: verdict.model,
        triageError: null,
        missingContext: verdict.missingContext,
        // A re-triage never reopens something a person has already closed —
        // their call outranks the model's.
        status: CLOSED.includes(existing.status)
          ? existing.status
          : verdict.duplicateOf
            ? 'DUPLICATE'
            : verdict.routing === 'ANSWERED'
              ? 'ANSWERED'
              : 'OPEN',
      },
    })
    if (updated.routing === 'ESCALATED' && !updated.escalatedAt) {
      const sent = await notifyBugEscalation(updated)
      if (sent.sent) await prisma.bugReport.update({ where: { id: updated.id }, data: { escalatedAt: new Date() } })
    }
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'bug_report.retriage', entityType: 'bug_report', entityId: updated.id, newValues: { severity: updated.severity, kind: updated.kind, routing: updated.routing } },
    })
    return NextResponse.json({ ok: true, report: updated })
  }

  const data: Record<string, unknown> = {}

  const STATUSES = Object.values(BugStatus) as string[]
  if (typeof json.status === 'string' && STATUSES.includes(json.status)) {
    const status = json.status as BugStatus
    data.status = status
    const closing = CLOSED.includes(status)
    data.resolvedAt = closing ? new Date() : null
    data.resolvedByEmail = closing ? user.email : null
  }
  if (typeof json.resolutionNote === 'string') {
    data.resolutionNote = json.resolutionNote.trim().slice(0, 2000) || null
  }
  // Hand-overriding the agent's read. The agent is often right and
  // occasionally confidently wrong; the person doing the work gets the
  // final say, and the audit row keeps both stories.
  const SEVERITIES = Object.values(BugSeverity) as string[]
  if (typeof json.severity === 'string' && SEVERITIES.includes(json.severity)) {
    data.severity = json.severity
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to change' }, { status: 400 })
  }

  const updated = await prisma.bugReport.update({ where: { id: params.id }, data })
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'bug_report.update',
      entityType: 'bug_report',
      entityId: updated.id,
      oldValues: { status: existing.status, severity: existing.severity },
      newValues: { status: updated.status, severity: updated.severity, resolutionNote: updated.resolutionNote },
    },
  })
  return NextResponse.json({ ok: true, report: updated })
}
