/**
 * Public /payment-info — "Payments made simple." (Wes ruled A).
 * Request-only flow: single email field; details are delivered by
 * EMAIL ONLY via /api/public/payment-info. Nothing sensitive ever
 * renders here, and the confirmation is uniform for known and
 * unknown addresses.
 */

import type { Metadata } from 'next'
import { PaymentInfoRequestForm } from '@/components/site/PaymentInfoRequestForm'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import { SWatermark } from '@/components/site/SWatermark'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Payments made simple. · SirReel Studio Services',
  description: 'Request SirReel payment and ACH details — sent straight to your email on file.',
}

export default function PaymentInfoPage() {
  return (
    <section className="bg-[#0c0c0d] text-white scroll-mt-24 relative overflow-hidden min-h-[70vh]">
      <SWatermark size={460} className="-right-24 -top-24 rotate-[6deg]" />
      <div className="relative max-w-[1480px] mx-auto px-5 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] items-start">
          <div>
            <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Payment Info &amp; ACH
            </div>
            <h1 className="font-black tracking-tight text-[32px] sm:text-[46px] leading-[1.05] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Payments made simple.
            </h1>
            <p className="text-[#a8a294] text-[15px] leading-relaxed mt-5 max-w-[46ch]">
              Enter your email and we&rsquo;ll send your payment details straight over — ready to
              forward to your accounts-payable team.
            </p>
            <div className="mt-7 text-[14px] text-[#cfc9bd] leading-relaxed">
              <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.phone}</a>
              <br />
              <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.email}</a>
            </div>
          </div>
          <PaymentInfoRequestForm />
        </div>
      </div>
    </section>
  )
}
