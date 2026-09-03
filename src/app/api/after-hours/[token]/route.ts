/**
 * GET /api/after-hours/[token] — the driver's read.
 *
 * Unauthenticated by design: the recipient is a truck driver or a PA who
 * has no SirReel account and never will. The token IS the credential, same
 * contract as /coi/[token] and /drive/[token].
 *
 * What it serves is deliberately thin — the lot, the codes, the steps, the
 * phone number, and whatever the production told them. No order, no
 * pricing, no paperwork, no contacts, not even the client company's name
 * beyond the project the sender typed. A driver holding this link learns
 * how to open a gate; that is the entire scope.
 *
 * Every failure — unknown, expired, revoked, or a job whose release was
 * pulled — returns the same 404. Telling a stranger which of those it was
 * tells them which tokens once existed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveAfterHoursShare } from '@/lib/afterHours/share'
import { afterHoursPayload } from '@/lib/afterHours/instructions'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const share = await resolveAfterHoursShare(params.token || '')
  if (!share) {
    return NextResponse.json(
      {
        error: 'not_found',
        message:
          'This link is no longer active. Call (888) 477-7335 — the line is answered around the clock and they can get you in.',
      },
      { status: 404 },
    )
  }

  const payload = await afterHoursPayload()

  return NextResponse.json({
    projectName: share.jobName,
    recipientName: share.recipientName,
    // Both notes reach the driver: the production's message to this person,
    // and the agent's standing line for the job ("your cart is the one
    // tagged GOGGLES") — which is written for exactly this reader.
    message: share.message,
    note: share.jobNote,
    expiresAt: share.expiresAt,
    // A share carries no rep contact: the driver's escalation path is the
    // 24-hour line, not a salesperson's mobile.
    agent: null,
    ...payload,
  })
}
