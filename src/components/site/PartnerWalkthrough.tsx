/**
 * "How it works" — the partnership explained on the partner's OWN page.
 *
 * Wes 2026-09-15, preparing California Rent A Car: "I only want a presentation
 * embedded in page." A PDF attached to a cold introduction is a file someone
 * has to open and keep; this is the same walkthrough living where the partner
 * already is, reached from a bar above their people section, and personalised
 * from their record — their name, their pickup arrangement, their split.
 *
 * Every number here comes from the same places the account page and the
 * agreement read (partnerTerms.ts, partnerShare on the vendor row), so the
 * three cannot drift. Nothing is invented for the page: where the deal is not
 * set yet, it says so rather than printing a percentage.
 *
 * Styling matches the partner surfaces around it — the cream card, the
 * hairline, the turquoise CTA — rather than introducing a second look for one
 * page.
 */
import { partnerVocab } from '@/lib/sub-rentals/partnerKind'
import { partnerTerms } from '@/lib/sub-rentals/partnerTerms'

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 20 }
const H2: React.CSSProperties = { fontFamily: 'Archivo, sans-serif', fontSize: 20, fontWeight: 800, color: '#111', letterSpacing: '-0.01em' }
const EYEBROW: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8b857a' }
const BODY: React.CSSProperties = { fontSize: 15, color: '#3d392f', lineHeight: 1.6 }
const MUTED: React.CSSProperties = { fontSize: 13.5, color: '#6b6560', lineHeight: 1.6 }
const MAIL: React.CSSProperties = { border: '1px solid #e4dfd4', borderRadius: 10, overflow: 'hidden', background: '#fcfbf8' }
const MAIL_META: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: '#8b857a', padding: '8px 12px', borderBottom: '1px solid #eee9de', overflowWrap: 'anywhere' }
const MAIL_SUBJECT: React.CSSProperties = { fontWeight: 700, fontSize: 14.5, color: '#111', padding: '10px 12px 0' }
const MAIL_BODY: React.CSSProperties = { fontSize: 14, color: '#5a554c', padding: '4px 12px 12px', lineHeight: 1.55 }
const STEP_NUM: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#0C657A',
  background: '#e4f1f4', borderRadius: 999, width: 28, height: 28, display: 'grid', placeItems: 'center', flexShrink: 0,
}
const CHIP: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: '#e6f4ec', color: '#2f7d5d' }

export interface PartnerWalkthroughProps {
  vendorName: string
  kind: string | null
  /** How their units normally reach the production — decides the pickup half. */
  receiveMethod: 'PICKUP' | 'DELIVERY' | 'WILL_CALL'
  sharePercent: number | null
  maxSharePercent: number | null
  lotAddress: string | null
  /** Back to their account page. */
  accountPath: string
  /** A unit of theirs to use in the sample text, when we have one on file. */
  exampleUnit?: string | null
  /** Inert links, for the HQ preview. */
  preview?: boolean
}

function Step({ n, title, note, chip, children }: { n: number; title: string; note: string; chip?: string; children?: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={STEP_NUM}>{n}</span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Archivo, sans-serif', fontSize: 16, fontWeight: 700, color: '#111' }}>{title}</span>
          {chip && <span style={CHIP}>{chip}</span>}
        </div>
        <p style={MUTED}>{note}</p>
        {children}
      </div>
    </li>
  )
}

