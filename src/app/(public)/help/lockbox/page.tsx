import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { SWatermark } from '@/components/site/SWatermark'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import { supportLines } from '@/lib/support/lines'
import { LOCKBOX_PHOTO_PATH, LOCKBOX_STEPS, LOCKBOX_TROUBLESHOOTING } from '@/lib/site/lockboxGuide'

/**
 * Public /help/lockbox — how to open a SirReel vehicle lock box.
 *
 * A static segment, so it wins over /help/[slug] and does not need to be a
 * SetupGuide: that registry is shaped for gear in a case (kit list, placement,
 * aiming, return checklist) and a keypad on a mirror is none of those.
 *
 * Content is src/lib/site/lockboxGuide.ts, the same module AHA's prompt and
 * the MMS caption read, so the page and the assistant cannot drift.
 *
 * NO CODE APPEARS HERE. The page is unauthenticated and in the sitemap; it is
 * the same rule setupGuides.ts states for Wi-Fi passwords. Codes are released
 * one at a time, to a verified person, by AHA.
 */

const ARCHIVO = { fontFamily: 'Archivo, sans-serif' } as const

export const metadata: Metadata = {
  title: 'SirReel · Opening the vehicle lock box',
  description:
    'How to open the lock box on a SirReel vehicle: slide the clear button down, enter your code, push the top button down. Photo, steps and what to try when it will not open.',
  alternates: { canonical: '/help/lockbox' },
}

export default function LockboxHelpPage() {
  const lines = supportLines()
  const smsHref = `sms:${lines.aha.replace(/[^\d+]/g, '')}`

  return (
    <>
      {/* Hero */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <Link
            href="/help"
            className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#8a8272] hover:text-[#6FC3D4] transition-colors"
            style={ARCHIVO}
          >
            ← Help
          </Link>
          <div className="mt-4 text-[12px] font-semibold tracking-[0.22em] uppercase text-[#4DB1C6]" style={ARCHIVO}>
            Vehicle lock box
          </div>
          <h1 className="mt-3 font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px] max-w-[16ch]" style={ARCHIVO}>
            Opening the lock box
          </h1>
          <p className="mt-4 max-w-[58ch] text-[#cfc9bd] text-base leading-relaxed">
            The keys to your SirReel vehicle are in the small keypad box hanging on the mirror or the
            door handle. {LOCKBOX_STEPS}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={smsHref}
              className="inline-flex items-center gap-2 rounded-lg bg-[#4DB1C6] hover:bg-[#6FC3D4] text-[#0c0c0d] font-bold px-5 py-2.5 text-[14px] transition-colors"
              style={ARCHIVO}
            >
              Text AHA {lines.aha}
            </a>
            <a
              href={PUBLIC_CONTACT.phoneHref}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 hover:border-[#4DB1C6] px-5 py-2.5 text-[14px] font-bold transition-colors"
              style={ARCHIVO}
            >
              Call {PUBLIC_CONTACT.phone}
            </a>
          </div>
          <p className="mt-3 text-[13px] text-[#8a8272] max-w-[58ch]">
            AHA is our automated assistant and answers texts at any hour. Don&rsquo;t have your code?
            Text AHA and say which unit you are at — for example &ldquo;Cube 27&rdquo;.
          </p>
        </div>
      </section>

      {/* The three steps + the photo */}
      <section className="bg-[#f6f4ef] text-[#1b1a17]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div>
              <h2 className="font-black tracking-tight text-[26px] sm:text-[34px] leading-tight" style={ARCHIVO}>
                Three steps
              </h2>
              <ol className="mt-7 space-y-7">
                {[
                  {
                    title: 'Slide the clear button DOWN',
                    body: 'It is the wide sliding button in the middle of the keypad. This wipes anything pressed before — yours or the last driver’s — and it has to be done every single time, including after a failed try.',
                  },
                  {
                    title: 'Enter your code',
                    body: 'Press each number until it clicks all the way down. A digit that does not click is the usual reason a correct code does not open the box.',
                  },
                  {
                    title: 'Push the top button DOWN',
                    body: 'The small button above the numbers. Push it down firmly and the front of the box comes away, with the keys inside.',
                  },
                ].map((step, i) => (
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
                      <p className="mt-1.5 text-[14px] leading-relaxed text-[#3d392f] max-w-[46ch]">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <figure className="rounded-2xl border border-[#e2ddd0] bg-white p-3 shadow-sm">
              <Image
                src={LOCKBOX_PHOTO_PATH}
                alt="A SirReel vehicle lock box held up to the door of a truck. An arrow marked PUSH DOWN points to the small button above the number pad; a second arrow marked CLEAR points to the wide sliding button in the middle of the pad."
                width={1320}
                height={1993}
                className="w-full h-auto rounded-lg"
                priority
              />
              <figcaption className="px-1 pt-3 pb-1 text-[13px] leading-relaxed text-[#6d6759]">
                The two buttons that matter: <strong className="text-[#1b1a17]">CLEAR</strong> (slide it
                down first) and the <strong className="text-[#1b1a17]">open</strong> button at the top
                (push it down last).
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="bg-white text-[#1b1a17] border-y border-[#e2ddd0]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-14">
          <div className="text-[12px] font-bold tracking-[0.2em] uppercase text-[#0F7A93]" style={ARCHIVO}>
            If it still will not open
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {LOCKBOX_TROUBLESHOOTING.map((item) => (
              <div key={item.q}>
                <h3 className="text-[15px] font-black leading-snug" style={ARCHIVO}>
                  {item.q}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#3d392f] max-w-[48ch]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reach us */}
      <section className="bg-[#0c0c0d] text-white">
        <div className="max-w-[1200px] mx-auto px-5 py-10 sm:py-12">
          <h2 className="font-black tracking-tight text-[22px] sm:text-[28px]" style={ARCHIVO}>
            Still locked out?
          </h2>
          <p className="mt-3 max-w-[60ch] text-[#cfc9bd] text-[15px] leading-relaxed">
            Text AHA at{' '}
            <a href={smsHref} className="text-[#4DB1C6] hover:text-[#6FC3D4] font-semibold whitespace-nowrap">
              {lines.aha}
            </a>{' '}
            with the unit you are at and what the box is doing — any hour. During office hours
            (weekdays 7:30am&ndash;5:30pm Pacific) you can also call{' '}
            <a href={PUBLIC_CONTACT.phoneHref} className="text-[#4DB1C6] hover:text-[#6FC3D4] font-semibold whitespace-nowrap">
              {PUBLIC_CONTACT.phone}
            </a>
            .
          </p>
        </div>
      </section>
    </>
  )
}
