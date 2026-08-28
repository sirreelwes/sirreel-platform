'use client'

/**
 * Outreach composer — pick an audience, write the copy, see what real
 * recipients will get, then release.
 *
 * The design puts the three uncomfortable numbers ABOVE the copy box:
 * how many people this reaches, how many are suppressed, and how many
 * the copy cannot be personalised for. A composer that shows those only
 * after you have written something is a composer that encourages you to
 * send anyway.
 *
 * Previews are of REAL contacts, taken from the front, middle and end of
 * the audience — the risk in a merge is the sparse record, and a
 * synthetic "Jane Example" hides exactly those.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  PEOPLE_SEGMENT_KEYS,
  PEOPLE_SEGMENTS,
  type PeopleSegmentKey,
} from '@/lib/crm/peopleSegments'
import { MERGE_TOKENS, MERGE_TOKEN_META } from '@/lib/outreach/mergeFields'

interface PreviewRow {
  personId: string
  email: string
  ok: boolean
  subject: string
  body: string
  missing: string[]
}

interface FunnelStage {
  key: string
  label: string
  value: number
  influenced?: boolean
  note?: string
}

interface Scoreboard {
  firstSendAt: string | null
  windowDays: number
  funnel: FunnelStage[]
  deliverability: { delivered: number; bounced: number; complained: number; bounceRate: number | null }
  influencedRevenue: number
}

interface PreviewResponse {
  audience: {
    total: number
    suppressed: number
    sendable: number
    unrenderable: number
    unrenderableByToken: Record<string, number>
    readyToSend: number
  }
  unknownTokens: string[]
  previews: PreviewRow[]
  sending: {
    allowed: boolean
    reason: string | null
    message: string | null
    remainingPerRep: number
    remainingGlobal: number
  }
}

export default function OutreachComposerPage() {
  const [segment, setSegment] = useState<PeopleSegmentKey | ''>('')
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyTemplate, setBodyTemplate] = useState('')
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [board, setBoard] = useState<Scoreboard | null>(null)

  useEffect(() => {
    fetch('/api/outreach/scoreboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBoard(d))
      .catch(() => undefined)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/outreach/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentKey: segment || null, subject, bodyTemplate }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'preview failed')
    } finally {
      setLoading(false)
    }
  }, [segment, subject, bodyTemplate])

  // Audience refreshes on segment change immediately; copy changes are
  // debounced so typing doesn't hammer the endpoint.
  useEffect(() => {
    const t = setTimeout(refresh, 400)
    return () => clearTimeout(t)
  }, [refresh])

  const createDraft = async () => {
    setCreating(true)
    setErr(null)
    setNotice(null)
    try {
      const res = await fetch('/api/outreach/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subject, bodyTemplate, segmentKey: segment || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      const counts = json.statusCounts ?? {}
      setNotice(
        `Draft saved — ${counts.PENDING ?? 0} ready to send` +
          (counts.SKIPPED ? `, ${counts.SKIPPED} skipped` : '') +
          '. Nothing has been sent.',
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not save draft')
    } finally {
      setCreating(false)
    }
  }

  const a = data?.audience
  const canDraft = !!name.trim() && !!subject.trim() && !!bodyTemplate.trim() && (a?.readyToSend ?? 0) > 0

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">Outreach</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Compose against a segment. Nothing sends until you release it.
          </p>
        </div>

        {/* Sending status — stated up front, not discovered at release. */}
        {data && !data.sending.allowed && (
          <div className="rounded-xl border border-chip-warn-fg/30 bg-chip-warn-bg px-4 py-3">
            <p className="text-sm font-semibold text-chip-warn-fg">Sending is currently closed</p>
            <p className="text-xs text-chip-warn-fg mt-1">{data.sending.message}</p>
            <p className="text-xs text-chip-warn-fg mt-1">
              You can still build and save the campaign — it will send when this is opened.
            </p>
          </div>
        )}

        <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="seg" className="block text-xs text-lt-fg3 mb-1">Audience</label>
              <select id="seg" value={segment}
                onChange={(e) => setSegment(e.target.value as PeopleSegmentKey | '')}
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg">
                <option value="">Everyone (no segment)</option>
                {PEOPLE_SEGMENT_KEYS.map((k) => (
                  <option key={k} value={k}>{PEOPLE_SEGMENTS[k].label}</option>
                ))}
              </select>
              {segment && (
                <p className="text-[11px] text-lt-fg3 mt-1">{PEOPLE_SEGMENTS[segment].description}</p>
              )}
            </div>
            <div>
              <label htmlFor="cname" className="block text-xs text-lt-fg3 mb-1">Campaign name (internal)</label>
              <input id="cname" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Sept — art department, stages"
                className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3" />
            </div>
          </div>

          {/* The three numbers, before the copy box. */}
          {a && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'In segment', value: a.total, tone: 'text-lt-fg' },
                { label: 'Suppressed', value: a.suppressed, tone: a.suppressed > 0 ? 'text-chip-bad-fg' : 'text-lt-fg3' },
                { label: "Can't personalise", value: a.unrenderable, tone: a.unrenderable > 0 ? 'text-chip-warn-fg' : 'text-lt-fg3' },
                { label: 'Ready to send', value: a.readyToSend, tone: 'text-chip-good-fg' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-lt-fg3">{s.label}</div>
                  <div className={`text-xl font-semibold tabular-nums ${s.tone}`}>{s.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}

          {a && a.unrenderable > 0 && (
            <p className="text-xs text-chip-warn-fg">
              {a.unrenderable.toLocaleString()} contacts will be skipped because the copy uses a value they
              don&rsquo;t have
              {Object.keys(a.unrenderableByToken).length > 0 && (
                <> — mostly <code className="font-mono">{Object.entries(a.unrenderableByToken).sort((x, y) => y[1] - x[1])[0][0]}</code></>
              )}
              . Wrap that sentence in <code className="font-mono">{'{{#token}}…{{/token}}'}</code> to send it to them anyway.
            </p>
          )}

          <div>
            <label htmlFor="subj" className="block text-xs text-lt-fg3 mb-1">Subject</label>
            <input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question about {{company}}"
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3" />
          </div>

          <div>
            <label htmlFor="bodyt" className="block text-xs text-lt-fg3 mb-1">Body</label>
            <textarea id="bodyt" rows={10} value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              placeholder={'Hi {{first_name}},\n\n{{#last_project}}Hope {{last_project}} wrapped well.{{/last_project}}\n\nWe added two stages since the spring...\n\n{{sender_first_name}}'}
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg font-mono placeholder:text-lt-fg3" />
            <p className="text-[11px] text-lt-fg3 mt-1">
              The unsubscribe footer is added automatically — you don&rsquo;t need to write one.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {MERGE_TOKENS.map((t) => (
              <button key={t} type="button" title={MERGE_TOKEN_META[t].description}
                onClick={() => setBodyTemplate((b) => `${b}{{${t}}}`)}
                className="text-[11px] font-mono px-2 py-1 rounded border border-lt-hairline text-lt-fg2 hover:border-lt-fg2">
                {`{{${t}}}`}
              </button>
            ))}
          </div>

          {data && data.unknownTokens.length > 0 && (
            <p className="text-xs text-chip-bad-fg">
              Unknown token{data.unknownTokens.length > 1 ? 's' : ''}:{' '}
              <code className="font-mono">{data.unknownTokens.join(', ')}</code> — this is a typo, and it
              blocks every send.
            </p>
          )}

          {err && <p className="text-xs text-chip-bad-fg">{err}</p>}
          {notice && <p className="text-xs text-chip-good-fg">{notice}</p>}

          <div className="flex items-center gap-3">
            <button onClick={createDraft} disabled={!canDraft || creating}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-medium">
              {creating ? 'Saving…' : 'Save draft'}
            </button>
            <span className="text-xs text-lt-fg3">{loading ? 'Refreshing preview…' : 'Saving a draft sends nothing.'}</span>
          </div>
        </div>

        {/* Scoreboard. Deliberately shows the empty state in words rather
            than rendering a funnel of zeros, which reads as failure
            rather than as "nothing has been sent yet". */}
        {board && (
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <h2 className="text-sm font-semibold text-lt-fg">Results</h2>
              <span className="text-xs text-lt-fg3">
                Influence measured over {board.windowDays} days
              </span>
            </div>

            {board.firstSendAt === null ? (
              <p className="text-sm text-lt-fg3">
                No outreach has been sent yet, so there is nothing to measure. This fills in from the
                first campaign onward.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  {board.funnel.map((f) => (
                    <div key={f.key} className="rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2"
                         title={f.note}>
                      <div className="text-[10px] uppercase tracking-wide text-lt-fg3">
                        {f.label}{f.influenced && <span className="ml-1 text-chip-warn-fg">~</span>}
                      </div>
                      <div className="text-xl font-semibold tabular-nums text-lt-fg">
                        {f.value.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-lt-fg3 mt-2">
                  <span className="text-chip-warn-fg">~</span> These are <strong>influenced</strong>, not
                  caused. The contact was mailed and then the thing happened — they may equally have
                  called us, or been coming back anyway.
                </p>
                {board.deliverability.bounceRate !== null && board.deliverability.bounceRate > 0.02 && (
                  <p className="text-xs text-chip-bad-fg mt-2">
                    Bounce rate is {(board.deliverability.bounceRate * 100).toFixed(1)}% — above 2% puts the
                    sending domain at risk. Clean the list before sending more.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
          <h2 className="text-sm font-semibold text-lt-fg mb-1">What real people will get</h2>
          <p className="text-xs text-lt-fg3 mb-4">
            Three actual contacts from this audience — the first, one from the middle, and the last.
          </p>
          {(!data || data.previews.length === 0) && (
            <p className="text-sm text-lt-fg3">Write a subject and body to see previews.</p>
          )}
          <div className="space-y-4">
            {data?.previews.map((p) => (
              <div key={p.personId} className="rounded-lg border border-lt-hairline overflow-hidden">
                <div className="px-3 py-2 bg-lt-inner flex items-center justify-between gap-3">
                  <span className="text-xs font-mono text-lt-fg2">{p.email}</span>
                  {p.ok ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">will send</span>
                  ) : (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-chip-bad-bg text-chip-bad-fg">
                      skipped — no {p.missing.join(', ')}
                    </span>
                  )}
                </div>
                <div className="px-3 py-3">
                  <div className="text-sm font-semibold text-lt-fg mb-2">{p.subject}</div>
                  <pre className="text-xs text-lt-fg2 whitespace-pre-wrap break-words font-sans">{p.body}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
