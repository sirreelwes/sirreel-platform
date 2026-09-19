/**
 * Someone hit it again. That reopens it.
 *
 * Wes 2026-09-19: "I'd rather have reports come through than not, cause if
 * they are typing it usually it's because it was high friction, so I don't
 * want AI just to shut down for no reason."
 *
 * The quietest way for this system to fail is for a report to be folded
 * into something already marked FIXED and never seen again. That is not a
 * duplicate — it is evidence the fix did not take, or the answer did not
 * land, and it is the most valuable single signal the box can produce.
 * Same for a WONT_FIX or an ANSWERED that keeps getting reported: the
 * second person to hit it is not repeating the first, they are disagreeing
 * with the decision.
 *
 * So joining a CLOSED parent reopens the parent and says why. Joining an
 * open one just makes it heavier, which it already did.
 */

import { prisma } from '@/lib/prisma'
import type { BugStatus } from '@prisma/client'

const CLOSED: BugStatus[] = ['FIXED', 'WONT_FIX', 'ANSWERED', 'DUPLICATE']

export async function reopenIfClosed(parentId: string, reporterName: string): Promise<boolean> {
  try {
    const parent = await prisma.bugReport.findUnique({
      where: { id: parentId },
      select: { id: true, status: true, resolutionNote: true },
    })
    if (!parent || !CLOSED.includes(parent.status)) return false

    const was = parent.status
    const stamp = new Date().toISOString().slice(0, 10)
    const note =
      was === 'FIXED'
        ? `Reopened ${stamp}: ${reporterName} hit this again after it was marked fixed.`
        : was === 'ANSWERED'
          ? `Reopened ${stamp}: ${reporterName} reported this again after it was answered — the answer did not land.`
          : `Reopened ${stamp}: ${reporterName} reported this again after it was closed as ${was}.`

    await prisma.bugReport.update({
      where: { id: parentId },
      data: {
        status: 'OPEN',
        resolvedAt: null,
        // The human review is void too — the decision it agreed with has
        // just been contradicted by somebody hitting the thing again.
        reviewedAt: null,
        reviewedByEmail: null,
        resolutionNote: parent.resolutionNote ? `${parent.resolutionNote}\n${note}` : note,
      },
    })
    return true
  } catch {
    // Never block a report over this.
    return false
  }
}
