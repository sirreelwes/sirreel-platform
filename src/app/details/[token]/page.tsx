import { prisma } from '@/lib/prisma'
import { verifyDetailsToken } from '@/lib/intake/detailsToken'
import { ClientDetailsForm } from '@/components/intake/ClientDetailsForm'

export const dynamic = 'force-dynamic'

/**
 * Client-facing "tell us your production company and project" page (no
 * login). The Quick Reply email links here instead of relying on a typed
 * reply, because email cannot carry working input fields — see
 * src/lib/intake/detailsToken.ts for the why.
 *
 * Mirrors the COI drop page (/coi/[token]): server-verifies the signed
 * token, greets with whatever context resolves, renders the form. The
 * token says which fields we were missing, so a client is never asked to
 * re-type a company we already had.
 *
 * If the ask was already answered, the page says so rather than silently
 * taking a second copy — a forwarded link shouldn't produce duplicates.
 */
export default async function ClientDetailsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const payload = verifyDetailsToken(token)

  if (!payload) {
    return (
      <Shell>
        <h1 className="text-[26px] font-extrabold tracking-tight text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          This link has expired
        </h1>
        <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
          These links are valid for a limited time. Just reply to our email with your production
          company and project name and we&rsquo;ll take it from there.
        </p>
      </Shell>
    )
  }

  const existing = await prisma.clientDetailReply.findFirst({
    where: {
      status: { not: 'DISMISSED' },
      ...(payload.inquiryId ? { inquiryId: payload.inquiryId } : { bookingId: payload.bookingId }),
    },
    orderBy: { createdAt: 'desc' },
    select: { companyName: true, projectName: true },
  })

  if (existing) {
    return (
      <Shell>
        <h1 className="text-[26px] font-extrabold tracking-tight text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Got it — thank you
        </h1>
        <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
          We already have {existing.companyName ? <b className="text-[#0c0c0d]">{existing.companyName}</b> : null}
          {existing.companyName && existing.projectName ? ' / ' : null}
          {existing.projectName ? <b className="text-[#0c0c0d]">{existing.projectName}</b> : null} on file for this
          booking. If something there looks wrong, reply to our email and we&rsquo;ll fix it.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-[26px] font-extrabold tracking-tight text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
        Two quick details
      </h1>
      <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
        So we can get your paperwork started, let us know who&rsquo;s booking and what the project is
        called. Takes about ten seconds.
      </p>
      <div className="mt-6">
        <ClientDetailsForm token={token} ask={payload.ask} />
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#f4f1ea] text-[#0c0c0d] flex flex-col"
      style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}
    >
      <header className="bg-[#0c0c0d] text-white px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <span className="font-bold text-[16px]">SirReel</span>
          <span className="text-[#c39a3f] text-[11px] font-semibold tracking-[0.22em] uppercase">Studio Services</span>
        </div>
      </header>
      <main className="flex-1 px-6 py-10">
        <div className="max-w-2xl mx-auto bg-white border border-[#e4dfd4] rounded-2xl p-6 sm:p-8 shadow-sm">
          {children}
        </div>
      </main>
    </div>
  )
}
