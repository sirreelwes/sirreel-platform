/** POST /api/public/vendor-account/[token]/hq/start — the partner presses
 *  "Start" on the "See what HQ can do for you" page. Gated by their
 *  SirReel partner token; idempotent. Answers the workspace URL. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { startWorkspaceTrial, hqUrl } from '@/lib/hq-white-label/workspace'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-hq-start:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : null)
  try {
    const ws = await startWorkspaceTrial(v.id, { requestedByName: str('name'), requestedByEmail: str('email'), note: str('note') })
    return NextResponse.json({ ok: true, url: hqUrl(ws.accessToken), status: ws.status })
  } catch (e) {
    const status = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500
    if (status >= 500) console.error('[vendor-hq start]', e)
    return NextResponse.json({ error: status < 500 && e instanceof Error ? e.message : 'Something went wrong.' }, { status })
  }
}
