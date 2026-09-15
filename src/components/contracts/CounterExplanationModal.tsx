'use client'

/**
 * "Why we landed here" — the clause-by-clause explanation beside a
 * counter-proposal (Wes 2026-09-15: "a very tactful overview of how we
 * landed … hopefully soften the fact that we are not going with their
 * redline exactly").
 *
 * One component for both readers so staff preview exactly what the client
 * reads: the client portal opens it from the paperwork row; the job page
 * card opens it with `rewriteUrl`, which adds a "Rewrite" action.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'

type Outcome = 'ACCEPT' | 'COUNTER' | 'REJECT'

interface Explanation {
  intro: string
  closing: string
  generatedAt: string
  clauses: Array<{ key: string; title: string; outcome: Outcome; outcomeLabel: string; headline: string; explanation: string }>
}

const CHIP: Record<Outcome, string> = {
  ACCEPT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COUNTER: 'bg-amber-50 text-amber-800 border-amber-200',
  REJECT: 'bg-zinc-100 text-zinc-700 border-zinc-200',
}

export function CounterExplanationModal({
  url,
  rewriteUrl,
  pdfUrl,
  onClose,
}: {
  url: string
  /** Staff only: POST here to have it rewritten. */
  rewriteUrl?: string
  pdfUrl?: string
  onClose: () => void
}) {
  const [data, setData] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState<'load' | 'rewrite' | null>('load')
  const [err, setErr] = useState<string | null>(null)

  const fetchIt = useCallback(
    async (mode: 'load' | 'rewrite') => {
      setBusy(mode)
      setErr(null)
      try {
        const r = await fetch(mode === 'rewrite' && rewriteUrl ? rewriteUrl : url, {
          method: mode === 'rewrite' ? 'POST' : 'GET',
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.explanation) throw new Error(j.error || 'Not available right now.')
        setData(j.explanation)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Not available right now.')
      } finally {
        setBusy(null)
      }
    },
    [url, rewriteUrl],
  )

  useEffect(() => {
    void fetchIt('load')
  }, [fetchIt])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900">Why we landed here</div>
            <div className="text-xs text-zinc-500">Our notes on each change to the rental agreement</div>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-900" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {busy === 'load' && !data && (
            <p className="flex items-center gap-2 text-sm text-zinc-600">
              <Loader2 className="w-4 h-4 animate-spin" /> Pulling together our notes on each clause — this can take a minute…
            </p>
          )}
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          {data && (
            <>
              <p className="text-[15px] leading-relaxed text-zinc-800">{data.intro}</p>
              <ol className="space-y-3">
                {data.clauses.map((c) => (
                  <li key={c.key} className="rounded-xl border border-zinc-200 p-3.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{c.title}</div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CHIP[c.outcome]}`}>
                        {c.outcomeLabel}
                      </span>
                    </div>
                    {c.headline && <div className="mt-1.5 text-sm font-semibold text-zinc-900">{c.headline}</div>}
                    <p className="mt-1 text-sm leading-relaxed text-zinc-700">{c.explanation}</p>
                  </li>
                ))}
              </ol>
              <p className="text-sm leading-relaxed text-zinc-700">{data.closing}</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 flex-wrap">
          <div className="text-xs text-zinc-500">
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="font-semibold text-zinc-900 underline">
                Read the full counter-proposal
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {rewriteUrl && (
              <button
                type="button"
                onClick={() => void fetchIt('rewrite')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-zinc-500 disabled:opacity-40"
                title="Have the explanation written again — replaces what the client sees"
              >
                {busy === 'rewrite' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Rewrite
              </button>
            )}
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
