'use client'

/**
 * The unlisted client page for a subcontracted vehicle, and the estimate
 * that goes with it.
 *
 * Two deliberately separate acts:
 *   - the PAGE is unlisted, not secret. Anyone with the link sees photos and
 *     specs, and no rates at all.
 *   - the ESTIMATE carries the rates, and only ever goes to one named
 *     recipient a rep typed and reviewed.
 *
 * Re-minting is offered as the recovery path for a link that has travelled
 * somewhere it shouldn't, so the copy says plainly that the old URL dies.
 */

import { useEffect, useState } from 'react'
import SendEstimateModal from './SendEstimateModal'

export default function ClientPageCard({
  vehicleId,
  vehicleName,
  publicToken,
  publiclyListed,
  publicSlug,
  onChanged,
}: {
  vehicleId: string
  vehicleName: string
  publicToken: string | null
  publiclyListed: boolean
  publicSlug: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [estimateOpen, setEstimateOpen] = useState(false)
  // A page with no photos is not worth publishing, and the mint route
  // refuses it anyway — so disable the button rather than surface a 400.
  const [hasPhotos, setHasPhotos] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/sub-rentals/vehicles/${vehicleId}/photos`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setHasPhotos((j.photos ?? []).length > 0) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [vehicleId])

  const url = publicToken ? `https://sirreel.com/unit/${publicToken}` : null

  async function mint(replacing: boolean) {
    if (replacing && !confirm('Re-minting creates a new URL and immediately kills the current one. Anyone holding the old link will get a 404. Continue?')) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/public-link`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not create the link.'); return }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

  async function revoke() {
    if (!confirm('Revoke this page? Anyone holding the link gets a 404 immediately.')) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}/public-link`, { method: 'DELETE' })
      if (!r.ok) { const j = await r.json(); setError(j.error ?? 'Could not revoke.'); return }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

  async function toggleListed(next: boolean) {
    if (next && !confirm(`List ${vehicleName} in the PUBLIC vehicle catalog? Anyone browsing sirreel.com will see it, and it goes in the sitemap. The partner is never named and the price shown is the list rate.`)) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/sub-rentals/vehicles/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publiclyListed: next }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not change the listing.'); return }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Client page</h2>
        <span className="text-[11px] text-gray-400">unlisted · no rates</span>
      </div>

      <div className="p-4">
        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {!url ? (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              Publish a client-facing page for {vehicleName} — photos, specs and description, with
              no pricing anywhere on it. The page is linked from nowhere on sirreel.com and is
              excluded from search engines; the link itself is the only way in.
            </p>
            <button
              onClick={() => mint(false)}
              disabled={busy || !hasPhotos}
              className="mt-3 px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create client page'}
            </button>
            {!hasPhotos && (
              <p className="mt-2 text-xs text-gray-500">Add at least one photo first.</p>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs font-mono text-gray-700 bg-gray-50"
              />
              <button
                onClick={copy}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setEstimateOpen(true)}
                className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              >
                Send estimate to client
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Preview
              </a>
              <button
                onClick={() => mint(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Re-mint
              </button>
              <button
                onClick={revoke}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Revoke
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-500 leading-relaxed">
              Anyone with this link can view the page — treat it as shareable, not private.
              Re-mint to kill a link that has spread; revoke to take the page down entirely.
            </p>
          </>
        )}
      </div>

      <div className="px-4 py-3.5 border-t border-gray-200 bg-gray-50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Public catalog</div>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed max-w-[46ch]">
              {publiclyListed
                ? 'Listed — anyone browsing sirreel.com can find it.'
                : 'Not listed. Only people you send the link above to can see it.'}
              {' '}The partner is never named either way.
            </p>
            {publiclyListed && publicSlug && (
              <a
                href={`https://sirreel.com/vehicles/${publicSlug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-1.5 text-xs font-mono text-amber-700 hover:text-amber-600"
              >
                sirreel.com/vehicles/{publicSlug} →
              </a>
            )}
          </div>
          <button
            role="switch"
            aria-checked={publiclyListed}
            onClick={() => toggleListed(!publiclyListed)}
            disabled={busy}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
              publiclyListed ? 'bg-amber-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                publiclyListed ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {publiclyListed && !publicSlug && (
          <p className="mt-2 text-xs text-amber-700">
            Listed but no catalog URL yet — save the vehicle to generate one.
          </p>
        )}
      </div>

      {estimateOpen && (
        <SendEstimateModal
          vehicleId={vehicleId}
          vehicleName={vehicleName}
          onClose={() => setEstimateOpen(false)}
        />
      )}
    </div>
  )
}
