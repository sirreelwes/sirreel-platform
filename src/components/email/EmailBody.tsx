'use client'

/**
 * EmailBody — HTML/Text toggle + sandboxed iframe renderer.
 *
 * Lifted from ThreadDrawer's preview internals so any email-display
 * surface (incident detail drawer, inquiries drawer, follow-up preview)
 * can render an email body without re-implementing the sandbox/
 * srcDoc plumbing.
 *
 * Rendering rules:
 *   - When bodyHtml is set, default view is HTML (rendered inside an
 *     iframe with sandbox="" — no scripts, no forms, no popups, no
 *     same-origin — images load fine). User can toggle to Text if a
 *     plain-text alternative exists.
 *   - When only bodyText is set, no toggle is shown.
 *   - When neither is set, falls back to the optional `snippet`
 *     prop wrapped in italics so the surface still reads as "we know
 *     something, just not the full body."
 *
 * Height defaults to 420px (matching ThreadDrawer); caller can
 * override via the `height` prop for tight surfaces.
 */

import { useEffect, useState } from 'react'

export interface EmailBodyProps {
  bodyText: string | null
  bodyHtml: string | null
  snippet?: string | null
  /** Pixel height for the iframe / pre. Default 420. */
  height?: number
  /** Optional aria-label for the iframe — falls back to "Email body preview". */
  iframeLabel?: string
}

export function EmailBody({
  bodyText, bodyHtml, snippet,
  height = 420, iframeLabel = 'Email body preview',
}: EmailBodyProps) {
  // Default to HTML when present (matches what the recipient actually
  // sees). User-toggled state lives here so the parent doesn't need
  // to thread it through.
  const hasHtml = !!bodyHtml && bodyHtml.trim().length > 0
  const hasText = !!bodyText && bodyText.trim().length > 0
  const [view, setView] = useState<'html' | 'text'>(hasHtml ? 'html' : 'text')

  // Re-sync the default when the underlying email changes (drawer
  // re-uses one component instance across messages).
  useEffect(() => {
    setView(hasHtml ? 'html' : 'text')
  }, [hasHtml, bodyHtml, bodyText])

  if (!hasHtml && !hasText) {
    return (
      <div
        className="text-[12px] text-gray-500 italic bg-gray-50 border border-gray-200 rounded p-3"
        style={{ minHeight: 80 }}
      >
        {snippet ? snippet : 'No body stored for this message.'}
      </div>
    )
  }

  return (
    <div>
      {hasHtml && hasText && (
        <div className="flex items-center justify-end gap-0.5 text-[10px] font-semibold mb-1.5">
          <button
            type="button"
            onClick={() => setView('html')}
            className={`px-1.5 py-0.5 rounded ${
              view === 'html'
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="Rendered HTML — what the recipient saw"
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => setView('text')}
            className={`px-1.5 py-0.5 rounded ${
              view === 'text'
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="Plain-text alternative"
          >
            Text
          </button>
        </div>
      )}
      {view === 'html' && hasHtml ? (
        // sandbox="" → no scripts, no forms, no popups, no same-origin.
        // srcDoc injects the stored HTML directly; fixed height with
        // internal scroll keeps the drawer's outer layout stable.
        <iframe
          title={iframeLabel}
          sandbox=""
          srcDoc={bodyHtml as string}
          className="w-full bg-white border border-gray-200 rounded"
          style={{ height }}
          aria-label={iframeLabel}
        />
      ) : (
        <pre
          className="text-[11px] text-gray-700 whitespace-pre-wrap break-words bg-white border border-gray-200 rounded p-2 font-sans overflow-y-auto"
          style={{ maxHeight: height }}
        >
          {bodyText || snippet || ''}
        </pre>
      )}
    </div>
  )
}
