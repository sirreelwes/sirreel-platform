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
 * Placement: this component is only the PANEL. Where it sits — a pinned
 * column beside the job at 1280px+, a full-screen window below that, a
 * pill at the bottom of the screen when minimised — is JobChatDock's
 * business, and the dock lives in the /jobs layout so the window survives
 * walking from one job to the next. It is mounted ONCE and hidden with
 * classes rather than unmounted, so it fetches once, keeps a half-typed
 * note through a minimise, and can report `awaitingReply` to the dock.
 *
 * Four kinds of row: client (left), staff (right, by name), system (one
 * compact line — "Quote sent · S260912-003"), note (violet, dashed,
 * "Internal · never sent"). Lanes (Sales / Billing) are chips in the
 * header; the filter is per viewer and remembered nowhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Lock, Mail, Minus, Send, Siren, StickyNote, UserCheck, UserPlus, Users, X } from 'lucide-react'
import { splitCcInput } from '@/lib/email/ccList'
import { internalNoteTells, mentionsIn } from '@/lib/email/conversationRules'

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
  urgent: boolean
  alertSummary: string
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
  onMinimize,
  onClose,
}: {
  jobId: string
  className?: string
  /** Fired after each load — the dock reads `awaitingReply` for its dot. */
  onSummary?: (s: { awaitingReply: boolean; count: number }) => void
  /**
   * Window controls, supplied by whatever is holding the panel (the dock).
   * Absent — as on a surface that owns its own chrome — and no buttons
   * render, so the panel is still a plain embeddable card.
   */
  onMinimize?: () => void
  onClose?: () => void
}) {
  const [data, setData] = useState<Conversation | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lane, setLane] = useState<'ALL' | Lane>('ALL')
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [urgent, setUrgent] = useState(false)
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

  // Wes 2026-09-17: "the option to CC all from the job as a button. In the
  // CC field if I pull the dropdown, it should offer other people from the
  // job so that I can continually add specific people." The box stays
  // free-text for an outside address; these two controls fill it from the
  // job's own contacts — whoever is not already in To or Cc.
  const ccAddable = useMemo(() => {
    if (!draft) return []
    const have = new Set([to.trim().toLowerCase(), ...splitCcInput(cc).valid])
    return draft.contacts.filter((c) => !have.has(c.email))
  }, [draft, to, cc])

  const addCc = (emails: string[]) => {
    const current = splitCcInput(cc).valid
    const merged = [...current, ...emails.filter((e) => !current.includes(e))]
    setCc(merged.join(', '))
  }

  // Wes 2026-09-17: an URGENT note texts whoever is tagged, right now. The
  // same matcher the server runs, so the button knows before the POST
  // whether anyone would be reached — an urgent note with nobody tagged is
  // refused rather than sent to no one.
  const taggedOthers = useMemo(() => {
    if (!data) return []
    return mentionsIn(body, data.staff).filter((id) => id !== data.me.id)
  }, [body, data])
  const urgentBlocked = mode === 'note' && urgent && taggedOthers.length === 0

  // Wes 2026-09-17: "Things that are going out to the client need to be
  // flagged or confirmed because I'm a little bit afraid that someone's
  // going to try to write an internal note and accidentally send an email
  // to the client." A client reply is TWO taps: the first arms it and shows
  // exactly who receives the email; the second sends. Anything that changes
  // the message disarms it. Notes never arm — they go nowhere.
  const [armed, setArmed] = useState(false)
  useEffect(() => setArmed(false), [mode, body, to, cc])

  // What in the draft says this was meant for the TEAM — an @mention of
  // someone on staff, a "Hey team" / "Hi all" opener, a colleague
  // addressed by first name. The arm step above shows who RECEIVES the
  // email; this says what the message itself looks like, which is the
  // half of Wes's fear the recipient list cannot answer. Loud, never
  // blocking: "Hi all" to a production is a real thing to write.
  const tells = useMemo(
    () => (data && mode === 'reply' ? internalNoteTells(body, data.staff) : []),
    [data, mode, body],
  )

  const send = async (confirmed = false) => {
    if (!data || busy) return
    const text = body.trim()
    if (!text) return
    if (mode === 'reply' && !confirmed) {
      if (!to.trim()) { say('Pick who this goes to.'); return }
      setArmed(true)
      return
    }
    setArmed(false)
    setBusy(true)
    try {
      if (mode === 'note') {
        const r = await fetch(`/api/jobs/${jobId}/conversation/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text, urgent }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save the note.')
        setBody('')
        setUrgent(false)
        const summary: string = j.note?.alertSummary || ''
        say(urgent ? (summary ? `Urgent — ${summary}.` : 'Urgent note added — nobody could be reached.') : 'Note added — internal only.')
      } else {
        if (!to.trim()) throw new Error('Pick who this goes to.')
        const r = await fetch(`/api/jobs/${jobId}/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The arm step above IS the confirmation, and the route refuses
          // a send that does not carry it — so no composer, now or later,
          // can put a message in front of a client unreviewed.
          body: JSON.stringify({ to: to.trim(), cc, subject: draft?.subject || data.subject, body: text, confirmed: true }),
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

  /** The armed reply was really a note. File it as one, email nobody. */
  const saveAsNote = async () => {
    if (!data || busy) return
    const text = body.trim()
    if (!text) return
    setArmed(false)
    setBusy(true)
    try {
      const r = await fetch(`/api/jobs/${jobId}/conversation/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, urgent: false }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save the note.')
      setBody('')
      setMode('note')
      say('Kept as an internal note — nothing was emailed.')
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
          <div className="flex items-center gap-1 shrink-0">
          {data && (
            <div className="relative">
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
          {/* Window controls (Wes 2026-09-17: "a minimize button for the chat
              window so that we can leave it open on top of the other jobs
              that we are looking at. Also, a close window button"). Minimise
              does NOT unmount the panel — the dock hides it — so a half-typed
              note survives being tucked away. */}
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="p-1 rounded-md text-lt-fg3 hover:text-lt-fg hover:bg-lt-inner"
              title="Minimise — keep this conversation while you look at other jobs"
              aria-label="Minimise the conversation"
            >
              <Minus size={15} aria-hidden />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-lt-fg3 hover:text-lt-fg hover:bg-lt-inner"
              title="Close — reopen from the job's Conversation button"
              aria-label="Close the conversation"
            >
              <X size={15} aria-hidden />
            </button>
          )}
          </div>
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
              <div
                key={it.id}
                className={`rounded-lg border border-dashed px-3 py-2 ${
                  it.urgent ? 'border-red-400 bg-red-50 text-red-950' : 'border-violet-300 bg-violet-50 text-violet-900'
                }`}
              >
                <div className={`flex items-center gap-2 text-[11px] ${it.urgent ? 'text-red-800' : 'text-violet-700'}`}>
                  {it.urgent ? <Siren size={11} aria-hidden /> : <StickyNote size={11} aria-hidden />}
                  {it.urgent && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-600 text-white">Urgent</span>
                  )}
                  <span className="font-semibold">Internal · never sent to the client</span>
                  <span>· {it.authorName}</span>
                  <span className="ml-auto">{fmtWhen(it.at)}</span>
                </div>
                <div className="mt-1">
                  <NoteBody body={it.body} />
                </div>
                {it.urgent && it.alertSummary && (
                  <div className="mt-1 text-[10.5px] text-red-800/80">{it.alertSummary}</div>
                )}
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
            <Mail size={12} aria-hidden /> Email the client
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
            {ccAddable.length > 0 && (
              <div className="flex items-center gap-2 pl-10">
                <label className="relative inline-flex items-center min-w-0">
                  <UserPlus size={11} aria-hidden className="absolute left-2 text-lt-fg3 pointer-events-none" />
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addCc([e.target.value])
                    }}
                    aria-label="Cc someone from the job"
                    className="rounded-md border border-lt-hairline bg-lt-inner pl-6 pr-2 py-1 text-[16px] sm:text-[11.5px] text-lt-fg2 max-w-[220px]"
                  >
                    <option value="">Cc someone on the job…</option>
                    {ccAddable.map((c) => (
                      <option key={c.id} value={c.email}>
                        {c.name} · {c.role}
                      </option>
                    ))}
                  </select>
                </label>
                {ccAddable.length > 1 && (
                  <button
                    type="button"
                    onClick={() => addCc(ccAddable.map((c) => c.email))}
                    className="inline-flex items-center gap-1 rounded-md border border-lt-hairline bg-lt-card px-2 py-1 text-[11.5px] font-medium text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner shrink-0"
                    title={ccAddable.map((c) => c.name).join(', ')}
                  >
                    <Users size={11} aria-hidden /> Cc everyone on the job ({ccAddable.length})
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 text-lt-fg3">
              <span className="w-8">Subj</span>
              <span className="truncate" title="Fixed for this job — one thread, so the client sees a single conversation.">
                {draft?.subject || data?.subject || '…'}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] text-violet-800 bg-violet-50 border border-violet-200 rounded-md px-2 py-1">
              Stays here. The client never sees it. Type <span className="font-semibold">@Name</span> to mention someone on the team.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setUrgent((u) => !u)}
                aria-pressed={urgent}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold ${
                  urgent
                    ? 'border-red-600 bg-red-600 text-white hover:bg-red-500'
                    : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:text-lt-fg hover:bg-lt-inner'
                }`}
                title="Text everyone tagged in this note right now (email if they have no mobile on file)."
              >
                <Siren size={12} aria-hidden /> {urgent ? 'Urgent — will text whoever is tagged' : 'Mark urgent'}
              </button>
              {urgent && (
                <span className={`text-[10.5px] ${urgentBlocked ? 'text-red-700 font-semibold' : 'text-lt-fg3'}`}>
                  {urgentBlocked
                    ? 'Tag someone first — @Name — or nobody gets it.'
                    : `Reaches ${taggedOthers.length} ${taggedOthers.length === 1 ? 'person' : 'people'} now, quiet hours or not.`}
                </span>
              )}
            </div>
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
            // ⌘↵ adds a note outright; on a client reply it ARMS (a second
            // ⌘↵ while armed sends) — the same two taps as the buttons.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(mode === 'reply' && armed)
          }}
        />
        {mode === 'reply' && armed && (
          <div className="rounded-lg border border-amber-600 bg-amber-50 px-3 py-2 text-[12px] text-lt-fg">
            <div className="font-semibold text-amber-900 flex items-center gap-1.5">
              <Mail size={12} aria-hidden /> This is an email to the client. Send it?
            </div>
            <div className="mt-1 text-lt-fg2">
              To <span className="font-medium text-lt-fg">{to.trim()}</span>
              {splitCcInput(cc).valid.length > 0 && (
                <>
                  {' '}· Cc <span className="font-medium text-lt-fg">{splitCcInput(cc).valid.join(', ')}</span>
                </>
              )}
              {' '}· from {data?.me.name || data?.me.email}
            </div>
            {tells.length > 0 && (
              <div className="mt-2 rounded-md border border-chip-warn-fg/30 bg-chip-warn-bg px-2.5 py-2 text-chip-warn-fg">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={12} aria-hidden /> This reads like a note for the team
                </div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {tells.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void saveAsNote()}
                  disabled={busy}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40"
                >
                  <StickyNote size={12} aria-hidden /> Keep it internal instead
                </button>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-40"
              >
                <Send size={13} aria-hidden /> {busy ? 'Sending…' : 'Yes, send to the client'}
              </button>
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="px-3 py-1.5 text-[13px] font-medium rounded-lg border border-lt-hairline bg-lt-card text-lt-fg2 hover:text-lt-fg"
              >
                Not yet
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-lt-fg3 truncate">{flash ?? (mode === 'reply' && data ? `Emails the client as ${data.me.name || data.me.email} — you confirm before it goes` : '⌘↵ to add')}</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !body.trim() || (mode === 'reply' && (!to.trim() || armed)) || urgentBlocked}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === 'note' ? (urgent ? 'bg-red-600 hover:bg-red-500' : 'bg-violet-600 hover:bg-violet-500') : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {mode === 'note' ? (urgent ? <Siren size={13} aria-hidden /> : <StickyNote size={13} aria-hidden />) : <Mail size={13} aria-hidden />}
            {busy ? 'Working…' : mode === 'note' ? (urgent ? 'Send urgent note' : 'Add note') : 'Email client…'}
          </button>
        </div>
        {data && data.staff.length > 0 && mode === 'note' && (
          <div className="flex items-center gap-1 text-[10.5px] text-lt-fg3 flex-wrap">
            <Users size={10} aria-hidden />
            {/* Everyone on the team except yourself (2026-09-17: a cap of 8
                hid Jose and Ana behind the end of the list). A chip already
                in the note is shown lit and tapping it again adds nothing. */}
            {data.staff
              .filter((s) => s.id !== data.me.id)
              .map((s) => {
                const tagged = taggedOthers.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={tagged}
                    onClick={() => {
                      if (tagged) return
                      setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${s.name.split(' ')[0]} `)
                    }}
                    className={`px-1.5 py-0.5 rounded ${
                      tagged
                        ? urgent ? 'bg-red-600 text-white' : 'bg-violet-600 text-white'
                        : 'bg-lt-inner hover:text-lt-fg'
                    }`}
                  >
                    @{s.name.split(' ')[0]}
                  </button>
                )
              })}
          </div>
        )}
      </footer>
    </section>
  )
}
