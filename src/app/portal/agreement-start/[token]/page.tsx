import { prisma } from '@/lib/prisma'
import { AgreementStartForm } from '@/components/site/AgreementStartForm'

/**
 * /portal/agreement-start/[token] — the Branch C "new job" form from the
 * agreement-entry email. GET performs ZERO writes (mail scanners prefetch
 * links); the client's SUBMIT is the create action, handled by
 * POST /api/public/agreement-start/[token] which routes Job+Order creation
 * through the same idempotent WelcomeInvite click-to-create path. The token
 * is the identity — no sign-in. Already-used tokens still render the form
 * shell; submit resolves them straight to the existing job's links.
 */

export const dynamic = 'force-dynamic'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f3', fontFamily: 'Helvetica, Arial, sans-serif' }} className="flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[560px] bg-white rounded-2xl shadow-sm overflow-hidden border border-black/5">
        <div style={{ background: '#0a0a0a' }} className="px-8 pt-8 pb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sirreel-logo-white.png" alt="SirReel Studio Services" className="h-9 w-auto inline-block" />
        </div>
        <div className="px-8 py-7">{children}</div>
      </div>
    </div>
  )
}

export default async function AgreementStartPage({ params }: { params: { token: string } }) {
  const token = params.token || ''
  const entry = token
    ? await prisma.agreementEntry.findUnique({
        where: { token },
        select: { kind: true, expiresAt: true, usedAt: true, createdInquiryId: true },
      })
    : null

  const valid =
    entry &&
    entry.kind === 'START_NEW' &&
    (entry.createdInquiryId !== null || entry.usedAt !== null || entry.expiresAt >= new Date())

  if (!valid) {
    return (
      <Shell>
        <h1 className="text-[20px] font-serif text-[#1a1a1a] m-0">This link isn&rsquo;t valid anymore.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#555]">
          Request a fresh one from the rental agreement page, or call us at (888) 477-7335.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-[22px] font-serif text-[#1a1a1a] m-0">Tell us about the job.</h1>
      <p className="mt-2 mb-6 text-[13.5px] leading-relaxed text-[#555]">
        One short form — then your rental agreement is ready to sign and you can start building
        your order.
      </p>
      <AgreementStartForm token={token} />
    </Shell>
  )
}
