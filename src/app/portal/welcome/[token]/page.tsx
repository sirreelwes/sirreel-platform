import { prisma } from '@/lib/prisma'
import { WELCOME_CTA_LABEL } from '@/lib/sales/welcomeEmail'

/**
 * /portal/welcome/[token] — the "Get Paperwork Started" landing page from the
 * Welcome / Job Begin email.
 *
 * GET (this page) performs ZERO writes — deliberately. Corporate mail
 * scanners (Outlook SafeLinks etc.) prefetch GET links, and Wes's rule is
 * that the Job is created only by the CLIENT's click. So this page just
 * validates the token and shows one button; pressing it POSTs to
 * /api/portal/welcome/[token]/start, which mints Job + Order + portal access
 * in one idempotent transaction and 303s into the job portal. The token IS
 * the identity — no sign-in screen anywhere.
 *
 * States: valid → button; already used → "Open your portal" (same button,
 * resolves to the same job); expired/invalid → friendly message, never a 500.
 */

export const dynamic = 'force-dynamic'

const DARK = '#0a0a0a'
const GOLD = '#D4A547'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f3', fontFamily: 'Helvetica, Arial, sans-serif' }} className="flex items-center justify-center px-4">
      <div className="w-full max-w-[520px] bg-white rounded-2xl shadow-sm overflow-hidden border border-black/5">
        <div style={{ background: DARK }} className="px-8 pt-9 pb-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sirreel-logo-white.png" alt="SirReel Studio Services" className="h-9 w-auto inline-block" />
          <div style={{ color: GOLD }} className="mt-4 text-[10px] font-semibold uppercase tracking-[0.25em]">Presents</div>
          <div className="mt-1 text-white text-[28px] font-light tracking-[6px]">TSX</div>
        </div>
        <div className="px-8 py-8 text-center">{children}</div>
      </div>
    </div>
  )
}

export default async function WelcomeLandingPage({ params }: { params: { token: string } }) {
  const token = params.token || ''
  const invite = token
    ? await prisma.welcomeInvite.findUnique({
        where: { token },
        select: {
          expiresAt: true,
          usedAt: true,
          createdJobId: true,
          person: { select: { firstName: true } },
          inquiry: { select: { title: true } },
        },
      })
    : null

  if (!invite) {
    return (
      <Shell>
        <h1 className="text-[20px] font-serif text-[#1a1a1a] m-0">This link isn&rsquo;t valid anymore.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#555]">
          It may have been replaced by a newer invite. Reply to your SirReel rep&rsquo;s email and
          they&rsquo;ll send a fresh one — or call us at (888) 477-7335.
        </p>
      </Shell>
    )
  }

  const used = Boolean(invite.usedAt || invite.createdJobId)
  const expired = !used && invite.expiresAt < new Date()

  if (expired) {
    return (
      <Shell>
        <h1 className="text-[20px] font-serif text-[#1a1a1a] m-0">This link has expired.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#555]">
          Welcome links are good for 7 days. Contact your SirReel rep and they&rsquo;ll send a fresh
          one — or call us at (888) 477-7335.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-[22px] font-serif text-[#1a1a1a] m-0">
        {used ? 'Welcome back' : `Welcome${invite.person.firstName ? `, ${invite.person.firstName}` : ''}`}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[#555]">
        {used ? (
          <>Your portal for <strong>{invite.inquiry.title}</strong> is ready — pick up right where you left off.</>
        ) : (
          <>One click sets up your job portal for <strong>{invite.inquiry.title}</strong> — paperwork, schedule and equipment, all in one place.</>
        )}
      </p>
      {/* Plain form POST → the start route mints (first click) or resolves
          (every later click) and 303s into the portal. No JS, no sign-in. */}
      <form method="POST" action={`/api/portal/welcome/${encodeURIComponent(token)}/start`} className="mt-7">
        <button
          type="submit"
          style={{ background: GOLD, color: '#1a1a1a' }}
          className="inline-block font-semibold text-[15px] px-8 py-3.5 rounded-lg border-0 cursor-pointer hover:opacity-90"
        >
          {used ? 'Open your portal →' : `${WELCOME_CTA_LABEL} →`}
        </button>
      </form>
      <p className="mt-5 text-[11px] text-[#999]">Your progress saves automatically — come back any time.</p>
    </Shell>
  )
}
