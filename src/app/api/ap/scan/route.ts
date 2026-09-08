import { NextRequest, NextResponse } from 'next/server'
import { requireApUser } from '@/lib/ap/access'
import { findBillCandidates, countBillCandidates } from '@/lib/ap/candidates'
import { scanCandidate, scannedEmailIds } from '@/lib/ap/scan'

/**
 * POST /api/ap/scan — read the next batch of candidate emails.
 *
 * Batched on purpose, and small. Each candidate costs a Gmail message fetch,
 * usually an attachment download, and a Sonnet read of a PDF — call it a few
 * seconds each. Asking for the whole backlog in one request would hit the
 * function ceiling long before it finished, and would spend the whole budget
 * before anyone had seen whether the reads are any good.
 *
 * Body: { limit?, sinceDays? }. The desk asks for a batch, shows the result,
 * and says how many are still waiting.
 *
 * Re-running is safe: rows key on emailMessageId, and every email already on
 * the desk (including ones read as NOT a bill) is skipped.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20
const DEFAULT_WINDOW_DAYS = 180
const MAX_WINDOW_DAYS = 730

export async function POST(req: NextRequest) {
  const user = await requireApUser()
  if (user instanceof NextResponse) return user

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))
  const sinceDays = Math.min(MAX_WINDOW_DAYS, Math.max(1, Number(body.sinceDays) || DEFAULT_WINDOW_DAYS))

  const scanned = await scannedEmailIds()
  const candidates = await findBillCandidates({ sinceDays, limit, skipEmailMessageIds: scanned })

  const read = []
  for (const c of candidates) {
    try {
      read.push(await scanCandidate(c))
    } catch (err) {
      // One unreadable message must not abandon the batch — the rest of the
      // backlog is still worth reading, and the failure is in the log.
      console.error('[ap-scan] failed on', c.gmailMessageId, err instanceof Error ? err.message : err)
    }
  }

  const after = await scannedEmailIds()
  const waiting = await countBillCandidates({ sinceDays, skipEmailMessageIds: after })

  return NextResponse.json({
    ok: true,
    read,
    bills: read.filter((r) => r.isBill).length,
    notBills: read.filter((r) => !r.isBill).length,
    unread: waiting,
  })
}
