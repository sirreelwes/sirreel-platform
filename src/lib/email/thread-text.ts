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
    // bodyText is preferred. When it's null (older than the 90-day F
    // backfill, or a Gmail-format-quirk message), we fall back to the
    // snippet but mark the block as degraded so the AI knows that
    // turn's context is incomplete — important when extracting items
    // or dates that may only have appeared in the full body.
    let raw: string
    let degraded = false
    if (m.bodyText) {
      raw = m.bodyText
    } else if (m.snippet) {
      raw = m.snippet
      degraded = true
    } else {
      raw = ''
    }
    const stripped = stripQuotedReply(raw).trim() || '(no content)'
    const body = degraded ? `[snippet only - full body unavailable]\n${stripped}` : stripped
    blocks.push(`${header}\n${body}`)
  }

  const full = blocks.join(SEPARATOR)
  if (full.length <= maxLen) return full

  // Keep-first + last-N truncation: the first message carries the
  // original ask (dates, items, contact); the most recent N turns
  // carry the negotiated state. Drop the middle, never split a block.
  const firstBlock = blocks[0]
  let budget = maxLen - firstBlock.length - SEPARATOR.length
  const tail: string[] = []
  // Walk backwards from the most recent message, accumulating whole
  // blocks until adding another would bust the budget.
  for (let i = blocks.length - 1; i >= 1; i--) {
    const cost = blocks[i].length + (tail.length > 0 ? SEPARATOR.length : 0)
    if (cost > budget) break
    tail.unshift(blocks[i])
    budget -= cost
  }
  const omittedCount = blocks.length - 1 - tail.length
  if (omittedCount <= 0) {
    // Edge case — first block alone is already over budget, or every
    // non-first block fits. Either way no truncation marker needed.
    return firstBlock + SEPARATOR + tail.join(SEPARATOR)
  }
  const marker = `[... ${omittedCount} earlier turns omitted ...]`
  return `${firstBlock}${SEPARATOR}${marker}${SEPARATOR}${tail.join(SEPARATOR)}`
}
