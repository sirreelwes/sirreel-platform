import { prisma } from '@/lib/prisma'

/**
 * Find-or-create the stage PaperworkRequest for a booking that holds a
 * STAGES-department item — the bridge between a held stage job and the
 * /admin/stage-terms workflow ("Awaiting Terms Approval").
 *
 * Called ONLY from explicit agent actions (the stage-terms worklist's
 * "Needs stage paperwork" section and the gantt modal's Stage terms
 * button) — deliberately NOT from hold creation, Planyo import, or
 * status routes, so paperwork never auto-creates on hold entry.
 *
 * Rules:
 *  - Stage detection is by AssetCategory.department === 'STAGES', never
 *    by name (the live category is named "Studios").
 *  - Existing stage|both request → returned as-is.
 *  - Existing vehicles request → contractType UPGRADED vehicles→both
 *    (never downgraded).
 *  - None → created with contractType 'stage'; sentTo from the booking
 *    contact's email, tolerating a missing email (empty sentTo + a
 *    warning for the tool to surface — the ready-to-sign email helper
 *    already skips gracefully when no address is on file).
 *  - No email is sent and no terms are set here.
 *
 * Idempotent via the lookup — double-clicks return the same request.
 */

export interface EnsureStageRequestResult {
  token: string
  contractType: string
  /** 'existing' | 'upgraded' | 'created' */
  outcome: 'existing' | 'upgraded' | 'created'
  /** Present when the booking has no client email on file. */
  warning?: string
}

export async function ensureStagePaperworkRequest(bookingId: string): Promise<EnsureStageRequestResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      person: { select: { email: true } },
      items: { include: { category: { select: { department: true } } } },
      paperworkRequests: { orderBy: { sentAt: 'desc' } },
    },
  })
  if (!booking) throw new Error('Booking not found')

  const hasStageItem = booking.items.some((i) => i.category?.department === 'STAGES')
  if (!hasStageItem) throw new Error('Booking has no STAGES-department item')

  const email = (booking.person?.email || '').trim()
  const warning = email ? undefined : 'No client email on file for this booking — the ready-to-sign email will be skipped until one is added.'

  const stageRequest = booking.paperworkRequests.find((r) => r.contractType === 'stage' || r.contractType === 'both')
  if (stageRequest) {
    return { token: stageRequest.token, contractType: stageRequest.contractType, outcome: 'existing', warning }
  }

  const vehiclesRequest = booking.paperworkRequests.find((r) => r.contractType === 'vehicles')
  if (vehiclesRequest) {
    await prisma.paperworkRequest.update({
      where: { token: vehiclesRequest.token },
      data: { contractType: 'both' },
    })
    return { token: vehiclesRequest.token, contractType: 'both', outcome: 'upgraded', warning }
  }

  const created = await prisma.paperworkRequest.create({
    data: {
      bookingId: booking.id,
      sentTo: email,
      contractType: 'stage',
    },
  })
  return { token: created.token, contractType: 'stage', outcome: 'created', warning }
}
