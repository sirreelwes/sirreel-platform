import { stripQuotedReply } from './strip-quote'

// Build a chronological transcript of an email thread suitable for
// feeding to the AI quote parser. Each message contributes its
// quote-stripped body (so the AI sees each turn exactly once, not
// re-quoted 13 times). Output is plain text — keep it parseable by
// humans and by the LLM.
//
// Shape:
//   ── 2026-05-06 10:14 · INBOUND · "Eve Symington" <eve@buzzfeed.com>
//   Hi Oliver, looking to rent a 5-ton on May 18–21 for our shoot…
//
//   ── 2026-05-06 14:02 · OUTBOUND · "Oliver Carlson" <oliver@sirreel.com>
//   Hi Eve! Yes, we have a 5-ton available those dates…
//
// The capture endpoint stores this string in Inquiry.description and
// the new-quote page hands it to /api/orders/parse-quote, which feeds
// it to Claude with a prompt that knows about multi-turn context.

export interface ThreadMessageForText {
  fromAddress: string
  direction: string // 'inbound' | 'outbound' | 'INBOUND' | 'OUTBOUND'
  sentAt: Date
  bodyText: string | null
  snippet: string | null
}

const SEPARATOR = '\n\n──────────\n\n'

function fmtTimestamp(d: Date): string {
  // Compact, human-readable, locale-stable.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

function formatDirection(d: string): 'INBOUND' | 'OUTBOUND' {
  return d.toUpperCase() === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND'
}

export interface BuildThreadTextOptions {
  // Hard upper bound on the output length. Default 32KB — well under
  // Claude Sonnet's input window and under Postgres text limits, while
  // still fitting a long negotiation (13 stripped turns × ~2KB).
  maxLength?: number
}

export function buildThreadText(
  messages: ThreadMessageForText[],
  opts: BuildThreadTextOptions = {},
): string {
  const maxLen = opts.maxLength ?? 32_000
  if (messages.length === 0) return ''

  // Chronological asc — caller may have sorted already but enforce it.
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())

  const blocks: string[] = []
  for (const m of sorted) {
    const dir = formatDirection(m.direction)
    const ts = fmtTimestamp(m.sentAt)
    const header = `── ${ts} · ${dir} · ${m.fromAddress}`
    const raw = m.bodyText || m.snippet || ''
    const body = stripQuotedReply(raw).trim() || '(no content)'
    blocks.push(`${header}\n${body}`)
  }

  let out = blocks.join(SEPARATOR)
  if (out.length > maxLen) {
    // Truncate from the START — keep the most recent turns intact since
    // those carry the active ask. Insert a marker so the AI knows older
    // turns were elided.
    const tail = out.slice(out.length - maxLen + 200)
    const cutPoint = tail.indexOf(SEPARATOR.trim())
    const aligned = cutPoint >= 0 ? tail.slice(cutPoint + SEPARATOR.trim().length).trimStart() : tail
    out = `[earlier turns omitted for length — ${blocks.length} total messages]\n\n${aligned}`
  }
  return out
}
