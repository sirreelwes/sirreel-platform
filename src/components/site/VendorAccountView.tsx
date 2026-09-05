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
import { UnitRateForm } from '@/components/site/UnitRateForm'

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
            {job.companyName ? `${job.companyName} · ` : ''}{job.jobCode ? `SirReel ref ${job.jobCode} · ` : ''}{fmtRange(job.startDate, job.endDate)}
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
  const logoSrc = preview ? `/api/vendors/${v.vendorId}/logo` : `/api/public/vendor-account/${token}/logo`
  const agreementHref = preview ? `/api/vendors/${v.vendorId}/agreement` : `/api/public/vendor-account/${token}/agreement/pdf`
  const signHref = preview ? '#' : `/vendor/account/${token}/sign`

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
          <div style={{ fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#c39a3f', fontWeight: 700 }}>SirReel Studio Services</div>
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
                  <a href={signHref} aria-disabled={preview} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#c39a3f', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', opacity: preview ? 0.5 : 1, pointerEvents: preview ? 'none' : 'auto' }}>Sign the agreement →</a>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Fleet */}
        <h2 style={H2}>Your units with SirReel · {v.fleet.length}</h2>
        <p style={{ fontSize: 13, color: '#6b6560', margin: '0 0 10px', maxWidth: 640 }}>
          What we can offer productions from your fleet, at the rates you&apos;ve given us. Propose a change any time; it takes effect once SirReel accepts.
        </p>
        <div style={{ ...CARD, padding: 0 }}>
          {v.fleet.length === 0 && <div style={{ padding: 20, fontSize: 14, color: '#6b6560' }}>No units on file yet.</div>}
          {v.fleet.map((u, i) => (
            <div key={u.id} style={{ padding: '14px 20px', borderTop: i ? '1px solid #eeece6' : 'none', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', opacity: u.active ? 1 : 0.55 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{u.name}{u.vehicleType ? <span style={{ fontWeight: 400, color: '#6b6560' }}> · {u.vehicleType}</span> : null}</div>
                <div style={{ fontSize: 12, color: '#6b6560', marginTop: 2 }}>
                  {u.listed ? 'Listed to productions' : 'Quoted on request'}{!u.active ? ' · inactive' : ''}
                </div>
                <UnitRateForm token={token} unitId={u.id} preview={preview} current={{ daily: u.daily, weekly: u.weekly, monthly: u.monthly }} proposed={u.proposed} />
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: '#111', lineHeight: 1.6 }}>
                <div><strong>{money(u.daily)}</strong> <span style={{ color: '#8a8272' }}>/day</span></div>
                <div><strong>{money(u.weekly)}</strong> <span style={{ color: '#8a8272' }}>/week</span></div>
                {u.monthly != null && <div><strong>{money(u.monthly)}</strong> <span style={{ color: '#8a8272' }}>/month</span></div>}
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
      </div>
    </div>
  )
}
