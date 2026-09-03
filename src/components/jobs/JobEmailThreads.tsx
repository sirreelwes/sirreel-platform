'use client'

/**
 * Email threads filed in this Job (email-in-Job, step 6). Self-loading
 * section for /jobs/[id] — collapsible thread cards; expanding shows
 * the messages inline. Attach/detach lives in the pipeline ThreadDrawer
 * (and happens automatically on Quick Reply resolution / inquiry
 * conversion); this section is the Job-side read surface.
 */

import { useEffect, useState } from 'react'

interface ThreadMsg {
  id: string
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string | null
  bodyText: string | null
  direction: string
  sentAt: string
  attachmentCount: number
}

interface JobThread {
  id: string
  subject: string
  lastMessageAt: string
  messageCount: number
  lastDirection: string | null
  messages: ThreadMsg[]
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function fromName(header: string): string {
  const m = header.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/)
  return (m ? m[1].trim() : header).trim()
}

/**
 * Two surfaces render this: the jobs detail page (light since 2026-09-01)
 * and /rentalworks/reconcile (still dark). `tone` keeps one component
 * serving both rather than forking it — dark stays the default so the
 * reconcile page is untouched.
 */
const TONE = {
  dark: {
    card: 'bg-gradient-to-b from-zinc-900 to-zinc-950 border-zinc-800 hover:border-zinc-700/70',
    heading: 'text-white',
    meta: 'text-zinc-500',
    row: 'border-zinc-800',
    rowHover: 'hover:bg-zinc-800/50',
    subject: 'text-zinc-100',
    body: 'border-zinc-800 divide-zinc-800/60',
    outbound: 'bg-blue-950/20',
    tagIn: 'bg-zinc-800 text-zinc-400',
    tagOut: 'bg-blue-900/60 text-blue-300',
    sender: 'text-zinc-200',
    text: 'text-zinc-400',
  },
  light: {
    card: 'bg-gradient-to-b from-white to-zinc-50 border-zinc-200 hover:border-zinc-300',
    heading: 'text-zinc-900',
    meta: 'text-zinc-600',
    row: 'border-zinc-200',
    rowHover: 'hover:bg-zinc-50',
    subject: 'text-zinc-900',
    body: 'border-zinc-200 divide-zinc-200',
    outbound: 'bg-blue-50',
    tagIn: 'bg-zinc-100 text-zinc-600',
    tagOut: 'bg-blue-100 text-blue-700',
    sender: 'text-zinc-800',
    text: 'text-zinc-600',
  },
} as const

export function JobEmailThreads({ jobId, tone = 'dark' }: { jobId: string; tone?: 'dark' | 'light' }) {
  const T = TONE[tone]
  const [threads, setThreads] = useState<JobThread[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/threads`)
      .then((r) => r.json())
      .then((d) => setThreads(Array.isArray(d.threads) ? d.threads : []))
      .catch(() => setThreads([]))
  }, [jobId])

  // Section hides entirely until the job has at least one filed thread
  // — an empty "Email" box on every job is noise.
  if (!threads || threads.length === 0) return null

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={`${T.card} border rounded-2xl p-4 transition-colors duration-200`}>
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className={`text-[15px] font-semibold ${T.heading} flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80`}>Email threads</h2>
        <span className={`text-[11px] ${T.meta}`}>
          {threads.length} filed — replies follow their thread into this job
        </span>
      </div>
      <div className="space-y-2">
        {threads.map((t) => {
          const expanded = open.has(t.id)
          const latest = t.messages[t.messages.length - 1]
          return (
            <div key={t.id} className={`border ${T.row} rounded-lg overflow-hidden`}>
              <button
                onClick={() => toggle(t.id)}
                className={`w-full text-left px-3 py-2.5 ${T.rowHover} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-medium ${T.subject} truncate`}>
                    {t.subject || '(no subject)'}
                  </span>
                  <span className={`ml-auto flex-shrink-0 text-[10px] ${T.meta}`}>
                    {t.messageCount} msg{t.messageCount === 1 ? '' : 's'} · {fmtWhen(t.lastMessageAt)}
                  </span>
                  <span className={`${T.meta} text-[10px]`} aria-hidden>{expanded ? '▾' : '▸'}</span>
                </div>
                {!expanded && latest && (
                  <div className={`mt-0.5 text-[11px] ${T.meta} truncate`}>
                    {fromName(latest.fromAddress)}: {latest.snippet || latest.bodyText?.slice(0, 140) || ''}
                  </div>
                )}
              </button>
              {expanded && (
                <div className={`border-t divide-y ${T.body}`}>
                  {t.messages.map((m) => {
                    const inbound = (m.direction || '').toLowerCase() === 'inbound'
                    return (
                      <div key={m.id} className={`px-3 py-2 ${inbound ? '' : T.outbound}`}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider ${
                              inbound ? T.tagIn : T.tagOut
                            }`}
                          >
                            {inbound ? 'In' : 'Out'}
                          </span>
                          <span className={`text-[11px] font-semibold ${T.sender} truncate`}>
                            {fromName(m.fromAddress)}
                          </span>
                          <span className={`ml-auto text-[10px] ${T.meta} flex-shrink-0`}>{fmtWhen(m.sentAt)}</span>
                        </div>
                        <p className={`mt-1 text-[11px] ${T.text} whitespace-pre-wrap break-words line-clamp-6`}>
                          {m.bodyText || m.snippet || '(no preview)'}
                        </p>
                        {m.attachmentCount > 0 && (
                          <div className={`mt-1 text-[10px] ${T.meta}`}>{m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
