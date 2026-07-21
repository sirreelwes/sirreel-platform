'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Shared client-side transcript + send logic for the public after-hours
 * assistant. Used by both the floating PublicAssistantWidget and the
 * full-page HelpAssistantPanel on /help so they behave identically.
 *
 * The client holds the transcript; each turn POSTs the whole conversation
 * to /api/public/assistant (rate-limited server-side). The greeting is
 * local-only — the server sees the user/assistant turns after it. Access
 * codes only appear once server-side driver verification passes.
 */

export interface AssistantMsg {
  role: 'user' | 'assistant'
  content: string
}

export const ASSISTANT_GREETING: AssistantMsg = {
  role: 'assistant',
  content:
    "Hi — I'm SirReel's assistant. I can help after hours with things like a lost vehicle access code, directions, or getting a message to your agent. What do you need?",
}

export function useAssistantChat() {
  const [messages, setMessages] = useState<AssistantMsg[]>([ASSISTANT_GREETING])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    const content = draft.trim()
    if (!content || busy) return
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setDraft('')
    setBusy(true)
    try {
      const res = await fetch('/api/public/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(1) }),
      })
      const json = await res.json().catch(() => ({}))
      const reply =
        typeof json.reply === 'string' && json.reply
          ? json.reply
          : json.error || 'Something went wrong — please call 888.477.7335.'
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection trouble — please call 888.477.7335.' },
      ])
    } finally {
      setBusy(false)
    }
  }

  return { messages, draft, setDraft, busy, send, scrollRef }
}
