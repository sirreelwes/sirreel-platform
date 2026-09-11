/**
 * The partner's account page body — shared by the public page
 * (/vendor/account/[token]) and the HQ preview.
 *
 * Wes 2026-09-05: "things like their logo, contact info, a vehicle list
 * that is available to SirReel for sublease, a place to change the rates
 * on those vehicles, etc. Then under that should be the job tiles, with
 * alerts for things that are missing etc."
 *
 * Reading order is that sentence: who they are (masthead, contact,
 * agreement), what they rent us (fleet + rates), then the work (jobs with
 * what is still owed on each unit).
 */

import type { VendorAccountJob, VendorAccountView as View, UnitAlert } from '@/lib/sub-rentals/vendorAccount'
import { fmtRange } from '@/lib/sub-rentals/conduit'
import { VendorContactForm } from '@/components/site/VendorContactForm'
import { UnitMarketingToggle } from '@/components/site/UnitMarketingToggle'
import { UnitRateForm } from '@/components/site/UnitRateForm'
import { UnitPhotosForm } from '@/components/site/UnitPhotosForm'
import { partnerVocab } from '@/lib/sub-rentals/partnerKind'
import { partnerSection } from '@/lib/site/partnerSections'
import { PARTNER_HQ_OFFER } from '@/lib/hq-white-label/product'

const STATUS: Record<string, { label: string; tone: string; bg: string }> = {
  ESTIMATED: { label: 'Quoted', tone: '#8a6d1f', bg: '#fbf3df' },
  REQUESTED: { label: 'Requested', tone: '#8a6d1f', bg: '#fbf3df' },
  CONFIRMED: { label: 'Confirmed', tone: '#2f7d5d', bg: '#e6f4ec' },
  PICKED_UP: { label: 'Out', tone: '#2f7d5d', bg: '#e6f4ec' },
  ON_RENT: { label: 'On rent', tone: '#2f7d5d', bg: '#e6f4ec' },
  RETURNED: { label: 'Returned', tone: '#5a554c', bg: '#eeece6' },
  CANCELLED: { label: 'Cancelled', tone: '#8b857a', bg: '#eeece6' },
}
const ALERT: Record<UnitAlert, string> = {
  confirm: 'Please confirm',
  driver: 'Driver needed',
  'delivery-contact': 'Delivery contact needed',
  'driver-ack': 'Driver hasn’t confirmed',
  'call-time': 'Call time needed',
}
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
const H2: React.CSSProperties = { fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8a8272', fontWeight: 700, margin: '28px 0 10px' }
const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 20 }
const CHIP = (tone: string, bg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: tone, background: bg, padding: '4px 8px', borderRadius: 6 })

