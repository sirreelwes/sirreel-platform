import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Public /sms-terms/opt-in-examples — the login-protected SMS consent forms,
 * rendered where a carrier reviewer can see them.
 *
 * Twilio rejected the A2P campaign twice (2026-09-07, 2026-09-08) with 30909:
 * the reviewer cannot open the client portal, the partner booking page or the
 * driver profile, so the Message Flow's description of those opt-in paths
 * could not be verified. This page shows each form as the person sees it —
 * the mobile-number field, the consent checkbox (unchecked) and the full
 * disclosure — so the campaign can cite one public URL. The copy MUST match
 * PortalDeliveriesSection, VendorDeliveryContactCard and
 * DriverProfilePageView; the fields here are inert and save nothing.
 */

export const metadata: Metadata = {
  title: 'SirReel · Where we ask for text-message consent',
  description: 'The forms on which SirReel Studio Services collects consent to send booking texts, shown as the person sees them.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/sms-terms/opt-in-examples' },
}

const P = 'text-[15px] leading-relaxed text-[#3d392f] mb-4'
const CAPTION = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#0F7A93] mb-3'
const LT_FIELD = 'w-full border border-[#e4dfd4] rounded-lg px-3 py-2.5 text-[16px] bg-white'
const LT_LABEL = 'block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5'

function Frame({ title, where, children, dark }: { title: string; where: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <section className="mt-10">
      <div className={CAPTION} style={{ fontFamily: 'Archivo, sans-serif' }}>{title}</div>
      <p className="text-[14px] leading-relaxed text-[#3d392f] mb-3">{where}</p>
      <div className={`rounded-[14px] border ${dark ? 'border-zinc-800 bg-zinc-900 text-white' : 'border-[#e4dfd4] bg-white'} p-5 sm:p-6`}>
        {children}
      </div>
    </section>
  )
}

const TermsLinks = ({ light }: { light?: boolean }) => (
  <>
    <a href="https://sirreel.com/sms-terms" className={`underline underline-offset-2 ${light ? '' : ''}`}>Terms</a> &middot;{' '}
    <a href="https://sirreel.com/privacy" className="underline underline-offset-2">Privacy</a>.
  </>
)

export default function OptInExamplesPage() {
  return (
    <section className="bg-[#f6f4ef] text-[#0c0c0d]">
      <div className="max-w-[820px] mx-auto px-5 py-14 sm:py-20">
        <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#0F7A93] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Legal · <Link href="/sms-terms" className="underline underline-offset-2">Text Message Terms</Link>
        </div>
        <h1 className="font-black tracking-tight text-[34px] sm:text-[44px] leading-[1.05]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Where we ask for text-message consent
        </h1>
        <p className={`${P} mt-6`}>
          Besides the public form and the START keyword on our <Link href="/sms-terms#opt-in" className="text-[#0F7A93] underline underline-offset-2">Text Message Terms</Link>,
          SirReel Studio Services collects consent on three forms that sit behind a private link. They are shown below
          exactly as the person sees them: the mobile-number field and the consent checkbox are on the same form, the
          checkbox is unchecked until the person ticks it, and no text is ever sent to a number whose box was left
          unticked. The copies on this page are for review only and do not save anything.
        </p>

        <Frame
          title="1 · Client portal — on-site contact for a delivery"
          where="A production that has booked with us opens its private booking page and names the person our driver should ask for on set. The consent box sits directly under that person's mobile number.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">On-site contact</label>
              <input className={LT_FIELD} readOnly placeholder="Who the driver asks for" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">Their mobile</label>
              <input className={LT_FIELD} readOnly placeholder="(818) 555-0147" inputMode="tel" />
            </div>
          </div>
          <label className="mt-3 flex items-start gap-2.5 text-[12px] leading-relaxed text-gray-700">
            <input type="checkbox" readOnly checked={false} className="mt-0.5 w-4 h-4 accent-[#0F7A93]" />
            <span>
              OK for SirReel Studio Services to text this number about this booking &mdash; day-of changes to the delivery,
              call time or pickup. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for
              help. Consent is not a condition of renting.{' '}<TermsLinks />
            </span>
          </label>
        </Frame>

        <Frame
          title="2 · Partner booking page — delivery contact"
          where="A vehicle partner delivering one of their units for us opens the booking's private page and enters the driver who will be on the truck. The consent box sits under the driver's mobile number.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LT_LABEL}>Name</label>
              <input className={LT_FIELD} readOnly placeholder="Who's on the truck" />
            </div>
            <div>
              <label className={LT_LABEL}>Mobile</label>
              <input className={LT_FIELD} readOnly placeholder="Text or call" inputMode="tel" />
            </div>
            <label className="sm:col-span-2 flex items-start gap-2.5 text-[13px] leading-relaxed text-[#3d392f]">
              <input type="checkbox" readOnly checked={false} className="mt-0.5 w-4 h-4 accent-[#0F7A93]" />
              <span>
                OK for SirReel Studio Services to text this number about this booking &mdash; day-of changes to the drop-off or
                pickup. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. Consent
                is not a condition of the booking.{' '}<TermsLinks />
              </span>
            </label>
            <div className="sm:col-span-2">
              <span className="inline-flex min-h-[44px] items-center rounded-full bg-amber-600 text-white px-5 text-[14px] font-bold opacity-60" style={{ fontFamily: 'Archivo, sans-serif' }}>Save contact</span>
            </div>
          </div>
        </Frame>

        <Frame
          dark
          title="3 · Driver profile — the driver's own number"
          where="A driver we dispatch opens their private profile link to enter their name, mobile number and licence. The consent box sits under the mobile number.">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">First name</label><input readOnly className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Last name</label><input readOnly className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white" /></div>
            <div className="col-span-2"><label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Mobile</label><input readOnly inputMode="tel" placeholder="(818) 555-0100" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white placeholder:text-zinc-600" /></div>
            <label className="col-span-2 flex items-start gap-2.5 text-[13px] leading-relaxed text-zinc-300">
              <input type="checkbox" readOnly checked={false} className="mt-0.5 w-4 h-4 accent-[#4DB1C6]" />
              <span>
                OK for SirReel Studio Services to text this number about jobs I&rsquo;m driving &mdash; call time, location,
                day-of changes. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
                Consent is not a condition of driving for SirReel.{' '}<TermsLinks light />
              </span>
            </label>
          </div>
        </Frame>

        <h2 className="text-[20px] sm:text-[22px] font-black tracking-tight mt-12 mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>What happens after the box is ticked</h2>
        <p className={P}>
          The number is stored with the time and the form it came from. Messages are limited to that booking: confirmations,
          day-of logistics, and replies to questions the person texts us. Every message ends with &ldquo;Reply STOP to opt
          out.&rdquo; STOP is honored immediately and blocks all further texts until the person texts START; HELP returns our
          email and phone number. Full terms: <Link href="/sms-terms" className="text-[#0F7A93] underline underline-offset-2">sirreel.com/sms-terms</Link>.
          Privacy: <Link href="/privacy" className="text-[#0F7A93] underline underline-offset-2">sirreel.com/privacy</Link>.
        </p>
      </div>
    </section>
  )
}
