/**
 * /vendor/account/[token]/hq — "See what HQ can do for you."
 *
 * Wes 2026-09-05: the link at the bottom of the partner portal, leading
 * to the white-label HQ (by VerMar Design) a partner can subscribe to.
 * Reached only from the partner page, gated by the same token, noindex.
 * If they already have a workspace it becomes the way back in.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarDays, ClipboardList, FileSignature, Truck, UserRound, Users } from 'lucide-react'
import { vendorByToken } from '@/lib/sub-rentals/vendorAccountActions'
import { prisma } from '@/lib/prisma'
import { workspaceLinkForVendor } from '@/lib/hq-white-label/workspace'
import { HQ_PITCH, HQ_PLANS, HQ_PRODUCT } from '@/lib/hq-white-label/product'
import { StartHqTrialForm } from '@/components/hq-white-label/StartHqTrialForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: `See what ${HQ_PRODUCT.name} can do for you`, robots: { index: false, follow: false } }

const ICONS = [CalendarDays, ClipboardList, Truck, Users, UserRound, FileSignature]

export default async function HqLandingPage({ params }: { params: { token: string } }) {
  const v = await vendorByToken(params.token)
  if (!v) notFound()
  const [vendor, ws] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: v.id }, select: { contactName: true, email: true, _count: { select: { subcontractedVehicles: true, subRentals: true } } } }),
    workspaceLinkForVendor(v.id),
  ])
  const accent = HQ_PRODUCT.defaultAccent
  const back = `/vendor/account/${params.token}`

  return (
    <div className="bg-[#f6f4ef] min-h-screen" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <div className="max-w-[880px] mx-auto px-5 py-10">
        <a href={back} className="text-[13px] font-semibold text-[#6b6560] no-underline hover:text-[#111]">← Your partner page</a>

        <section className="mt-6 rounded-[18px] text-white px-7 py-9 sm:px-10 sm:py-12" style={{ background: accent }}>
          <div className="text-[11px] font-bold uppercase tracking-[2.5px] opacity-80">{HQ_PRODUCT.name}</div>
          <h1 className="mt-3 text-[30px] sm:text-[40px] font-black leading-[1.05] tracking-tight">See what {HQ_PRODUCT.name} can do for you.</h1>
          <p className="mt-4 text-[16px] sm:text-[18px] leading-relaxed opacity-90 max-w-[56ch]">
            The fleet system SirReel uses, for your own fleet — every unit you own on one calendar, your own productions booked
            beside the ones that come through partners, and nothing of anyone else&rsquo;s branding on it.
          </p>
          {ws ? (
            <a href={ws.url} className="inline-flex mt-7 items-center justify-center rounded-lg bg-white px-5 py-3 text-[15px] font-bold no-underline" style={{ color: accent }}>
              Open your {HQ_PRODUCT.name} →
            </a>
          ) : (
            <a href="#start" className="inline-flex mt-7 items-center justify-center rounded-lg bg-white px-5 py-3 text-[15px] font-bold no-underline" style={{ color: accent }}>
              Start your free {HQ_PRODUCT.trialDays}-day trial
            </a>
          )}
        </section>

        {vendor && (vendor._count.subcontractedVehicles > 0 || vendor._count.subRentals > 0) && (
          <p className="mt-6 text-[14px] text-[#5a554c] max-w-[64ch]">
            Your workspace starts already filled in: the {vendor._count.subcontractedVehicles} unit{vendor._count.subcontractedVehicles === 1 ? '' : 's'} on file with SirReel and every SirReel booking on them are on your calendar from the first minute. Add the rest of your fleet and your own productions from there.
          </p>
        )}

        <div className="mt-8 grid sm:grid-cols-2 gap-4">
          {HQ_PITCH.map((p, i) => {
            const Icon = ICONS[i] ?? Truck
            return (
              <div key={p.title} className="bg-white border border-[#e2ddd0] rounded-[14px] p-5">
                <Icon className="w-5 h-5" style={{ color: accent }} />
                <div className="mt-3 text-[16px] font-bold text-[#111]">{p.title}</div>
                <p className="mt-1.5 text-[14px] text-[#5a554c] leading-relaxed">{p.body}</p>
              </div>
            )
          })}
        </div>

        <h2 className="mt-10 text-[11px] font-bold uppercase tracking-[1.6px] text-[#8a8272]">Plans</h2>
        <div className="mt-3 grid sm:grid-cols-2 gap-4">
          {HQ_PLANS.map((p) => (
            <div key={p.key} className="bg-white border border-[#e2ddd0] rounded-[14px] p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[18px] font-black text-[#111]">{p.name}</div>
                <div className="text-[13px] font-semibold text-[#5a554c]">{p.monthlyUsd == null ? 'Pricing soon' : `$${p.monthlyUsd}/mo`}</div>
              </div>
              <p className="mt-1 text-[14px] text-[#5a554c]">{p.blurb}</p>
              <ul className="mt-3 space-y-1.5 text-[14px] text-[#111]">
                {p.includes.map((f) => <li key={f} className="flex gap-2"><span style={{ color: accent }}>✓</span>{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-[#8a8272]">
          Every trial starts on Starter, free for {HQ_PRODUCT.trialDays} days, no card. Pricing is announced before a trial ends — nobody is charged without saying yes first.
        </p>

        {!ws && (
          <section id="start" className="mt-10 bg-white border border-[#e2ddd0] rounded-[18px] p-6 sm:p-8">
            <h2 className="text-[22px] font-black text-[#111] tracking-tight">Start your workspace</h2>
            <p className="mt-1.5 text-[14px] text-[#5a554c]">It&rsquo;s set up under <strong>{v.name}</strong>. We&rsquo;ll email you the link, and open it right away.</p>
            <div className="mt-5">
              <StartHqTrialForm token={params.token} initial={{ name: vendor?.contactName ?? '', email: vendor?.email ?? '' }} trialDays={HQ_PRODUCT.trialDays} accent={accent} />
            </div>
          </section>
        )}

        <p className="mt-10 text-[12px] text-[#8a8272]">
          {HQ_PRODUCT.name} is built and billed by {HQ_PRODUCT.maker}, a separate company; SirReel is one of its customers. Your workspace is yours: SirReel sees only the units you offer them and the bookings they place, exactly as today.
        </p>
      </div>
    </div>
  )
}