function JobCard({ job, preview, unitHref }: { job: VendorAccountJob; preview: boolean; unitHref: (id: string, url: string | null) => string | null }) {
  return (
    <section style={{ ...CARD, marginBottom: 14, borderColor: job.alertCount > 0 ? '#e7c46a' : '#e2ddd0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111', letterSpacing: '-0.01em' }}>{job.jobName}</div>
          <div style={{ fontSize: 13, color: '#6b6560', marginTop: 2 }}>
            {/* The production's name never reaches a partner — same rule as the per-booking vendor page (Wes 2026-09-05). SirReel ref + dates are the handle. */}{job.jobCode ? `SirReel ref ${job.jobCode} · ` : ''}{fmtRange(job.startDate, job.endDate)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {job.alertCount > 0 && <span style={CHIP('#8a6d1f', '#fbf3df')}>{job.alertCount} thing{job.alertCount === 1 ? '' : 's'} needed</span>}
          <span style={{ fontSize: 12, color: '#8a8272' }}>{job.units.length} unit{job.units.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div style={{ marginTop: 12, borderTop: '1px solid #eeece6' }}>
        {job.units.map((u) => {
          const st = STATUS[u.status] ?? STATUS.REQUESTED
          const href = unitHref(u.subRentalId, u.unitPageUrl)
          const row = (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid #eeece6' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{u.quantity > 1 ? `${u.quantity} × ` : ''}{u.unitName}</div>
                <div style={{ fontSize: 12, color: '#6b6560', marginTop: 2 }}>
                  {fmtRange(u.startDate, u.endDate)}{u.callTime ? ` · call ${u.callTime}` : ''}{u.driverName ? ` · driver ${u.driverName}${u.driverAcked ? ' ✓' : ''}` : ''}
                </div>
                {u.alerts.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {u.alerts.map((a) => <span key={a} style={CHIP('#8a6d1f', '#fbf3df')}>{ALERT[a]}</span>)}
                  </div>
                )}
              </div>
              <span style={CHIP(st.tone, st.bg)}>{u.vendorDeclined ? 'Declined' : st.label}</span>
              {href && <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{preview ? 'Open (preview)' : 'Open'} →</span>}
            </div>
          )
          return href ? <a key={u.subRentalId} href={href} style={{ textDecoration: 'none', display: 'block' }}>{row}</a> : <div key={u.subRentalId}>{row}</div>
        })}
      </div>
    </section>
  )
}

export function VendorAccountView({ v, token, preview = false }: { v: View; token: string; preview?: boolean }) {
  const unitHref = (id: string, url: string | null) => (preview ? `/crm/portals/preview/vendor/${id}` : url)

  // Pre-filled so the reply lands with the partner and the current deal already
  // named — Wes should not have to ask "who is this and what do you have now?".
  const shareMailto = `mailto:wes@sirreel.com?subject=${encodeURIComponent(
    `${v.vendorName} — our split with SirReel`,
  )}&body=${encodeURIComponent(
    `Hi Wes,\n\n${
      v.sharePercent == null
        ? 'We would like to agree the split for our units with SirReel.'
        : `We currently receive ${Math.round((100 - v.sharePercent) * 100) / 100}% and SirReel keeps ${v.sharePercent}%. We would like to talk about changing that.`
    }\n\n\n— ${v.contactName ?? v.vendorName}`,
  )}`
  const logoSrc = preview ? `/api/vendors/${v.vendorId}/logo` : `/api/public/vendor-account/${token}/logo`
  const agreementHref = preview ? `/api/vendors/${v.vendorId}/agreement` : `/api/public/vendor-account/${token}/agreement/pdf`
  const signHref = preview ? '#' : `/vendor/account/${token}/sign`
  // "Your vehicles" to King Kong, "your equipment" to PowerTrip.
  const words = partnerVocab(v.kind)

  return (
    <div style={{ fontFamily: FONT, background: '#f6f4ef', minHeight: '100vh' }}>
      {/* Masthead lockup — theirs | ours, same treatment as the client's account portal. */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2ddd0' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            {v.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt={v.vendorName} style={{ display: 'block', height: 30, maxWidth: 220, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: '#111' }}>{v.vendorName}</span>
            )}
          </div>
          <span style={{ display: 'block', width: 1, height: 34, background: '#d6d1c4' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sirreel-logo.png" alt="SirReel Studio Services" style={{ display: 'block', height: 38, maxWidth: 200, objectFit: 'contain' }} />
          </div>
        </div>
      </div>
      <div style={{ background: '#0c0c0d', color: '#fff' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13 }}><strong>{v.vendorName}</strong><span style={{ color: 'rgba(255,255,255,0.55)' }}> · partner account</span></div>
          <div style={{ fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#4DB1C6', fontWeight: 700 }}>SirReel Studio Services</div>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 48px' }}>
        {/* Contact + agreement side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          <section style={CARD}>
            <div style={{ ...H2, margin: '0 0 10px' }}>Your contact details</div>
            <VendorContactForm token={token} preview={preview} initial={{ contactName: v.contactName, email: v.contactEmail, phone: v.contactPhone, lotAddress: v.lotAddress }} />
          </section>
          <section style={{ ...CARD, borderColor: v.agreement && !v.agreement.signedAt ? '#e7c46a' : '#e2ddd0' }}>
            <div style={{ ...H2, margin: '0 0 10px' }}>Partner agreement</div>
            {!v.agreement ? (
              <div style={{ fontSize: 14, color: '#6b6560' }}>SirReel hasn&apos;t sent an agreement yet. It will appear here to read and sign.</div>
            ) : v.agreement.signedAt ? (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{v.agreement.title}</div>
                <div style={{ fontSize: 13, color: '#2f7d5d', marginTop: 4 }}>Signed{v.agreement.signerName ? ` by ${v.agreement.signerName}` : ''} on {new Date(v.agreement.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                <a href={agreementHref} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 600, color: '#111' }}>Read the signed copy →</a>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{v.agreement.title}</div>
                <div style={{ fontSize: 13, color: '#8a6d1f', marginTop: 4 }}>Waiting for your signature.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a href={agreementHref} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#111', border: '1px solid #d6d1c4', borderRadius: 8, padding: '7px 12px', textDecoration: 'none' }}>Read</a>
                  <a href={signHref} aria-disabled={preview} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#0F7A93', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', opacity: preview ? 0.5 : 1, pointerEvents: preview ? 'none' : 'auto' }}>Sign the agreement →</a>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* The deal — plain words, the same numbers the agreement carries */}
        <section style={{ ...CARD, marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...H2, margin: '0 0 6px' }}>Your deal with SirReel</div>
            {v.sharePercent == null ? (
              <div style={{ fontSize: 14, color: '#6b6560' }}>SirReel hasn&apos;t set the split yet. It will show here, and on every booking, once it is.</div>
            ) : (
              <div style={{ fontSize: 14, color: '#3d392f', lineHeight: 1.55 }}>
                Your listed rate is what the production pays. <strong style={{ color: '#111' }}>SirReel keeps {v.sharePercent}%</strong> of the {words.rateNoun} and <strong style={{ color: '#111' }}>you receive {Math.round((100 - v.sharePercent) * 100) / 100}%</strong>, invoiced to SirReel after each booking returns. Each unit below shows what that comes to.{' '}
                {v.maxSharePercent != null && v.maxSharePercent > v.sharePercent
                  ? <>If a production needs a discount to book, it is <strong style={{ color: '#111' }}>shared equally with SirReel</strong> until SirReel&apos;s share reaches {v.maxSharePercent}% (you receive {Math.round((100 - v.maxSharePercent) * 100) / 100}% of list); past that, SirReel covers the rest.</>
                  : <>If a production needs a discount to book, it comes out of SirReel&apos;s share, not yours.</>}
              </div>
            )}
            {/* Wes 2026-09-10, second pass: the split is a conversation he
                wants to have himself, not a number typed into a form. A form
                would record an ask and leave the partner waiting; an email
                puts them straight in front of the person who decides. */}
            <div style={{ fontSize: 13, color: '#6b6560', marginTop: 10 }}>
              Want to talk about the split?{' '}
              <a
                href={preview ? undefined : shareMailto}
                aria-disabled={preview}
                style={{ color: '#0F7A93', fontWeight: 600, textDecoration: 'none', borderBottom: '1px solid rgba(15,122,147,0.35)', pointerEvents: preview ? 'none' : 'auto', opacity: preview ? 0.5 : 1 }}
              >
                Email Wes Bailey
              </a>{' '}
              and he&apos;ll come back to you.
            </div>
          </div>
          {v.sharePercent != null && (
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ textAlign: 'center', padding: '10px 16px', borderRadius: 10, background: '#f6f4ef' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>{Math.round((100 - v.sharePercent) * 100) / 100}%</div>
                <div style={{ fontSize: 11, color: '#8a8272', textTransform: 'uppercase', letterSpacing: '1px' }}>to you</div>
              </div>
              <div style={{ textAlign: 'center', padding: '10px 16px', borderRadius: 10, background: '#f6f4ef' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0F7A93' }}>{v.sharePercent}%</div>
                <div style={{ fontSize: 11, color: '#8a8272', textTransform: 'uppercase', letterSpacing: '1px' }}>to SirReel</div>
              </div>
            </div>
          )}
        </section>

        {/* Fleet */}
        <h2 style={H2}>Your {words.many} with SirReel · {v.fleet.length}</h2>
        <p style={{ fontSize: 13, color: '#6b6560', margin: '0 0 10px', maxWidth: 640 }}>
          What we can offer productions from your fleet, at the rates you&apos;ve given us. Propose a change any time; it takes effect once SirReel accepts. Add your own photos — they are what a production sees.
        </p>
        <div style={{ ...CARD, padding: 0 }}>
          {v.fleet.length === 0 && <div style={{ padding: 20, fontSize: 14, color: '#6b6560' }}>Nothing on file yet — reply to your welcome email with your list and rates, and it appears here.</div>}
          {v.fleet.map((u, i) => (
            <div key={u.id} style={{ padding: '14px 20px', borderTop: i ? '1px solid #eeece6' : 'none', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', opacity: u.active ? 1 : 0.55 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{u.name}{u.vehicleType ? <span style={{ fontWeight: 400, color: '#6b6560' }}> · {u.vehicleType}</span> : null}</div>
                <div style={{ fontSize: 12, color: '#6b6560', marginTop: 2 }}>
                  {u.listed ? `Offered to productions · under ${partnerSection(u.section).title} on sirreel.com` : 'Not offered'}{u.receiveMethod === 'DELIVERY' ? ' · you deliver' : u.receiveMethod === 'PICKUP' ? ' · driven to set' : ''}{!u.active ? ' · inactive' : ''}
                </div>
                <UnitRateForm token={token} unitId={u.id} preview={preview} current={{ daily: u.daily, weekly: u.weekly, monthly: u.monthly }} proposed={u.proposed} />
                <UnitMarketingToggle token={token} unitId={u.id} preview={preview} initial={u.listed} noun={words.one} />
                <UnitPhotosForm token={token} unitId={u.id} unitName={u.name} preview={preview} noun={words.one} />
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: '#111', lineHeight: 1.6 }}>
                <div><strong>{money(u.daily)}</strong> <span style={{ color: '#8a8272' }}>/day</span>{u.net.daily != null && <span style={{ color: '#2f7d5d', marginLeft: 8 }}>you receive {money(u.net.daily)}</span>}</div>
                <div><strong>{money(u.weekly)}</strong> <span style={{ color: '#8a8272' }}>/week</span>{u.net.weekly != null && <span style={{ color: '#2f7d5d', marginLeft: 8 }}>you receive {money(u.net.weekly)}</span>}</div>
                {u.monthly != null && <div><strong>{money(u.monthly)}</strong> <span style={{ color: '#8a8272' }}>/month</span>{u.net.monthly != null && <span style={{ color: '#2f7d5d', marginLeft: 8 }}>you receive {money(u.net.monthly)}</span>}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Jobs */}
        <h2 style={H2}>Current & upcoming · {v.current.length}</h2>
        {v.current.length === 0 ? (
          <div style={{ ...CARD, color: '#6b6560', fontSize: 14 }}>Nothing booked right now.</div>
        ) : v.current.map((j) => <JobCard key={j.jobId ?? j.jobName} job={j} preview={preview} unitHref={unitHref} />)}
        {v.past.length > 0 && (
          <>
            <h2 style={H2}>Past · {v.past.length}</h2>
            {v.past.map((j) => <JobCard key={j.jobId ?? j.jobName} job={j} preview={preview} unitHref={unitHref} />)}
          </>
        )}

        {/* "See what HQ can do for you" — Wes 2026-09-05. The white-label
            HQ (by VerMar Design) a partner can run their own fleet on. Once
            they've started one, this is the way back into it.
            OFF since 2026-09-11 (PARTNER_HQ_OFFER): partners are not offered
            the tech — "so they can't compete with our client service". */}
        {PARTNER_HQ_OFFER && (
        <div style={{ marginTop: 36, borderTop: '1px solid #e2ddd0', paddingTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {v.hq.workspace ? (
            <>
              <div style={{ fontSize: 13, color: '#6b6560' }}>
                Your own Utliiz is running{v.hq.workspace.status === 'TRIAL' && v.hq.workspace.trialDaysLeft != null ? ` · ${v.hq.workspace.trialDaysLeft > 0 ? `${v.hq.workspace.trialDaysLeft} day${v.hq.workspace.trialDaysLeft === 1 ? '' : 's'} left on your trial` : 'trial ended'}` : ''}.
              </div>
              <a href={preview ? '#' : v.hq.workspace.url} aria-disabled={preview} style={{ fontSize: 13, fontWeight: 700, color: '#111', textDecoration: 'none', pointerEvents: preview ? 'none' : 'auto', opacity: preview ? 0.5 : 1 }}>Open your Utliiz →</a>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: '#6b6560' }}>Run your whole fleet — not just what you rent us — from one place.</div>
              <a href={preview || !v.hq.landingPath ? '#' : v.hq.landingPath} aria-disabled={preview} style={{ fontSize: 13, fontWeight: 700, color: '#111', textDecoration: 'none', pointerEvents: preview ? 'none' : 'auto', opacity: preview ? 0.5 : 1 }}>See what Utliiz can do for you →</a>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
