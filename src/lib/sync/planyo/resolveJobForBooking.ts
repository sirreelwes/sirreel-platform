import { prisma } from '@/lib/prisma'
import { resolveJob, createJobFromDraft } from '@/lib/jobs/resolveJob'

/**
 * Job-as-root step 5 — resolve an imported Planyo Booking into a Job.
 *
 * Runs AFTER applyCartImport has created the Booking (company/person/
 * agent already resolved by the cart importer). Shared by the daily
 * cron pass (importNewCartsRun) and the one-shot backfill script, so
 * both apply the identical policy through the SAME resolveJob /
 * createJobFromDraft primitives — no new matching logic here.
 *
 * Policy (ratified):
 *   - Booking already has a jobId          → ALREADY_LINKED (no-op)
 *   - resolveJob → CLEAN_MATCH             → attach top candidate
 *   - resolveJob → NO_MATCH                → createJobFromDraft
 *     (status ACTIVE — an imported cart is confirmed booked work, not
 *     a lead; NEW would flood the lead queue) and attach
 *   - resolveJob → CANDIDATES (ambiguous)  → NAME-ANCHORED policy
 *     (Wes, Jul 14): attach the best candidate ONLY when its match is
 *     anchored by a name or cart rung (ATTACHED_AMBIGUOUS — flagged
 *     for confirmation). When the only signal is company + overlapping
 *     dates, the differing Planyo Job_Name is strong evidence of a
 *     DISTINCT production (the Echobend case: four different shoots,
 *     same client, same week) — create a new Job instead and flag it
 *     as a possible sibling (CREATED_NEW_SIBLING). A wrong create is a
 *     cheap merge later; a wrong attach means untangling bookings.
 *
 * Idempotency: (1) the jobId short-circuit above; (2) resolveJob's
 * rung ② — planyoCartId on the Job or a sibling Booking scores 90, so
 * a re-import of an already-resolved cart CLEAN_MATCHes back to the
 * same Job instead of creating a duplicate. Created Jobs get
 * planyoCartId stamped (fill-only, tolerant of the unique constraint)
 * to strengthen that rung further.
 */

export type CartJobAction =
  | 'ALREADY_LINKED'
  | 'ATTACHED_EXISTING'
  | 'CREATED_NEW'
  | 'ATTACHED_AMBIGUOUS'
  | 'CREATED_NEW_SIBLING'
  | 'SKIPPED_NO_SIGNALS'

export interface CartJobResolution {
  bookingId: string
  bookingNumber: string
  cart: string | null
  action: CartJobAction
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  /** Top candidate's score + reasons (attach paths). */
  score?: number
  reasons?: string[]
  /** CANDIDATES bucket only — everything the agent should compare. */
  candidates?: { jobCode: string; name: string; score: number; reasons: string[] }[]
  companyName?: string | null
}

