import type { VendorView } from '@/lib/sub-rentals/potentialSubRental'
import VehicleGallery from '@/components/site/VehicleGallery'
import VendorDriverCard from '@/components/site/VendorDriverCard'
import VendorDeliveryContactCard from '@/components/site/VendorDeliveryContactCard'
import VendorHoldCard from '@/components/site/VendorHoldCard'
import VendorOriginCard from '@/components/site/VendorOriginCard'
import VendorReleaseCard from '@/components/site/VendorReleaseCard'

/**
 * The vendor's page, as a component — rendered at /vendor/[token] for the
 * partner and inside HQ (/crm/portals/preview/vendor/[id]) for staff who want
 * to see exactly what the partner sees. `preview` makes every control inert.
 *
 * It names no client. The production, the company and the contacts are not
 * loaded by getVendorViewByToken at all — the vendor's shared reference is
 * our job code. Since 2026-09-05 it DOES carry the delivery address, access
 * notes and call time (Wes's ruling — a driver can't arrive without them);
 * the on-site contact's phone stays out. See lib/sub-rentals/conduit.ts.
 */

const STATUS_COPY: Record<string, { label: string; blurb: string; tone: string }> = {
  ESTIMATED: {
    label: 'Estimate submitted',
    blurb:
      'We have quoted this unit to a production for the dates below. Nothing is booked yet — this is advance notice so the dates are on your radar. We will confirm here as soon as we hear back.',
    tone: '#0C657A',
  },
  REQUESTED: {
    label: 'Hold requested',
    blurb:
      'The production has accepted — please hold this unit for the dates below and confirm with the button further down. We will follow up with the PO. Name your driver whenever you are ready; the location and call time appear here as the production sets them.',
    tone: '#0C657A',
  },
  CONFIRMED: { label: 'Confirmed', blurb: 'This booking is confirmed. Location, call time and driver details are exchanged on this page.', tone: '#2f7d5d' },
  PICKED_UP: { label: 'Picked up', blurb: 'The unit is with us.', tone: '#2f7d5d' },
  ON_RENT: { label: 'On rent', blurb: 'The unit is out on the job.', tone: '#2f7d5d' },
  RETURNED: { label: 'Returned', blurb: 'The unit is back with you. Thank you.', tone: '#5a554c' },
  CANCELLED: {
    label: 'Released',
    blurb:
      'This booking is no longer going ahead — the dates below are released and yours to book elsewhere. Please confirm below that you have them back.',
    tone: '#8b857a',
  },
}

/** REQUESTED, but the partner has already pressed Confirm hold. HQ may still be
 *  finishing its side (the COI gate holds the status back until the production's
 *  certificate clears) — that is ours to chase, so the page stops asking them. */
