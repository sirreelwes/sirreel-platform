/**
 * /reports/vehicles/[inspectionId] — what the walk-around found.
 *
 * READ-ONLY on purpose, the same rule the filed order sheets follow:
 * the capture screens write inspections, move assignments and can put a
 * truck on the road, so looking one up months later must not sit one
 * mis-tap from any of that. Nothing on this page posts anywhere.
 *
 * The slots are rendered in full — Julian's whole walk-around for this
 * end (23 out, 22 back), including the ones nobody shot. A missing angle is the fact you need when a body shop points at
 * a panel: "not photographed" is evidence, a silent gap is not
 * (src/lib/fleet/photoPositions.ts).
 *
 * When the other end of the rental is on file, its shot of the SAME
 * slot sits beside this one. That pairing is the entire mechanism HQ
 * copied from DamageID — photographs on their own settle nothing.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Lock, ArrowLeft, FileText, Camera, AlertTriangle, ArrowLeftRight } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { PHOTO_GROUPS } from '@/lib/fleet/photoPositions'
import {
  filedInspection,
  type FiledInspectionDetail,
  type FiledPhoto,
  type FiledSlot,
} from '@/lib/fleet/inspectionHistory'

export const dynamic = 'force-dynamic'

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(d)
}

/** Assignment dates are @db.Date — read them in UTC or they slide a day. */
function fmtDay(d: Date | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(d)
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

export default async function FiledInspectionPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>
}) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">
          Vehicle check in/out is for fleet and warehouse staff.
        </p>
      </div>
    )
  }

  const { inspectionId } = await params
  const rec = await filedInspection(inspectionId)
  if (!rec) notFound()

  const isOut = rec.edge === 'OUT'
  const shot = rec.slots.filter((s) => s.mine).length
  const preExisting = rec.damage.filter((d) => d.isPreExisting)
  const found = rec.damage.filter((d) => !d.isPreExisting)

  return (
    <div className="max-w-3xl mx-auto px-1 py-2">
      <Back />

      <header className="mb-4">
        <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">
          {isOut ? 'Check-out walk-around' : 'Check-in walk-around'}
        </div>
        <h1 className="text-lt-fg text-2xl font-bold">
          {rec.unitName} <span className="text-lt-fg3 font-normal text-[18px]">· {rec.category}</span>
        </h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5">
          {rec.jobName ?? 'No booking attached'}
          {rec.company ? ` · ${rec.company}` : ''}
          {rec.bookingNumber ? ` · ${rec.bookingNumber}` : ''}
          {rec.startDate ? ` · ${fmtDay(rec.startDate)} → ${fmtDay(rec.endDate)}` : ''}
        </p>
        <p className="text-lt-fg3 text-[13px] mt-0.5">
          {[rec.makeModel, rec.licensePlate].filter(Boolean).join(' · ') || 'No make/model on file'}
        </p>
        <p className="text-lt-fg2 text-[14px] mt-2">
          Filed {fmtWhen(rec.inspectedAt)}
          {rec.inspectorName
            ? ` by ${rec.inspectorName}${rec.byDriver ? ' (driver, self service)' : ''}`
            : ' · inspector not recorded'}
        </p>
      </header>

      {/* The readings, which is what anyone looking this up came for
          before they scroll to the photographs. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Condition" value={titleCase(rec.condition)} />
        <Stat label="Odometer" value={rec.mileage != null ? `${rec.mileage.toLocaleString()} mi` : 'Not recorded'} />
        <Stat label="Fuel" value={rec.fuelLevel || 'Not recorded'} />
        <Stat
          label="Photos"
          value={`${shot} of ${rec.slots.length}${rec.damagePhotos.length ? ` + ${rec.damagePhotos.length}` : ''}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        {rec.counterpart && (
          <Link
            href={`/reports/vehicles/${rec.counterpart.inspectionId}`}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg border border-lt-hairline rounded-lg px-3 py-1.5"
          >
            <ArrowLeftRight size={14} aria-hidden />
            {rec.counterpart.edge === 'OUT' ? 'The check-out' : 'The check-in'}
          </Link>
        )}
        {/* The out-vs-back document. Viewing is open to yard staff;
            sending it to the renter is still gated off. */}
        {rec.assignmentId && (
          <a
            href={`/api/fleet/inspections/report/${rec.assignmentId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg border border-lt-hairline rounded-lg px-3 py-1.5"
          >
            <FileText size={14} aria-hidden /> Condition report PDF
          </a>
        )}
        {rec.milesDriven != null && (
          <span className="text-[14px] text-lt-fg2">
            {rec.milesDriven.toLocaleString()} miles driven on this rental
          </span>
        )}
      </div>

      {rec.notes && (
        <div className="border border-lt-hairline bg-lt-card rounded-xl px-3 py-2.5 mb-4">
          <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">Notes</div>
          <p className="text-[15px] text-lt-fg whitespace-pre-line">{rec.notes}</p>
        </div>
      )}

      {found.length > 0 && <DamageBlock title="Damage logged on this walk-around" rows={found} bad />}
      {preExisting.length > 0 && (
        <DamageBlock title="Marked as already there" rows={preExisting} bad={false} />
      )}

      {rec.counterpart && (
        <p className="text-lt-fg2 text-[14px] mb-3">
          Each slot below shows this walk-around beside the{' '}
          {rec.counterpart.edge === 'OUT' ? 'check-out' : 'check-in'} shot of the same angle,{' '}
          {fmtWhen(rec.counterpart.inspectedAt)}.
        </p>
      )}

      {PHOTO_GROUPS.map((group) => {
        const slots = rec.slots.filter((s) => s.group === group)
        if (slots.length === 0) return null
        return (
          <section key={group} className="mb-6">
            <h2 className="text-lt-fg2 text-[13px] font-semibold uppercase tracking-wide mb-2">
              {group}
              <span className="text-lt-fg3 font-normal normal-case tracking-normal">
                {' '}· {slots.filter((s) => s.mine).length} of {slots.length} shot
              </span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {slots.map((s) => (
                <SlotCard key={s.position} slot={s} edge={rec.edge} paired={!!rec.counterpart} />
              ))}
            </div>
          </section>
        )
      })}

      {rec.damagePhotos.length > 0 && (
        <LooseBlock title="Damage close-ups" photos={rec.damagePhotos} unit={rec.unitName} />
      )}
      {/* Anything shot before guided capture existed, or a free-form
          extra. Real evidence, so it renders rather than disappearing. */}
      {rec.otherPhotos.length > 0 && (
        <LooseBlock title="Other photos" photos={rec.otherPhotos} unit={rec.unitName} />
      )}

      {shot === 0 && rec.damagePhotos.length === 0 && rec.otherPhotos.length === 0 && (
        <p className="border border-lt-hairline bg-lt-card rounded-xl px-4 py-8 text-center text-[15px] text-lt-fg3 mb-8">
          No photographs were filed with this walk-around.
        </p>
      )}
    </div>
  )
}

function Back() {
  return (
    <Link
      href="/reports/vehicles/history"
      className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-lt-fg mb-2"
    >
      <ArrowLeft size={14} aria-hidden /> Past walk-arounds
    </Link>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-lt-hairline bg-lt-card rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-lt-fg3 font-semibold">{label}</div>
      <div className="text-lt-fg text-[16px] font-medium">{value}</div>
    </div>
  )
}

function DamageBlock({
  title, rows, bad,
}: {
  title: string
  rows: FiledInspectionDetail['damage']
  bad: boolean
}) {
  return (
    <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
      <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
        {bad && <AlertTriangle size={13} aria-hidden className="text-chip-bad-fg" />}
        {title}
      </div>
      {rows.map((d) => (
        <div key={d.id} className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0">
          <div className="text-lt-fg text-[16px] font-medium">{d.location}</div>
          <div className="text-lt-fg2 text-[13px]">
            {titleCase(d.damageType.replace(/_/g, ' '))} · {titleCase(d.severity)}
          </div>
          {d.notes && <div className="text-lt-fg2 text-[13px] mt-0.5 whitespace-pre-line">{d.notes}</div>}
        </div>
      ))}
    </div>
  )
}

function SlotCard({ slot, edge, paired }: { slot: FiledSlot; edge: 'OUT' | 'IN'; paired: boolean }) {
  const otherLabel = edge === 'OUT' ? 'On return' : 'At check-out'
  return (
    <div className="border border-lt-hairline bg-lt-card rounded-lg overflow-hidden">
      <div className="px-2 py-1.5 border-b border-lt-hairline text-[13px] text-lt-fg font-medium truncate">
        {slot.label}
      </div>
      <Frame photo={slot.mine} alt={`${slot.label}, ${edge === 'OUT' ? 'check-out' : 'check-in'}`} />
      {paired && (
        <>
          <div className="px-2 pt-1.5 text-[11px] uppercase tracking-wide text-lt-fg3 font-semibold">
            {otherLabel}
          </div>
          <Frame photo={slot.theirs} alt={`${slot.label}, other end`} muted />
        </>
      )}
    </div>
  )
}

function Frame({ photo, alt, muted }: { photo: FiledPhoto | null; alt: string; muted?: boolean }) {
  if (!photo) {
    return (
      <div
        className={`flex items-center justify-center text-center text-[12px] text-lt-fg3 bg-lt-inner ${
          muted ? 'h-16' : 'h-28'
        }`}
      >
        Not photographed
      </div>
    )
  }
  return (
    <a href={`/api/fleet/photos/${photo.id}`} target="_blank" rel="noreferrer" className="block">
      {/* Private blob, streamed behind the HQ session. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/fleet/photos/${photo.id}`}
        alt={alt}
        loading="lazy"
        className={`w-full object-cover ${muted ? 'h-16' : 'h-28'}`}
      />
    </a>
  )
}

function LooseBlock({ title, photos, unit }: { title: string; photos: FiledPhoto[]; unit: string }) {
  return (
    <section className="mb-6">
      <h2 className="text-lt-fg2 text-[13px] font-semibold uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
        <Camera size={13} aria-hidden /> {title} · {photos.length}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="border border-lt-hairline bg-lt-card rounded-lg overflow-hidden">
            <Frame photo={p} alt={`${title} of ${unit}`} />
          </div>
        ))}
      </div>
    </section>
  )
}
