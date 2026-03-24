'use client';

import { useState, useRef, useEffect } from 'react';
import { UserRole } from '@prisma/client';
import { getPermissions } from '@/lib/permissions';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AIChat({
  role,
  userName,
  onClose,
}: {
  role: UserRole;
  userName: string;
  onClose: () => void;
}) {
  const perms = getPermissions(role);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hey ${userName.split(' ')[0]}! I'm your fleet assistant. Try:\n\n• "How many cubes available?"\n• "What's in maintenance?"\n• "Show pending bookings"\n• "Fleet summary"`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages((p) => [...p, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          role,
          history: messages.slice(-8),
        }),
      });
      const data = await res.json();
      setMessages((p) => [
        ...p,
        { role: 'assistant', content: data.reply || 'Let me try again.' },
      ]);
    } catch {
      setMessages((p) => [
        ...p,
        {
          role: 'assistant',
          content:
            "I'm having trouble connecting right now. Try again in a moment.",
        },
      ]);
    }
    setLoading(false);
  }

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <div>
            <div className="text-[13px] font-bold text-gray-900">SirReel AI</div>
            <div className="text-[9px] text-gray-400">
              Fleet Assistant
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-900 transition-colors text-sm p-1"
        >
          ✕
        </button>
      </div>

      {/* Role restriction notice */}
      {!perms.seeClientNames && (
        <div className="px-3 py-1.5 bg-red-950/30 text-[9px] text-red-400/70 border-b border-red-900/20">
          🔒 AI won't reveal client info in this role
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[88%] ${
              m.role === 'user' ? 'self-end' : 'self-start'
            }`}
          >
            <div
              className={`px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-white text-black rounded-xl rounded-br-sm'
                  : 'bg-white text-gray-700 rounded-xl rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="self-start max-w-[88%]">
            <div className="px-3 py-2 bg-white rounded-xl rounded-bl-sm">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-sirreel-text-dim animate-pulse"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask about fleet, bookings..."
            className="flex-1 input text-[12px] py-2"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm transition-colors ${
              input.trim()
                ? 'bg-white text-black'
                : 'bg-sirreel-border text-gray-400'
            }`}
          >
            ↑
          </button>
        </div>
        <div className="text-[9px] text-gray-400 text-center mt-1.5">
          Live fleet data · Powered by Claude
        </div>
      </div>
    </div>
  );
}
