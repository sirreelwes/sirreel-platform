import type { Metadata } from 'next'
import Link from 'next/link'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/**
 * Public /privacy — the privacy policy sirreel.com never had.
 *
 * Written 2026-09-07 because Twilio's toll-free verification requires a
 * linked privacy policy that (1) states mobile numbers and SMS consent are
 * never shared with third parties for marketing, (2) notes message
 * frequency, and (3) carries the "message and data rates may apply"
 * disclosure. Those three sentences live in the "Text messages" section
 * and must stay — carriers read this page. The SMS-specific terms are at
 * /sms-terms; this page links to them.
 *
 * Plain page, no CMS. Entity name appears here because this is legal text
 * (the one place "SirReel Production Vehicles, Inc." is allowed client-side).
 */

export const metadata: Metadata = {
  title: 'SirReel · Privacy Policy',
  description: 'How SirReel Studio Services collects, uses and protects the information you share with us, including mobile numbers used for text messages.',
  alternates: { canonical: '/privacy' },
}

const EFFECTIVE = 'September 7, 2026'

const H2 = 'text-[20px] sm:text-[22px] font-black tracking-tight mt-10 mb-3'
const P = 'text-[15px] leading-relaxed text-[#3d392f] mb-4'
const LI = 'text-[15px] leading-relaxed text-[#3d392f]'

export default function PrivacyPage() {
  return (
    <section className="bg-[#f6f4ef] text-[#0c0c0d]">
      <div className="max-w-[820px] mx-auto px-5 py-14 sm:py-20">
        <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#0F7A93] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Legal
        </div>
        <h1 className="font-black tracking-tight text-[34px] sm:text-[44px] leading-[1.05]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Privacy Policy
        </h1>
        <p className="mt-3 text-[14px] text-[#8b857a]">Effective {EFFECTIVE}</p>

        <p className={`${P} mt-8`}>
          SirReel Studio Services (SirReel Production Vehicles, Inc., &ldquo;SirReel&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
          rents production vehicles, stages and equipment to film, television and commercial productions. This policy
          explains what we collect from the people we work with, why, and what we do with it.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>What we collect</h2>
        <ul className="list-disc pl-5 space-y-2 mb-4">
          <li className={LI}><strong>Contact details</strong> &mdash; name, company, email address, phone and mobile number, and mailing address, when you request a quote, book with us, sign an agreement, or work with us as a vendor or driver.</li>
          <li className={LI}><strong>Booking details</strong> &mdash; the production, dates, locations, vehicles and equipment involved, and the paperwork that goes with a rental: agreements, certificates of insurance, and driver licence images where a driver operates our vehicle.</li>
          <li className={LI}><strong>Payment details</strong> &mdash; card information is entered into and stored by our payment processor, never on our systems. We keep the last four digits and the authorization record.</li>
          <li className={LI}><strong>Site usage</strong> &mdash; standard server logs (IP address, browser, pages visited) when you use sirreel.com or our client portal.</li>
        </ul>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>How we use it</h2>
        <p className={P}>
          To quote, book, deliver, support and invoice rentals; to send the paperwork a rental requires; to reach you
          about the rental itself, including changes on the day; to comply with law and our insurers; and to run and
          secure our systems. We do not sell personal information.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Text messages</h2>
        <p className={P}>
          If you give us a mobile number and agree to receive text messages, we may text you about your booking:
          confirmations, day-of logistics such as a changed call time or address, and replies to a question you
          text us. Messages are sent only in connection with a rental you or your production has with us.
        </p>
        <p className={P}>
          <strong>Message frequency varies</strong> with your booking and is typically a few messages around each
          rental. <strong>Message and data rates may apply.</strong> Reply <strong>STOP</strong> to any message to
          stop receiving texts, and <strong>HELP</strong> for help. Consent to receive texts is not a condition of
          renting from us.
        </p>
        <p className={P}>
          <strong>Mobile numbers and text-message opt-in information are never shared with or sold to third
          parties or affiliates for their marketing purposes.</strong> They are used only by SirReel and the
          service providers that deliver our messages on our behalf. Full terms are at{' '}
          <Link href="/sms-terms" className="text-[#0F7A93] underline underline-offset-2">sirreel.com/sms-terms</Link>.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Who we share it with</h2>
        <p className={P}>
          Service providers who act for us and only as needed to do so: our payment processor, email and text-message
          delivery services, cloud hosting, and our insurers and legal advisers. Vehicle partners and their drivers
          receive the location and timing details a delivery requires, and nothing more. We may disclose information
          when the law requires it.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Retention and security</h2>
        <p className={P}>
          We keep booking records for as long as needed for our business, tax and insurance obligations. Access is
          limited to staff who need it, and data in transit and at rest is encrypted.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Your choices</h2>
        <p className={P}>
          You can ask us to correct or delete your contact details, opt out of text messages at any time by replying
          STOP, and ask what we hold about you. California residents have the rights described in the CCPA, and we
          honour them on request.
        </p>

        <h2 className={H2} style={{ fontFamily: 'Archivo, sans-serif' }}>Contact</h2>
        <p className={P}>
          {PUBLIC_CONTACT.entity}<br />
          {PUBLIC_CONTACT.address}<br />
          <a href={PUBLIC_CONTACT.emailHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.email}</a> &middot;{' '}
          <a href={PUBLIC_CONTACT.phoneHref} className="text-[#0F7A93] underline underline-offset-2">{PUBLIC_CONTACT.phone}</a>
        </p>
        <p className="text-[13px] text-[#8b857a] mt-8">
          We may update this policy; the effective date above changes when we do.
        </p>
      </div>
    </section>
  )
}
