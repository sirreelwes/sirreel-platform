/**
 * The partner's account page body — shared by the public page
 * (/vendor/account/[token]) and the HQ preview, so what we look at is
 * exactly what they see. Server component; no interaction here beyond
 * links into the per-unit conduit pages.
 */

import type { VendorAccountJob, VendorAccountView as View } from '@/lib/sub-rentals/vendorAccount'
import { fmtRange } from '@/lib/sub-rentals/conduit'

const STATUS: Record<string, { label: string; tone: string; bg: string }> = {
  ESTIMATED: { label: 'Quoted', tone: '#8a6d1f', bg: '#fbf3df' },
  REQUESTED: { label: 'Requested', tone: '#8a6d1f', bg: '#fbf3df' },
  CONFIRMED: { label: 'Confirmed', tone: '#2f7d5d', bg: '#e6f4ec' },
  PICKED_UP: { label: 'Out', tone: '#2f7d5d', bg: '#e6f4ec' },
  ON_RENT: { label: 'On rent', tone: '#2f7d5d', bg: '#e6f4ec' },
  RETURNED: { label: 'Returned', tone: '#5a554c', bg: '#eeece6' },
  CANCELLED: { label: 'Cancelled', tone: '#8b857a', bg: '#eeece6' },
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function JobCard({
  job,
  preview,
  unitHref,
}: {
  job: VendorAccountJob
  preview: boolean
  unitHref: (subRentalId: string, unitPageUrl: string | null) => string | null
}) {
  return (
    <section style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111', letterSpacing: '-0.01em' }}>{job.jobName}</div>
          <div style={{ fontSize: 13, color: '#6b6560', marginTop: 2 }}>
            {job.companyName ? `${job.companyName} · ` : ''}
            {job.jobCode ? `SirReel ref ${job.jobCode} · ` : ''}
            {fmtRange(job.startDate, job.endDate)}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#8a8272' }}>
          {job.units.length} unit{job.units.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid #eeece6' }}>
        {job.units.map((u) => {
          const st = STATUS[u.status] ?? STATUS.REQUESTED
          const href = unitHref(u.subRentalId, u.unitPageUrl)
          const row = (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid #eeece6' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
                  {u.quantity > 1 ? `${u.quantity} × ` : ''}{u.unitName}
                </div>
                <div style={{ fontSize: 12, color: '#6b6560', marginTop: 2 }}>
                  {fmtRange(u.startDate, u.endDate)}
                  {u.callTime ? ` · call ${u.callTime}` : ''}
                  {u.driverName ? ` · driver ${u.driverName}${u.driverAcked ? ' ✓' : ''}` : u.status !== 'ESTIMATED' && u.status !== 'CANCELLED' && u.status !== 'RETURNED' ? ' · driver needed' : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: st.tone, background: st.bg, padding: '4px 8px', borderRadius: 6 }}>
                {u.vendorDeclined ? 'Declined' : st.label}
              </span>
              {href && (
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{preview ? 'Open (preview)' : 'Open'} →</span>
              )}
            </div>
          )
          return href ? (
            <a key={u.subRentalId} href={href} style={{ textDecoration: 'none', display: 'block' }}>{row}</a>
          ) : (
            <div key={u.subRentalId}>{row}</div>
          )
        })}
      </div>
    </section>
  )
}

export function VendorAccountView({ v, preview = false }: { v: View; preview?: boolean }) {
  // In the HQ preview, unit rows open the HQ preview of that unit — never
  // the live token page, which would count as the partner opening it.
  const unitHref = (subRentalId: string, unitPageUrl: string | null) =>
    preview ? `/crm/portals/preview/vendor/${subRentalId}` : unitPageUrl

  return (
    <div style={{ fontFamily: FONT, background: '#f6f4ef', minHeight: '100vh' }}>
      <div style={{ background: '#0c0c0d', color: '#fff' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '26px 20px' }}>
          <div style={{ fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#c39a3f', fontWeight: 700 }}>
            Partner account · SirReel Studio Services
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 6 }}>{v.vendorName}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
            {v.rosterCount} unit{v.rosterCount === 1 ? '' : 's'} on our roster
            {v.contactName ? ` · ${v.contactName}` : ''}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 48px' }}>
        <p style={{ fontSize: 15, color: '#3d392f', lineHeight: 1.55, margin: '0 0 20px', maxWidth: 640 }}>
          Every show we have your units on, in one place. Open a unit for that booking&apos;s
          location, call time and driver, and to confirm it. New bookings appear here as they come
          in; you&apos;ll also get an email for each.
        </p>

        <h2 style={{ fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8a8272', fontWeight: 700, margin: '0 0 10px' }}>
          Current & upcoming · {v.current.length}
        </h2>
        {v.current.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, padding: 20, color: '#6b6560', fontSize: 14 }}>
            Nothing booked right now.
          </div>
        ) : (
          v.current.map((j) => <JobCard key={j.jobId ?? j.jobName} job={j} preview={preview} unitHref={unitHref} />)
        )}

        {v.past.length > 0 && (
          <>
            <h2 style={{ fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8a8272', fontWeight: 700, margin: '28px 0 10px' }}>
              Past · {v.past.length}
            </h2>
            {v.past.map((j) => <JobCard key={j.jobId ?? j.jobName} job={j} preview={preview} unitHref={unitHref} />)}
          </>
        )}

        {v.lotAddress && (
          <div style={{ marginTop: 28, fontSize: 12, color: '#8a8272' }}>
            Your lot on file: {v.lotAddress}. Every booking leaves from here unless the unit page says otherwise.
          </div>
        )}
      </div>
    </div>
  )
}
