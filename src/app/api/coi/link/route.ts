import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { signCoiToken } from '@/lib/coi/coiUploadToken'

export const dynamic = 'force-dynamic'

// GET /api/coi/link?companyId=&jobId=&inquiryId= — authed. Mints a no-login
// COI upload link the team can share with a client. Any/all context params
// are optional; a link with none lands uploads as UNATTACHED.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const sp = req.nextUrl.searchParams
  const jobId = sp.get('jobId') || undefined
  const companyId = sp.get('companyId') || undefined
  const inquiryId = sp.get('inquiryId') || undefined
  const token = signCoiToken({ jobId, companyId, inquiryId })
  const origin = req.nextUrl.origin
  return NextResponse.json({ url: `${origin}/coi/${token}`, token })
}
