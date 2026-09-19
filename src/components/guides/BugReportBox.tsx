'use client'

/**
 * The improvement box at the top of HQ Help.
 *
 * Wes 2026-09-18: "make it seem really friendly… they can start typing."
 *
 * Wes 2026-09-19: "let's not call it bugs and call it improvements,
 * especially on the employee- and client-facing side where they can report
 * something: design improvements, color, whatever it is." The word does
 * real work here. A box headed "found a bug?" only collects things people
 * are already confident are BROKEN — nobody files a bug report because a
 * colour is unreadable on the yard screen at 6am, or because a label is
 * ambiguous, even though those cost just as much time. Widening the
 * invitation is what gets those reported at all.
 * So: no category dropdown, no severity picker, no "steps to reproduce",
 * no ticket number. One box, already open, with the cursor welcome in it.
 * Every field a form like this usually asks for is something the triage
 * agent works out for itself (src/lib/bugs/triage.ts) — asking the person
 * mid-task to classify their own bug is how you end up with no reports.
 *
 * What they get back is the point. The agent reads it while they wait and
 * answers: nothing is broken and here is what is happening, or yes that is
 * real and it is on the list, or this is bad enough that Wes has it now.
 * A box that swallows complaints in silence trains people to stop sending
 * them — which is the actual failure mode this is built against.
 *
 * NOTE: every hook is above every early return. The repo has no ESLint, so
 * react-hooks/rules-of-hooks never runs (see project_no_eslint_hooks_gap) —
 * a hook below a return builds clean and white-screens at runtime.
 */

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bug, Send, Loader2, CheckCircle2, AlertTriangle, ListTodo } from 'lucide-react'
import type { BugRouting, BugSeverity } from '@prisma/client'
import { ROUTING_CHIP, ROUTING_LABEL, SEVERITY_CHIP, SEVERITY_LABEL, STATUS_CHIP, STATUS_LABEL } from '@/lib/bugs/vocab'
import { snapshotBugContext } from '@/lib/bugs/clientContext'

export interface MyReport {
  id: string
  createdAt: string
  body: string
  title: string | null
  status: keyof typeof STATUS_LABEL
  severity: BugSeverity
  routing: BugRouting
  response: string | null
}

interface Verdict {
  id: string
  acknowledgement: string
  response: string | null
  routing: BugRouting
  severity: BugSeverity
  title: string | null
  duplicate: boolean
}

