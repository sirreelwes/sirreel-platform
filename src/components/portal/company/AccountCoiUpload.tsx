'use client'

/**
 * "Upload a COI for your teams" — the account's certificates of insurance,
 * and the one action, in the production company's own portal.
 *
 * Wes 2026-09-11: "This should always be an option for them." So the button
 * renders whatever is on file — an accepted certificate does not hide it:
 * policies renew, a show can carry its own, and the person holding the
 * renewal should never have to ask where it goes.
 *
 * What a row says is deliberately narrow (companyPortalCois.ts): accepted /
 * with SirReel for review / not accepted / expired, and the dates. "Covers
 * your shows" only for a certificate the carry-forward will actually use.
 *
 * `preview` renders the same thing for HQ's "see what they see" with the
 * upload inert.
 */

import { useRef, useState } from 'react'
import { Check, ChevronDown, FileText, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { PORTAL } from '@/lib/brand/portalTokens'
import { CERTIFICATE_HOLDER, COI_REQUIREMENTS } from '@/lib/coi/requirements'
import type { ClientCoiRow, ClientCoiStatus } from '@/lib/portal/companyPortalCois'

const ACCEPT = 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const STATUS_CHIP: Record<ClientCoiStatus, { label: string; cls: string }> = {
  ACCEPTED: { label: 'Accepted', cls: 'bg-emerald-50 text-emerald-800' },
  IN_REVIEW: { label: 'With SirReel for review', cls: 'bg-amber-50 text-amber-900' },
  NOT_ACCEPTED: { label: 'Not accepted', cls: 'bg-red-50 text-red-800' },
  EXPIRED: { label: 'Expired', cls: 'bg-zinc-100 text-zinc-600' },
}

function rowSentence(r: ClientCoiRow): string {
  if (r.status === 'ACCEPTED') {
    return r.coversShows
      ? `Covers your shows through ${fmtDate(r.policyExpiry)}.`
      : 'Accepted, but no expiry date could be read — ask your rep before relying on it for other shows.'
  }
  if (r.status === 'IN_REVIEW') {
    return r.policyExpiry
      ? `Policy runs through ${fmtDate(r.policyExpiry)}. It covers your shows once SirReel accepts it.`
      : 'It covers your shows once SirReel accepts it.'
  }
  if (r.status === 'NOT_ACCEPTED') {
    return 'Your rep will say what the certificate is missing — upload the corrected one here.'
  }
  return `Lapsed ${fmtDate(r.policyExpiry)} — upload the renewal.`
}

export function AccountCoiUpload({
  companyId,
  initial,
  preview = false,
}: {
  companyId: string
  initial: ClientCoiRow[]
  /** HQ's "see what they see" — everything renders, nothing writes. */
  preview?: boolean
}) {
  const [cois, setCois] = useState<ClientCoiRow[]>(initial)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsOpen, setNeedsOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (preview) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setWarning(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/portal/company/${companyId}/coi`, { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'The upload did not go through. Try again, or send it to your rep.')
        return
      }
      setCois(data.cois)
      setNotice(`${file.name} is with SirReel for review. Once accepted it covers every show your company books until the policy expires.`)
      setWarning(data.insuredNotice || null)
    } catch {
      setError('The upload did not go through. Check your connection and try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-[62ch]">
          <div className="text-sm font-semibold text-zinc-900">One certificate for every show</div>
          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
            File your company&apos;s certificate of insurance here once. After SirReel accepts it, every
            show your company books uses it until the policy expires — each coordinator just confirms
            it&apos;s the right policy for their job instead of chasing a new certificate.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
          }}
        />
        <button
          type="button"
          onClick={() => !preview && !busy && input.current?.click()}
          disabled={busy}
          {...(preview ? { 'aria-disabled': true, title: 'Disabled in preview' } : {})}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white shrink-0 ${
            preview ? 'opacity-60 cursor-not-allowed' : busy ? 'opacity-80 cursor-wait' : ''
          }`}
          style={{ backgroundColor: PORTAL.gold }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? 'Reading your certificate…' : 'Upload a COI for your teams'}
        </button>
      </div>

      {(notice || warning || error) && (
        <div className="px-5 pb-4 space-y-2">
          {notice && (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <Check className="w-4 h-4 shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}
          {warning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
              {warning}
            </div>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
        </div>
      )}

      {cois.length > 0 ? (
        <ul className="border-t border-zinc-100 divide-y divide-zinc-100">
          {cois.map((c) => (
            <li key={c.id} className="px-5 py-3 flex items-start gap-3">
              {c.coversShows ? (
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <FileText className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-zinc-900 truncate max-w-full">{c.namedInsured || c.filename}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_CHIP[c.status].cls}`}>
                    {STATUS_CHIP[c.status].label}
                  </span>
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">{rowSentence(c)}</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  {c.namedInsured ? `${c.filename} · ` : ''}
                  {c.uploadedBy ? `Uploaded by ${c.uploadedBy}` : 'Filed by SirReel'} · {fmtDate(c.uploadedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          No certificate on file for the account yet — until there is one, each show sends its own.
        </div>
      )}

      <div className="border-t border-zinc-100">
        <button
          type="button"
          onClick={() => setNeedsOpen((v) => !v)}
          className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-zinc-600 hover:text-zinc-900"
        >
          <span>What the certificate needs to show</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${needsOpen ? 'rotate-180' : ''}`} />
        </button>
        {needsOpen && (
          <div className="px-5 pb-4 space-y-2">
            <ul className="space-y-1.5">
              {COI_REQUIREMENTS.map((r) => (
                <li key={r.label} className="text-xs text-zinc-800">
                  <span className="font-semibold">{r.label}</span>
                  {r.details && r.details.length > 0 && (
                    <ul className="mt-0.5 ml-4 list-disc text-zinc-600 space-y-0.5">
                      {r.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Certificate holder: {CERTIFICATE_HOLDER.name}, {CERTIFICATE_HOLDER.address}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
