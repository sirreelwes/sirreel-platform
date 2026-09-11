'use client'
/** Everything staff do for one partner from the Portals tab: logo, the
 *  agreement to sign, and the rate proposals waiting on a decision. */
import { useState } from 'react'
import { Camera, Check, FileSignature, FileText, Loader2, Percent, Send, ShieldCheck, Tag, Trash2, Upload, X } from 'lucide-react'
import { PARTNER_KINDS, partnerVocab, type PartnerKindKey } from '@/lib/sub-rentals/partnerKind'
import { PARTNER_SECTIONS, partnerSection, type PartnerCatalogSectionKey } from '@/lib/site/partnerSections'
import { PartnerWelcomeCard } from '@/components/crm/PartnerWelcomeCard'
import { VendorContactsPanel } from '@/components/crm/VendorContactsPanel'
import type { PartnerStage } from '@/lib/sub-rentals/partnerStage'
import { describeDeal, SIRREEL_FLOOR_PERCENT } from '@/lib/sub-rentals/discountWaterfall'

export interface RateProposalRow {
  unitId: string
  unitName: string
  current: { daily: number | null; weekly: number | null; monthly: number | null }
  proposed: { daily: number | null; weekly: number | null; monthly: number | null }
  at: string
  note: string | null
}

export function VendorPartnerPanel({ vendorId, hasLogo, agreement, proposals, contact, invited, sharePercent, maxSharePercent = null, sirreelContactUserId = null, staff = [], naming = null, welcomeSent = null, canSendWelcome = false, vendorName = 'this partner', coi, kind: kindInitial = 'VEHICLES', section: sectionInitial = 'LOCATION_VEHICLES', newPhotos = [], stage: stageInitial = 'partner' }: {
  vendorId: string
  hasLogo: boolean
  /** Units with partner-added photos nobody at HQ has looked at. Live already. */
  newPhotos?: { unitId: string; unitName: string; count: number; latestAt: string }[]
  /** What they rent us — picks the words everywhere and the agreement body. */
  kind?: PartnerKindKey
  /** Where their listed units sit on /vehicles by default. */
  section?: PartnerCatalogSectionKey
  /** Last time HQ emailed the account link, and to whom. */
  invited: { at: string; to: string } | null
  /** For the introduction's subject line and confirm dialog. */
  vendorName?: string
  /** When the INTRODUCTION went. Null = the account link stays locked. */
  welcomeSent?: { at: string; to: string | null } | null
  /** prospect → introduced → partner (Wes 2026-09-11: "no company gets
   *  onboarded until they reply and I mark it as a new partner"). Below
   *  partner, the account link is locked and the mark card shows. */
  stage?: PartnerStage
  /** Is the viewer the one person who may send the introduction? Server-gated
   *  too — this decides whether the compose card is even rendered. */
  canSendWelcome?: boolean
  /** SirReel's share of the vehicle rental rate — the deal. Null = not set. */
  sharePercent: number | null
  /** How far SirReel's share may rise to keep a client (discountWaterfall.ts). */
  maxSharePercent?: number | null
  /** Who at SirReel they call, shown on their page. Null = Wes. */
  sirreelContactUserId?: string | null
  /** People who can be that contact. */
  staff?: { id: string; name: string; email: string }[]
  /** Clause 10 permission to name them to clients, and what they said. */
  naming?: { allowed: boolean; note: string | null } | null
  /** Their certificate of insurance: when HQ received it and when it lapses. */
  coi: { receivedAt: string | null; expiresAt: string | null }
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
  const [inv, setInv] = useState(invited)
  const [welcome, setWelcome] = useState(welcomeSent)
  const [stage, setStage] = useState<PartnerStage>(stageInitial)
  const [share, setShare] = useState<number | null>(sharePercent)
  const [coiState, setCoiState] = useState(coi)
  const [coiExpiry, setCoiExpiry] = useState(coi.expiresAt ? coi.expiresAt.slice(0, 10) : '')
  const [shareDraft, setShareDraft] = useState(sharePercent == null ? '' : String(sharePercent))
  const [maxShare, setMaxShare] = useState<number | null>(maxSharePercent)
  const [maxDraft, setMaxDraft] = useState(maxSharePercent == null ? '' : String(maxSharePercent))
  const [ourContact, setOurContact] = useState(sirreelContactUserId ?? '')
  const [named, setNamed] = useState(!!naming?.allowed)
  const [nameNote, setNameNote] = useState(naming?.note ?? '')
  const [invTo, setInvTo] = useState(invited?.to ?? contact.email ?? '')
  const [kind, setKind] = useState<PartnerKindKey>(kindInitial)
  const [section, setSection] = useState<PartnerCatalogSectionKey>(sectionInitial)
  const words = partnerVocab(kind)
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
  async function saveCoi(received: boolean) {
    setBusy('coi'); setMsg(null)
    const body = received ? { coiReceivedAt: new Date().toISOString(), coiExpiresAt: coiExpiry || null } : { coiReceivedAt: null, coiExpiresAt: null }
    const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) { setCoiState(received ? { receivedAt: new Date().toISOString(), expiresAt: coiExpiry ? new Date(coiExpiry).toISOString() : null } : { receivedAt: null, expiresAt: null }); setMsg(received ? 'COI marked received.' : 'COI cleared.') }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function saveShare() {
    const raw = shareDraft.trim()
    const n = raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) { setMsg('Share must be 0–100.'); return }
    setBusy('share'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerSharePercent: n }) })
    if (r.ok) { setShare(n); setMsg(n == null ? 'Deal cleared.' : `Deal saved — SirReel keeps ${n}% of the vehicle rental rate. New bookings and the agreement use it; re-file the agreement so the PDF says so.`) }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function saveMaxShare() {
    const raw = maxDraft.trim()
    const n = raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) { setMsg('Maximum must be 0–100.'); return }
    if (n !== null && share != null && n < share) { setMsg(`The maximum can't be below the deal (${share}%).`); return }
    setBusy('maxShare'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerMaxSharePercent: n }) })
    if (r.ok) { setMaxShare(n); setMsg(n == null ? 'Maximum cleared — a client discount on their units now comes out of SirReel’s share alone.' : `Saved — to keep a client, SirReel’s share can rise to ${n}%. The agreement’s Terms box prints it; re-file the agreement so the PDF says so.`) }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function saveKind(next: PartnerKindKey) {
    setBusy('kind'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partnerKind: next }) })
    if (r.ok) { setKind(next); setMsg(next === 'EQUIPMENT' ? 'Equipment partner. Their page, welcome email and the standard agreement now say so — re-file the agreement if one is already filed.' : 'Vehicle partner. Their page, welcome email and the standard agreement now say so — re-file the agreement if one is already filed.') }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function saveSection(next: PartnerCatalogSectionKey) {
    setBusy('section'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogSection: next }) })
    if (r.ok) { setSection(next); setMsg(`Listed units now sit under “${partnerSection(next).title}” on sirreel.com unless a unit says otherwise.`) }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function markPartner() {
    if (!window.confirm(`${vendorName} replied and is a new partner? This seeds their starter roster, mints their account link and unlocks the account-link email.`)) return
    setBusy('mark'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}/mark-partner`, { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setStage('partner')
      setMsg(j.alreadyMarked
        ? 'Already a partner — nothing changed.'
        : `${vendorName} is a partner. ${j.seededUnits > 0 ? `${j.seededUnits} starter unit${j.seededUnits === 1 ? '' : 's'} seeded (rates empty — they propose from their page). ` : 'No starter roster on file — add units on the roster page. '}Account link minted; set the deal, file the agreement, then email the link below.`)
    } else setMsg(j?.error || 'Failed')
    setBusy(null)
  }
  async function sendInvite() {
    if (!invTo.trim()) return
    if (inv && !window.confirm(`Send the account link again, to ${invTo.trim()}?`)) return
    setBusy('invite'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: invTo.trim() }) })
    if (r.ok) { const j = await r.json(); setInv({ at: new Date().toISOString(), to: j.to }); setMsg(`Account link emailed to ${j.to}.`) }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  async function fileStandard() {
    if (ag && !window.confirm(ag.signedAt ? 'This replaces the signed agreement — they will need to sign again. Continue?' : 'This replaces the agreement waiting for signature. Continue?')) return
    setBusy('standard'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}/agreement/standard`, { method: 'POST' })
    if (r.ok) { const j = await r.json(); setAg({ title: j.title, signedAt: null, signerName: null, uploadedAt: new Date().toISOString() }); setAgTitle(j.title); setMsg('SirReel\u2019s standard Partner Vehicle Agreement is filed \u2014 it is now on their account page to sign.') }
    else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
    setBusy(null)
  }
  /** Clause 10: naming a partner to clients is THEIR permission to give, so
   *  turning it on needs a note saying where that permission came from.
   *  Withdrawing is immediate and needs no reason. */
  async function saveNaming(next: boolean) {
    if (next && !nameNote.trim()) { setMsg('Say where their written permission came from first.'); return }
    setBusy('naming'); setMsg(null)
    const r = await fetch(`/api/vendors/${vendorId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nameClientFacing: next, namePermissionNote: next ? nameNote.trim() : null }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setNamed(next)
      if (!next) setNameNote('')
      setMsg(next
        ? 'Clients will now see “Supplied by …” on their units in the catalog, on unlisted unit pages and in the portal’s arriving list. Quotes stay neutral.'
        : 'Their name is off every client-facing surface again.')
    } else setMsg(j?.error || 'Failed')
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

      {/* What they rent us — decides the words on every partner surface and
          which agreement body is filed. PowerTrip (generators, lifts) made
          this a setting; King Kong stays VEHICLES. */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><Tag className="w-4 h-4 text-lt-fg3" /> What they rent us</div>
        <div className="mt-2 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-lt-fg2 mb-1">Kind of partner</label>
            <select value={kind} onChange={(e) => saveKind(e.target.value as PartnerKindKey)} disabled={busy === 'kind'} className="w-full text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg">
              {PARTNER_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <div className="text-[11px] text-lt-fg3 mt-1">{words.hint}</div>
          </div>
          <div>
            <label className="block text-[11px] text-lt-fg2 mb-1">Section on sirreel.com</label>
            <select value={section} onChange={(e) => saveSection(e.target.value as PartnerCatalogSectionKey)} disabled={busy === 'section'} className="w-full text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg">
              {PARTNER_SECTIONS.map((sec) => <option key={sec.key} value={sec.key}>{sec.title}</option>)}
            </select>
            <div className="text-[11px] text-lt-fg3 mt-1">Where their listed units appear under “Also from SirReel”. A unit can pick its own section on its roster page.</div>
          </div>
        </div>
      </div>

      {/* The people at the partner — both sides keep this list. */}
      <VendorContactsPanel vendorId={vendorId} />

      {/* Who at SirReel they call — the card on their page. */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="text-sm font-medium text-lt-fg">Their SirReel contact</div>
        <div className="text-xs text-lt-fg2 mt-1">Shown on their partner page with a cell and email. Blank = Wes.</div>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={ourContact}
            disabled={busy === 'ourContact'}
            onChange={async (e) => {
              const next = e.target.value
              setBusy('ourContact'); setMsg(null)
              const r = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sirreelContactUserId: next || null }) })
              if (r.ok) { setOurContact(next); setMsg(`Saved — their page now names ${staff.find((s) => s.id === next)?.name ?? 'Wes Bailey'} as their SirReel contact.`) }
              else setMsg((await r.json().catch(() => ({})))?.error || 'Failed')
              setBusy(null)
            }}
            className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg"
          >
            <option value="">Wes Bailey (default)</option>
            {staff.filter((s) => s.email.toLowerCase() !== 'wes@sirreel.com').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {busy === 'ourContact' && <Loader2 className="w-3 h-3 animate-spin text-lt-fg3" />}
        </div>
      </div>

      {/* The deal */}
      <div className={`border rounded-lg p-3 ${share == null ? 'border-chip-bad-fg/40' : 'border-lt-hairline'}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><Percent className="w-4 h-4 text-lt-fg3" /> The deal</div>
        <div className="text-xs text-lt-fg2 mt-1">
          {share == null
            ? <span className="text-chip-bad-fg">Not set. Until it is, their units quote with no cost to us on the books and their page shows no split.</span>
            : <>SirReel keeps <span className="text-lt-fg font-semibold">{share}%</span> of the {words.rateNoun}; they receive {Math.round((100 - share) * 100) / 100}%. Their listed rate is what the production pays. A unit can override this on its roster page.</>}
        </div>
        <div className="text-[11px] text-lt-fg3 mt-1">
          Wes 2026-09-10: partners ask for a different split by emailing Wes, not through their page — so this field is the only place it changes.
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input value={shareDraft} onChange={(e) => setShareDraft(e.target.value)} inputMode="decimal" placeholder="20" className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg w-20 text-right" />
          <span className="text-xs text-lt-fg2">% to SirReel</span>
          <button onClick={saveShare} disabled={busy === 'share' || shareDraft.trim() === (share == null ? '' : String(share))} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
            {busy === 'share' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
          </button>
        </div>
        <div className="mt-3 pt-2 border-t border-lt-hairline">
          <div className="text-xs text-lt-fg2">
            <span className="text-lt-fg font-medium">To keep a client</span> — the most SirReel&apos;s share may rise when a production gets a discount on their unit (VSM Planet: deal 35%, they&apos;ll go to 43%). A discount is shared equally until it gets there, then comes out of SirReel&apos;s share, never below {SIRREEL_FLOOR_PERCENT}% of list. Blank = they don&apos;t flex.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} inputMode="decimal" placeholder={share == null ? '43' : String(share)} className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg w-20 text-right" />
            <span className="text-xs text-lt-fg2">% max to SirReel</span>
            <button onClick={saveMaxShare} disabled={busy === 'maxShare' || maxDraft.trim() === (maxShare == null ? '' : String(maxShare))} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
              {busy === 'maxShare' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
            </button>
          </div>
          {share != null && <div className="text-[11px] text-lt-fg3 mt-1.5">{describeDeal(share, maxShare)}</div>}
        </div>
      </div>

      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg">Naming them to clients</div>
        <div className="text-xs text-lt-fg2 mt-1">
          {named
            ? <>Clients see <span className="text-lt-fg font-semibold">“Supplied by {'{'}partner{'}'}”</span> on the catalog card, the unlisted unit page and the portal’s arriving list. Quotes stay neutral.</>
            : <>Their units render with no supplier named — the same as our own fleet. Agreement clause 10 makes this <span className="text-lt-fg font-semibold">their</span> permission to give, in writing.</>}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={nameNote}
            onChange={(e) => setNameNote(e.target.value)}
            placeholder="Where their permission came from — e.g. “Evan, email 10 Sep: happy to be credited”"
            className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg w-full"
          />
          <div>
            <button
              onClick={() => saveNaming(!named)}
              disabled={busy === 'naming'}
              className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40"
            >
              {busy === 'naming' ? <Loader2 className="w-3 h-3 animate-spin" /> : named ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              {named ? 'Stop naming them' : 'Name them to clients'}
            </button>
          </div>
        </div>
      </div>

      {/* Insurance certificate — deliberately NOT asked for in the welcome
          email (Wes 2026-09-06); the action item chases it after signing. */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><ShieldCheck className="w-4 h-4 text-lt-fg3" /> Insurance certificate</div>
        <div className="text-xs text-lt-fg2 mt-1">
          {coiState.receivedAt
            ? <>On file since {new Date(coiState.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{coiState.expiresAt ? <> · expires <span className={new Date(coiState.expiresAt) < new Date() ? 'text-chip-bad-fg' : 'text-lt-fg'}>{new Date(coiState.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></> : ' · no expiry recorded'}.</>
            : <span className="text-lt-fg3">None on file. Not asked for in the welcome; an action item asks a week after they sign. Mark it here when it arrives.</span>}
        </div>
        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input type="date" value={coiExpiry} onChange={(e) => setCoiExpiry(e.target.value)} className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg" title="Expiry date on the certificate" />
          <button onClick={() => saveCoi(true)} disabled={busy === 'coi'} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
            {busy === 'coi' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {coiState.receivedAt ? 'Update' : 'Mark received'}
          </button>
          {coiState.receivedAt && <button onClick={() => saveCoi(false)} disabled={busy === 'coi'} className="text-[11px] text-lt-fg3 underline">clear</button>}
        </div>
      </div>

      {/* The introduction — Wes only. Sits ABOVE the account link because it
          comes first, and the link below is disabled until it has gone. */}
      {canSendWelcome && (
        <PartnerWelcomeCard
          vendorId={vendorId}
          vendorName={vendorName}
          onSent={(at: string, to: string) => { setWelcome({ at, to }); setStage((st) => (st === 'prospect' ? 'introduced' : st)) }}
        />
      )}

      {/* The mark — Wes only (Wes 2026-09-11: "no company gets onboarded
          until they reply and I mark it as a new partner"). Shown while they
          are not yet a partner; the account link below stays locked. */}
      {stage !== 'partner' && (
        <div className="border border-lt-hairline rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><Check className="w-4 h-4 text-lt-fg3" /> New partner</div>
          <div className="text-xs text-lt-fg2 mt-1">
            {stage === 'prospect'
              ? <span>A prospect. Send the introduction{canSendWelcome ? ' above' : ' (Wes sends that)'}; when they reply, they are marked here.</span>
              : <span>Introduced{welcome?.at ? ` on ${new Date(welcome.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}. When they reply, mark {vendorName} as a new partner: that seeds their starter roster, mints their account link and unlocks the email below. Nothing reaches sirreel.com until units are listed and the agreement is signed.</span>}
          </div>
          <div className="mt-2">
            <button onClick={markPartner} disabled={stage !== 'introduced' || !canSendWelcome || busy === 'mark'} title={!canSendWelcome ? 'Wes marks new partners.' : stage !== 'introduced' ? 'The introduction has to go first.' : undefined} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
              {busy === 'mark' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Mark as new partner
            </button>
          </div>
        </div>
      )}

      {/* Invite */}
      <div className="border border-lt-hairline rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><Send className="w-4 h-4 text-lt-fg3" /> Account link</div>
        <div className="text-xs text-lt-fg2 mt-1">
          {inv ? <>Emailed to <span className="text-lt-fg">{inv.to}</span> on {new Date(inv.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</> : !welcome ? <span className="text-chip-warn-fg">Locked until the introduction goes out{canSendWelcome ? ' — send it above' : ' (Wes sends that)'}.</span> : stage !== 'partner' ? <span className="text-chip-warn-fg">Locked until they reply and are marked as a new partner{canSendWelcome ? ' — above' : ' (Wes does that)'}.</span> : <span className="text-lt-fg3">Not sent yet. The welcome email carries their link and the first-visit checklist (agreement, {words.many} &amp; rates, {words.drivers ? 'drivers, lot address' : 'delivery contacts, yard address'}).</span>}
        </div>
        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input value={invTo} onChange={(e) => setInvTo(e.target.value)} placeholder="partner@example.com" className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg sm:w-64" />
          <button onClick={sendInvite} disabled={!invTo.trim() || busy === 'invite' || !welcome || stage !== 'partner'} title={!welcome ? 'The introduction has to go first.' : stage !== 'partner' ? 'Mark them as a new partner first.' : undefined} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
            {busy === 'invite' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} {inv ? 'Send again' : 'Email the account link'}
          </button>
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
          <div className="text-xs text-lt-fg3 mt-1">None filed. File SirReel&apos;s standard agreement, or upload your own PDF — it appears on their page immediately.</div>
        )}
        <div className="mt-2">
          <button onClick={fileStandard} disabled={busy === 'standard'} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
            {busy === 'standard' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} {ag ? 'Re-file SirReel\u2019s standard agreement' : 'File SirReel\u2019s standard agreement'}
          </button>
          <span className="ml-2 text-[11px] text-lt-fg3">{kind === 'EQUIPMENT' ? 'Partner Equipment Agreement' : 'Partner Vehicle Agreement'}, pre-filled with their name and address.</span>
        </div>
        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <span className="text-[11px] text-lt-fg3 sm:w-auto">Or upload your own:</span>
          <input value={agTitle} onChange={(e) => setAgTitle(e.target.value)} placeholder="Title" className="text-xs border border-lt-hairline rounded-md px-2 py-1.5 bg-lt-card text-lt-fg sm:w-56" />
          <input type="file" accept="application/pdf" onChange={(e) => setAgFile(e.target.files?.[0] ?? null)} className="text-xs text-lt-fg2" />
          <button onClick={uploadAgreement} disabled={!agFile || busy === 'agreement'} className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg disabled:opacity-40">
            {busy === 'agreement' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} {ag ? 'Replace (re-sign)' : 'File for signature'}
          </button>
        </div>
      </div>

      {/* New partner photos — live already (Wes 2026-09-11), this is the glance. */}
      {newPhotos.length > 0 && (
        <div className="border border-chip-warn-fg/40 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-lt-fg"><Camera className="w-4 h-4 text-lt-fg3" /> New photos from the partner · {newPhotos.reduce((n, g) => n + g.count, 0)}</div>
          <div className="text-xs text-lt-fg2 mt-1">Already live wherever the unit is listed. Open each unit, look, and press “Looks good” or remove.</div>
          <div className="mt-2 divide-y divide-lt-hairline">
            {newPhotos.map((g) => (
              <div key={g.unitId} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-lt-fg">{g.unitName} <span className="text-lt-fg3">· {g.count} photo{g.count === 1 ? '' : 's'} · {new Date(g.latestAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
                <a href={`/sub-rentals/vehicles/${g.unitId}`} className="font-semibold text-lt-fg underline">Open unit</a>
              </div>
            ))}
          </div>
        </div>
      )}

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
