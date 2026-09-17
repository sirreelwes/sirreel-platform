'use client'

/**
 * The Chat page — one row per job conversation you are in.
 *
 * Two rules from Wes (2026-09-17) shape this screen:
 *
 * 1. "It needs to be very clear what company and job it is referring to."
 *    Every row leads with the COMPANY and the production, and the reply box
 *    repeats both directly above the text — a note is filed against a job,
 *    and a list of look-alike rows is exactly where the wrong one gets
 *    answered.
 *
 * 2. Internal notes reply HERE; a client email does not. The note box posts
 *    to the job's own notes route, so the note "shows up simultaneously in
 *    the chat page and the job internal notes" — it is ONE record read
 *    twice, never a copy. To write to the client you click the job, where
 *    the composer and its two-tap confirm live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Mail, MessagesSquare, Search, Siren, StickyNote, Users } from 'lucide-react'
import { mentionsIn } from '@/lib/email/conversationRules'

type Reason = 'mentioned' | 'holding' | 'wrote' | 'rep' | 'desk'

interface Row {
  jobId: string
  jobCode: string
  jobName: string
  companyName: string | null
  lastAt: string
  lastKind: 'client' | 'staff' | 'system' | 'note'
  lastWho: string
  lastPreview: string
  reasons: Reason[]
  reasonLabel: string
  awaitingReply: boolean
  taggedMe: boolean
  urgentForMe: boolean
  claimLabel: string | null
}

interface Inbox {
  ok: boolean
  me: { id: string; name: string | null; email: string }
  rows: Row[]
  found: NoteTarget[]
  notesAvailable: boolean
  truncated: boolean
  error?: string
}

type Filter = 'all' | 'needs-you' | 'waiting'

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

const KIND_WORD: Record<Row['lastKind'], string> = {
  client: 'Client',
  staff: '',
  system: 'HQ',
  note: 'Note',
}

/** Enough of a job to file a note against it: a row you are in, or one the
 *  search turned up. The box needs nothing else. */
interface NoteTarget {
  jobId: string
  jobCode: string
  jobName: string
  companyName: string | null
}