const REQUESTED_CONFIRMED_COPY = {
  label: 'Hold confirmed',
  blurb:
    'You have confirmed the hold — thank you. SirReel is finalising the booking with the production and will follow up with the PO. Name your driver whenever you are ready; the location and call time appear here as the production sets them.',
  tone: '#2f7d5d',
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

const EYEBROW = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3'
const ROW = 'flex items-start justify-between gap-4 px-4 py-3'
// Rows whose value is a sentence, not a figure: stack on a phone, side-by-side from sm.
const ROW_TEXT = 'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4 px-4 py-3'
const DD_TEXT = 'text-[15px] text-[#3a362f] leading-relaxed sm:text-right whitespace-pre-line'
const DT = 'text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8b857a] shrink-0'
const DD = 'text-[15px] font-semibold text-[#0c0c0d] text-right'

export function VendorPageView({ v, token, preview = false }: { v: VendorView; token: string; preview?: boolean }) {
  // REQUESTED with the partner's confirm already stamped: HQ is still finishing
  // its side (the COI gate can hold the status back), so don't ask them again.
  const status =
    v.status === 'REQUESTED' && v.vendorConfirmedAt
      ? REQUESTED_CONFIRMED_COPY
      : STATUS_COPY[v.status] ?? { label: v.status, blurb: '', tone: '#5a554c' }
  const photos = v.photos.map((p) => ({ id: p.id, src: `/api/public/vendor/${token}/photo/${p.id}` }))
  const l = v.logistics
  const showLogistics = ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT'].includes(v.status)

  return (
    <div className="max-w-[1100px] mx-auto px-5 py-8 sm:py-12">
      <div className="text-[12px] font-semibold tracking-[0.16em] uppercase mb-2" style={{ fontFamily: 'Archivo, sans-serif', color: status.tone }}>
        {status.label}
      </div>
      <h1 className="font-black tracking-tight leading-[0.98] text-[32px] sm:text-[42px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
        {v.vehicleName}
      </h1>
      {v.reference && (
        <p className="mt-1.5 text-[14px] text-[#8b857a]">
          SirReel reference <span className="font-semibold text-[#3a362f]">{v.reference}</span>
        </p>
      )}
      {status.blurb && <p className="mt-4 text-[16px] text-[#3a362f] leading-relaxed max-w-[60ch]">{status.blurb}</p>}

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div>
          <div className={EYEBROW} style={{ fontFamily: 'Archivo, sans-serif' }}>Dates</div>
          <dl className="rounded-[14px] border border-[#e4dfd4] bg-white overflow-hidden">
            <div className={ROW}><dt className={DT}>Start</dt><dd className={DD}>{fmtDate(v.startDate)}</dd></div>
            <div className={`${ROW} border-t border-[#efe9dd]`}><dt className={DT}>End</dt><dd className={DD}>{fmtDate(v.endDate)}</dd></div>
            <div className={`${ROW} border-t border-[#efe9dd]`}><dt className={DT}>Units</dt><dd className={DD}>{v.quantity}</dd></div>
          </dl>

          <VendorHoldCard
            token={token}
            status={v.status}
            confirmedAt={v.vendorConfirmedAt?.toISOString() ?? null}
            declinedAt={v.vendorDeclinedAt?.toISOString() ?? null}
            declineNote={v.vendorDeclineNote}
            readOnly={preview}
          />

          <VendorReleaseCard
            token={token}
            status={v.status}
            releaseAckedAt={v.vendorReleaseAckedAt?.toISOString() ?? null}
            cancelNotifiedAt={v.vendorCancelNotifiedAt?.toISOString() ?? null}
            readOnly={preview}
          />

          <VendorOriginCard token={token} lotAddress={v.lotAddress} originAddress={v.originAddress} unitName={v.vehicleName} readOnly={preview} />

          {/* Where and when — set by the production on their portal. */}
          {showLogistics && (
            <div className="mt-6">
              <div className={EYEBROW} style={{ fontFamily: 'Archivo, sans-serif' }}>Location &amp; call time</div>
              {l.hasAny ? (
                <dl className="rounded-[14px] border border-[#e4dfd4] bg-white overflow-hidden">
                  {l.address && <div className={ROW_TEXT}><dt className={DT}>Report to</dt><dd className={`${DD_TEXT} font-semibold text-[#0c0c0d]`}>{l.address}</dd></div>}
                  {!l.address && l.area && <div className={ROW_TEXT}><dt className={DT}>Area</dt><dd className={`${DD_TEXT} font-semibold text-[#0c0c0d]`}>{l.area} <span className="font-normal text-[#5a554c]">&middot; exact address to follow</span></dd></div>}
                  {l.accessNotes && <div className={`${ROW_TEXT} border-t border-[#efe9dd]`}><dt className={DT}>Gate / access</dt><dd className={DD_TEXT}>{l.accessNotes}</dd></div>}
                  {(l.callTime || l.arriveTime) && <div className={`${ROW} border-t border-[#efe9dd]`}><dt className={DT}>Call time</dt><dd className={DD}>{l.callTime ?? l.arriveTime}</dd></div>}
                  {l.onSiteContactName && <div className={`${ROW} border-t border-[#efe9dd]`}><dt className={DT}>Ask for</dt><dd className={DD}>{l.onSiteContactName}</dd></div>}
                  {l.driverNotes && <div className={`${ROW_TEXT} border-t border-[#efe9dd]`}><dt className={DT}>Note for driver</dt><dd className={DD_TEXT}>{l.driverNotes}</dd></div>}
                  {l.pickupAddress && l.pickupAddress !== l.address && <div className={`${ROW_TEXT} border-t border-[#efe9dd]`}><dt className={DT}>Collect from</dt><dd className={`${DD_TEXT} font-semibold text-[#0c0c0d]`}>{l.pickupAddress}</dd></div>}
                  {l.pickupTime && <div className={`${ROW} border-t border-[#efe9dd]`}><dt className={DT}>Collect</dt><dd className={DD}>{l.pickupTime}</dd></div>}
                  {l.updatedAt && (
                    <div className="px-4 py-2.5 border-t border-[#efe9dd] bg-[#faf7f0] text-[12px] text-[#8b857a]">
                      Updated {fmtStamp(l.updatedAt)}. {v.driverName ? `${v.driverName} has been sent this and asked to confirm.` : 'Your driver receives this the moment you name them.'}
                    </div>
                  )}
                </dl>
              ) : (
                <div className="rounded-[14px] border border-[#e4dfd4] bg-[#faf7f0] px-4 py-3.5">
                  {l.area && (
                    <p className="text-[15px] font-semibold text-[#0c0c0d] mb-1">
                      {l.area} <span className="font-normal text-[13px] text-[#5a554c]">&middot; exact address to follow</span>
                    </p>
                  )}
                  <p className="text-[13px] text-[#5a554c] leading-relaxed">
                    The production hasn&rsquo;t set the {l.area ? 'exact address' : 'location'} and call time yet. It appears here — and goes to your driver — the moment they do.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Who is paying the driver. The partner has to know BEFORE they
              invoice us: on a union job the production carries the driver on
              their own payroll, so the driver day is not ours to be billed for
              (Wes 2026-09-09). Only shown when it's true — the ordinary case
              needs no announcement. */}
          {v.driverOnProductionPayroll && v.receiveMethod !== 'DELIVERY' && (
            <div className="mt-6 rounded-[14px] border border-[#cbdde3] bg-[#f2f8fa] px-4 py-3.5">
              <div className="text-[14px] font-semibold text-[#0c0c0d]">
                Driver is on the production&rsquo;s payroll for this booking
              </div>
              <p className="mt-1 text-[13px] text-[#5a554c] leading-relaxed">
                The production is carrying the driver themselves, so please don&rsquo;t invoice
                SirReel for driver labor on this job. Everything else — the unit, mileage,
                generator and supplies — is unchanged. Still name your driver below and have
                them log their hours: the production needs those hours for their own payroll.
              </p>
            </div>
          )}

          {/* A delivered unit (restroom trailer) has no driver on set — the
              partner gives us a name and a mobile instead (Wes 2026-09-07). */}
          {v.receiveMethod === 'DELIVERY' ? (
          <VendorDeliveryContactCard
            token={token}
            status={v.status}
            unitName={v.vehicleName}
            initialName={v.driverName}
            initialPhone={v.driverPhone}
            initialEmail={v.driverEmail}
            readOnly={preview}
          />
          ) : (
          <VendorDriverCard
            token={token}
            status={v.status}
            unitName={v.vehicleName}
            roster={v.roster}
            assignedVendorDriverId={v.assignedVendorDriverId}
            initialDriverName={v.driverName}
            initialDriverEmail={v.driverEmail}
            initialDriverPhone={v.driverPhone}
            initialRelayAddress={v.relayAddress}
            state={{
              driverPageSent: v.driverPageSent,
              driverViewedAt: v.driverViewedAt?.toISOString() ?? null,
              driverAck: v.driverAck ? { at: v.driverAck.at.toISOString(), note: v.driverAck.note, stale: v.driverAck.stale } : null,
              hours: { total: v.hours.total, days: v.hours.entries.length },
            }}
            readOnly={preview}
          />
          )}

          {v.hours.entries.length > 0 && (
            <div className="mt-6">
              <div className={EYEBROW} style={{ fontFamily: 'Archivo, sans-serif' }}>Driver hours</div>
              <dl className="rounded-[14px] border border-[#e4dfd4] bg-white overflow-hidden">
                {v.hours.entries.map((e, i) => (
                  <div key={e.workDate} className={`${ROW} ${i ? 'border-t border-[#efe9dd]' : ''}`}>
                    <dt className="min-w-0">
                      <div className="text-[14px] font-semibold text-[#0c0c0d]">{fmtDay(e.workDate)}</div>
                      <div className="text-[12px] text-[#8b857a]">
                        Left lot {e.startTime}{e.onSetTime ? ` · on set ${e.onSetTime}` : ''}{e.leftSetTime ? ` · left set ${e.leftSetTime}` : ''}{e.endTime ? ` · wrap ${e.endTime}` : ' · not wrapped yet'}{e.notes ? ` · ${e.notes}` : ''}
                      </div>
                      {(e.miles != null || e.generatorHours != null || e.suppliesNote) && (
                        <div className="text-[12px] text-[#5a554c]">
                          {e.miles != null ? `${e.miles} mi (${e.odometerOut}→${e.odometerIn})` : ''}{e.miles != null && e.generatorHours != null ? ' · ' : ''}{e.generatorHours != null ? `generator ${e.generatorHours} h` : ''}{e.suppliesNote ? `${e.miles != null || e.generatorHours != null ? ' · ' : ''}supplies: ${e.suppliesNote}` : ''}
                        </div>
                      )}
                    </dt>
                    <dd className={DD}>{e.hours === null ? <span className="text-[#0C657A]">open</span> : `${e.hours} h`}</dd>
                  </div>
                ))}
                <div className={`${ROW} border-t border-[#efe9dd] bg-[#faf7f0]`}>
                  <dt className={DT}>Total</dt>
                  <dd className={DD}>{v.hours.total} h{v.hours.usage.miles > 0 ? ` · ${v.hours.usage.miles} mi` : ''}{v.hours.usage.generatorHours > 0 ? ` · gen ${v.hours.usage.generatorHours} h` : ''}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] text-[#8b857a]">Portal to portal (wrap minus left lot), with the meters, as logged by {v.driverName ?? 'the driver'} on their page. Mileage, generator and supplies bill from these numbers — query anything here with SirReel before invoicing.</p>
            </div>
          )}

          <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-[#faf7f0] px-4 py-3.5">
            <p className="text-[13px] text-[#5a554c] leading-relaxed">
              Questions about this booking go to SirReel — please reply to the email that brought you here rather than contacting the production directly.
            </p>
          </div>
        </div>

        <div>
          {photos.length > 0 && <VehicleGallery photos={photos} fallbackSrc={null} alt={v.vehicleName} />}
          {v.specs.length > 0 && (
            <div className="mt-5">
              <div className={EYEBROW} style={{ fontFamily: 'Archivo, sans-serif' }}>Unit on file</div>
              <ul className="rounded-[14px] border border-[#e4dfd4] bg-white px-5 py-4 space-y-2">
                {v.specs.map((sp) => (
                  <li key={sp} className="flex items-start gap-2.5 text-[14px] text-[#3a362f] leading-relaxed">
                    <span aria-hidden className="mt-[8px] w-1.5 h-1.5 rounded-full bg-[#4DB1C6] shrink-0" />
                    {sp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
