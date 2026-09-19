/**
 * How a triaged bug report is WORDED and COLOURED, in one place.
 *
 * Both surfaces read this: the acknowledgement the reporter sees the
 * instant they hit send (src/components/guides/BugReportBox.tsx) and the
 * to-do board (/admin/bugs). They must agree — the whole promise of the
 * box is "we read it and here is what we think", and a person who is told
 * "we're on it, this is blocking" and then finds their report sitting
 * under a grey "Low" chip stops reporting.
 *
 * Chips use the chip-* token pairs per CLAUDE.md, never raw zinc.
 */

import type { BugKind, BugRouting, BugSeverity, BugStatus } from '@prisma/client'

export const SEVERITY_LABEL: Record<BugSeverity, string> = {
  UNTRIAGED: 'Not sorted yet',
  BLOCKER: 'Blocking',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

/** Sort weight for the board — blockers first, unsorted above the noise. */
export const SEVERITY_RANK: Record<BugSeverity, number> = {
  BLOCKER: 0,
  UNTRIAGED: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
}

export const SEVERITY_CHIP: Record<BugSeverity, string> = {
  UNTRIAGED: 'bg-chip-neutral-bg text-chip-neutral-fg',
  BLOCKER: 'bg-chip-bad-bg text-chip-bad-fg',
  HIGH: 'bg-chip-warn-bg text-chip-warn-fg',
  MEDIUM: 'bg-chip-neutral-bg text-chip-neutral-fg',
  LOW: 'bg-chip-neutral-bg text-chip-neutral-fg',
}

export const KIND_LABEL: Record<BugKind, string> = {
  UNTRIAGED: 'Unsorted',
  MECHANICAL: 'Broken mechanics',
  DESIGN: 'Design / UX',
  HOW_TO: 'Works as built',
  FEATURE_REQUEST: 'Feature request',
  OTHER: 'Other',
}

/** The distinction Wes asked the agent to draw, spelled out for the board. */
export const KIND_BLURB: Record<BugKind, string> = {
  UNTRIAGED: 'Nobody has sorted this one yet.',
  MECHANICAL: 'The system genuinely did the wrong thing — it saved nothing, sent nothing, or got the number wrong.',
  DESIGN: 'The mechanics worked. The screen did not say so, or made it look like they had not.',
  HOW_TO: 'Working as built — the person expected something different.',
  FEATURE_REQUEST: 'We do not do this yet.',
  OTHER: 'Not about the software.',
}

export const ROUTING_LABEL: Record<BugRouting, string> = {
  PENDING: 'Reading it',
  ANSWERED: 'Answered on the spot',
  QUEUED: 'On the fix list',
  ESCALATED: 'Sent to Wes',
}

export const ROUTING_CHIP: Record<BugRouting, string> = {
  PENDING: 'bg-chip-neutral-bg text-chip-neutral-fg',
  ANSWERED: 'bg-chip-good-bg text-chip-good-fg',
  QUEUED: 'bg-chip-warn-bg text-chip-warn-fg',
  ESCALATED: 'bg-chip-bad-bg text-chip-bad-fg',
}

export const STATUS_LABEL: Record<BugStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'Being fixed',
  FIXED: 'Fixed',
  WONT_FIX: "Won't fix",
  DUPLICATE: 'Same as another',
  ANSWERED: 'Answered',
}

export const STATUS_CHIP: Record<BugStatus, string> = {
  OPEN: 'bg-chip-warn-bg text-chip-warn-fg',
  IN_PROGRESS: 'bg-chip-neutral-bg text-chip-neutral-fg',
  FIXED: 'bg-chip-good-bg text-chip-good-fg',
  WONT_FIX: 'bg-chip-neutral-bg text-chip-neutral-fg',
  DUPLICATE: 'bg-chip-neutral-bg text-chip-neutral-fg',
  ANSWERED: 'bg-chip-good-bg text-chip-good-fg',
}

/** Statuses that still want someone to do something. */
export const OPEN_STATUSES: BugStatus[] = ['OPEN', 'IN_PROGRESS']

/**
 * The friendly one-liner the reporter gets back, keyed on where the agent
 * sent it. Deliberately says what happens NEXT, not what category it fell
 * into — the category is the agent's business, the next step is theirs.
 */
export function acknowledgement(routing: BugRouting, severity: BugSeverity): string {
  switch (routing) {
    case 'ANSWERED':
      return 'Good news — nothing is broken here. Here is what is going on:'
    case 'ESCALATED':
      return severity === 'BLOCKER'
        ? 'This one is blocking real work, so Wes has it now — not the back of a queue.'
        : 'This needs a decision from Wes, so it went straight to him.'
    case 'QUEUED':
      return 'Thanks — that is a real one. It is on the fix list.'
    default:
      return 'Got it. Someone will read this shortly.'
  }
}
