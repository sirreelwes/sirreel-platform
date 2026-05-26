/**
 * Quote follow-up cadence helper — Mode A (agent-driven).
 *
 * Three nudges anchored to the order's quoteSentAt + expiresAt rather
 * than flat hour offsets. The shape adapts to the quote's valid-until
 * window so a 14-day quote doesn't get all three nudges piled into the
 * first 3 days like the legacy DAY_0/1/3 cron does.
 *
 * Stages (default expiresAt = sent + 7 days):
 *   STAGE_1 — sentAt + 2 days        "did the quote land?"
 *   STAGE_2 — midpoint(sent, expires) "still planning these dates?"
 *   STAGE_3 — expiresAt - 36h         "want to lock it in?"
 *
 * Min-gap rule: stages must be >= 24h apart. For short quote windows
 * (e.g. 4-day expiry) the math is clamped so the three stages don't
 * collapse onto the same day.
 *
 * GATING (pauses the cadence — never nudge someone who already
 * responded or whose deal is no longer live):
 *   - order.status !== 'QUOTE_SENT'  → paused (status_advanced)
 *   - thread has an inbound message after sentAt → paused (client_replied)
 *   - order.quoteSentAt is null (never sent) → no cadence at all
 *
 * Pure function. No I/O. Callers (API route or panel) pass in the
 * minimal order shape + the thread's lastInboundAt + the rows already
 * sent for this order.
 */

import type { FollowUpStage } from '@prisma/client'

const DAY_MS = 86_400_000
const MIN_GAP_MS = DAY_MS // 24h
const STAGE_3_BEFORE_EXPIRY_MS = 36 * 3_600_000 // 36h before expires

export type CadenceStage = Extract<FollowUpStage, 'STAGE_1' | 'STAGE_2' | 'STAGE_3'>

export const CADENCE_STAGES: CadenceStage[] = ['STAGE_1', 'STAGE_2', 'STAGE_3']

export type PauseReason =
  | 'never_sent'        // quoteSentAt is null
  | 'status_advanced'   // order is past QUOTE_SENT (WON/LOST/etc.)
  | 'client_replied'    // thread had an inbound after sentAt
  | 'all_stages_sent'   // 3 of 3 already fired

export interface CadenceInput {
  /** Order timing. quoteSentAt is the anchor; if null, no cadence runs. */
  quoteSentAt: Date | null
  /** Hard valid-until. If null, computed as quoteSentAt + quoteExpDays. */
  expiresAt: Date | null
  /** Falls back to 7 if Order.quoteExpDays not provided. */
  quoteExpDays?: number | null
  /** Order.status — must be 'QUOTE_SENT' for cadence to run. */
  status: string
  /** Most-recent inbound message on the order's thread; null if none. */
  threadLastInboundAt: Date | null
  /** STAGE_N rows already SENT for this order (status=SENT, not PENDING). */
  stagesSent: CadenceStage[]
  /** Optional override for "now" — defaults to new Date(). */
  now?: Date
}

export interface CadenceState {
  /** Stage that's due now (past its dueAt, not yet sent). null when nothing due. */
  currentDueStage: CadenceStage | null
  /** Stages already sent — chronologically meaningful but order-agnostic in input. */
  stagesSent: CadenceStage[]
  /** Per-stage dueAt times — always populated when not paused. */
  dueDates: Record<CadenceStage, Date>
  /** Next stage's dueAt for the UI countdown. null when nothing more is scheduled. */
  nextStageAt: Date | null
  /** The next stage label to fire, or null when none remain. */
  nextStage: CadenceStage | null
  /** True when the cadence should not nudge — for any reason. */
  paused: boolean
  /** Specific reason for the pause; null when paused=false. */
  pauseReason: PauseReason | null
  /** valid-until used by the helper (computed from quoteExpDays when expiresAt was null). */
  effectiveExpiresAt: Date | null
}

/**
 * Compute the three stage dueAt values given a sentAt + expiresAt.
 * Applies the min-gap clamp so stages never collide on short windows.
 */
