/**
 * VerMar Design's control plane for HQ — the white-label product the
 * partners subscribe to. Its own route group so the SirReel staff shell
 * never wraps it: no SirReel nav, no SirReel tokens' meaning, no SirReel
 * role. Wes 2026-09-05: "the control of other HQs should lie with VerMar
 * Design and not within SirReel."
 *
 * Gate: signed in (the same Google login this host runs) AND on the
 * VerMar operator allowlist. Anyone else gets a 404 — this tree is not
 * advertised anywhere in SirReel's HQ.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth-admin'
import { isVerMarOperator } from '@/lib/hq-white-label/operator'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: `${HQ_PRODUCT.maker} · ${HQ_PRODUCT.name} operations`, robots: { index: false, follow: false } }

export default async function VerMarLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user || !isVerMarOperator(user.email)) notFound()
  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] antialiased" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <header className="bg-[#111827] text-white">
        <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[16px] font-black tracking-tight">{HQ_PRODUCT.maker}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[1.6px] text-white/60">{HQ_PRODUCT.name} operations</span>
          </div>
          <div className="text-[12px] text-white/70">{user.email}</div>
        </div>
      </header>
      <main className="max-w-[960px] mx-auto px-4 sm:px-6 py-6">{children}</main>
      <footer className="max-w-[960px] mx-auto px-4 sm:px-6 py-8 text-[12px] text-[#6b7280]">
        {HQ_PRODUCT.maker} · internal. Partners are VerMar&rsquo;s customers; nothing on this page is visible from SirReel HQ.
      </footer>
    </div>
  )
}
