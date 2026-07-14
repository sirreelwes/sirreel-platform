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

export function JobEmailThreads({ jobId }: { jobId: string }) {
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-semibold text-white">Email threads</h2>
        <span className="text-[11px] text-zinc-500">
          {threads.length} filed — replies follow their thread into this job
        </span>
      </div>
      <div className="space-y-2">
        {threads.map((t) => {
          const expanded = open.has(t.id)
          const latest = t.messages[t.messages.length - 1]
          return (
            <div key={t.id} className="border border-zinc-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(t.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-zinc-100 truncate">
                    {t.subject || '(no subject)'}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-500">
                    {t.messageCount} msg{t.messageCount === 1 ? '' : 's'} · {fmtWhen(t.lastMessageAt)}
                  </span>
                  <span className="text-zinc-500 text-[10px]" aria-hidden>{expanded ? '▾' : '▸'}</span>
                </div>
                {!expanded && latest && (
                  <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
                    {fromName(latest.fromAddress)}: {latest.snippet || latest.bodyText?.slice(0, 140) || ''}
                  </div>
                )}
              </button>
              {expanded && (
                <div className="border-t border-zinc-800 divide-y divide-zinc-800/60">
                  {t.messages.map((m) => {
                    const inbound = (m.direction || '').toLowerCase() === 'inbound'
                    return (
                      <div key={m.id} className={`px-3 py-2 ${inbound ? '' : 'bg-blue-950/20'}`}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider ${
                              inbound ? 'bg-zinc-800 text-zinc-400' : 'bg-blue-900/60 text-blue-300'
                            }`}
                          >
                            {inbound ? 'In' : 'Out'}
                          </span>
                          <span className="text-[11px] font-semibold text-zinc-200 truncate">
                            {fromName(m.fromAddress)}
                          </span>
                          <span className="ml-auto text-[10px] text-zinc-500 flex-shrink-0">{fmtWhen(m.sentAt)}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap break-words line-clamp-6">
                          {m.bodyText || m.snippet || '(no preview)'}
                        </p>
                        {m.attachmentCount > 0 && (
                          <div className="mt-1 text-[10px] text-zinc-500">📎 {m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'}</div>
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
