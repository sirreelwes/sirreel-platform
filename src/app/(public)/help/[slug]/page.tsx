import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SWatermark } from '@/components/site/SWatermark'
import { SETUP_GUIDES, getSetupGuide } from '@/lib/site/setupGuides'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/**
 * Public /help/[slug] — client-facing gear setup guides.
 *
 * Content comes from src/lib/site/setupGuides.ts, which the after-hours
 * assistant also reads, so the page and the assistant never drift apart.
 * Credentials are never rendered here — see the note in that module.
 */

const ARCHIVO = { fontFamily: 'Archivo, sans-serif' } as const

export function generateStaticParams() {
  return SETUP_GUIDES.map((g) => ({ slug: g.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const guide = getSetupGuide(params.slug)
  if (!guide) return { title: 'SirReel · Help' }
  return {
    title: `SirReel · ${guide.title} Setup`,
    description: guide.summary,
    alternates: { canonical: `/help/${params.slug}` },
  }
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const guide = getSetupGuide(params.slug)
  if (!guide) notFound()

  return (
    <>
      {/* Hero */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <Link
            href="/help"
            className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#8a8272] hover:text-[#c39a3f] transition-colors"
            style={ARCHIVO}
          >
            ← Help
          </Link>
          <div className="mt-4 text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f]" style={ARCHIVO}>
            {guide.eyebrow}
          </div>
          <h1
            className="mt-3 font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px]"
            style={ARCHIVO}
          >
            {guide.title}
          </h1>
          <p className="mt-4 max-w-[58ch] text-[#cfc9bd] text-base leading-relaxed">{guide.summary}</p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={guide.pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold px-5 py-2.5 text-[14px] transition-colors"
              style={ARCHIVO}
            >
              Download the one-page PDF
            </a>
            <a
              href={PUBLIC_CONTACT.phoneHref}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 hover:border-[#c39a3f] px-5 py-2.5 text-[14px] font-bold transition-colors"
              style={ARCHIVO}
            >
              Call {PUBLIC_CONTACT.phone}
            </a>
          </div>

          {/* What's in the case */}
          <div className="mt-9 rounded-2xl border border-white/12 bg-white/[0.03] px-5 py-4">
            <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#c39a3f] mb-2.5" style={ARCHIVO}>
              In the case
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px]">
              {guide.kit.map((item) => (
                <li key={item.label} className={item.optional ? 'text-[#8a8272]' : 'text-[#cfc9bd]'}>
                  {item.label}
                  {item.optional && <span className="italic"> (optional — some kits only)</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="bg-[#f6f4ef] text-[#1b1a17]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <h2 className="font-black tracking-tight text-[26px] sm:text-[34px] leading-tight" style={ARCHIVO}>
            Getting online
          </h2>

          <ol className="mt-7 grid gap-7 sm:grid-cols-2">
            {guide.steps.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  className="flex-none grid place-items-center h-9 w-9 rounded-full bg-[#1b1a17] text-white text-[16px] font-black"
                  style={ARCHIVO}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[17px] font-bold leading-snug" style={ARCHIVO}>
                    {step.title}
                  </h3>
                  {step.body.map((p) => (
                    <p key={p} className="mt-1.5 text-[14px] leading-relaxed text-[#3d392f]">
                      {p}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {/* Optional add-on */}
          {guide.addOn && (
            <div className="mt-10 rounded-2xl border-2 border-dashed border-[#c39a3f]/55 bg-[#c39a3f]/[0.07] px-6 py-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <span
                  className="rounded bg-[#c39a3f] text-[#0c0c0d] text-[10px] font-black tracking-[0.14em] uppercase px-2 py-1"
                  style={ARCHIVO}
                >
                  Optional
                </span>
                <h3 className="text-[19px] font-black" style={ARCHIVO}>
                  {guide.addOn.name}
                </h3>
                <span className="text-[13px] italic text-[#6d6759]">{guide.addOn.note}</span>
              </div>
              <div className="mt-5 grid gap-6 sm:grid-cols-3">
                {guide.addOn.points.map((pt, i) => (
                  <div key={pt.title}>
                    <div className="text-[14px] font-bold" style={ARCHIVO}>
                      {i + 1}. {pt.title}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[#3d392f]">{pt.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Placement */}
      <section className="bg-white text-[#1b1a17] border-y border-[#e2ddd0]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-14">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {guide.aim && (
              <div>
                <div className="text-[12px] font-bold tracking-[0.2em] uppercase text-[#c39a3f]" style={ARCHIVO}>
                  {guide.aim.title}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#3d392f] max-w-[34ch]">{guide.aim.body}</p>
              </div>
            )}
            <div>
              <h3 className="text-[15px] font-black text-[#2f7d4f]" style={ARCHIVO}>
                Works great
              </h3>
              <ul className="mt-2.5 space-y-1.5">
                {guide.placement.good.map((g) => (
                  <li key={g} className="text-[14px] leading-relaxed text-[#3d392f] pl-5 relative">
                    <span className="absolute left-0 text-[#2f7d4f] font-bold">✓</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[15px] font-black text-[#a63a30]" style={ARCHIVO}>
                Won&rsquo;t work
              </h3>
              <ul className="mt-2.5 space-y-1.5">
                {guide.placement.bad.map((b) => (
                  <li key={b} className="text-[14px] leading-relaxed text-[#3d392f] pl-5 relative">
                    <span className="absolute left-0 text-[#a63a30] font-bold">×</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Troubleshooting + return */}
      <section className="bg-[#f6f4ef] text-[#1b1a17]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-16 grid gap-10 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <h2 className="font-black tracking-tight text-[26px] sm:text-[32px] leading-tight" style={ARCHIVO}>
              If something&rsquo;s not working
            </h2>
            <dl className="mt-6 divide-y divide-[#e2ddd0] border-t border-[#e2ddd0]">
              {guide.faqs.map((f) => (
                <div key={f.q} className="py-3.5 grid gap-1 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-5">
                  <dt className="text-[14px] font-bold" style={ARCHIVO}>
                    {f.q}
                  </dt>
                  <dd className="text-[14px] leading-relaxed text-[#3d392f]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl bg-[#0c0c0d] text-white p-6 relative overflow-hidden self-start">
            <SWatermark size={200} className="-right-8 -bottom-10 rotate-[-8deg]" />
            <div className="relative">
              <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#c39a3f]" style={ARCHIVO}>
                Before you send it back
              </div>
              <ul className="mt-4 space-y-2.5">
                {guide.returnChecklist.map((c) => (
                  <li key={c} className="text-[13.5px] leading-relaxed text-[#cfc9bd] pl-6 relative">
                    <span className="absolute left-0 top-[3px] h-3 w-3 rounded-[3px] border border-[#6b7280]" />
                    {c}
                  </li>
                ))}
              </ul>
              <p className="mt-5 pt-4 border-t border-white/12 text-[12.5px] leading-relaxed text-[#8a8272]">
                Please don&rsquo;t factory-reset anything or change the Wi-Fi settings — it&rsquo;s tied to the
                SirReel service account. Damage or loss? Call us the same day.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Still need help */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark size={260} className="-right-12 -bottom-16 rotate-[-8deg]" />
        <div className="relative max-w-[1200px] mx-auto px-5 py-10 sm:py-12 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <div className="text-[18px] font-black" style={ARCHIVO}>
              Still stuck on location?
            </div>
            <p className="text-[13.5px] text-[#cfc9bd] mt-1 max-w-[52ch]">
              Our 24/7 line is the fastest way to reach someone — or ask the assistant on the{' '}
              <Link href="/help" className="text-[#c39a3f] hover:text-[#d4a547] font-semibold">
                help page
              </Link>
              .
            </p>
          </div>
          <a
            href={PUBLIC_CONTACT.phoneHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold px-5 py-2.5 text-[14px] whitespace-nowrap transition-colors"
            style={ARCHIVO}
          >
            Call {PUBLIC_CONTACT.phone}
          </a>
        </div>
      </section>
    </>
  )
}
