/**
 * /portal/company — the door into the account portal.
 *
 * Three outcomes, and each one has to say something useful rather than
 * bounce:
 *   • not signed in     → the standard portal sign-in, returning here
 *   • signed in, 0 grants → an honest explanation. This is the common
 *     case for a client who has a job portal but no account access, and
 *     "404" would read as a broken link they were sent in good faith.
 *   • 1 grant  → straight through
 *   • 2+ grants → a picker. Rare but real: an executive who works across
 *     two banners under the same email.
 */

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, ArrowRight } from 'lucide-react'
import { PERSON_SESSION_COOKIE } from '@/lib/portal/personSession'
import {
  listCompanyPortalGrants,
  COMPANY_PORTAL_ROLE_LABEL,
} from '@/lib/portal/companyPortal'
import { PORTAL } from '@/lib/brand/portalTokens'

export const dynamic = 'force-dynamic'

export default async function CompanyPortalIndexPage({
  searchParams,
}: {
  searchParams?: { next?: string }
}) {
  const { signedIn, personName, grants } = await listCompanyPortalGrants(
    cookies().get(PERSON_SESSION_COOKIE)?.value,
  )

  // Only our own company paths ride along — never an arbitrary URL.
  const next =
    typeof searchParams?.next === 'string' && /^\/portal\/company\/[A-Za-z0-9-]+$/.test(searchParams.next)
      ? searchParams.next
      : null

  if (!signedIn) redirect(`/portal/auth/sign-in?next=${encodeURIComponent(next ?? '/portal/company')}`)
  if (next && grants.some((g) => next.startsWith(`/portal/company/${g.companyId}`))) redirect(next)
  if (grants.length === 1) redirect(`/portal/company/${grants[0].companyId}`)

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
          <div
            className="mt-3 text-[10px] uppercase font-semibold"
            style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}
          >
            Account portal
          </div>
          <h1 className="mt-1 text-white text-[26px] font-display leading-tight tracking-tight">
            {grants.length === 0 ? `Hi ${personName.split(' ')[0] || 'there'}.` : 'Choose an account'}
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        {grants.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-6">
            <p className="text-sm text-zinc-700 leading-relaxed">
              You&apos;re signed in as <span className="font-medium">{personName}</span>, but this
              email doesn&apos;t have account-level access to a production company yet.
            </p>
            <p className="text-sm text-zinc-600 leading-relaxed mt-3">
              Account access shows every show your company has with SirReel, the standing
              agreement and the invoices — it&apos;s issued by your SirReel rep. Ask them to turn
              it on, or email{' '}
              <a href="mailto:info@sirreel.com" className="underline text-zinc-900">
                info@sirreel.com
              </a>
              .
            </p>
            <Link
              href="/portal/account"
              className="inline-flex items-center gap-1.5 mt-5 text-sm font-semibold text-zinc-900 hover:text-black"
            >
              Go to your jobs <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {grants.map((g) => (
              <Link
                key={g.accessId}
                href={`/portal/company/${g.companyId}`}
                className="flex items-center gap-3 bg-white border border-zinc-200 rounded-xl p-4 hover:border-zinc-400 transition-colors"
              >
                <Building2 className="w-5 h-5 text-zinc-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{g.companyName}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {COMPANY_PORTAL_ROLE_LABEL[g.role]} access
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
