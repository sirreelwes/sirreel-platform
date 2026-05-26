/**
 * Canonical mapping of `AgreementStatus` → display + behavior.
 *
 * Every surface that renders an agreement state imports from here.
 * Inline ternary chains in `/portal/job/[slug]/page.tsx` and
 * `/orders/[id]/page.tsx` previously drifted apart — same enum value
 * showed different copy on the two pages. One mapping closes that.
 *
 * Properties carried per state (not all consumed by every surface,
 * but documented in one place so future readers know the dimensions):
 *
 *   label         — short, client-safe display label
 *   kind          — semantic bucket the portal page uses for badge tone
 *   adminBadge    — Tailwind classes for the admin order-detail badge
 *   isReleased    — true once the agreement is visible to the client
 *                   for signing (PORTAL_RELEASED, NEGOTIATED_READY, or
 *                   a SIGNED_* terminal — anything past the agent's
 *                   release-gate)
 *   isSigned      — true on SIGNED_BASELINE / SIGNED_NEGOTIATED
 *   isPrepared    — true on PORTAL_GENERATED (rendered but not yet
 *                   released)
 *   agentVerb     — the action label an agent would see on the order
 *                   detail page to advance from this state (null on
 *                   terminal states)
 */

import type { AgreementStatus } from '@prisma/client'

export type AgreementStatusKind = 'pending' | 'warning' | 'success' | 'failed'

export interface AgreementStatusDescription {
  status: AgreementStatus
  label: string
  kind: AgreementStatusKind
  adminBadge: string
  isReleased: boolean
  isSigned: boolean
  isPrepared: boolean
  agentVerb: string | null
}

const TABLE: Record<AgreementStatus, AgreementStatusDescription> = {
  PORTAL_GENERATED: {
    status: 'PORTAL_GENERATED',
    // Prepared, not delivered. The badge MUST NOT read "Sent" here —
    // that was the long-standing lie this mapping corrects.
    label: 'Preparing',
    kind: 'pending',
    adminBadge: 'bg-zinc-700 text-zinc-300',
    isReleased: false,
    isSigned: false,
    isPrepared: true,
    agentVerb: 'Release to portal',
  },
  PORTAL_RELEASED: {
    status: 'PORTAL_RELEASED',
    label: 'Ready to sign',
    kind: 'warning',
    adminBadge: 'bg-amber-900/60 text-amber-300',
    isReleased: true,
    isSigned: false,
    isPrepared: false,
    agentVerb: 'Revoke release',
  },
  DOWNLOAD_SENT: {
    // Legacy path — the agreement was emailed via the /portal/[token]
    // paperwork-portal flow. Rows in this state predate the native
    // release-gate; they are NOT advanced to PORTAL_RELEASED on read,
    // they keep their lineage so the audit trail stays interpretable.
    status: 'DOWNLOAD_SENT',
    label: 'Downloaded',
    kind: 'pending',
    adminBadge: 'bg-blue-900/60 text-blue-300',
    isReleased: true, // legacy-released; client had a delivery route
    isSigned: false,
    isPrepared: false,
    agentVerb: null,
  },
  REDLINE_UPLOADED: {
    status: 'REDLINE_UPLOADED',
    label: 'Reviewing',
    kind: 'warning',
    adminBadge: 'bg-amber-900/60 text-amber-300',
    isReleased: true,
    isSigned: false,
    isPrepared: false,
    agentVerb: 'Open redline',
  },
  UNDER_REVIEW: {
    status: 'UNDER_REVIEW',
    label: 'Reviewing',
    kind: 'warning',
    adminBadge: 'bg-amber-900/60 text-amber-300',
    isReleased: true,
    isSigned: false,
    isPrepared: false,
    agentVerb: 'Send counter',
  },
  NEGOTIATED_READY: {
    status: 'NEGOTIATED_READY',
    label: 'Ready to sign',
    kind: 'warning',
    adminBadge: 'bg-indigo-900/60 text-indigo-300',
    isReleased: true,
    isSigned: false,
    isPrepared: false,
    agentVerb: null,
  },
  SIGNED_BASELINE: {
    status: 'SIGNED_BASELINE',
    label: 'Signed',
    kind: 'success',
    adminBadge: 'bg-emerald-900/60 text-emerald-300',
    isReleased: true,
    isSigned: true,
    isPrepared: false,
    agentVerb: null,
  },
  SIGNED_NEGOTIATED: {
    status: 'SIGNED_NEGOTIATED',
    label: 'Signed',
    kind: 'success',
    adminBadge: 'bg-emerald-900/60 text-emerald-300',
    isReleased: true,
    isSigned: true,
    isPrepared: false,
    agentVerb: null,
  },
}

/**
 * Look up the description for a known status. Pass `null` when the
 * order has no SignedAgreement row yet — returns a synthetic
 * "Pending" entry so callers don't need to branch.
 */
export function describeAgreementStatus(
  status: AgreementStatus | null | undefined,
): AgreementStatusDescription {
  if (!status) {
    return {
      status: 'PORTAL_GENERATED', // shape-only; real status is "no row"
      label: 'Pending',
      kind: 'pending',
      adminBadge: 'bg-zinc-700 text-zinc-300',
      isReleased: false,
      isSigned: false,
      isPrepared: false,
      agentVerb: null,
    }
  }
  return TABLE[status]
}

/**
 * Recoverable target states for the agent's manual-override strip on
 * the order detail page AND the API allow-list at
 * /api/orders/[id]/agreement.
 *
 * Excludes SIGNED_* (terminal — signing is an event, not a manual
 * flip) and PORTAL_GENERATED (initial — admin can't push backward
 * into "not prepared" since the PDF exists).
 *
 * Single export so the API and the UI can't drift on which manual
 * transitions are allowed.
 */
export const RECOVERABLE_AGREEMENT_STATES: readonly AgreementStatus[] = [
  'PORTAL_RELEASED',
  'DOWNLOAD_SENT',
  'REDLINE_UPLOADED',
  'UNDER_REVIEW',
  'NEGOTIATED_READY',
] as const
