'use client'

/**
 * "Email client" — write and send a client email without leaving the Job.
 *
 * Wes 2026-09-09: "I hate having to go back to email in order to send. We
 * should be able to populate an email from here that cc's whomever was on
 * the thread's latest email."
 *
 * So the modal opens ALREADY ADDRESSED. Opening it only composes (GET);
 * nothing leaves until Send. The CC row is read off the latest message on
 * the thread and is editable — but every address is visible as its own
 * chip rather than buried in a comma string, because the failure this
 * button exists to prevent is a person quietly falling off the reply.
 *
 * What is NOT editable: the sales-desk CC and the Reply-To. Both are
 * policy (lib/email/teamVisibility), changed once at /admin/notifications
 * rather than per email — so they are stated, not offered.
 */

import { useCallback, useEffect, useState } from 'react'
import { Mail, X, Plus } from 'lucide-react'
import { splitCcInput } from '@/lib/email/ccList'

interface Contact {
  id: string
  name: string
  email: string
  role: string
  isPrimary: boolean
}

interface ThreadSummary {
  id: string
  subject: string
  lastMessageAt: string
  messageCount: number
}

interface Draft {
  job: { id: string; jobCode: string; name: string; company: string | null }
  from: string
  replyTo: string | null
  to: string | null
  cc: string[]
  internalOnThread: string[]
  teamCc: string[]
  subject: string
  contacts: Contact[]
  thread: {
    id: string
    subject: string
    messageCount: number
    lastMessageAt: string
    participantsAsOf: string | null
  } | null
  threads: ThreadSummary[]
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function JobEmailButton({
  jobId,
  threadId,
  label = 'Email client',
  onSent,
}: {
  jobId: string
  /** Opens addressed to this specific conversation (the per-thread Reply). */
  threadId?: string
  label?: string
  /** Fired after a successful send. The thread list renders a message
   *  count and an In/Out badge that this send just changed — without
   *  this the reply is invisible until the page is reloaded, which reads
   *  as "did it go?" */
  onSent?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  // Editable fields, seeded from the draft once it lands.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadId ?? null)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState<string[]>([])
  const [ccAdd, setCcAdd] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(
    async (forThreadId: string | null) => {
      setLoading(true)
      setErr(null)
      try {
        const qs = forThreadId ? `?threadId=${encodeURIComponent(forThreadId)}` : ''
        const r = await fetch(`/api/jobs/${jobId}/email${qs}`)
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.error || 'Could not compose the email.')
        const d = j as Draft
        setDraft(d)
        setActiveThreadId(d.thread?.id ?? null)
        setTo(d.to ?? '')
        setCc(d.cc)
        setSubject(d.subject)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not compose the email.')
      } finally {
        setLoading(false)
      }
    },
    [jobId],
  )

  useEffect(() => {
    if (open && !draft && !err && !loading) void load(threadId ?? null)
  }, [open, draft, err, loading, threadId, load])

  function reset() {
    setOpen(false)
    setDraft(null)
    setErr(null)
    setSentTo(null)
    setBody('')
    setCcAdd('')
    setActiveThreadId(threadId ?? null)
  }

  function addCc(raw: string) {
    const { valid, invalid } = splitCcInput(raw)
    if (invalid.length > 0) {
      setErr(`Not an email address: ${invalid[0]}`)
      return
    }
    if (valid.length === 0) return
    setErr(null)
    setCc((prev) => {
      const seen = new Set([...prev, to.trim().toLowerCase()])
      return [...prev, ...valid.filter((a) => !seen.has(a))]
    })
    setCcAdd('')
  }

  async function send() {
    setSending(true)
    setErr(null)
    try {
      const r = await fetch(`/api/jobs/${jobId}/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: activeThreadId, to, cc, subject, body }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Send failed.')
      setSentTo(j.to)
      onSent?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed.')
    } finally {
      setSending(false)
    }
  }

  const canSend = !!to.trim() && !!subject.trim() && !!body.trim() && !sending

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline px-3 py-1.5 text-xs font-semibold text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
        title="Write the client an email from here"
      >
        <Mail className="w-3.5 h-3.5" /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-lt-card shadow-xl my-8">
            <div className="flex items-center justify-between gap-3 border-b border-lt-hairline px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-lt-fg">Email client</div>
                <div className="text-xs text-lt-fg3 truncate">
                  {draft ? `${draft.job.name} · ${draft.job.jobCode}` : 'Composing…'}
                </div>
              </div>
              <button type="button" onClick={reset} className="text-lt-fg3 hover:text-lt-fg" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {loading && <p className="text-sm text-lt-fg2">Composing the email…</p>}
              {err && <p className="rounded-lg bg-chip-bad-bg px-3 py-2 text-sm text-chip-bad-fg">{err}</p>}

              {sentTo && (
                <p className="rounded-lg bg-chip-good-bg px-3 py-2 text-sm text-chip-good-fg">
                  Sent to {sentTo}. It&apos;s filed on this job&apos;s email threads.
                </p>
              )}

              {draft && !sentTo && (
                <>
                  {/* Which conversation. Only offered when there's a choice
                      to make — one thread is the overwhelming case and a
                      picker over a single row is just a row. */}
                  {draft.threads.length > 1 && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-lt-fg3">
                        Replying to
                      </span>
                      <select
                        value={activeThreadId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value || null
                          setActiveThreadId(v)
                          setDraft(null)
                          void load(v)
                        }}
                        className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
                      >
                        {draft.threads.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.subject || '(no subject)'} · {t.messageCount} msg · {fmtWhen(t.lastMessageAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-lt-fg3">To</span>
                    <input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
                    />
                    {draft.contacts.length > 0 && (
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-lt-fg3">
                        Job contacts:
                        {draft.contacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => (c.email === to.trim().toLowerCase() ? undefined : addCc(c.email))}
                            className="rounded-full border border-lt-hairline px-2 py-0.5 text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
                            title={`CC ${c.email}`}
                          >
                            + {c.name}
                          </button>
                        ))}
                      </span>
                    )}
                  </label>

                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-lt-fg3">CC</span>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-lt-hairline bg-lt-inner px-2 py-2">
                      {cc.map((a) => (
                        <span
                          key={a}
                          className="inline-flex items-center gap-1 rounded-full bg-chip-neutral-bg px-2 py-0.5 text-xs text-chip-neutral-fg"
                        >
                          {a}
                          <button
                            type="button"
                            onClick={() => setCc((prev) => prev.filter((x) => x !== a))}
                            className="opacity-60 hover:opacity-100"
                            aria-label={`Remove ${a}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1">
                        <input
                          value={ccAdd}
                          onChange={(e) => setCcAdd(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault()
                              addCc(ccAdd)
                            }
                          }}
                          onBlur={() => ccAdd.trim() && addCc(ccAdd)}
                          placeholder={cc.length ? 'add another…' : 'add someone…'}
                          className="w-40 bg-transparent px-1 py-0.5 text-sm text-lt-fg outline-none"
                        />
                        {ccAdd.trim() && (
                          <button type="button" onClick={() => addCc(ccAdd)} className="text-lt-fg3 hover:text-lt-fg">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-lt-fg3">
                      {draft.thread && draft.cc.length > 0
                        ? `Everyone on the latest email in this thread${draft.thread.participantsAsOf ? ` (${fmtWhen(draft.thread.participantsAsOf)})` : ''}.`
                        : draft.thread
                          ? 'Nobody else was on the latest email in this thread.'
                          : 'No email thread on this job yet — nobody is pre-filled.'}
                      {draft.internalOnThread.length > 0 && (
                        <> {draft.internalOnThread.join(', ')} {draft.internalOnThread.length === 1 ? 'was' : 'were'} on it too, and stay off a client-facing reply.</>
                      )}
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-lt-fg3">
                      Subject
                    </span>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm font-medium text-lt-fg"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-lt-fg3">
                      Message
                    </span>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={9}
                      autoFocus
                      // Tracks the live To, not the draft's — the agent may
                      // have just retyped who this is going to.
                      placeholder={`Hi ${
                        draft.contacts.find((c) => c.email === to.trim().toLowerCase())?.name.split(' ')[0] ||
                        (to || 'there').split('@')[0]
                      },`}
                      className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm leading-relaxed text-lt-fg"
                    />
                    <span className="mt-1 block text-xs text-lt-fg3">
                      Goes out in the standard SirReel email frame, signed with your name. Blank lines
                      become paragraphs.
                    </span>
                  </label>

                  <dl className="space-y-1 border-t border-lt-hairline pt-2.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-lt-fg3">Also CC&apos;d</dt>
                      <dd className="text-lt-fg2">
                        {draft.teamCc.length ? draft.teamCc.join(', ') : 'nobody'}
                        <span className="text-lt-fg3"> — the sales desk, set at /admin/notifications.</span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-lt-fg3">Replies to</dt>
                      <dd className="text-lt-fg2">
                        {draft.replyTo ?? <span className="text-lt-fg3">the desk (your account has no @sirreel.com address)</span>}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-lt-hairline px-5 py-3">
              <button type="button" onClick={reset} className="px-3 py-2 text-sm text-lt-fg2 hover:text-lt-fg">
                {sentTo ? 'Close' : 'Cancel'}
              </button>
              {draft && !sentTo && (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!canSend}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
                >
                  {sending ? 'Sending…' : 'Send it'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
