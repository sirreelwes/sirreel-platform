'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The RentalWorks connection meter.
 *
 * Collections reads balances out of the RW mirror, so "is the mirror being
 * fed" is a collections question — but until now the only answer lived in an
 * env var and a runbook. An expired token showed up as an invoice list that
 * quietly stopped growing.
 *
 * Green/yellow/red is driven by LIVE VERIFICATION, never by the token's own
 * exp claim: RentalWorks issues a cosmetic ~300-second exp that it honors for
 * weeks, so a meter keyed to it would read red five minutes after every
 * rotation and teach everyone to ignore it.
 */

interface RwStatus {
  health: 'green' | 'yellow' | 'red'
  lastRotatedAt: string | null
  lastVerifiedAt: string | null
  lastVerifyStatus: 'OK' | 'EXPIRED' | 'ERROR' | null
  rotateDueAt: string | null
  updatedBy: string | null
  usingEnvFallback: boolean
  canManage: boolean
}

const TONE: Record<RwStatus['health'], { dot: string; text: string; label: string }> = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Connected' },
  yellow: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Renewal due' },
  red: { dot: 'bg-rose-500', text: 'text-rose-700', label: 'Not connected' },
}

function when(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  const stamp = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (days <= 0) return `today (${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`
  return `${stamp} · ${days}d ago`
}

export function RwConnectionCard() {
  const [s, setS] = useState<RwStatus | null>(null)
  const [busy, setBusy] = useState<'verify' | 'paste' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [token, setToken] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/integrations/rw/status', { cache: 'no-store' })
      if (!r.ok) return
      setS((await r.json()) as RwStatus)
    } catch {
      /* the card is a read-out; a failed poll just leaves the last value */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const post = async (body: object, which: 'verify' | 'paste') => {
    setBusy(which)
    setMsg(null)
    try {
      const r = await fetch('/api/integrations/rw/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json().catch(() => ({}))) as RwStatus & {
        error?: string
        ok?: boolean
        adopted?: boolean
      }
      if (!r.ok || j.error) {
        setMsg({ kind: 'err', text: j.error || 'That did not go through.' })
      } else {
        setMsg({
          kind: j.ok === false ? 'err' : 'ok',
          text:
            which === 'paste'
              ? 'Token saved and verified.'
              : j.ok === false
                ? 'RentalWorks rejected the stored token.'
                : j.adopted
                  ? 'Verified, and moved out of the environment variable into encrypted storage.'
                  : 'Verified — RentalWorks accepted the token.',
        })
        if (which === 'paste') {
          setToken('')
          setPasteOpen(false)
        }
      }
      if (j.health) setS((prev) => (prev ? { ...prev, ...j } : prev))
      else void load()
    } catch {
      setMsg({ kind: 'err', text: 'That did not go through.' })
    } finally {
      setBusy(null)
    }
  }

  if (!s) return null
  const tone = TONE[s.health]

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-6">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[13px] font-semibold text-zinc-900">RentalWorks connection</span>
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${tone.text}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
          {tone.label}
        </span>
        {s.usingEnvFallback && (
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            still on the env var
          </span>
        )}
        <span className="ml-auto text-[12px] text-zinc-600">
          Checked {when(s.lastVerifiedAt)}
        </span>
      </div>

      <div className="mt-2 grid gap-x-6 gap-y-1 text-[12px] text-zinc-600 sm:grid-cols-3">
        <div>
          Renewed <span className="text-zinc-800">{when(s.lastRotatedAt)}</span>
        </div>
        <div>
          Renews again{' '}
          <span className="text-zinc-800">
            {s.rotateDueAt
              ? new Date(s.rotateDueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—'}
          </span>
        </div>
        <div>
          Last changed by <span className="text-zinc-800">{s.updatedBy ?? '—'}</span>
        </div>
      </div>

      {s.health === 'red' && (
        <div className="mt-2.5 text-[12px] text-rose-700">
          Invoice imports are stopped until this is fixed. Nothing falls back to another source.
        </div>
      )}

      {msg && (
        <div className={`mt-2.5 text-[12px] ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.text}
        </div>
      )}

      {s.canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void post({ action: 'verify' }, 'verify')}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-[12px] font-semibold text-zinc-800"
          >
            {busy === 'verify' ? 'Checking…' : 'Verify now'}
          </button>
          <button
            onClick={() => setPasteOpen((v) => !v)}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 hover:text-zinc-900"
          >
            {pasteOpen ? 'Cancel' : 'Paste a token…'}
          </button>
          {pasteOpen && (
            <div className="w-full flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJ…"
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                className="flex-1 min-w-[240px] rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[12px] font-mono text-zinc-900"
              />
              <button
                onClick={() => void post({ action: 'paste', token: token.trim() }, 'paste')}
                disabled={!!busy || !token.trim()}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[12px] font-semibold"
              >
                {busy === 'paste' ? 'Saving…' : 'Save & verify'}
              </button>
              <p className="w-full text-[11px] text-zinc-500">
                HQ renews this itself every 45 days. Pasting is the backup for when it cannot —
                the token is checked against RentalWorks before it is stored, and never shown again.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
