'use client'
/** Everything staff do for one partner from the Portals tab: logo, the
 *  agreement to sign, and the rate proposals waiting on a decision. */
import { useState } from 'react'
import { Check, FileSignature, Loader2, Trash2, Upload, X } from 'lucide-react'

export interface RateProposalRow {
  unitId: string
  unitName: string
  current: { daily: number | null; weekly: number | null; monthly: number | null }
  proposed: { daily: number | null; weekly: number | null; monthly: number | null }
  at: string
  note: string | null
}

export function VendorPartnerPanel({ vendorId, hasLogo, agreement, proposals, contact }: {
  vendorId: string
  hasLogo: boolean
  agreement: { title: string; signedAt: string | null; signerName: string | null; uploadedAt: string } | null
  proposals: RateProposalRow[]
  contact: { name: string | null; email: string | null; phone: string | null; lotAddress: string | null }
}) {
  const [logo, setLogo] = useState(hasLogo)
  const [logoV, setLogoV] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [agTitle, setAgTitle] = useState(agreement?.title ?? 'SirReel Partner Agreement')
  const [agFile, setAgFile] = useState<File | null>(null)
  const [ag, setAg] = useState(agreement)
  const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

  async function uploadLogo(f: File) {
    setBusy('logo'); setMsg(null)
    const fd = new FormData(); fd.append('file', f)
    const r = await fetch(`/api/vendors/${vendorId}/logo`, { method: 'POST', body: fd })
    if (r.ok) { setLogo(true); setLogoV((v) => v + 1) } else setMsg((await r.json().catch(() => ({})))?.error || 'Upload failed')
    setBusy(null)
  }
  async function removeLogo() { setBusy('logo'); await fetch(`/api/vendors/${vendorId}/logo`, { method: 'DELETE' }); setLogo(false); setBusy(null) }
  async function uploadAgreement() {
    if (!agFile) return
    setBusy('agreement'); setMsg(null)
    const fd = new FormData(); fd.append('file', agFile); fd.append('title', agTitle)
    const r = await fetch(`/api/vendors/${vendorId}/agreement`, { method: 'POST', body: fd })
    if (r.ok) { setAg({ title: agTitle, signedAt: null, signerName: null, uploadedAt: new Date().toISOString() }); setAgFile(null); setMsg('Agreement filed — it is now on their account page to sign.') }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Upload failed')
    setBusy(null)
  }
  async function decide(unitId: string, decision: 'accept' | 'decline') {
    setBusy(unitId); setMsg(null)
    const r = await fetch(`/api/sub-rentals/vehicles/${unitId}/rate-proposal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
    if (r.ok) { setGone((g) => new Set(g).add(unitId)); setMsg(decision === 'accept' ? 'Rates updated.' : 'Proposal declined.') }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  const open = proposals.filter((p) => !gone.has(p.unitId))

  return (
    <div className="space-y-3">
      {msg && <div className="text-xs text-lt-fg2">{msg}</div>}

      <div className="grid sm:grid-cols-2 gap-3">
        {/* Logo */}
        <div className="border border-lt-hairline rounded-lg p-3 flex items-center gap-3">
          <div className="w-20 h-12 bg-white border border-lt-hairline rounded flex items-center justify-center shrink-0 overflow-hidden">
            {logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/vendors/${vendorId}/logo?v=${logoV}`} alt="" className="max-h-10 max-w-[72px] object-contain" /> : <span className="text-[10px] text-lt-fg3">no logo</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-lt-fg">Their logo</div>
            <div className="text-[11px] text-lt-fg2">Masthead of their account page. SVG best.</div>
          </div>
          <label className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg cursor-pointer">
            {busy === 'logo' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} {logo ? 'Replace' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = '' }} />
          </label>
          {logo && <button onClick={removeLogo} className="text-lt-fg3 hover:text-chip-bad-fg"><Trash2 className="w-4 h-4" /></button>}
        </div>

        {/* Contact (read-only here; they edit it themselves) */}
        <div className="border border-lt-hairline rounded-lg p-3">
          <div className="text-sm font-medium text-lt-fg">Contact on file</div>
          <div className="text-xs text-lt-fg2 mt-1 leading-relaxed">
            {contact.name || <span className="text-lt-fg3">no name</span>}<br />
            {contact.email || '—'}{contact.phone ? ` · ${contact.phone}` : ''}<br />
            <span className="text-lt-fg3">{contact.lotAddress ? `Lot: ${contact.lotAddress}` : 'no lot address'}</span>
          </div>
          <div className="text-[11px] text-lt-fg3 mt-1">They can update this from their page; you&apos;re emailed when they do.</div>
        </div>
      </div>

      {/* Agreement */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><FileSignature className="w-4 h-4 text-lt-fg3" /> Partner agreement</div>
        {ag ? (
          <div className="text-xs text-lt-fg2 mt-1">
            <span className="text-lt-fg">{ag.title}</span> · {ag.signedAt ? <span className="text-chip-good-fg">signed{ag.signerName ? ` by ${ag.signerName}` : ''} {new Date(ag.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : <span className="text-chip-warn-fg">waiting for their signature</span>}
            {' · '}<a href={`/api/vendors/${vendorId}/agreement`} target="_blank" rel="noreferrer" className="underline">open</a>
          </div>
        ) : (
          <div className="text-xs text-lt-fg3 mt-1">None filed. Upload the PDF they should sign — it appears on their page immediately.</div>
        )}
        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input value={agTitle} onChange={(e) => setAgTitle(e.target.value)} placeholder="Title" className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg sm:w-56" />
          <input type="file" accept="application/pdf" onChange={(e) => setAgFile(e.target.files?.[0] ?? null)} className="text-xs text-lt-fg2" />
          <button onClick={uploadAgreement} disabled={!agFile || busy === 'agreement'} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
            {busy === 'agreement' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} {ag ? 'Replace (re-sign)' : 'File for signature'}
          </button>
        </div>
      </div>

      {/* Rate proposals */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="text-sm font-medium text-lt-fg">Rate proposals · {open.length}</div>
        {open.length === 0 ? (
          <div className="text-xs text-lt-fg3 mt-1">Nothing waiting. Their current rates are what we quote from.</div>
        ) : (
          <div className="mt-2 divide-y divide-lt-hairline">
            {open.map((p) => (
              <div key={p.unitId} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-lt-fg">{p.unitName}</div>
                  <div className="text-xs text-lt-fg2">
                    daily {money(p.current.daily)} → <strong className="text-lt-fg">{money(p.proposed.daily)}</strong>
                    {' · '}weekly {money(p.current.weekly)} → <strong className="text-lt-fg">{money(p.proposed.weekly)}</strong>
                    {p.proposed.monthly != null && <> · monthly {money(p.current.monthly)} → <strong className="text-lt-fg">{money(p.proposed.monthly)}</strong></>}
                  </div>
                  {p.note && <div className="text-xs text-lt-fg3 italic mt-0.5">“{p.note}”</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => decide(p.unitId, 'accept')} disabled={busy === p.unitId} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 bg-chip-good-bg text-chip-good-fg"><Check className="w-3 h-3" /> Accept</button>
                  <button onClick={() => decide(p.unitId, 'decline')} disabled={busy === p.unitId} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 bg-chip-neutral-bg text-chip-neutral-fg"><X className="w-3 h-3" /> Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
