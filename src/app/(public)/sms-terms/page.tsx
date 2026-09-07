import type { Metadata } from 'next'
import Link from 'next/link'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/**
 * Public /sms-terms — the SMS program terms carriers require.
 *
 * Twilio's toll-free verification (2026-09-07) asks for a terms-and-
 * conditions link that describes the program, how people opt in, message
 * frequency, STOP/HELP, and the data-rates disclosure. Everything on this
 * page is read by carrier reviewers; keep the program description honest
 * and narrow — SirReel texts about bookings, not marketing (Wes: "drivers
 * and clients in non-normal situations — last-minute changes").
 */

export const metadata: Metadata = {
  title: 'SirReel · Text Message Terms',
  description: 'Terms for text messages from SirReel Studio Services: what we send, how you opt in and out, message frequency and rates.',
  alternates: { canonical: '/sms-terms' },
}

const EFFECTIVE = 'September 7, 2026'
const H2 = 'text-[20px] sm:text-[22px] font-black tracking-tight mt-10 mb-3'
const P = 'text-[15px] leading-relaxed text-[#3d392f] mb-4'
const LI = 'text-[15px] leading-relaxed text-[#3d392f]'

export default function SmsTermsPage() {
  return (
    <section className="bg-[#f6f4ef] text-[#0c0c0d]">
      <div className="max-w-[820px] mx-auto px-5 py-14 sm:py-20">
        <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#0F7A93] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Legal
        </div>
        <h1 className="font-black tracking-tight text-[34px] sm:text-[44px] leading-[1.05]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Text Message Terms
        </h1>
        <p className="mt-3 text-[14px] text-[#8b857a]">Effective {EFFECTIVE}</p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>The program</h2>
        <p className={P}>
          SirReel Studio Services (SirReel Production Vehicles, Inc.) sends text messages about rentals you or your
          production have booked with us. Messages are operational, not promotional: booking confirmations, day-of
          logistics such as a changed call time, delivery address or pickup window, a link to your booking or driver
          page, and replies to questions you text us. We do not send marketing texts.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>How you opt in</h2>
        <ul className="list-disc pl-5 space-y-2 mb-4">
          <li className={LI}>By entering your mobile number and checking the box &ldquo;OK to text this number about my booking&rdquo; in the SirReel client portal, on a partner booking page, or on a SirReel form.</li>
          <li className={LI}>By texting <strong>START</strong> to our number.</li>
          <li className={LI}>By asking a SirReel team member, in writing, to text you about your booking.</li>
        </ul>
        <p className={P}>Consent to receive text messages is not a condition of renting from SirReel.</p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Frequency and rates</h2>
        <p className={P}>
          <strong>Message frequency varies</strong> and depends on your booking; most rentals involve a few messages
          around the rental dates. <strong>Message and data rates may apply.</strong> Check with your carrier for
          details of your plan.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Opting out and help</h2>
        <p className={P}>
          Reply <strong>STOP</strong> to any message to stop receiving texts from us. You will receive one message
          confirming you have opted out, and no further texts unless you opt in again. Reply <strong>HELP</strong>{' '}
          for help, or contact us at <a href={PUBLIC_CONTACT.emailHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.email}</a>{' '}
          or <a href={PUBLIC_CONTACT.phoneHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.phone}</a>.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Your number</h2>
        <p className={P}>
          Mobile numbers and opt-in information are used only to send the messages described here and are never shared
          with or sold to third parties or affiliates for their marketing purposes. See our{' '}
          <Link href="/privacy" className="text-[#0F7A93] underline underline-offset-2">Privacy Policy</Link>.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Carriers</h2>
        <p className={P}>
          Carriers are not liable for delayed or undelivered messages. Supported carriers include the major US
          carriers; delivery depends on your carrier and device.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Contact</h2>
        <p className={P}>
          {PUBLIC_CONTACT.entity}<br />
          {PUBLIC_CONTACT.address}<br />
          <a href={PUBLIC_CONTACT.emailHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.email}</a> &middot;{' '}
          <a href={PUBLIC_CONTACT.phoneHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.phone}</a>
        </p>
      </div>
    </section>
  )
}
