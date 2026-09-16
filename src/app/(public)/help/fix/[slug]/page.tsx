import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SWatermark } from '@/components/site/SWatermark'
import { getTopic, listTopics } from '@/lib/assistant/topics'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import { smsNumberDisplay } from '@/lib/sms/number'

/**
 * Public troubleshooting page — the link AHA sends when it walks someone
 * through a failure on the truck.
 *
 * Content comes from the SAME source AHA reads (editable topics, falling
 * back to the built-in registry), so the page and the assistant can never
 * disagree about a step. `openQuestions` is deliberately not rendered: it
 * is fleet's to-do list, not something a client on a dark street should be
 * reading.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTopic(params.slug)
  if (!t) return { title: 'SirReel · Help' }
  return {
    title: `SirReel · ${t.title}`,
    description: t.summary,
    alternates: { canonical: `/help/fix/${t.slug}` },
  }
}

export default async function FixPage({ params }: { params: { slug: string } }) {
  const t = await getTopic(params.slug)
  if (!t) notFound()
  const others = (await listTopics()).filter((o) => o.slug !== t.slug)

  return (
    <>
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[820px] mx-auto px-5 py-10 sm:py-14">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#4DB1C6] mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {t.eyebrow}
          </div>
          <h1 className="font-black tracking-tight leading-[1.0] text-[34px] sm:text-[46px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {t.title}
          </h1>
          <p className="mt-3 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">{t.summary}</p>
          <p className="mt-4 text-[13.5px] text-[#cfc9bd]">
            Stuck at any point? Text AHA at{' '}
            <span className="text-[#4DB1C6] font-semibold whitespace-nowrap">{smsNumberDisplay()}</span> any hour.
          </p>
        </div>
      </section>

      {/* Stop conditions come BEFORE the steps on purpose — someone skimming
          on a phone in the dark should hit the danger list first. */}
      {t.stopIf.length > 0 && (
        <section className="bg-[#fdf3f3] text-[#1b1a17] border-b border-[#f0d7d7]">
          <div className="max-w-[820px] mx-auto px-5 py-7">
            <h2 className="text-[15px] font-black" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Stop and call us straight away if
            </h2>
            <ul className="mt-2.5 grid gap-1.5">
              {t.stopIf.map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-snug text-[#5d1f1f]">
                  <span aria-hidden className="mt-[7px] h-[6px] w-[6px] shrink-0 rotate-45 bg-[#b03030]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-[#6d4a4a]">
              Don&apos;t keep trying things. Call{' '}
              <a href={PUBLIC_CONTACT.phoneHref} className="font-semibold text-[#0C657A]">{PUBLIC_CONTACT.phone}</a>{' '}
              during business hours, or text AHA any hour and it will reach our on-call team.
            </p>
          </div>
        </section>
      )}

      <section className="bg-white text-[#1b1a17]">
        <div className="max-w-[820px] mx-auto px-5 py-10">
          <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Try these, in order
          </h2>
          <ol className="mt-5 grid gap-5">
            {t.checks.map((c, i) => (
              <li key={c.title} className="flex gap-4">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#0F7A93] text-[13px] font-black text-white"
                  style={{ fontFamily: 'Archivo, sans-serif' }}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[16px] font-bold leading-snug" style={{ fontFamily: 'Archivo, sans-serif' }}>{c.title}</h3>
                  {c.body && <p className="mt-1 text-[14.5px] leading-relaxed text-[#3d392f]">{c.body}</p>}
                </div>
              </li>
            ))}
          </ol>

          {t.tellUs.length > 0 && (
            <div className="mt-9 rounded-2xl border border-[#e2ddd0] bg-[#f6f4ef] p-5">
              <h2 className="text-[15px] font-black" style={{ fontFamily: 'Archivo, sans-serif' }}>
                When you call or text us, have this ready
              </h2>
              <ul className="mt-2.5 grid gap-1.5">
                {t.tellUs.map((line) => (
                  <li key={line} className="flex gap-2.5 text-[14px] leading-snug text-[#3d392f]">
                    <span aria-hidden className="mt-[7px] h-[6px] w-[6px] shrink-0 rotate-45 bg-[#0F7A93]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {others.length > 0 && (
            <div className="mt-9 border-t border-[#e2ddd0] pt-6">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#0F7A93]">Other guides</div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {others.map((o) => (
                  <Link
                    key={o.slug}
                    href={`/help/fix/${o.slug}`}
                    className="rounded-full border border-[#e2ddd0] px-3.5 py-1.5 text-[13px] font-semibold text-[#1b1a17] hover:border-[#0F7A93] hover:text-[#0C657A]"
                  >
                    {o.title}
                  </Link>
                ))}
                <Link href="/help" className="rounded-full border border-[#e2ddd0] px-3.5 py-1.5 text-[13px] font-semibold text-[#1b1a17] hover:border-[#0F7A93] hover:text-[#0C657A]">
                  All help
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
