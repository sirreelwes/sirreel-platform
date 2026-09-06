/**
 * /hq/[token] — a partner's OWN HQ. The white-label shell.
 *
 * Wes 2026-09-05: "a simplified version of SirReel's HQ that they can
 * subscribe to — paying VerMar Design."
 *
 * Its own route group so nothing of SirReel's wraps it: no public-site
 * nav, no footer, no assistant widget, none of the staff shell. The
 * partner's mark and accent, the product's name, and VerMar's in the
 * footer. The token in the URL is the login, the same contract as every
 * other partner-facing page here.
 *
 * A signed-in VerMar operator who opens a partner's link gets a support
 * ribbon and does NOT bump the partner's open counter. SirReel staff get
 * no such thing: the product is VerMar's to support, not SirReel's (Wes
 * 2026-09-05), and a SirReel login holding the link is just a visitor.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadWorkspaceByToken } from '@/lib/hq-white-label/workspace'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'
import { isVerMarOperator } from '@/lib/hq-white-label/operator'
import { HqNav } from '@/components/hq-white-label/HqNav'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const ws = await loadWorkspaceByToken(params.token)
  return { title: ws ? `${ws.brandName} · ${HQ_PRODUCT.name}` : HQ_PRODUCT.name, robots: { index: false, follow: false } }
}

async function viewerIsVerMar(): Promise<boolean> {
  const session = await getServerSession(authOptions).catch(() => null)
  return isVerMarOperator(session?.user?.email)
}

export default async function HqLayout({ children, params }: { children: React.ReactNode; params: { token: string } }) {
  const support = await viewerIsVerMar()
  const ws = await loadWorkspaceByToken(params.token, { stamp: !support })
  if (!ws) notFound()
  const base = `/hq/${params.token}`
  const trialEnds = ws.trialEndsAt ? new Date(ws.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] antialiased" style={{ ['--hq-accent' as string]: ws.accentColor, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      {support && (
        <div className="bg-[#111827] text-white text-[12px] px-4 py-1.5 text-center">
          {HQ_PRODUCT.maker} support view of <strong>{ws.vendorName}</strong>&rsquo;s workspace — this open isn&rsquo;t counted, and everything you change here is real.
        </div>
      )}
      <header className="bg-white border-b border-[#e3e6ea]">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3.5">
            <a href={base} className="flex items-center gap-3 min-w-0 no-underline">
              {ws.hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/public/vendor-hq/${params.token}/logo`} alt={ws.brandName} className="block h-8 max-w-[180px] object-contain" />
              ) : (
                <span className="w-8 h-8 rounded-lg grid place-items-center text-white font-black text-[15px]" style={{ background: ws.accentColor }}>{ws.brandName.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="min-w-0">
                <span className="block text-[16px] font-bold tracking-tight truncate">{ws.brandName}</span>
                <span className="block text-[11px] font-semibold uppercase tracking-[1.6px] text-[#6b7280]">{HQ_PRODUCT.name}</span>
              </span>
            </a>
            <div className="text-right text-[12px] text-[#6b7280] hidden sm:block">
              {ws.status === 'TRIAL' && trialEnds && (
                <span>
                  Free trial{ws.trialDaysLeft != null && ws.trialDaysLeft >= 0 ? ` · ${ws.trialDaysLeft} day${ws.trialDaysLeft === 1 ? '' : 's'} left` : ' ended'}
                </span>
              )}
              {ws.status === 'ACTIVE' && <span>{ws.plan === 'PRO' ? 'Pro' : 'Starter'} plan</span>}
            </div>
          </div>
          {ws.open && (
            <div className="pb-2">
              <HqNav base={base} />
            </div>
          )}
        </div>
      </header>

      {!ws.open ? (
        <main className="max-w-[640px] mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-[24px] font-bold tracking-tight">This workspace is closed</h1>
          <p className="mt-2 text-[15px] text-[#4b5563]">
            {ws.status === 'PAST_DUE' ? 'The subscription is past due.' : 'The subscription has ended.'} Your bookings, fleet and clients are kept safe. Write to{' '}
            <a href={`mailto:${HQ_PRODUCT.supportEmail}`} className="font-semibold underline">{HQ_PRODUCT.supportEmail}</a> to pick up where you left off.
          </p>
        </main>
      ) : (
        <>
          {ws.trialExpired && (
            <div className="bg-[#fff7e0] border-b border-[#f0dfa0] text-[#5a4300] text-[13px] px-4 py-2 text-center">
              Your free trial ended {trialEnds}. Everything still works — {HQ_PRODUCT.maker} will be in touch about a subscription, or write to <a href={`mailto:${HQ_PRODUCT.supportEmail}`} className="font-semibold underline">{HQ_PRODUCT.supportEmail}</a>.
            </div>
          )}
          <main>{children}</main>
        </>
      )}

      <footer className="max-w-[1080px] mx-auto px-4 sm:px-6 py-10 text-[12px] text-[#6b7280] flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong className="text-[#4b5563]">{HQ_PRODUCT.name}</strong> by {HQ_PRODUCT.maker} · {HQ_PRODUCT.tagline}
        </span>
        <a href={`mailto:${HQ_PRODUCT.supportEmail}`} className="hover:text-[#111827]">{HQ_PRODUCT.supportEmail}</a>
      </footer>
    </div>
  )
}
