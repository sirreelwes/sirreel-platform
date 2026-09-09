/**
 * Two jobs that may be one production (EVENT).
 *
 * The nightly Planyo importer flags this itself — CREATED_NEW_SIBLING when
 * it builds a job beside a plausible existing one, ATTACHED_AMBIGUOUS when
 * it attaches on a soft anchor — and until 2026-09-09 the flag went only to
 * a 6 AM Slack alert. It fired for SR-JOB-0328 "WS-RK" the morning it was
 * created and nobody saw it: Jose kept adding to the Planyo twin while the
 * client's paperwork, COI and contacts sat on Darsh's SR-JOB-0315 "WS".
 *
 * Deliberately UNSCOPED (like inquiryUntouched): the person who can tell
 * two shoots apart is whoever knows the client, not whoever the importer
 * happened to name as agent — imports default the agent, so scoping to the
 * owner would hide the item from everyone who could resolve it.
 *
 * Medium, not high. A twin splits the work but nothing is on fire: no
 * truck is blocked and no money is wrong. It earns attention this week,
 * not this hour.
 *
 * Self-clearing: listDuplicateJobSignals re-checks live state, so merging
 * (which archives the loser) retires the item with no cleanup step. The
 * side-row dismissal is for the OTHER answer — genuinely different shows
 * for the same client, which is the common case (six of the first seven).
 */

import type { UserRole } from '@prisma/client'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'
import { describeDuplicateSignal, listDuplicateJobSignals } from '@/lib/jobs/duplicateSignal'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

export const possibleDuplicateJobProvider: ActionItemProvider = {
  id: 'possible-duplicate-job',
  kind: 'EVENT',
  async fetch(): Promise<ActionItem[]> {
    const signals = await listDuplicateJobSignals()

    return signals.map((s) => {
      const subject = [s.job.companyName, s.job.name].filter(Boolean).join(' · ') || s.job.jobCode
      const verb = s.mode === 'created_sibling' ? 'Possible duplicate job' : 'Confirm this booking’s job'
      return {
        id: `possible-duplicate-job:${s.eventId}`,
        type: 'possible_duplicate_job',
        title: `${verb} — ${subject}`,
        subtitle: describeDuplicateSignal(s),
        ownerRole: OWNER,
        priority: 'medium' as const,
        href: `/jobs/${s.job.jobId}`,
        occurredAt: s.detectedAt,
        source: 'possible-duplicate-job',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