function computeStageDueDates(sentAt: Date, expiresAt: Date): Record<CadenceStage, Date> {
  const s = sentAt.getTime()
  const e = expiresAt.getTime()

  // Initial proposed times.
  let stage1 = s + 2 * DAY_MS
  let stage2 = (s + e) / 2
  let stage3 = e - STAGE_3_BEFORE_EXPIRY_MS

  // Enforce min 24h gaps. If the window is too short to fit three
  // distinct nudges, the later stages slide forward and may end up at
  // or near expiresAt — the gating logic will still suppress them once
  // the order leaves QUOTE_SENT, so over-scheduled stages are harmless.
  if (stage2 < stage1 + MIN_GAP_MS) stage2 = stage1 + MIN_GAP_MS
  if (stage3 < stage2 + MIN_GAP_MS) stage3 = stage2 + MIN_GAP_MS

  return {
    STAGE_1: new Date(stage1),
    STAGE_2: new Date(stage2),
    STAGE_3: new Date(stage3),
  }
}

/** Effective expiresAt — explicit column wins; otherwise sentAt + quoteExpDays. */
function resolveExpiresAt(
  sentAt: Date,
  explicit: Date | null,
  quoteExpDays: number | null | undefined,
): Date {
  if (explicit) return explicit
  const days = quoteExpDays ?? 7
  return new Date(sentAt.getTime() + days * DAY_MS)
}

export function computeCadenceState(input: CadenceInput): CadenceState {
  const now = (input.now ?? new Date()).getTime()
  const sentAt = input.quoteSentAt

  // ── Pause cases that short-circuit before any dueAt math ──────────
  if (!sentAt) {
    return emptyState('never_sent', null)
  }

  const effectiveExpiresAt = resolveExpiresAt(sentAt, input.expiresAt, input.quoteExpDays)
  const dueDates = computeStageDueDates(sentAt, effectiveExpiresAt)

  if (input.status !== 'QUOTE_SENT') {
    return pausedAt('status_advanced', dueDates, effectiveExpiresAt, input.stagesSent)
  }
  if (input.threadLastInboundAt && input.threadLastInboundAt.getTime() > sentAt.getTime()) {
    return pausedAt('client_replied', dueDates, effectiveExpiresAt, input.stagesSent)
  }

  const sentSet = new Set(input.stagesSent)
  const unsent = CADENCE_STAGES.filter((s) => !sentSet.has(s))
  if (unsent.length === 0) {
    return pausedAt('all_stages_sent', dueDates, effectiveExpiresAt, input.stagesSent)
  }

  // currentDueStage = earliest unsent stage whose dueAt has elapsed.
  let currentDueStage: CadenceStage | null = null
  for (const s of unsent) {
    if (dueDates[s].getTime() <= now) {
      currentDueStage = s
      break
    }
  }

  // nextStage = earliest unsent stage strictly after now (i.e. the one
  // the agent is waiting on). When currentDueStage exists, that IS the
  // next one to send, so nextStage points at the stage AFTER it.
  let nextStage: CadenceStage | null = null
  if (currentDueStage) {
    const idx = unsent.indexOf(currentDueStage)
    nextStage = unsent[idx + 1] ?? null
  } else {
    nextStage = unsent.find((s) => dueDates[s].getTime() > now) ?? null
  }

  return {
    currentDueStage,
    stagesSent: input.stagesSent,
    dueDates,
    nextStage,
    nextStageAt: nextStage ? dueDates[nextStage] : null,
    paused: false,
    pauseReason: null,
    effectiveExpiresAt,
  }
}

function emptyState(reason: PauseReason, expiresAt: Date | null): CadenceState {
  return {
    currentDueStage: null,
    stagesSent: [],
    dueDates: {
      STAGE_1: new Date(0),
      STAGE_2: new Date(0),
      STAGE_3: new Date(0),
    },
    nextStage: null,
    nextStageAt: null,
    paused: true,
    pauseReason: reason,
    effectiveExpiresAt: expiresAt,
  }
}

function pausedAt(
  reason: PauseReason,
  dueDates: Record<CadenceStage, Date>,
  effectiveExpiresAt: Date,
  stagesSent: CadenceStage[],
): CadenceState {
  return {
    currentDueStage: null,
    stagesSent,
    dueDates,
    nextStage: null,
    nextStageAt: null,
    paused: true,
    pauseReason: reason,
    effectiveExpiresAt,
  }
}