export function PartnerWalkthrough({
  vendorName, kind, receiveMethod, sharePercent, maxSharePercent, lotAddress, accountPath, exampleUnit = null, preview = false,
}: PartnerWalkthroughProps) {
  const w = partnerVocab(kind)
  const willCall = receiveMethod === 'WILL_CALL'
  const delivered = receiveMethod === 'DELIVERY'
  const terms = partnerTerms({ kind, sharePercent, maxSharePercent })
  const payment = terms.find((t) => t.key === 'payment')!
  const rates = terms.find((t) => t.key === 'rates')!
  const one = w.one

  const handoverTitle = willCall ? `Pickup at your lot` : delivered ? `You deliver it` : `Your driver takes it`
  const handoverBody = willCall
    ? `The production collects the ${one} from you and returns it to you, checked out at your counter the way you do for any rental. No driver is needed from you, and we tell you who is collecting before the day.`
    : delivered
      ? `You deliver the ${one} and collect it again. The address and timing land on the booking page as the production sets them, and we ask you for a name and mobile for whoever handles the drop.`
      : `Your driver takes the ${one} to set. Name them on the booking page and they get their own page with the location, the call time and somewhere to log their hours.`

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={EYEBROW}>How it works</span>
        <h1 style={{ fontFamily: 'Archivo, sans-serif', fontSize: 30, fontWeight: 800, color: '#111', margin: 0, letterSpacing: '-0.02em', textWrap: 'balance' }}>
          SirReel &amp; {vendorName}
        </h1>
        <p style={{ ...BODY, maxWidth: '62ch' }}>
          Your {w.many} in front of the productions already booking with us. We bring you the work,
          handle the client&rsquo;s contract, insurance and invoice, and pay you. {willCall
            ? `Nothing changes at your counter — the production collects from you and brings it back.`
            : `The rest of your day runs as it does now.`}
        </p>
      </div>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h2 style={H2}>One booking, start to finish</h2>
          <p style={{ ...MUTED, marginTop: 4 }}>Four moments. You hear about every one by email, and only one needs anything from you.</p>
        </div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Step n={1} title={`We quote your ${one} to a production`} note="A heads-up so the dates are on your radar. Nothing is held, and you don't have to do anything.">
            <div style={MAIL}>
              <div style={MAIL_META}>Subject</div>
              <div style={MAIL_SUBJECT}>Estimate submitted &mdash; your {one}, with the dates</div>
              <div style={MAIL_BODY}>&ldquo;We have quoted this unit to a production for the dates below. Nothing is booked yet.&rdquo;</div>
            </div>
          </Step>

          <Step n={2} title="They accept — please hold" chip="your move" note="One tap on the booking page holds the dates. No reply, no phone tag. If you can't hold them, that's one tap too.">
            <div style={MAIL}>
              <div style={MAIL_META}>Subject &middot; your rate is on the email</div>
              <div style={MAIL_SUBJECT}>Please hold &mdash; your {one}, with the dates</div>
              <div style={MAIL_BODY}>
                &ldquo;The production accepted our estimate. Please hold it for these dates.&rdquo;{' '}
                {willCall && `It also says the production picks it up at your lot and that we'll tell you who is collecting.`}
              </div>
            </div>
          </Step>

          <Step n={3} title="The production books — it's a go" note="Firm, apart from our standard 24-hour client cancellation. If that happens you hear the moment it does, and the dates are yours again.">
            <div style={MAIL}>
              <div style={MAIL_META}>Subject</div>
              <div style={MAIL_SUBJECT}>It&rsquo;s a go &mdash; your {one}, with the dates</div>
              <div style={MAIL_BODY}>&ldquo;Your {one} is confirmed. Nothing more is needed from you right now.&rdquo;</div>
            </div>
          </Step>

          <Step n={4} title={`It comes back, you invoice us`} note="One invoice to SirReel with our booking number. We have already billed and collected from the production — you never chase them." />
        </ol>
      </section>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={H2}>{handoverTitle}</h2>
        <p style={BODY}>{handoverBody}</p>
        {willCall && lotAddress && (
          <div style={{ background: '#faf7f0', borderRadius: 10, padding: '12px 14px' }}>
            <div style={EYEBROW}>Where</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111', whiteSpace: 'pre-line', marginTop: 2 }}>{lotAddress}</div>
            <p style={{ ...MUTED, marginTop: 4 }}>
              The production&rsquo;s own portal shows them this address for the pickup, so they arrive knowing where they are going.
            </p>
          </div>
        )}
      </section>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={H2}>How you hear about it</h2>
        <p style={BODY}>
          Every booking lands by email, and each one links the booking page where you confirm, decline or check the dates.
          Anyone on your team can also switch on a text for the same moments &mdash; tick it beside their mobile in
          your people list. Texts hold overnight, and STOP stops them.
        </p>
        <div style={{ background: '#e4f1f4', border: '1px solid #cbdde3', borderRadius: 14, borderBottomLeftRadius: 4, padding: '10px 14px', fontSize: 14, color: '#10212a', maxWidth: '46ch' }}>
          SirReel: {exampleUnit?.trim() || `your ${one}`}, Sep 22-Sep 24. The production accepted &mdash; please hold these dates. Confirm in one tap: sirreel.com/vendor/…
          <div style={{ fontSize: 12.5, color: '#6b6560', marginTop: 4 }}>Reply STOP to opt out.</div>
        </div>
      </section>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={H2}>What you&rsquo;re paid</h2>
        <p style={BODY}>{rates.body}</p>
        <p style={BODY}>{payment.body}</p>
        <p style={MUTED}>
          The full terms &mdash; discounts, cancellations, insurance and your control over what we list &mdash; are on{' '}
          <a href={preview ? undefined : accountPath} style={{ color: '#0C657A', fontWeight: 600, pointerEvents: preview ? 'none' : 'auto' }}>your account page</a>,
          and in the partner agreement itself.
        </p>
      </section>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={H2}>Paperwork</h2>
        <p style={BODY}>
          One partner agreement between our two companies, signed once on your page and covering every booking after it.
          For each booking SirReel handles the production&rsquo;s contract, their certificate of insurance and their
          invoice, so they never become your customer.
        </p>
        <p style={BODY}>
          <strong style={{ color: '#111' }}>Your own rental contract can ride with ours.</strong> Send it over and we
          embed it in the agreement the production signs, so your terms are part of what they agree to &mdash; and you
          get the signed PDF for your file. Nothing to re-sign at the counter.
        </p>
      </section>

      <section style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={H2}>Anything else</h2>
        <p style={MUTED}>
          Questions about a booking go to the SirReel contact at the bottom of your account page &mdash; or just reply to
          any booking email. We&rsquo;d rather hear it from you than have you work around it.
        </p>
        <div>
          <a
            href={preview ? undefined : accountPath}
            aria-disabled={preview}
            style={{
              display: 'inline-block', background: '#0F7A93', color: '#fff', textDecoration: 'none',
              fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 999,
              opacity: preview ? 0.5 : 1, pointerEvents: preview ? 'none' : 'auto',
            }}
          >
            &larr; Back to your page
          </a>
        </div>
      </section>
    </div>
  )
}

export default PartnerWalkthrough
