'use client'

/**
 * Public after-hours assistant — floating chat on every marketing page.
 * Client holds the transcript; each turn POSTs the whole conversation
 * to /api/public/assistant (rate-limited server-side). No sensitive
 * data lives client-side beyond what the server chose to say — access
 * codes only appear after server-side driver verification passes.
 */

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAssistantChat } from './useAssistantChat'

export function PublicAssistantWidget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { messages, draft, setDraft, busy, send, scrollRef } = useAssistantChat()

  // /help hosts the assistant inline (HelpAssistantPanel) — don't also float
  // the launcher there.
  if (pathname === '/help') return null

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Chat with SirReel"
          className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 bg-[#c39a3f] hover:bg-[#d4a547] text-[#0c0c0d] font-extrabold text-[13px] uppercase tracking-wide rounded-full pl-4 pr-5 py-3 shadow-2xl transition-colors"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          <span className="text-[17px] leading-none">💬</span>
          Need help?
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[70] w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-4rem)] bg-[#141414] border border-[#2e2e30] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#0c0c0d] border-b border-[#2e2e30]">
            <div>
              <div className="text-white font-extrabold text-[14px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                SirReel Assistant
              </div>
              <div className="text-[#8b857a] text-[11px]">After-hours help · 888.477.7335</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="text-[#8b857a] hover:text-white text-lg leading-none px-1"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {messages.map((m, i) =>
              m.role === 'assistant' ? (
                <div key={i} className="max-w-[85%] bg-[#1f1f21] border border-[#2e2e30] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13.5px] text-[#e8e4da] leading-relaxed whitespace-pre-wrap">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="max-w-[85%] ml-auto bg-[#c39a3f] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[13.5px] text-[#0c0c0d] font-medium leading-relaxed whitespace-pre-wrap">
                  {m.content}
                </div>
              ),
            )}
            {busy && (
              <div className="max-w-[85%] bg-[#1f1f21] border border-[#2e2e30] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13.5px] text-[#8b857a]">
                …
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[#2e2e30] bg-[#0c0c0d]">
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
                className="flex-1 resize-none bg-[#141414] border border-[#2e2e30] rounded-xl px-3 py-2.5 text-[13.5px] text-white placeholder:text-[#5c574d] outline-none focus:border-[#c39a3f] max-h-28"
              />
              <button
                onClick={() => void send()}
                disabled={busy || !draft.trim()}
                aria-label="Send"
                className="bg-[#c39a3f] hover:bg-[#d4a547] disabled:opacity-40 text-[#0c0c0d] font-extrabold rounded-xl px-3.5 py-2.5 text-[13.5px]"
              >
                ➤
              </button>
            </div>
            <div className="text-[10px] text-[#5c574d] mt-1.5">
              For emergencies call 888.477.7335 — this assistant can also file a callback.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