export function BugReportBox({ myReports }: { myReports: MyReport[] }) {
  const pathname = usePathname()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showMine, setShowMine] = useState(false)

  const tooShort = text.trim().length < 8

  async function send() {
    if (tooShort || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The envelope: what the browser saw on the pages they came from.
        // Nobody had to remember to include it, which is the point.
        body: JSON.stringify({
          body: text.trim(),
          pagePath: pathname,
          context: snapshotBugContext(pathname ?? ''),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong sending that. Try again in a moment?')
        return
      }
      setVerdict({
        id: data.report?.id ?? '',
        acknowledgement: data.acknowledgement,
        response: data.response ?? null,
        routing: data.report?.routing ?? 'PENDING',
        severity: data.report?.severity ?? 'UNTRIAGED',
        title: data.report?.title ?? null,
        duplicate: !!data.report?.duplicate,
      })
      setText('')
    } catch {
      setError('Could not reach HQ just then. Your words are still in the box — try send again.')
    } finally {
      setSending(false)
    }
  }

  // Cmd/Ctrl+Enter sends, because everyone tries it.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  return (
    <section className="bg-lt-card border border-lt-hairline rounded-xl p-5 sm:p-6 mb-8">
      {/*
        The icon sits with the HEADING, not beside the whole card. Beside the
        card it eats a fixed ~44px off every line at phone width, which left
        the body copy about 25 characters wide and the textarea cramped —
        and warehouse and fleet report from handhelds.
      */}
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-amber-600/10 p-2">
          <Bug className="w-5 h-5 text-amber-600" />
        </div>
        <h2 className="text-[17px] font-semibold text-lt-fg">Did you find a bug in the system?</h2>
      </div>
      <div className="min-w-0">
          <p className="text-sm text-lt-fg2 mt-3 max-w-[62ch] leading-relaxed">
            Anything at all, in your own words — no form, no ticket number. Something broken, a
            button that did nothing, a screen that reads wrong, a colour you can&apos;t make out in
            the yard, a step that takes four clicks and should take one. It gets read straight
            away and you&apos;ll hear back right here.
          </p>

          {verdict ? (
            <Acknowledgement verdict={verdict} onAnother={() => setVerdict(null)} />
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={3}
                maxLength={6000}
                disabled={sending}
                placeholder="Start typing… e.g. “I hit Send on the quote and nothing happened”, or “the pick list text is too small to read on the warehouse screen”."
                className="mt-4 w-full rounded-lg border border-lt-hairline bg-lt-inner px-3.5 py-3 text-[15px] text-lt-fg placeholder:text-lt-fg3 leading-relaxed resize-y focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-60"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={send}
                  disabled={tooShort || sending}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reading it…
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send it
                    </>
                  )}
                </button>
                <span className="text-xs text-lt-fg3">
                  {sending
                    ? 'Working out what it is and where it goes — a few seconds.'
                    : 'Nothing is too small. Half a sentence is fine.'}
                </span>
              </div>
              {error && (
                <p className="mt-3 inline-flex items-start gap-2 rounded-lg bg-chip-bad-bg px-3 py-2 text-sm text-chip-bad-fg">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </>
          )}

          {myReports.length > 0 && (
            <div className="mt-5 border-t border-lt-hairline pt-4">
              <button
                type="button"
                onClick={() => setShowMine((v) => !v)}
                className="inline-flex items-start gap-2 text-left text-xs font-semibold text-lt-fg2 hover:text-lt-fg"
              >
                <ListTodo className="w-3.5 h-3.5" />
                {showMine ? 'Hide' : 'What happened to'} the {myReports.length} thing
                {myReports.length === 1 ? '' : 's'} you&apos;ve sent
              </button>
              {showMine && (
                <ul className="mt-3 space-y-2.5">
                  {myReports.map((r) => (
                    <li key={r.id} className="rounded-lg bg-lt-inner px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[13px] font-medium text-lt-fg min-w-0">
                          {r.title || r.body.slice(0, 80)}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      {r.response && r.routing === 'ANSWERED' && (
                        <p className="mt-1.5 text-[13px] text-lt-fg2 leading-relaxed">{r.response}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
    </section>
  )
}

/** What they see the moment the agent has read it. */
function Acknowledgement({ verdict, onAnother }: { verdict: Verdict; onAnother: () => void }) {
  const answered = verdict.routing === 'ANSWERED'
  return (
    <div className="mt-4 rounded-lg bg-lt-inner p-4">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-chip-good-fg" />
        <div className="min-w-0">
          <p className="text-[15px] text-lt-fg leading-relaxed">{verdict.acknowledgement}</p>

          {answered && verdict.response && (
            <p className="mt-2 text-sm text-lt-fg2 leading-relaxed">{verdict.response}</p>
          )}

          {!answered && verdict.title && (
            <p className="mt-2 text-sm text-lt-fg2 leading-relaxed">
              Written down as: <span className="font-medium text-lt-fg">{verdict.title}</span>
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ROUTING_CHIP[verdict.routing]}`}>
              {ROUTING_LABEL[verdict.routing]}
            </span>
            {!answered && verdict.severity !== 'UNTRIAGED' && (
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SEVERITY_CHIP[verdict.severity]}`}>
                {SEVERITY_LABEL[verdict.severity]}
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-lt-fg3">
            {answered
              ? 'If that misses the point, send it again with what you expected to happen — it gets read the same way.'
              : 'Nobody needs to chase this for you. Thank you for saying something.'}
          </p>

          <button
            type="button"
            onClick={onAnother}
            className="mt-3 text-xs font-semibold text-amber-600 hover:text-amber-500"
          >
            Found something else? Tell us →
          </button>
        </div>
      </div>
    </div>
  )
}
