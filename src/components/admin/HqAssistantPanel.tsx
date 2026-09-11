'use client'
/**
 * Ask AHA as yourself — the signed-in chat on /admin/assistant.
 *
 * Same transcript + send logic as the public widget (useAssistantChat),
 * pointed at /api/admin/assistant/ask, which runs AHA with the caller's HQ
 * role as the access level. For an ADMIN that is the continuity briefing:
 * "explain how reservations work", "what has Wes been doing this month",
 * "walk me through collections". Nothing here is stored client-side.
 */
import { useAssistantChat } from '@/components/site/useAssistantChat'
import { ASSISTANT_NAME } from '@/lib/assistant/identity'

export function HqAssistantPanel({ level, firstName }: { level: string; firstName: string | null }) {
  const greeting =
    level === 'admin'
      ? `Hi${firstName ? ` ${firstName}` : ''} — I'm ${ASSISTANT_NAME}. You're signed in as an admin, so ask me how any part of HQ works, what was built and why, or what the admins have been doing lately. I'll explain it and walk you through anything.`
      : `Hi${firstName ? ` ${firstName}` : ''} — I'm ${ASSISTANT_NAME}. You're signed in as staff, so ask me who is on a unit, whether a job has come back, or anything about a job.`
  const { messages, draft, setDraft, busy, send, scrollRef } = useAssistantChat({ endpoint: '/api/admin/assistant/ask', greeting })

  return (
    <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-white">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Ask {ASSISTANT_NAME} as yourself</h2>
          <p className="mt-1 max-w-3xl text-xs text-zinc-500">
            The same assistant the text number runs, with your HQ role as the access level — no phone needed. Signed-in
            and audited, so this is the stronger way to reach the admin tools. Try “how do reservations and Planyo
            relate”, “what has Wes been working on this month”, or “walk me through collections”.
          </p>
        </div>
        <span className="rounded-full border border-amber-600/40 bg-amber-600/20 px-2 py-0.5 text-[11px] text-amber-300">
          your level · {level}
        </span>
      </div>

      <div ref={scrollRef} className="mt-3 h-[360px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 space-y-2.5">
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            <div key={i} className="max-w-[85%] rounded-2xl rounded-tl-md border border-zinc-800 bg-zinc-800/60 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-zinc-100 whitespace-pre-wrap">
              {m.content}
            </div>
          ) : (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-amber-600 px-3.5 py-2.5 text-[13.5px] font-medium leading-relaxed text-white whitespace-pre-wrap">
              {m.content}
            </div>
          ),
        )}
        {busy && <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-zinc-800 bg-zinc-800/60 px-3.5 py-2.5 text-[13.5px] text-zinc-500">…</div>}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder={`Ask ${ASSISTANT_NAME}…`}
          className="max-h-28 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !draft.trim()}
          className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </section>
  )
}
