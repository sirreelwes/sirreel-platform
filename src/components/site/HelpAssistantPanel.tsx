'use client'

/**
 * Full-page inline version of the after-hours assistant, for /help. Same
 * transcript + send logic as the floating widget (shared useAssistantChat),
 * rendered as a large always-open panel.
 */

import { useAssistantChat } from './useAssistantChat'

export function HelpAssistantPanel() {
  const { messages, draft, setDraft, busy, send, scrollRef } = useAssistantChat()

  return (
    <div className="flex h-[560px] max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[#2e2e30] bg-[#141414] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[#2e2e30] bg-[#0c0c0d] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="text-[18px] leading-none" aria-hidden>💬</span>
          <div>
            <div className="text-[14px] font-extrabold text-white" style={{ fontFamily: 'Archivo, sans-serif' }}>
              SirReel Assistant
            </div>
            <div className="text-[11px] text-[#8b857a]">Here 24/7 · after-hours help &amp; access codes</div>
          </div>
        </div>
        <a href="tel:+18884777335" className="hidden sm:inline text-[12px] font-bold text-[#c39a3f] hover:text-[#d4a547]">
          888.477.7335
        </a>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            <div key={i} className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-md border border-[#2e2e30] bg-[#1f1f21] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#e8e4da]">
              {m.content}
            </div>
          ) : (
            <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[#c39a3f] px-3.5 py-2.5 text-[13.5px] font-medium leading-relaxed text-[#0c0c0d]">
              {m.content}
            </div>
          ),
        )}
        {busy && (
          <div className="max-w-[80%] rounded-2xl rounded-tl-md border border-[#2e2e30] bg-[#1f1f21] px-3.5 py-2.5 text-[13.5px] text-[#8b857a]">
            …
          </div>
        )}
      </div>

      <div className="border-t border-[#2e2e30] bg-[#0c0c0d] p-3.5">
        <div className="flex items-end gap-2">
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
            placeholder="Type a message…"
            className="max-h-28 flex-1 resize-none rounded-xl border border-[#2e2e30] bg-[#141414] px-3.5 py-2.5 text-[13.5px] text-white placeholder:text-[#5c574d] outline-none focus:border-[#c39a3f]"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="rounded-xl bg-[#c39a3f] px-4 py-2.5 text-[13.5px] font-extrabold text-[#0c0c0d] hover:bg-[#d4a547] disabled:opacity-40"
          >
            ➤
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-[#5c574d]">
          For emergencies call 888.477.7335 — this assistant can also file a callback.
        </div>
      </div>
    </div>
  )
}
