'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { TSX, TSX_SERIF } from '@/lib/brand/tsxTokens'
import { DetailsCard, intakeComplete } from '@/components/portal-v2/DetailsCard'
import { RentalAgreementCard } from '@/components/portal-v2/RentalAgreementCard'
import { LcdwCard } from '@/components/portal-v2/LcdwCard'
import { StudioContractCard } from '@/components/portal-v2/StudioContractCard'
import { CoiCard } from '@/components/portal-v2/CoiCard'
import { CcAuthCard } from '@/components/portal-v2/CcAuthCard'
import {
  EMPTY_INTAKE,
  type V2AgreementState,
  type V2Booking,
  type V2Done,
  type V2DocKey,
  type V2Intake,
  type V2Paperwork,
} from '@/components/portal-v2/types'

/**
 * Portal v2 — guided, collect-once client paperwork experience.
 *
 * Additive rebuild of /portal/[token]: same PaperworkRequest token, same
 * signing / upload / CardSecure plumbing underneath, new guided layout on
 * top. The legacy portal stays live at /portal/[token] until this page is
 * hand-verified and cut over — nothing links here yet by design.
 */

const fmtShort = (d?: string) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

type OpenKey = 'details' | V2DocKey | null

export default function ClientPortalV2() {
  const params = useParams()
  const token = params?.token as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [booking, setBooking] = useState<V2Booking | null>(null)
  const [paperwork, setPaperwork] = useState<V2Paperwork | null>(null)
  const [intake, setIntake] = useState<V2Intake>(EMPTY_INTAKE)
  const [agreementState, setAgreementState] = useState<V2AgreementState | null>(null)
  const [done, setDone] = useState<V2Done>({ agreement: false, lcdw: false, studio: false, coi: false, cc: false })
  const [locked, setLocked] = useState(false)
  const [openKey, setOpenKey] = useState<OpenKey>(null)
  const [initialised, setInitialised] = useState(false)

  useEffect(() => {
    if (!token) return
    Promise.all([
      fetch(`/api/portal/${token}`).then((r) => r.json()),
      fetch(`/api/portal/v2/${token}/intake`)
        .then((r) => (r.ok ? r.json() : { intake: null }))
        .catch(() => ({ intake: null })),
    ])
      .then(([data, intakeData]) => {
        if (data.error) {
          setError(data.error)
          return
        }
        const bk: V2Booking = data.booking
        const req: V2Paperwork = data.request
        setBooking(bk)
        setPaperwork(req)
        setDone({
          agreement: !!req?.rentalAgreement,
          lcdw: !!req?.lcdwAccepted,
          studio: !!req?.studioContractSigned,
          coi: !!(req?.coiReceived && req?.wcReceived),
          cc: !!req?.creditCardAuth,
        })
        setLocked(['CONFIRMED', 'ACTIVE', 'COMPLETE', 'CLOSED'].includes(bk.status))

        // Collect-once seed: persisted intake wins; otherwise pre-fill from
        // the booking's contact + company so the client starts pre-populated.
        const saved = intakeData?.intake
        const person = bk.person
        setIntake({
          fullName: saved?.fullName ?? [person?.firstName, person?.lastName].filter(Boolean).join(' '),
          title: saved?.title ?? '',
          company: saved?.company ?? (bk.company?.name || ''),
          email: saved?.email ?? (person?.email || ''),
          phone: saved?.phone ?? (person?.phone || person?.mobile || ''),
          billingAddress1: saved?.billingAddress1 ?? '',
          billingAddress2: saved?.billingAddress2 ?? '',
          billingCity: saved?.billingCity ?? '',
          billingState: saved?.billingState ?? '',
          billingZip: saved?.billingZip ?? '',
        })
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [token])

  // Dual-path SignedAgreement state — silent on 401/404, same as the live
  // portal: absence just means the legacy inline signing flow applies.
  useEffect(() => {
    if (!token) return
    fetch(`/api/portal/${token}/agreement`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.status) {
          setAgreementState({
            status: data.status,
            documentToSignUrl: data.documentToSignUrl ?? null,
            wordDocumentAvailable: !!data.wordDocumentAvailable,
            allowedActions: Array.isArray(data.allowedActions) ? data.allowedActions : [],
            statusUpdatedAt: data.statusUpdatedAt || '',
            job: data.job,
            timeline: Array.isArray(data.timeline) ? data.timeline : [],
          })
        }
      })
      .catch(() => {})
  }, [token])

  const contractType = paperwork?.contractType || 'vehicles'
  const showAgreement = contractType === 'vehicles' || contractType === 'both'
  const showStudio = contractType === 'stage' || contractType === 'both'

  const docKeys = useMemo<V2DocKey[]>(() => {
    const keys: V2DocKey[] = []
    if (showAgreement) keys.push('agreement', 'lcdw')
    if (showStudio) keys.push('studio')
    keys.push('coi', 'cc')
    return keys
  }, [showAgreement, showStudio])

  const doneCount = docKeys.filter((k) => done[k]).length
  const total = docKeys.length
  const allDone = doneCount === total
  const detailsDone = intakeComplete(intake)

  // Guided default: open "Your details" first; once saved, open the first
  // incomplete document. Runs once after load — after that the client drives.
  useEffect(() => {
    if (loading || initialised || !booking) return
    setInitialised(true)
    if (allDone) return
    if (!detailsDone && !locked) {
      setOpenKey('details')
      return
    }
    const firstTodo = docKeys.find((k) => !done[k])
    setOpenKey(firstTodo || null)
  }, [loading, initialised, booking, allDone, detailsDone, locked, docKeys, done])

  const toggle = (key: OpenKey) => setOpenKey((cur) => (cur === key ? null : key))

  const advanceFrom = (key: V2DocKey) => {
    const next = docKeys.find((k) => k !== key && !done[k])
    setOpenKey(next || null)
  }

  const markDone = (key: V2DocKey) => {
    setDone((d) => {
      const next = { ...d, [key]: true }
      const upcoming = docKeys.find((k) => k !== key && !next[k])
      setOpenKey(upcoming || null)
      return next
    })
  }

  const saveIntake = async (next: V2Intake): Promise<boolean> => {
    try {
      const r = await fetch(`/api/portal/v2/${token}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) return false
      setIntake(next)
      const firstTodo = docKeys.find((k) => !done[k])
      setOpenKey(firstTodo || null)
      return true
    } catch {
      return false
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (error || !booking || !paperwork) {
    return (
      <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <div className="text-gray-800 font-semibold">Link Not Found</div>
          <div className="text-gray-500 text-sm mt-1">{error || 'This link is invalid or expired.'}</div>
          <div className="mt-3 text-sm">
            📞{' '}
            <a href="tel:8185152389" className="font-semibold text-gray-700">
              (818) 515-2389
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Branded header — S mark + job context */}
      <div className="w-full" style={{ backgroundColor: TSX.dark }}>
        <div className="max-w-xl mx-auto px-5 pt-8 pb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/s-logo-white.png" alt="SirReel" width={44} style={{ display: 'inline-block', maxWidth: 44, height: 'auto' }} />
          <div className="mx-auto mt-3" style={{ width: 48, height: 2, backgroundColor: TSX.gold }} />
          <div className="mt-3 text-[10px] uppercase font-semibold" style={{ color: TSX.gold, letterSpacing: '2.5px' }}>
            SirReel Studio Services
          </div>
          <h1 className="mt-3 text-white text-[24px] font-light italic leading-tight" style={{ fontFamily: TSX_SERIF }}>
            {booking.person?.firstName ? `Welcome, ${booking.person.firstName}.` : 'Welcome to your portal.'}
          </h1>
          <p className="mt-2 text-white/70 text-[13px] font-semibold">{booking.jobName}</p>
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap text-[11px] text-white/50">
            {booking.company?.name && <span>{booking.company.name}</span>}
            {booking.startDate && (
              <>
                <span style={{ color: TSX.gold }}>·</span>
                <span>
                  {fmtShort(booking.startDate)}
                  {booking.endDate ? ` – ${fmtShort(booking.endDate)}` : ''}
                </span>
              </>
            )}
            {booking.agent?.name && (
              <>
                <span style={{ color: TSX.gold }}>·</span>
                <span>Your agent: {booking.agent.name}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress tracker */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-xl mx-auto px-5 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Paperwork</span>
            <span className={`text-[11px] font-bold ${allDone ? 'text-emerald-600' : 'text-gray-700'}`}>
              {allDone ? '🎉 All complete' : `${doneCount} of ${total} complete`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${total ? Math.max((doneCount / total) * 100, 4) : 0}%`,
                backgroundColor: allDone ? '#10b981' : TSX.gold,
              }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-3">
        {allDone && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-2">🎉</div>
            <div className="text-emerald-800 font-bold text-base">All paperwork submitted!</div>
            <div className="text-emerald-600 text-sm mt-1">
              Everything is on file with SirReel. {booking.agent?.name ? `${booking.agent.name} will` : 'We’ll'} reach out if anything
              else is needed — you&rsquo;re all set.
            </div>
          </div>
        )}

        {!allDone && !locked && (
          <p className="text-xs text-gray-400 px-1">
            Start with your details — we&rsquo;ll carry them into every document so you only enter them once.
          </p>
        )}

        <DetailsCard intake={intake} onSave={saveIntake} open={openKey === 'details'} onToggle={() => toggle('details')} />

        {showAgreement && (
          <RentalAgreementCard
            token={token}
            intake={intake}
            booking={booking}
            done={done.agreement}
            locked={locked}
            agreementState={agreementState}
            open={openKey === 'agreement'}
            onToggle={() => toggle('agreement')}
            onSigned={() => markDone('agreement')}
            onAgreementStateChange={setAgreementState}
          />
        )}

        {showAgreement && (
          <LcdwCard
            token={token}
            done={done.lcdw}
            accepted={!!paperwork.lcdwAccepted}
            locked={locked}
            signerName={paperwork.signerName || intake.fullName}
            open={openKey === 'lcdw'}
            onToggle={() => toggle('lcdw')}
            onSigned={(accepted) => {
              setPaperwork((p) => (p ? { ...p, lcdwAccepted: accepted } : p))
              markDone('lcdw')
            }}
          />
        )}

        {showStudio && (
          <StudioContractCard
            token={token}
            booking={booking}
            paperwork={paperwork}
            done={done.studio}
            locked={locked}
            open={openKey === 'studio'}
            onToggle={() => toggle('studio')}
            onSigned={() => markDone('studio')}
          />
        )}

        <CoiCard
          token={token}
          paperwork={paperwork}
          done={done.coi}
          locked={locked}
          open={openKey === 'coi'}
          onToggle={() => toggle('coi')}
          onComplete={() => markDone('coi')}
        />

        <CcAuthCard
          token={token}
          intake={intake}
          booking={booking}
          done={done.cc}
          locked={locked}
          open={openKey === 'cc'}
          onToggle={() => toggle('cc')}
          onAuthorized={() => markDone('cc')}
        />

        <div className="pt-1 pb-2 px-1">
          <a
            href={`mailto:${intake.email || booking.person?.email || ''}?subject=Your SirReel Paperwork Portal — ${booking.jobName}&body=Hi,%0A%0AHere is your link to your SirReel paperwork portal for ${booking.jobName}:%0A%0A${
              typeof window !== 'undefined' ? window.location.origin : ''
            }/portal/v2/${token}%0A%0AYour progress is saved automatically — return any time to pick up where you left off.%0A%0AQuestions? Call us at (818) 515-2389 or email info@sirreel.com.%0A%0AWarm regards,%0ASirReel Studio Services`}
            className="w-full flex items-center justify-center gap-2 py-3 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            📧 Email me this link for later
          </a>
        </div>
      </div>

      <footer className="mt-8 border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-xl mx-auto px-5 py-6 text-center">
          <div className="text-[18px]" style={{ fontFamily: TSX_SERIF, color: '#777', letterSpacing: '0.5px' }}>
            SirReel
          </div>
          <p className="mt-2 text-[10px] tracking-wide leading-relaxed" style={{ color: '#888' }}>
            SirReel Studio Services
            <br />
            8500 Lankershim Blvd, Sun Valley, CA 91352
          </p>
          <p className="mt-2 text-[11px]" style={{ color: TSX.gold }}>
            After-hours:{' '}
            <a href="tel:8884777335" style={{ color: TSX.gold }}>
              (888) 477-7335
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
