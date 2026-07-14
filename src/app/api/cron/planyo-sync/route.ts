/**
 * Daily Planyo→HQ sync cron. Wired in vercel.json at `0 13 * * *` UTC
 * (= 6 AM PT). CRON_SECRET-protected like the other crons.
 *
 * Two-phase: plan first (dry-run) to compute the signature, then apply
 * with that signature as `authorizedSignature`. If Planyo's state shifts
 * between the two phases, `runSync` aborts with `ABORTED_SIGNATURE_MISMATCH`
 * and writes nothing — the next day's run retries clean.
 *
 * Slack alert: ONLY when there are RELEASE_CANDIDATEs OR the run did
 * not finish SUCCESS. Clean runs are silent. No daily noise. Routes to
 * SLACK_ALERT_CHANNEL via the same helper the health-check cron uses.
 *
 * Auto-release is OFF — `runSync` has no auto-release path. The cron
 * surfaces RELEASE_CANDIDATEs for human action via the alert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { postMessage as slackPost } from '@/lib/slack'
import { runSync, type RunSyncResult } from '@/lib/sync/planyo/runSync'
import type { SyncEvent } from '@/lib/sync/planyo/reconcile'
import {
  importNewCartsRun,
  type NewCartImportRunResult,
} from '@/lib/sync/planyo/importNewCartsRun'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow manual curl
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tStart = Date.now()

  // PHASE 1: plan
  const plan = await runSync({ dryRun: true })

  // PHASE 2: apply maintenance — date drift, line adds, RELEASE_CANDIDATE
  // for cancellations on already-mirrored carts. Scope-guarded to
  // PLANYO_BACKFILL only.
  const apply = await runSync({
    dryRun: false,
    authorizedSignature: plan.computedSignature,
  })

  // PHASE 3: new-cart importer. Writes to the same audit run (apply.runId)
  // so a cron tick = one PlanyoSyncRun. AUTO buckets apply; FLAGGED
  // buckets log only. Cancelled / past-only / noise are silently
  // skipped (same posture as runSync's CREATE-probe).
  //
  // Wrapped in try/catch because per-cart errors are isolated INSIDE
  // importNewCartsRun, but a top-level throw (pull failure, filter
  // throws before the loop, transient DB error in the prelude, etc.)
  // would 500 the cron before shouldAlert is evaluated — silently
  // skipping the new-cart pass, which is exactly the drift this whole
  // feature exists to prevent. On throw we keep the response 200,
  // synthesize a neutral newCarts shape, mark the audit run PARTIAL,
  // and force a loud Slack alert. The maintenance apply already
  // committed; it stays untouched.
  let newCarts: NewCartImportRunResult = {
    imported: 0,
    flagged: [],
    jobsAttached: 0,
    jobsCreated: 0,
    jobAmbiguous: [],
    skippedCancelled: 0,
    skippedPastOnly: 0,
    skippedNoiseOnly: 0,
    candidatesConsidered: 0,
    errors: [],
    durationMs: 0,
  }
  let newCartsFatalError: string | null = null
  try {
    newCarts = await importNewCartsRun({
      runId: apply.runId,
      dryRun: false,
    })
  } catch (e) {
    newCartsFatalError = (e as Error).message || String(e)
    // Best-effort audit: degrade the run row from SUCCESS to PARTIAL +
    // log a fatal event. Failure of either is itself logged but does
    // NOT mask the Slack alert.
    try {
      await prisma.planyoSyncRun.update({
        where: { id: apply.runId },
        data: {
          outcome: 'PARTIAL',
          reason: `new-cart pass fatal: ${newCartsFatalError}`,
        },
      })
    } catch (auditErr) {
      console.error('[planyo-sync cron] failed to mark run PARTIAL:', auditErr)
    }
    try {
      await prisma.planyoSyncEvent.create({
        data: {
          runId: apply.runId,
          op: 'NO_CHANGE',
          detail: `[NEW_CART_PASS_FATAL] ${newCartsFatalError}`,
          after: { fatalError: newCartsFatalError } as unknown as Parameters<
            typeof prisma.planyoSyncEvent.create
          >[0]['data']['after'],
        },
      })
    } catch (auditErr) {
      console.error('[planyo-sync cron] failed to log fatal event:', auditErr)
    }
  }

  const tEnd = Date.now()

  const candidates = apply.events.filter((e) => e.op === 'RELEASE_CANDIDATE')

  // Alert posture: silent on clean runs; loud on any of —
  //   - cancellation-of-mirrored-cart flag (RELEASE_CANDIDATE)
  //   - new-cart flag (MULTI_MATCH_CO or no-email WOULD_CREATE)
  //   - per-cart errors in the new-cart pass
  //   - fatal throw from the new-cart pass as a whole
  //   - maintenance apply that didn't finish SUCCESS
  const shouldAlert =
    candidates.length > 0 ||
    newCarts.flagged.length > 0 ||
    newCarts.jobAmbiguous.length > 0 ||
    newCarts.errors.length > 0 ||
    newCartsFatalError !== null ||
    apply.outcome !== 'SUCCESS'

  let alertResult: { ok: boolean; reason?: string } | null = null
  if (shouldAlert) {
    alertResult = await sendSyncAlert(apply, candidates, newCarts, newCartsFatalError)
  }

  return NextResponse.json({
    ok: true,
    planRunId: plan.runId,
    applyRunId: apply.runId,
    outcome: apply.outcome,
    counts: apply.counts,
    releaseCandidates: candidates.length,
    newCarts: {
      imported: newCarts.imported,
      flagged: newCarts.flagged.length,
      jobsAttached: newCarts.jobsAttached,
      jobsCreated: newCarts.jobsCreated,
      jobAmbiguous: newCarts.jobAmbiguous.length,
      errors: newCarts.errors.length,
      skippedCancelled: newCarts.skippedCancelled,
      skippedPastOnly: newCarts.skippedPastOnly,
      candidatesConsidered: newCarts.candidatesConsidered,
      durationMs: newCarts.durationMs,
      fatalError: newCartsFatalError,
    },
    totalDurationMs: tEnd - tStart,
    alerted: !!alertResult?.ok,
    alertResult,
  })
}

async function sendSyncAlert(
  apply: RunSyncResult,
  candidates: SyncEvent[],
  newCarts: NewCartImportRunResult,
  newCartsFatalError: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const futureCands = candidates.filter((c) => {
    const b = c.before as { endTime?: string | Date } | undefined
    return b?.endTime && new Date(b.endTime) >= today
  })
  const pastCands = candidates.filter((c) => !futureCands.includes(c))

  const cartIds = [...new Set(candidates.map((c) => c.planyoCartId).filter(Boolean))]
  const bookings = cartIds.length
    ? await prisma.booking.findMany({
        where: { planyoCartId: { in: cartIds } },
        select: {
          planyoCartId: true,
          bookingNumber: true,
          company: { select: { name: true } },
        },
      })
    : []
  const bookByCart = new Map(bookings.map((b) => [b.planyoCartId!, b]))

  const fmtCand = (c: SyncEvent): string => {
    const b = c.before as
      | { startTime?: string | Date; endTime?: string | Date; unitName?: string }
      | undefined
    const booking = bookByCart.get(c.planyoCartId)
    const start = b?.startTime ? new Date(b.startTime).toISOString().slice(0, 10) : '?'
    const end = b?.endTime ? new Date(b.endTime).toISOString().slice(0, 10) : '?'
    return `  • resv=${c.planyoReservationId} · ${booking?.bookingNumber ?? '?'} · ${booking?.company?.name ?? '?'} · "${b?.unitName ?? '?'}" · ${start} → ${end}`
  }

  // Any of "real" failure modes (apply non-success, fatal in phase 3)
  // flips the header emoji to the louder rotating_light.
  const headerEmoji =
    apply.outcome !== 'SUCCESS' || newCartsFatalError ? ':rotating_light:' : ':warning:'
  const counts = apply.counts

  const lines: string[] = []
  lines.push(`${headerEmoji} *Planyo daily sync* — ${new Date().toISOString().slice(0, 10)}`)

  // FATAL FAILURE in the new-cart pass — surface FIRST so a reader who
  // only catches the top of the message still sees it. Maintenance has
  // already committed; new bookings did NOT mirror this run.
  if (newCartsFatalError) {
    lines.push(
      `:rotating_light: *New-cart pass FAILED — ${newCartsFatalError}.* Maintenance sync completed; new bookings NOT imported this run.`,
    )
  }

  if (apply.outcome !== 'SUCCESS') {
    lines.push(`*Outcome:* \`${apply.outcome}\``)
    if (apply.reason) lines.push(`*Reason:* ${apply.reason}`)
  }

  lines.push(
    `*Counts:* create=${counts.create}, updateDates=${counts.updateDates}, release=${counts.release}, *releaseCandidate=${counts.releaseCandidate}*, unmapped=${counts.unmapped}, conflict=${counts.conflict}, absent=${counts.absent}, noChange=${counts.noChange}`,
  )

  if (futureCands.length) {
    lines.push('')
    lines.push(
      `★ *Future-dated release candidates (live capacity wrongly held) — ${futureCands.length}*`,
    )
    for (const c of futureCands) lines.push(fmtCand(c))
  }

  if (pastCands.length) {
    lines.push('')
    lines.push(`_Past-dated release candidates (cosmetic) — ${pastCands.length}_`)
    for (const c of pastCands.slice(0, 30)) lines.push(fmtCand(c))
    if (pastCands.length > 30) lines.push(`  ...and ${pastCands.length - 30} more`)
  }

  // New-cart sections. NEW carts (first time we see them flagged) get
  // the full detail block — they need attention. REPEATs (already
  // flagged on a prior run) collapse to a quiet rollup so a stale
  // backlog doesn't train people to ignore the channel.
  const newFlagged = newCarts.flagged.filter((f) => f.firstFlaggedAt === null)
  const repeatFlagged = newCarts.flagged.filter((f) => f.firstFlaggedAt !== null)

  if (newCarts.imported > 0) {
    lines.push('')
    lines.push(
      `_New carts imported this run — ${newCarts.imported} (jobs: ${newCarts.jobsAttached} attached, ${newCarts.jobsCreated} created)_`,
    )
  }

  // Job-as-root step 5: ambiguous Job attachments. The best candidate
  // WAS attached (bookings never stay Job-less), but a human should
  // confirm the pick — same review posture as the company matcher.
  if (newCarts.jobAmbiguous.length) {
    lines.push('')
    lines.push(`★ *Imported carts needing Job confirmation — ${newCarts.jobAmbiguous.length}*`)
    for (const j of newCarts.jobAmbiguous) {
      if (j.mode === 'attached') {
        lines.push(`  • cart=${j.cart} · ${j.bookingNumber} → attached [${j.jobCode ?? '?'}] "${j.jobName ?? '?'}" (score ${j.score ?? '?'}) — confirm the pick`)
        if (j.candidates?.length) {
          lines.push(
            '    other candidates: ' +
              j.candidates.slice(1).map((c) => `[${c.jobCode}] "${c.name}" (${c.score})`).join(' | '),
          )
        }
      } else {
        lines.push(`  • cart=${j.cart} · ${j.bookingNumber} → created NEW [${j.jobCode ?? '?'}] "${j.jobName ?? '?'}" — possible sibling of ${(j.candidates ?? []).map((c) => `[${c.jobCode}] "${c.name}"`).join(' | ') || '?'} (merge if same production)`)
      }
    }
  }

  if (newFlagged.length) {
    lines.push('')
    lines.push(`★ *New carts requiring human review — ${newFlagged.length}*`)
    for (const f of newFlagged) {
      const candidatesStr = f.candidates && f.candidates.length
        ? '  candidates: ' + f.candidates.map((c) => `"${c.name}"`).join(' | ')
        : ''
      lines.push(
        `  • cart=${f.cart} · "${f.cartCompanyName}" · ${f.cartCustomerName}${f.cartCustomerEmail ? ` <${f.cartCustomerEmail}>` : ' (no email)'}`,
      )
      lines.push(`    ${f.bucket} (${f.flagKind}): ${f.flagReasons.join(' ; ')}`)
      if (candidatesStr) lines.push(candidatesStr)
    }
  }

  if (repeatFlagged.length) {
    // Oldest first-flagged stamp across the still-pending set — the
    // "backlog age" the rollup surfaces. Compute server-side so the
    // Slack line stays one tidy sentence.
    let oldest: Date | null = null
    for (const f of repeatFlagged) {
      if (f.firstFlaggedAt && (!oldest || f.firstFlaggedAt < oldest)) oldest = f.firstFlaggedAt
    }
    const oldestStr = oldest ? oldest.toISOString().slice(0, 10) : '?'
    lines.push('')
    lines.push(
      `_Still pending review: ${repeatFlagged.length} cart${repeatFlagged.length === 1 ? '' : 's'} (oldest flagged ${oldestStr})_`,
    )
  }

  if (newCarts.errors.length) {
    lines.push('')
    lines.push(`:rotating_light: *New-cart import errors — ${newCarts.errors.length}*`)
    for (const e of newCarts.errors.slice(0, 5)) {
      lines.push(`  • cart=${e.cart} — ${e.error}`)
    }
    if (newCarts.errors.length > 5) lines.push(`  ...and ${newCarts.errors.length - 5} more`)
  }

  lines.push('')
  lines.push(
    `_Auto-release OFF; cancellations stay flag-only. New-cart pass: ${newCarts.candidatesConsidered} considered, ${newCarts.skippedCancelled} cancelled-skipped, ${newCarts.skippedPastOnly} past-only-skipped, ${newCarts.durationMs}ms._`,
  )

  return slackPost(lines.join('\n'))
}
