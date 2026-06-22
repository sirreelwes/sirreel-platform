'use client'

/**
 * Incident detail. Three action buttons surface here:
 *
 *   - Upgrade to claim — enforces the carrier-required floor
 *     (filedAgainst + carrierClaimNumber). Routes to InsuranceClaim
 *     creation.
 *   - Bill renter      — opens a damage-finding form, posts to the
 *     bill-renter action which writes DamageItem rows with
 *     incidentId. The existing LD invoice generator (unchanged) is
 *     hit afterwards from the order detail page.
 *   - Edit fields      — inline PATCH for description / occurredAt /
 *     order/asset/company links.
 *
 * Cross-link to LD records (the existing surface on /orders/[id]) is
 * surfaced as a "View on order →" button when the Incident has an
 * Order link, per the spec ("L&D views stay where they are this
 * phase; add a cross-link from incidents with BILLED_RENTER to their
 * LD records").
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type IncidentSource = 'EMAIL' | 'RETURN_INSPECTION' | 'MANUAL'
type IncidentStatus = 'OPEN' | 'CLAIM_FILED' | 'BILLED_RENTER' | 'RESOLVED' | 'WRITTEN_OFF'

interface IncidentDetail {
  id: string
  incidentNumber: string
  source: IncidentSource
  status: IncidentStatus
  description: string
  occurredAt: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string } | null
  order: { id: string; orderNumber: string; bookingId: string | null } | null
  asset: { id: string; unitName: string; year: number | null; make: string | null; model: string | null } | null
  claims: Array<{
    id: string; claimNumber: string; status: string; filedAgainst: string;
    carrierClaimNumber: string | null; createdAt: string;
  }>
  damageItems: Array<{
    id: string; damageType: string; severity: string;
    locationOnVehicle: string; estimatedRepairCost: number | string | null;
    disposition: string; invoiceId: string | null; claimId: string | null;
  }>
  documents: Array<{ id: string; title: string; fileUrl: string; type: string }>
  claimMail: Array<{
    id: string;
    parse: Record<string, unknown> | null;
    reason: string | null;
    emailMessage: { id: string; subject: string; fromAddress: string; sentAt: string };
  }>
}

const STATUS_TONE: Record<IncidentStatus, string> = {
  OPEN:          'bg-chip-warn-bg text-chip-warn-fg',
  CLAIM_FILED:   'bg-chip-neutral-bg text-chip-neutral-fg',
  BILLED_RENTER: 'bg-chip-neutral-bg text-chip-neutral-fg',
  RESOLVED:      'bg-chip-good-bg text-chip-good-fg',
  WRITTEN_OFF:   'bg-lt-inner text-lt-fg3',
}
const STATUS_LABEL: Record<IncidentStatus, string> = {
  OPEN: 'Open', CLAIM_FILED: 'Claim filed', BILLED_RENTER: 'Billed renter',
  RESOLVED: 'Resolved', WRITTEN_OFF: 'Written off',
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function IncidentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [incident, setIncident] = useState<IncidentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showBillRenter, setShowBillRenter] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/incidents/${id}`)
      if (res.status === 404) { setError('Incident not found'); return }
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const data = await res.json()
      setIncident(data.incident)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]"><p className="text-sm text-lt-fg2">Loading…</p></div>
  if (error || !incident) return <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]"><p className="text-sm text-chip-bad-fg">{error ?? 'Not found'}</p></div>

  const canUpgrade = !!incident.company // server gate enforces this; UI mirrors
  const canBillRenter = !!incident.order // server returns 409 otherwise

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div className="flex items-baseline gap-4">
          <Link href="/incidents" className="text-xs text-lt-fg3 hover:text-lt-fg">← All incidents</Link>
        </div>

        {/* Profile */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-lt-fg font-mono">{incident.incidentNumber}</h1>
              <p className="text-sm text-lt-fg2 mt-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[incident.status]}`}>
                  {STATUS_LABEL[incident.status]}
                </span>
                <span className="ml-3 text-xs text-lt-fg3">Source: {incident.source.toLowerCase().replace('_', ' ')}</span>
              </p>
            </div>
            <div className="text-xs text-lt-fg3 space-y-0.5 text-right">
              <div>Created {fmtDate(incident.createdAt)}</div>
              {incident.occurredAt && <div>Occurred {fmtDate(incident.occurredAt)}</div>}
            </div>
          </div>
          <p className="text-sm text-lt-fg mt-4 whitespace-pre-wrap">{incident.description}</p>
          <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
            <Field label="Client">
              {incident.company ? (
                incident.company.name
              ) : (
                <LinkCompanyAffordance
                  incidentId={id}
                  parsedName={readParsedClient(incident)}
                  onLinked={load}
                />
              )}
            </Field>
            <Field label="Order">
              {incident.order ? (
                <Link href={`/orders/${incident.order.id}`} className="font-mono text-lt-fg hover:text-black hover:underline">
                  {incident.order.orderNumber}
                </Link>
              ) : '—'}
            </Field>
            <Field label="Asset">
              {incident.asset ? `${incident.asset.unitName}${incident.asset.make ? ` (${incident.asset.make} ${incident.asset.model})` : ''}` : '—'}
            </Field>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowUpgrade(true)}
            disabled={!canUpgrade}
            title={canUpgrade ? 'Open the carrier-required upgrade form' : 'Link a Client first — InsuranceClaim requires a company'}
            className="text-sm px-3 py-1.5 rounded border border-lt-fg/30 bg-lt-card hover:bg-lt-fg hover:text-white text-lt-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Upgrade to claim
          </button>
          <button
            onClick={() => setShowBillRenter(true)}
            disabled={!canBillRenter}
            title={canBillRenter ? 'Capture damages → bill renter (existing LD flow)' : 'Link an Order first — LD billing chains through Order.Booking'}
            className="text-sm px-3 py-1.5 rounded border border-lt-fg/30 bg-lt-card hover:bg-lt-fg hover:text-white text-lt-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Bill renter
          </button>
          {incident.order && (
            <Link
              href={`/orders/${incident.order.id}`}
              className="text-sm px-3 py-1.5 rounded border border-lt-hairline text-lt-fg2 hover:bg-lt-inner transition-colors"
            >
              View on order →
            </Link>
          )}
        </div>

        {/* Linked claims */}
        <Section title={`Claims (${incident.claims.length})`}>
          {incident.claims.length === 0 ? (
            <p className="text-xs text-lt-fg3">No claims yet. Use "Upgrade to claim" above when carrier details are known.</p>
          ) : (
            <ul className="space-y-1.5">
              {incident.claims.map((c) => (
                <li key={c.id} className="text-xs flex items-baseline gap-3">
                  <Link href={`/claims/${c.id}`} className="font-mono text-lt-fg hover:text-black hover:underline">{c.claimNumber}</Link>
                  <span className="text-lt-fg2">{c.status}</span>
                  <span className="text-lt-fg3">vs {c.filedAgainst}</span>
                  {c.carrierClaimNumber && <span className="text-lt-fg3 font-mono">#{c.carrierClaimNumber}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Linked damage items */}
        <Section title={`Damages (${incident.damageItems.length})`}>
          {incident.damageItems.length === 0 ? (
            <p className="text-xs text-lt-fg3">No damages logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {incident.damageItems.map((d) => (
                <li key={d.id} className="text-xs flex items-baseline gap-3 flex-wrap">
                  <span className="text-lt-fg font-medium">{d.locationOnVehicle}</span>
                  <span className="text-lt-fg2">{d.damageType} · {d.severity}</span>
                  {d.estimatedRepairCost != null && (
                    <span className="font-mono text-lt-fg2">${Number(d.estimatedRepairCost).toFixed(2)}</span>
                  )}
                  <span className="text-[10px] uppercase text-lt-fg3 tracking-wider">{d.disposition}</span>
                  {d.invoiceId && <span className="text-[10px] text-chip-good-fg">on invoice</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Documents */}
        <Section title={`Documents (${incident.documents.length})`}>
          {incident.documents.length === 0 ? (
            <p className="text-xs text-lt-fg3">No documents yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {incident.documents.map((d) => (
                <li key={d.id} className="text-xs">
                  <a href={`/api/claims/documents/${d.id}/download`} target="_blank" rel="noreferrer" className="text-lt-fg hover:text-black hover:underline">{d.title}</a>
                  <span className="ml-2 text-[10px] uppercase text-lt-fg3 tracking-wider">{d.type}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Original email parse (when source=EMAIL) */}
        {incident.claimMail.length > 0 && (
          <Section title="Originating email">
            {incident.claimMail.map((cm) => (
              <div key={cm.id} className="text-xs space-y-1">
                <div>
                  <span className="text-lt-fg font-medium">{cm.emailMessage.subject}</span>
                  <span className="ml-2 text-lt-fg3">from {cm.emailMessage.fromAddress.slice(0, 60)}</span>
                </div>
                <div className="text-lt-fg3">{fmtDate(cm.emailMessage.sentAt)}</div>
                {cm.parse && typeof cm.parse === 'object' && (
                  <pre className="bg-lt-inner p-2 rounded text-[10px] overflow-x-auto">{JSON.stringify(cm.parse, null, 2).slice(0, 800)}</pre>
                )}
              </div>
            ))}
          </Section>
        )}

        {showUpgrade && (
          <UpgradeToClaimModal
            incidentId={id}
            onClose={() => { setShowUpgrade(false); load() }}
          />
        )}
        {showBillRenter && (
          <BillRenterModal
            incidentId={id}
            onClose={() => { setShowBillRenter(false); load() }}
          />
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-lt-fg3">{label}</div>
      <div className="text-sm text-lt-fg mt-0.5">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-lt-fg3 mb-3">{title}</h2>
      {children}
    </div>
  )
}

// ── Upgrade to claim modal ─────────────────────────────────────────

function UpgradeToClaimModal({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [filedAgainst, setFiledAgainst] = useState('')
  const [carrierClaimNumber, setCarrierClaimNumber] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [adjusterName, setAdjusterName] = useState('')
  const [adjusterEmail, setAdjusterEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!filedAgainst.trim() || !carrierClaimNumber.trim()) {
      setError('Carrier name AND carrier claim number are both required')
      return
    }
    setPending(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/upgrade-to-claim`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filedAgainst: filedAgainst.trim(),
          carrierClaimNumber: carrierClaimNumber.trim(),
          policyNumber: policyNumber.trim() || undefined,
          adjusterName: adjusterName.trim() || undefined,
          adjusterEmail: adjusterEmail.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || `HTTP ${res.status}`); setPending(false); return }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-20">
      <div className="bg-lt-card rounded-xl w-full max-w-lg p-6 space-y-3 shadow-xl">
        <h2 className="text-lg font-semibold text-lt-fg">Upgrade to claim</h2>
        <p className="text-xs text-lt-fg3">
          Carrier name + carrier claim number are required — this is the carrier-required floor.
        </p>
        <FormField label="Carrier (filed against) *">
          <input value={filedAgainst} onChange={(e) => setFiledAgainst(e.target.value)} placeholder="e.g. Intact Insurance"
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm" />
        </FormField>
        <FormField label="Carrier claim # *">
          <input value={carrierClaimNumber} onChange={(e) => setCarrierClaimNumber(e.target.value)} placeholder="e.g. 0AB459860"
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm font-mono" />
        </FormField>
        <FormField label="Policy # (optional)">
          <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)}
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm font-mono" />
        </FormField>
        <FormField label="Adjuster name (optional)">
          <input value={adjusterName} onChange={(e) => setAdjusterName(e.target.value)}
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm" />
        </FormField>
        <FormField label="Adjuster email (optional)">
          <input value={adjusterEmail} onChange={(e) => setAdjusterEmail(e.target.value)}
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm" />
        </FormField>
        {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs text-lt-fg2 hover:text-lt-fg px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={pending} className="text-xs bg-lt-fg text-white px-3 py-1.5 rounded disabled:opacity-50">
            {pending ? 'Filing…' : 'File claim'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bill renter modal ─────────────────────────────────────────────

function BillRenterModal({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [location, setLocation] = useState('')
  const [damageType, setDamageType] = useState('SCRATCH')
  const [severity, setSeverity] = useState('MINOR')
  const [cost, setCost] = useState('')
  const [disposition, setDisposition] = useState<'BILL_NOW' | 'SEND_TO_LD'>('BILL_NOW')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!location.trim()) { setError('Location required'); return }
    setPending(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/bill-renter`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findings: [{
            locationOnVehicle: location.trim(),
            damageType, severity, disposition,
            estimatedRepairCost: cost ? Number(cost) : null,
            isPreExisting: false,
          }],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || `HTTP ${res.status}`); setPending(false); return }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-20">
      <div className="bg-lt-card rounded-xl w-full max-w-lg p-6 space-y-3 shadow-xl">
        <h2 className="text-lg font-semibold text-lt-fg">Bill renter</h2>
        <p className="text-xs text-lt-fg3">
          Captures DamageItem(s) on this incident. The existing L&D invoice flow on the order detail page picks up SEND_TO_LD rows; BILL_NOW rows land on the next RENTAL invoice automatically.
        </p>
        <FormField label="Location on vehicle">
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. driver side rear panel"
            className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type">
            <select value={damageType} onChange={(e) => setDamageType(e.target.value)} className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm">
              {['SCRATCH','DENT','CRACK','MISSING_PART','MECHANICAL','INTERIOR','OTHER'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Severity">
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm">
              {['MINOR','MODERATE','MAJOR'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Estimated cost ($)">
            <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)}
              className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm font-mono" />
          </FormField>
          <FormField label="Disposition">
            <select value={disposition} onChange={(e) => setDisposition(e.target.value as 'BILL_NOW' | 'SEND_TO_LD')} className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm">
              <option value="BILL_NOW">BILL_NOW (rental invoice)</option>
              <option value="SEND_TO_LD">SEND_TO_LD (LD invoice)</option>
            </select>
          </FormField>
        </div>
        {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs text-lt-fg2 hover:text-lt-fg px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={pending} className="text-xs bg-lt-fg text-white px-3 py-1.5 rounded disabled:opacity-50">
            {pending ? 'Capturing…' : 'Capture damage'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-lt-fg2">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

// ── Link-company affordance (parsed name + searchable picker) ────
// Renders inline in the Client field of the profile card when the
// incident has no companyId yet. The parsed name is sourced from the
// originating ClaimMail row's Sonnet parse — when present, it's the
// label the rep sees so they know what to search for. No auto-create
// path: the picker only links to existing CRM companies.

function readParsedClient(incident: IncidentDetail): string | null {
  for (const cm of incident.claimMail) {
    if (cm.parse && typeof cm.parse === 'object') {
      const name = (cm.parse as Record<string, unknown>).clientCompanyName
      if (typeof name === 'string' && name.trim().length > 0) return name.trim()
    }
  }
  return null
}

interface CompanyHit {
  id: string
  name: string
}

function LinkCompanyAffordance({
  incidentId, parsedName, onLinked,
}: {
  incidentId: string
  parsedName: string | null
  onLinked: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(parsedName ?? '')
  const [hits, setHits] = useState<CompanyHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search whenever the query changes — debounced via a small setTimeout
  // so the typeahead doesn't fire on every keystroke.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        const arr: CompanyHit[] = Array.isArray(data?.companies) ? data.companies : []
        setHits(arr.slice(0, 8).map((c) => ({ id: c.id, name: c.name })))
      } catch { /* empty state */ }
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, query])

  const link = async (companyId: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || `HTTP ${res.status}`); setBusy(false); return }
      setOpen(false)
      onLinked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="text-sm">
        {parsedName ? (
          <>
            <span className="italic text-lt-fg2">"{parsedName}"</span>
            <span className="ml-2 text-[10px] uppercase tracking-wider text-lt-fg3">parsed · unlinked</span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="ml-3 text-xs text-lt-fg2 hover:text-lt-fg underline-offset-2 hover:underline"
            >
              Link company
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-lt-fg2 hover:text-lt-fg underline-offset-2 hover:underline"
          >
            + Link company
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="text-sm space-y-1.5">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search existing companies…"
        className="w-full px-2 py-1.5 border border-lt-hairline rounded text-sm"
      />
      {hits.length > 0 && (
        <ul className="border border-lt-hairline rounded bg-lt-card max-h-[200px] overflow-y-auto divide-y divide-lt-hairline">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => link(c.id)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-lt-inner disabled:opacity-50"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits.length === 0 && query.trim().length >= 2 && !busy && (
        <div className="text-xs text-lt-fg3 italic">
          No matches. Companies can only be linked from the CRM — create one there first if needed.
        </div>
      )}
      {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-lt-fg3 hover:text-lt-fg2"
      >
        Cancel
      </button>
    </div>
  )
}