/** The reply box under one row. Internal notes only — by design. */
function NoteReply({
  row,
  staff,
  meId,
  onDone,
}: {
  row: NoteTarget
  staff: { id: string; name: string }[]
  meId: string
  onDone: (msg: string) => void
}) {
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)

  const tagged = useMemo(() => mentionsIn(body, staff).filter((id) => id !== meId), [body, staff, meId])
  const blocked = urgent && tagged.length === 0

  const send = async () => {
    const text = body.trim()
    if (!text || busy || blocked) return
    setBusy(true)
    try {
      const r = await fetch(`/api/jobs/${row.jobId}/conversation/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, urgent }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save the note.')
      setBody('')
      setUrgent(false)
      const summary: string = j.note?.alertSummary || ''
      onDone(urgent ? (summary ? `Urgent on ${row.jobCode} — ${summary}.` : `Urgent note added on ${row.jobCode}.`) : `Note added on ${row.jobCode}.`)
    } catch (e) {
      onDone(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 p-2 space-y-1.5">
      {/* Which job this lands on, right above the box — never only in the
          row header, which scrolls out of sight on a phone. */}
      <div className="text-[11px] text-violet-900">
        Internal note on <span className="font-semibold">{row.companyName ? `${row.companyName} · ` : ''}{row.jobName}</span>{' '}
        <span className="font-mono text-[10.5px]">{row.jobCode}</span>. The client never sees it.
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Note for the team…  @Name to tag someone"
        className="w-full rounded-md border border-violet-300 bg-lt-card px-2 py-1.5 text-[16px] sm:text-[13px] text-lt-fg focus:outline-none focus:ring-2 focus:ring-violet-300"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send()
        }}
      />
      {staff.length > 0 && (
        <div className="flex items-center gap-1 text-[10.5px] text-lt-fg3 flex-wrap">
          <Users size={10} aria-hidden />
          {staff
            .filter((s) => s.id !== meId)
            .map((s) => {
              const on = tagged.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (on) return
                    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${s.name.split(' ')[0]} `)
                  }}
                  className={`px-1.5 py-0.5 rounded ${on ? (urgent ? 'bg-red-600 text-white' : 'bg-violet-600 text-white') : 'bg-lt-inner hover:text-lt-fg'}`}
                >
                  @{s.name.split(' ')[0]}
                </button>
              )
            })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setUrgent((u) => !u)}
          aria-pressed={urgent}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold ${
            urgent ? 'border-red-600 bg-red-600 text-white hover:bg-red-500' : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:text-lt-fg'
          }`}
          title="Text everyone tagged in this note right now."
        >
          <Siren size={12} aria-hidden /> {urgent ? 'Urgent — texts whoever is tagged' : 'Mark urgent'}
        </button>
        <div className="flex items-center gap-2">
          {blocked && <span className="text-[10.5px] text-red-700 font-semibold">Tag someone first.</span>}
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !body.trim() || blocked}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              urgent ? 'bg-red-600 hover:bg-red-500' : 'bg-violet-600 hover:bg-violet-500'
            }`}
          >
            {urgent ? <Siren size={13} aria-hidden /> : <StickyNote size={13} aria-hidden />}
            {busy ? 'Working…' : urgent ? 'Send urgent note' : 'Add note'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatInbox() {
  const [data, setData] = useState<Inbox | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  // Wes 2026-09-17: "we probably need a search field at top of chat to find
  // jobs or clients that we want to message about." The box does two things:
  // it filters the rows you HAVE as you type (instant, in the browser), and
  // it asks the server for jobs you are NOT in yet, so a conversation can be
  // started here rather than only continued.
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/chat${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}`)
      const j = (await r.json()) as Inbox
      if (!j.ok) throw new Error(j.error || 'Could not load your chats.')
      setData(j)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your chats.')
    }
  }, [debouncedQ])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 90_000)
    return () => clearInterval(t)
  }, [load])

  // The @chip list comes from the job the row belongs to — one fetch the
  // first time a reply box opens, reused for every row after that.
  useEffect(() => {
    if (!openId || staff.length > 0) return
    void fetch(`/api/jobs/${openId}/conversation`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Array.isArray(j.staff)) setStaff(j.staff.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))
      })
      .catch(() => {})
  }, [openId, staff.length])

  const say = (m: string) => {
    setFlash(m)
    setTimeout(() => setFlash(null), 4000)
  }

  const rows = useMemo(() => {
    let all = data?.rows ?? []
    const needle = q.trim().toLowerCase()
    if (needle) {
      all = all.filter((r) =>
        `${r.companyName ?? ''} ${r.jobName} ${r.jobCode}`.toLowerCase().includes(needle),
      )
    }
    if (filter === 'needs-you') return all.filter((r) => r.taggedMe || r.urgentForMe)
    if (filter === 'waiting') return all.filter((r) => r.awaitingReply)
    return all
  }, [data, filter, q])

  /** Jobs the search found that are NOT already in your list. */
  const found = data?.found ?? []

  const counts = useMemo(() => {
    const all = data?.rows ?? []
    return {
      all: all.length,
      needsYou: all.filter((r) => r.taggedMe || r.urgentForMe).length,
      waiting: all.filter((r) => r.awaitingReply).length,
    }
  }, [data])

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-[20px] font-semibold text-lt-fg flex items-center gap-2">
          <MessagesSquare size={18} aria-hidden /> Chat
        </h1>
        <p className="text-[12.5px] text-lt-fg2 mt-1">
          Every job conversation you are in — tagged in, answering, wrote on, your job, or your desk. Reply with a note
          here; to write to the client, open the job.
        </p>
      </header>

      <label className="relative block mb-3">
        <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lt-fg3 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a job or client to message about…"
          aria-label="Find a job or client"
          className="w-full rounded-lg border border-lt-hairline bg-lt-card pl-8 pr-8 py-2 text-[16px] sm:text-[13px] text-lt-fg focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[13px] text-lt-fg3 hover:text-lt-fg px-1"
          >
            ✕
          </button>
        )}
      </label>

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {([
          ['all', `All (${counts.all})`],
          ['needs-you', `Needs you (${counts.needsYou})`],
          ['waiting', `Client waiting (${counts.waiting})`],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded-full text-[12px] font-medium border ${
              filter === key ? 'bg-amber-600 text-white border-amber-600' : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:text-lt-fg'
            }`}
          >
            {label}
          </button>
        ))}
        {flash && <span className="text-[11.5px] text-lt-fg2 ml-1">{flash}</span>}
      </div>

      {err && <div className="rounded-lg bg-chip-bad-bg text-chip-bad-fg px-3 py-2 text-[12.5px] mb-3">{err}</div>}
      {data && !data.notesAvailable && (
        <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] mb-3">
          Notes and the claim are not in the database yet — an admin runs &ldquo;Create the job Conversation tables&rdquo; on
          /admin/maintenance. Emails still show.
        </div>
      )}

      {data && rows.length === 0 && !q.trim() && (
        <div className="text-center text-[13px] text-lt-fg3 py-12">
          {counts.all === 0
            ? 'Nothing yet. A job lands here when someone tags you, hands it to you, or you write on it.'
            : 'Nothing in this filter.'}
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((r) => {
          const open = openId === r.jobId
          return (
            <li
              key={r.jobId}
              className={`rounded-xl border bg-lt-card px-3 py-2.5 ${
                r.urgentForMe ? 'border-red-400' : r.taggedMe ? 'border-violet-300' : 'border-lt-hairline'
              }`}
            >
              <div className="flex items-start gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  {/* Company first — the row is answered on the strength of
                      this line (Wes: "very clear what company and job"). */}
                  <Link
                    href={`/jobs/${r.jobId}?tab=conversation`}
                    className="text-[14px] font-semibold text-lt-fg hover:text-amber-700 break-words"
                  >
                    {r.companyName ? `${r.companyName} · ` : ''}
                    {r.jobName}
                  </Link>
                  <span className="ml-1.5 font-mono text-[11px] text-lt-fg3">{r.jobCode}</span>
                </div>
                <span className="text-[11px] text-lt-fg3 shrink-0">{fmtWhen(r.lastAt)}</span>
              </div>

              <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10.5px]">
                {r.urgentForMe && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white font-bold uppercase tracking-wide">Urgent for you</span>
                )}
                {!r.urgentForMe && r.taggedMe && (
                  <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white font-semibold">You were tagged</span>
                )}
                {r.awaitingReply && (
                  <span className="px-1.5 py-0.5 rounded-full bg-chip-warn-bg text-chip-warn-fg font-semibold">Client replied</span>
                )}
                {r.claimLabel && <span className="px-1.5 py-0.5 rounded-full bg-chip-neutral-bg text-chip-neutral-fg">{r.claimLabel}</span>}
                {!r.taggedMe && !r.urgentForMe && r.reasonLabel && <span className="text-lt-fg3">{r.reasonLabel}</span>}
              </div>

              <p className="mt-1.5 text-[12.5px] text-lt-fg2 break-words">
                <span className="font-medium text-lt-fg">
                  {KIND_WORD[r.lastKind] ? `${KIND_WORD[r.lastKind]} · ` : ''}
                  {r.lastWho}
                </span>
                {r.lastPreview ? <span className="text-lt-fg2"> — {r.lastPreview}</span> : null}
              </p>

              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.jobId)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] font-medium text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner"
                >
                  <StickyNote size={12} aria-hidden /> {open ? 'Close note' : 'Note to the team'}
                </button>
                {/* Writing to the CLIENT is deliberately not possible from
                    this page — that composer, and its confirm step, is on
                    the job. */}
                <Link
                  href={`/jobs/${r.jobId}?tab=conversation`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] font-medium text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner"
                >
                  <Mail size={12} aria-hidden /> Open the job to email the client <ArrowRight size={11} aria-hidden />
                </Link>
              </div>

              {open && data && <NoteReply row={r} staff={staff} meId={data.me.id} onDone={(m) => { say(m); void load() }} />}
            </li>
          )
        })}
      </ul>

      {found.length > 0 && (
        <div className="mt-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-lt-fg3 mb-1.5">
            Not in your chat — {found.length} match{found.length === 1 ? '' : 'es'}
          </h2>
          <ul className="space-y-2">
            {found.map((f) => {
              const open = openId === f.jobId
              return (
                <li key={f.jobId} className="rounded-xl border border-dashed border-lt-hairline bg-lt-card px-3 py-2.5">
                  <Link
                    href={`/jobs/${f.jobId}?tab=conversation`}
                    className="text-[14px] font-semibold text-lt-fg hover:text-amber-700 break-words"
                  >
                    {f.companyName ? `${f.companyName} · ` : ''}
                    {f.jobName}
                  </Link>
                  <span className="ml-1.5 font-mono text-[11px] text-lt-fg3">{f.jobCode}</span>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : f.jobId)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] font-medium text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner"
                    >
                      <StickyNote size={12} aria-hidden /> {open ? 'Close note' : 'Note to the team'}
                    </button>
                    <Link
                      href={`/jobs/${f.jobId}?tab=conversation`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] font-medium text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner"
                    >
                      <Mail size={12} aria-hidden /> Open the job to email the client <ArrowRight size={11} aria-hidden />
                    </Link>
                  </div>
                  {open && data && <NoteReply row={f} staff={staff} meId={data.me.id} onDone={(m) => { say(m); void load() }} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {q.trim().length >= 2 && rows.length === 0 && found.length === 0 && (
        <p className="text-[12.5px] text-lt-fg3 text-center py-6">
          Nothing matches &ldquo;{q.trim()}&rdquo; — try the company, the production or the job code.
        </p>
      )}

      {data?.truncated && (
        <p className="text-[11.5px] text-lt-fg3 mt-3">
          Showing the most active conversations. Older ones are on the job itself.
        </p>
      )}
      {!data && !err && <div className="text-[13px] text-lt-fg3 py-10 text-center">Loading…</div>}
    </section>
  )
}
