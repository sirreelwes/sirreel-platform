'use client'

/**
 * /portal/company/[companyId]/sign/annual — the executive signs the annual
 * rental agreement for the account.
 *
 * Same evidence the per-order sign page collects (typed name, title, the
 * acknowledgement as shown, a drawn signature), plus the LCDW election the
 * annual form has always carried ("I accept / decline LCDW for all fleet
 * vehicle rentals"). The document itself is the PDF, read in place — the
 * page never paraphrases the clauses.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { SignaturePad } from '@/components/portal/SignaturePad'
import { PORTAL } from '@/lib/brand/portalTokens'

const ACKNOWLEDGEMENT_TEXT =
  'I have read and agree to the Annual Rental Agreement above on behalf of my company, for all rentals during its term. By typing my name and clicking Sign, I am providing my electronic signature, which has the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.'

interface AnnualInfo {
  companyName: string
  signer: { name: string; email: string; title: string | null }
  pending: { id: string; title: string; effectiveDate: string | null; expiryDate: string | null } | null
  current: { id: string; title: string | null; expiryDate: string | null; signerName: string | null; signedAt: string | null } | null
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function SignAnnualPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = String(params?.companyId || '')

  const [info, setInfo] = useState<AnnualInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [lcdw, setLcdw] = useState<'ACCEPTED' | 'DECLINED' | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ paperedOrders: number } | null>(null)

  useEffect(() => {
    fetch(`/api/portal/company/${companyId}/annual`)
      .then(async (r) => {
        if (r.status === 404) { router.replace(`/portal/company?next=${encodeURIComponent(`/portal/company/${companyId}`)}`); return null }
        return r.json()
      })
      .then((j) => {
        if (!j) return
        setInfo(j)
        setSignerName(j.signer?.name || '')
        setSignerTitle(j.signer?.title || '')
      })
      .finally(() => setLoading(false))
  }, [companyId, router])

  const canSign = !!info?.pending && signerName.trim().length > 1 && !!lcdw && !!signature && acknowledged && !signing

  async function sign() {
    if (!canSign || !info?.pending) return
    setSigning(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/annual/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementId: info.pending.id,
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim() || null,
          lcdw,
          signatureImageData: signature,
          acknowledgmentText: ACKNOWLEDGEMENT_TEXT,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Signing failed')
      setDone({ paperedOrders: json.paperedOrders ?? 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href={`/portal/company/${companyId}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/70 hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" /> {info?.companyName || 'Your account'}
          </Link>
          <div className="text-[10px] uppercase font-semibold" style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}>
            Annual rental agreement
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : done ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-6">
            <div className="inline-flex items-center gap-2 text-emerald-700 font-semibold"><Check className="w-5 h-5" /> Signed.</div>
            <p className="text-sm text-zinc-700 mt-2 leading-relaxed">
              Thank you. Your annual agreement is on file and covers every show your teams book through its term
              {done.paperedOrders > 0 ? ` — including ${done.paperedOrders} open order${done.paperedOrders === 1 ? '' : 's'} already on the account` : ''}.
              Your coordinators won&apos;t be asked to sign a rental agreement per show.
            </p>
            <Link href={`/portal/company/${companyId}`} className="inline-block mt-4 text-sm font-semibold underline text-zinc-900">Back to your account</Link>
          </div>
        ) : info?.current ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-6 text-sm text-zinc-700">
            Your account already has a signed annual agreement{info.current.signerName ? ` (signed by ${info.current.signerName})` : ''}, through {fmt(info.current.expiryDate)}. Nothing to sign.
          </div>
        ) : !info?.pending ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-6 text-sm text-zinc-700">
            There&apos;s no annual agreement waiting for a signature on this account. Ask your SirReel rep if you&apos;d like one.
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-[22px] font-display leading-tight tracking-tight text-zinc-900">{info.pending.title}</h1>
              <p className="text-sm text-zinc-600 mt-1">
                {fmt(info.pending.effectiveDate)} → {fmt(info.pending.expiryDate)} · Read it in full below, then sign at the bottom.
              </p>
            </div>

            {/* The document, read in place. */}
            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <iframe
                title="Annual rental agreement"
                src={`/api/portal/company/${companyId}/agreement/${info.pending.id}/pdf#toolbar=0`}
                className="w-full h-[70vh]"
              />
              <div className="px-4 py-2 border-t border-zinc-100 text-xs text-zinc-500">
                Trouble viewing?{' '}
                <a href={`/api/portal/company/${companyId}/agreement/${info.pending.id}/pdf?download=1`} className="underline">Download the PDF</a>.
              </div>
            </div>

            {/* LCDW election — the annual form's own question. */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <div className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-2">Damage waiver (LCDW)</div>
              <p className="text-sm text-zinc-700 leading-relaxed">
                The Limited Collision Damage Waiver limits your responsibility for damage to fleet vehicles for a daily fee per vehicle. This election applies to every fleet vehicle rental on the account for the term; a coordinator can still change it for a specific show.
              </p>
              <div className="grid sm:grid-cols-2 gap-2 mt-3">
                {(['ACCEPTED', 'DECLINED'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setLcdw(v)}
                    className={`text-left rounded-lg border px-4 py-3 ${lcdw === v ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-400'}`}
                  >
                    <div className="text-sm font-semibold text-zinc-900">{v === 'ACCEPTED' ? 'Accept LCDW' : 'Decline LCDW'}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {v === 'ACCEPTED' ? 'for all fleet vehicle rentals' : 'for all fleet vehicle rentals — we carry our own coverage'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Signature */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
              <div className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500">Sign</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs text-zinc-500 mb-1">Your full name</span>
                  <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-900" />
                </label>
                <label className="block">
                  <span className="block text-xs text-zinc-500 mb-1">Title</span>
                  <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="Head of Production" className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-900" />
                </label>
              </div>
              <SignaturePad onChange={setSignature} />
              <label className="flex items-start gap-2.5 text-xs text-zinc-700 leading-relaxed cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-zinc-900 shrink-0" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>{ACKNOWLEDGEMENT_TEXT}</span>
              </label>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">Signing as {info.signer.email}</span>
                <button
                  type="button"
                  onClick={sign}
                  disabled={!canSign}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg text-white disabled:opacity-40"
                  style={{ backgroundColor: PORTAL.dark }}
                >
                  {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {signing ? 'Signing…' : 'Sign the annual agreement'}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
