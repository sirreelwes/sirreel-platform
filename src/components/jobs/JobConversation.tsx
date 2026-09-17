'use client'

/**
 * The job Conversation — one stream, every email filed to the job plus the
 * team's internal notes, with the composer at the bottom.
 *
 * Phase 2 of one-thread-per-job (docs/specs/job-thread-one-conversation.md).
 * Wes 2026-09-16: "Is it that we open a chat within the job itself and that
 * chat feeds a single email thread to the client?" — this is that chat.
 * A reply from here goes out on the job's thread (Phase 1 anchors, From =
 * the author); a note stays here and is never sent.
 *
 * Placement (Wes 2026-09-17): a pinned rail beside the job at 1280px+, a
 * Details | Conversation tab under the header below that, a full-screen
 * chat on a phone. This component is the panel; the job page decides
 * where it sits. It is mounted ONCE and shown/hidden with classes, so it
 * fetches once and can report `awaitingReply` to the tab strip.
 *
 * Four kinds of row: client (left), staff (right, by name), system (one
 * compact line — "Quote sent · S260912-003"), note (violet, dashed,
 * "Internal · never sent"). Lanes (Sales / Billing) are chips in the
 * header; the filter is per viewer and remembered nowhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Mail, Send, StickyNote, UserCheck, Users } from 'lucide-react'

type Lane = 'SALES' | 'BILLING'

interface EmailRow {
  kind: 'email'
  id: string
  who: 'client' | 'staff' | 'system'
  lane: Lane
  at: string
  fromAddress: string
  fromName: string
  toAddresses: string[]
  cc: string | null
  subject: string
  body: string
  snippet: string | null
  attachmentCount: number
  label: string | null
  systemLabel: string | null
  detail: string | null
  autoReply: boolean
}
interface NoteRow {
  kind: 'note'
  id: string
  at: string
  authorUserId: string
  authorName: string
  body: string
  mentions: string[]
  anchoredEmailMessageId: string | null
}
interface Staff { id: string; name: string; email: string; role: string }
interface Conversation {
  ok: true
  me: { id: string; name: string | null; email: string; role: string }
  job: { id: string; jobCode: string; name: string }
  subject: string
  address: string
  claim: { claimedByUserId: string | null; claimedLane: Lane | null; claimedAt: string | null; label: string | null; claimedByName: string | null }
  staff: Staff[]
  items: Array<EmailRow | NoteRow>
  awaitingReply: boolean
  notesAvailable: boolean
  missingTableHint: string | null
}
interface Draft {
  from: string
  to: string | null
  cc: string[]
  subject: string
  contacts: { id: string; name: string; email: string; role: string; isPrimary: boolean }[]
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Highlight @mentions in a note body — display only. */
function NoteBody({ body }: { body: string }) {
  const parts = body.split(/(@[A-Za-z][A-Za-z'.-]*)/g)
  return (
    <p className="text-[13px] leading-snug whitespace-pre-wrap break-words">
      {parts.map((p, i) => (p.startsWith('@') ? <span key={i} className="font-semibold">{p}</span> : <span key={i}>{p}</span>))}
    </p>
  )
}

function Body({ text, clamp }: { text: string; clamp: boolean }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 600 || text.split('\n').length > 10
  return (
    <div>
      <p className={`text-[13px] leading-snug whitespace-pre-wrap break-words ${clamp && long && !open ? 'line-clamp-6' : ''}`}>
        {text || '(no text)'}
      </p>
      {clamp && long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[11px] font-semibold text-amber-700 hover:text-amber-600">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

export function JobConversation({
  jobId,
  className = '',
  onSummary,
}: {
  jobId: string
  className?: string
  /** Fired after each load — the tab strip reads `awaitingReply` for its dot. */
  onSummary?: (s: { awaitingReply: boolean; count: number }) => void
}) {
  const [data, setData] = useState<Conversation | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lane, setLane] = useState<'ALL' | Lane>('ALL')
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([
        fetch(`/api/jobs/${jobId}/conversation`).then((r) => r.json()),
        fetch(`/api/jobs/${jobId}/email`).then((r) => r.json()).catch(() => null),
      ])
      if (!c?.ok) throw new Error(c?.error || 'Could not load the conversation.')
      setData(c as Conversation)
      onSummary?.({ awaitingReply: !!c.awaitingReply, count: (c.items as unknown[]).length })
      if (d?.ok) {
        setDraft(d as Draft)
        setTo((cur) => cur || d.to || '')
        setCc((cur) => cur || (d.cc as string[]).join(', '))
      }
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the conversation.')
    }
  }, [jobId, onSummary])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 90_000)
    return () => clearInterval(t)
  }, [load])

  // The header's Conversation button focuses the box (job page dispatches).
  useEffect(() => {
    const onFocus = () => boxRef.current?.focus()
    window.addEventListener('job-conversation:focus', onFocus)
    return () => window.removeEventListener('job-conversation:focus', onFocus)
  }, [])

  // Newest at the bottom, like a chat: scroll there on load and after a send.
  const itemCount = data?.items.length ?? 0
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [itemCount])

  const items = useMemo(() => {
    if (!data) return []
    if (lane === 'ALL') return data.items
    return data.items.filter((it) => it.kind === 'note' || it.lane === lane)
  }, [data, lane])

  const counts = useMemo(() => {
    const c = { SALES: 0, BILLING: 0 }
    for (const it of data?.items ?? []) if (it.kind === 'email') c[it.lane]++
    return c
  }, [data])

  const say = (m: string) => {
    setFlash(m)
    setTimeout(() => setFlash(null), 3500)
  }

  const send = async () => {
    if (!data || busy) return
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      if (mode === 'note') {
        const r = await fetch(`/api/jobs/${jobId}/conversation/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save the note.')
        setBody('')
        say('Note added — internal only.')
      } else {
        if (!to.trim()) throw new Error('Pick who this goes to.')
        const r = await fetch(`/api/jobs/${jobId}/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to.trim(), cc, subject: draft?.subject || data.subject, body: text }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.error || 'Send failed.')
        setBody('')
        say(`Sent to ${to.trim()} on the job thread.`)
      }
      await load()
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const claim = async (action: 'claim' | 'release' | 'hand', laneArg?: Lane) => {
    setClaimOpen(false)
    setBusy(true)
    try {
      const r = await fetch(`/api/jobs/${jobId}/conversation/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lane: laneArg }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not update.')
      if (action === 'hand' && laneArg === 'BILLING') say(j.notified?.length ? `Handed to Billing — ${j.notified.join(', ')} told.` : 'Handed to Billing.')
      else if (action === 'hand') say('Handed to Sales.')
      else if (action === 'claim') say('You are answering this one.')
      else say('Released.')
      await load()
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not update.')
    } finally {
      setBusy(false)
    }
  }

  const copyAddress = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.address)
      say('Job address copied.')
    } catch {
      say(data.address)
    }
  }

  const mine = !!data && data.claim.claimedByUserId === data.me.id

  return (
    <section
      className={`flex flex-col bg-lt-card border border-lt-hairline rounded-2xl overflow-hidden ${className}`}
      aria-label="Conversation"
    >
      {/* Header */}
      <header className="px-4 pt-3 pb-2.5 border-b border-lt-hairline space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-lt-fg flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
              Conversation
            </h2>
            {data && (
              <div className="mt-0.5 text-[12px] text-lt-fg2 truncate" title={data.subject}>
                {data.subject}
              </div>
            )}
          </div>
          {data && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setClaimOpen((v) => !v)}
                disabled={busy}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border ${
                  data.claim.label
                    ? mine
                      ? 'bg-chip-good-bg text-chip-good-fg border-transparent'
                      : 'bg-lt-inner text-lt-fg2 border-lt-hairline'
                    : 'bg-lt-card text-lt-fg3 border-lt-hairline hover:text-lt-fg'
                }`}
                title="Who is answering this conversation"
              >
                <UserCheck size={12} aria-hidden />
                {data.claim.label ?? 'Nobody answering'}
              </button>
              {claimOpen && (
                <div className="absolute right-0 mt-1 w-52 z-20 bg-lt-card border border-lt-hairline rounded-lg shadow-lg py-1 text-[12px]">
                  {!mine && (
                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-lt-inner text-lt-fg" onClick={() => claim('claim')}>
                      I&rsquo;m answering
                    </button>
                  )}
                  {data.claim.claimedLane !== 'BILLING' && (
                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-lt-inner text-lt-fg" onClick={() => claim('hand', 'BILLING')}>
                      Hand to Billing
                    </button>
                  )}
                  {data.claim.claimedLane === 'BILLING' && (
                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-lt-inner text-lt-fg" onClick={() => claim('hand', 'SALES')}>
                      Hand to Sales
                    </button>
                  )}
                  {(data.claim.claimedByUserId || data.claim.claimedLane) && (
                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-lt-inner text-lt-fg3" onClick={() => claim('release')}>
                      Release
                    </button>
                  )}
                  {!data.notesAvailable && (
                    <div className="px-3 py-1.5 text-[11px] text-chip-warn-fg">{data.missingTableHint}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['ALL', 'SALES', 'BILLING'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLane(l)}
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                lane === l ? 'bg-amber-600 text-white border-amber-600' : 'bg-lt-inner text-lt-fg2 border-transparent hover:text-lt-fg'
              }`}
            >
              {l === 'ALL' ? 'All' : l === 'SALES' ? `Sales${counts.SALES ? ` · ${counts.SALES}` : ''}` : `Billing${counts.BILLING ? ` · ${counts.BILLING}` : ''}`}
            </button>
          ))}
          {data && (
            <button
              type="button"
              onClick={copyAddress}
              className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-mono text-lt-fg3 hover:text-lt-fg truncate max-w-[60%]"
              title="Every email on this job carries this address on Cc — a reply-all from anywhere files here. Click to copy."
            >
              <Lock size={10} aria-hidden />
              <span className="truncate">{data.address}</span>
            </button>
          )}
        </div>
      </header>

      {/* Timeline */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto bg-lt-page px-3 py-3 space-y-2.5">
        {err && <div className="text-[12px] text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2">{err}</div>}
        {!data && !err && <div className="text-[12px] text-lt-fg3">Loading…</div>}
        {data && items.length === 0 && (
          <div className="text-[12px] text-lt-fg3 py-6 text-center">
            Nothing on this job yet. The first quote, welcome email or message you send from here starts the client&rsquo;s thread.
          </div>
        )}
        {items.map((it) => {
          if (it.kind === 'note') {
            return (
              <div key={it.id} className="rounded-lg border border-dashed border-violet-300 bg-violet-50 text-violet-900 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px] text-violet-700">
                  <StickyNote size={11} aria-hidden />
                  <span className="font-semibold">Internal · never sent</span>
                  <span>· {it.authorName}</span>
                  <span className="ml-auto">{fmtWhen(it.at)}</span>
                </div>
                <div className="mt-1">
                  <NoteBody body={it.body} />
                </div>
              </div>
            )
          }
          if (it.who === 'system') {
            return (
              <div key={it.id} className="rounded-lg border border-dashed border-lt-hairline bg-lt-inner px-3 py-1.5 text-[12px] text-lt-fg2 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">{it.systemLabel}</span>
                {it.detail && <span className="font-mono text-[11px]">{it.detail}</span>}
                <span className="text-lt-fg3">· to {it.toAddresses[0] ?? '—'}</span>
                <span className="ml-auto text-lt-fg3">{fmtWhen(it.at)}</span>
                <details className="basis-full">
                  <summary className="cursor-pointer text-[11px] text-lt-fg3 hover:text-lt-fg">Show</summary>
                  <div className="mt-1 text-lt-fg2">
                    <Body text={it.body} clamp={false} />
                  </div>
                </details>
              </div>
            )
          }
          const client = it.who === 'client'
          return (
            <div key={it.id} className={`flex ${client ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[88%] min-w-0 ${client ? '' : 'text-right'}`}>
                <div className={`text-[11px] text-lt-fg3 flex items-center gap-1.5 ${client ? '' : 'justify-end'}`}>
                  <span className="font-semibold text-lt-fg2">{it.fromName}</span>
                  {it.lane === 'BILLING' && <span className="text-[9.5px] font-semibold px-1 rounded bg-lt-inner">Billing</span>}
                  {it.autoReply && <span className="text-[9.5px] font-semibold px-1 rounded bg-lt-inner">auto-reply</span>}
                  <span>{fmtWhen(it.at)}</span>
                </div>
                <div
                  className={`mt-0.5 text-left rounded-xl px-3 py-2 ${
                    client ? 'bg-lt-card border border-lt-hairline rounded-tl-sm' : 'bg-amber-50 border border-amber-100 rounded-tr-sm'
                  } text-lt-fg`}
                >
                  <Body text={it.body} clamp />
                  {it.attachmentCount > 0 && (
                    <div className="mt-1 text-[11px] text-lt-fg3">{it.attachmentCount} attachment{it.attachmentCount === 1 ? '' : 's'}</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer */}
      <footer className="border-t border-lt-hairline px-3 pt-2 pb-3 space-y-2">
        <div className="flex items-center gap-1 border-b border-lt-hairline -mx-3 px-3">
          <button
            type="button"
            onClick={() => setMode('reply')}
            className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 border-b-2 -mb-px ${mode === 'reply' ? 'border-amber-600 text-amber-700' : 'border-transparent text-lt-fg3 hover:text-lt-fg'}`}
          >
            <Mail size={12} aria-hidden /> Reply to client
          </button>
          <button
            type="button"
            onClick={() => setMode('note')}
            className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 border-b-2 -mb-px ${mode === 'note' ? 'border-violet-500 text-violet-800' : 'border-transparent text-lt-fg3 hover:text-lt-fg'}`}
          >
            <StickyNote size={12} aria-hidden /> Internal note
          </button>
        </div>

        {mode === 'reply' ? (
          <div className="space-y-1.5 text-[12px]">
            <label className="flex items-center gap-2">
              <span className="w-8 text-lt-fg3">To</span>
              {draft && draft.contacts.length > 0 ? (
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="flex-1 min-w-0 rounded-md border border-lt-hairline bg-lt-inner px-2 py-1 text-[16px] sm:text-[12px] text-lt-fg"
                >
                  {!draft.contacts.some((c) => c.email === to) && to && <option value={to}>{to}</option>}
                  {draft.contacts.map((c) => (
                    <option key={c.id} value={c.email}>
                      {c.name} · {c.role}
                      {c.isPrimary ? ' · primary' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="client@production.com"
                  className="flex-1 min-w-0 rounded-md border border-lt-hairline bg-lt-inner px-2 py-1 text-[16px] sm:text-[12px] text-lt-fg"
                />
              )}
            </label>
            <label className="flex items-center gap-2">
              <span className="w-8 text-lt-fg3">Cc</span>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="comma-separated"
                className="flex-1 min-w-0 rounded-md border border-lt-hairline bg-lt-inner px-2 py-1 text-[16px] sm:text-[12px] text-lt-fg"
              />
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0" title="The job address rides on Cc automatically.">
                <Lock size={9} aria-hidden /> filed to {data?.job.jobCode ?? 'this job'}
              </span>
            </label>
            <div className="flex items-center gap-2 text-lt-fg3">
              <span className="w-8">Subj</span>
              <span className="truncate" title="Fixed for this job — one thread, so the client sees a single conversation.">
                {draft?.subject || data?.subject || '…'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-violet-800 bg-violet-50 border border-violet-200 rounded-md px-2 py-1">
            Stays here. The client never sees it. Type <span className="font-semibold">@Name</span> to mention someone on the team.
          </div>
        )}

        <textarea
          ref={boxRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={mode === 'note' ? 2 : 4}
          placeholder={mode === 'note' ? 'Note for the team…' : `Write to ${to || 'the client'}…`}
          className={`w-full rounded-lg border px-3 py-2 text-[16px] sm:text-[13px] text-lt-fg bg-lt-card focus:outline-none focus:ring-2 ${
            mode === 'note' ? 'border-violet-300 focus:ring-violet-300' : 'border-lt-hairline focus:ring-amber-500/40'
          }`}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send()
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-lt-fg3 truncate">{flash ?? (mode === 'reply' && data ? `Sends as ${data.me.name || data.me.email}` : '⌘↵ to send')}</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !body.trim() || (mode === 'reply' && !to.trim())}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === 'note' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {mode === 'note' ? <StickyNote size={13} aria-hidden /> : <Send size={13} aria-hidden />}
            {busy ? 'Working…' : mode === 'note' ? 'Add note' : 'Send'}
          </button>
        </div>
        {data && data.staff.length > 0 && mode === 'note' && (
          <div className="flex items-center gap-1 text-[10.5px] text-lt-fg3 flex-wrap">
            <Users size={10} aria-hidden />
            {data.staff.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${s.name.split(' ')[0]} `)}
                className="px-1.5 py-0.5 rounded bg-lt-inner hover:text-lt-fg"
              >
                @{s.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </footer>
    </section>
  )
}

/**
 * The Details | Conversation strip the job page shows below 1280px. The
 * rail carries the panel above that width, so the strip hides there.
 */
export function ConversationTabs({
  tab,
  onChange,
  awaiting,
}: {
  tab: 'details' | 'conversation'
  onChange: (t: 'details' | 'conversation') => void
  awaiting: boolean
}) {
  return (
    <div className="xl:hidden flex items-center gap-1 border-b border-lt-hairline mb-3">
      {(['details', 'conversation'] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 border-b-2 -mb-px ${
            tab === t ? 'border-amber-600 text-amber-700' : 'border-transparent text-lt-fg3 hover:text-lt-fg'
          }`}
        >
          {t === 'details' ? 'Details' : 'Conversation'}
          {t === 'conversation' && awaiting && <span className="w-2 h-2 rounded-full bg-amber-600" aria-label="client replied" />}
        </button>
      ))}
    </div>
  )
}