export async function resolveJobForImportedBooking(
  bookingId: string,
  opts?: { dryRun?: boolean },
): Promise<CartJobResolution> {
  const dryRun = opts?.dryRun === true

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingNumber: true,
      jobId: true,
      planyoCartId: true,
      companyId: true,
      jobName: true,
      startDate: true,
      endDate: true,
      agentId: true,
      company: { select: { name: true } },
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!booking) throw new Error(`booking ${bookingId} not found`)

  const base = {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    cart: booking.planyoCartId,
    companyName: booking.company?.name ?? null,
  }

  if (booking.jobId) {
    const j = await prisma.job.findUnique({
      where: { id: booking.jobId },
      select: { id: true, jobCode: true, name: true },
    })
    return { ...base, action: 'ALREADY_LINKED', jobId: booking.jobId, jobCode: j?.jobCode ?? null, jobName: j?.name ?? null }
  }
  if (!booking.companyId && !booking.planyoCartId && !booking.jobName) {
    return { ...base, action: 'SKIPPED_NO_SIGNALS', jobId: null, jobCode: null, jobName: null }
  }

  const dates =
    booking.startDate && booking.endDate
      ? {
          start: booking.startDate.toISOString().slice(0, 10),
          end: booking.endDate.toISOString().slice(0, 10),
        }
      : null

  const r = await resolveJob({
    companyId: booking.companyId,
    planyoCartId: booking.planyoCartId,
    jobNameHint: booking.jobName || null,
    dates,
    sourceRef: `planyo:import:${booking.planyoCartId ?? booking.id}`,
  })

  const attach = async (jobId: string): Promise<void> => {
    if (dryRun) return
    // jobId: null guard — never re-point a booking a concurrent pass
    // (or a human) already linked.
    await prisma.booking.updateMany({ where: { id: booking.id, jobId: null }, data: { jobId } })
  }

  const createAndAttach = async (action: 'CREATED_NEW' | 'CREATED_NEW_SIBLING'): Promise<CartJobResolution> => {
    const draftName = booking.jobName?.trim() || r.draft.name || `Planyo cart ${booking.planyoCartId ?? '?'}`
    const siblingCandidates =
      action === 'CREATED_NEW_SIBLING'
        ? r.candidates.slice(0, 5).map((c) => ({ jobCode: c.jobCode, name: c.name, score: c.score, reasons: c.reasons }))
        : undefined
    if (dryRun) {
      return { ...base, action, jobId: null, jobCode: '(dry-run)', jobName: draftName, candidates: siblingCandidates }
    }
    const created = await createJobFromDraft(
      {
        name: draftName,
        companyId: booking.companyId,
        contactName: booking.person ? `${booking.person.firstName} ${booking.person.lastName}`.trim() : null,
        contactEmail: booking.person?.email ?? null,
        startDate: dates?.start ?? null,
        endDate: dates?.end ?? null,
        status: 'ACTIVE',
        notes: `Created from Planyo import — cart ${booking.planyoCartId ?? '(none)'}`,
      },
      booking.agentId,
    )
    // Strengthen resolver rung ② for future re-imports. Fill-only and
    // tolerant: another job may already own this cart id (unique).
    if (booking.planyoCartId) {
      await prisma.job
        .update({ where: { id: created.job.id }, data: { planyoCartId: booking.planyoCartId } })
        .catch(() => {})
    }
    await attach(created.job.id)
    return {
      ...base,
      action,
      jobId: created.job.id,
      jobCode: created.job.jobCode,
      jobName: created.job.name,
      candidates: siblingCandidates,
    }
  }

  if (r.bucket === 'NO_MATCH') {
    return createAndAttach('CREATED_NEW')
  }

  const top = r.candidates[0]

  if (r.bucket === 'CLEAN_MATCH') {
    await attach(top.jobId)
    return {
      ...base,
      action: 'ATTACHED_EXISTING',
      jobId: dryRun ? null : top.jobId,
      jobCode: top.jobCode,
      jobName: top.name,
      score: top.score,
      reasons: top.reasons,
    }
  }

  // CANDIDATES — name-anchored policy. Rung reasons are module-internal
  // constants of resolveJob: '②' starts with "Planyo cart", '⑤' starts
  // with "job name". Company+dates alone is NOT an attach anchor.
  const anchored = top.reasons.some((why) => why.startsWith('Planyo cart') || why.startsWith('job name'))
  if (!anchored) {
    return createAndAttach('CREATED_NEW_SIBLING')
  }
  await attach(top.jobId)
  return {
    ...base,
    action: 'ATTACHED_AMBIGUOUS',
    jobId: dryRun ? null : top.jobId,
    jobCode: top.jobCode,
    jobName: top.name,
    score: top.score,
    reasons: top.reasons,
    candidates: r.candidates.slice(0, 5).map((c) => ({
      jobCode: c.jobCode,
      name: c.name,
      score: c.score,
      reasons: c.reasons,
    })),
  }
}
