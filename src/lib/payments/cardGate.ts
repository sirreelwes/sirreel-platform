/**
 * "Does this job need a card before it goes out — and is one on file?"
 *
 * Wes, 2026-09-06, after Figurov LLC asked to skip the portal and send a
 * paper card authorization instead: "as a protocol, if this happens
 * again, HQ needs to require the agent to manually enter the CC prior to
 * the job." The client said no to the secure form; that is their choice.
 * It does not change the rule that a truck leaves with a card behind it —
 * it moves the typing from the client to the agent, who keys the signed
 * authorization into the company wallet (CompanyCard, source STAFF).
 *
 * ── Scope: HQ-tracked capture only ─────────────────────────────────────
 * Measured 2026-09-06: of 23 bookings going out in the next 14 days, 21
 * held no card in either HQ store. Almost all are Planyo-era or annual
 * accounts whose authorization lives in Cognito or RentalWorks — "no card
 * in HQ" means "HQ never asked", not "no card". A blanket gate would have
 * stopped the yard on day one. So the requirement attaches only where HQ
 * OWNS the capture: a PaperworkRequest exists for one of the job's live
 * bookings, i.e. someone pressed "Send CC request". From then on the job
 * either has a card (portal or wallet) or it does not go out. Same shape
 * as the coi-missing provider's Planyo rule.
 *
 * Two stores, always both — see jobCardOnFile.ts for why. The portal card
 * on the booking's paperwork row, or a wallet card on the company.
 *
 * Callers: the two check-out writes (yard inspection POST, driver self
 * check-out) refuse on `blocked`; the card-required action item lists the
 * same rows for the agent; the job page names the consequence on the tile.
 */
import { prisma } from '@/lib/prisma'
import { resolveWalletCardForJob } from '@/lib/payments/jobCardOnFile'

export interface CardGate {
  /** HQ sent the card link for this job — HQ owns the capture. */
  required: boolean
  /** A card is on file in either store. */
  onFile: boolean
  /** required && !onFile — the check-out writes refuse on this. */
  blocked: boolean
  /** When the link went out, and to whom, for the message. */
  linkSentAt: Date | null
  linkSentTo: string | null
  companyName: string | null
  agentName: string | null
}

export async function cardGateForJob(jobId: string): Promise<CardGate> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      companyId: true,
      company: { select: { name: true } },
      agent: { select: { name: true } },
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null },
        select: {
          paperworkRequests: {
            orderBy: { sentAt: 'asc' },
            select: { sentAt: true, sentTo: true, ccCardNumberEncrypted: true, clientInitiatedAt: true },
          },
        },
      },
    },
  })
  const none: CardGate = {
    required: false, onFile: false, blocked: false,
    linkSentAt: null, linkSentTo: null, companyName: null, agentName: null,
  }
  if (!job) return none

  const requests = job.bookings.flatMap((b) => b.paperworkRequests)
  // Only a request HQ sent makes the card required. A client who opened the
  // card form themselves from the portal — "I want to get ahead of the
  // paperwork" (Oliver, 2026-09-12) — must never be able to block their own
  // pickup by not finishing it. Wes's ruling the same day: the client link is
  // not a gate. The moment a rep sends the CCA on that row the marker clears
  // and it gates like any other (schema: PaperworkRequest.clientInitiatedAt).
  const hqRequests = requests.filter((r) => !r.clientInitiatedAt)
  const required = hqRequests.length > 0
  // A card captured through a client-started link still counts as ON FILE —
  // where the link came from says nothing about the card behind it.
  const portalCard = requests.some((r) => !!r.ccCardNumberEncrypted)
  const onFile = portalCard || !!(await resolveWalletCardForJob(job.companyId, jobId))
  const first = hqRequests[0] ?? null

  return {
    required,
    onFile,
    blocked: required && !onFile,
    linkSentAt: first?.sentAt ?? null,
    linkSentTo: first?.sentTo ?? null,
    companyName: job.company?.name ?? null,
    agentName: job.agent?.name ?? null,
  }
}

/** The sentence both check-out surfaces show. Names the fix, not just the
 *  refusal — the person at the dock cannot key a card; the agent can. */
export function cardGateMessage(g: CardGate): string {
  const who = g.companyName ?? 'this client'
  const sent = g.linkSentAt
    ? ` The card link went to ${g.linkSentTo ?? 'the client'} on ${g.linkSentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} and was never completed.`
    : ''
  const agent = g.agentName ? ` (${g.agentName})` : ''
  return `No card on file for ${who}.${sent} The agent${agent} has to key in a signed card authorization before this vehicle goes out.`
}
