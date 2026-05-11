// Strip quoted-reply blocks from the bottom of an email body.
//
// Why: when the capture endpoint aggregates a 13-message thread, each
// reply contains the entire preceding conversation re-quoted by Gmail.
// Feeding all 13 raw bodies to the AI means the same prior turns appear
// 13 times, wasting context and confusing extraction. Stripping leaves
// just the *new content* the sender added.
//
// Heuristic: find the first occurrence of any well-known quote marker
// (Gmail "On … wrote:", Outlook "-----Original Message-----", Apple
// Mail "On Mon, ...", a run of RFC 3676 ">"-prefixed lines, or
// horizontal-rule separators) and discard everything from that point
// on. The new content always sits ABOVE the quoted history.
//
// This is intentionally conservative: a false positive trims too much
// (recoverable from snippet/bodyHtml), a false negative wastes some
// AI context but doesn't break anything. We don't try to interleave
// signature-stripping here — signatures stay attached to the new turn.

const QUOTE_MARKERS: RegExp[] = [
  // Gmail / Apple Mail: "On Mon, May 9, 2026 at 9:38 AM Oliver Carlson <oliver@sirreel.com> wrote:"
  // The "wrote:" can wrap across lines so we anchor on "On <date>" through "wrote:" with [\s\S].
  /^\s*On\s.{1,300}\swrote:\s*$/m,

  // Outlook English separator
  /^-{3,}\s*Original Message\s*-{3,}/im,

  // Outlook German/Spanish/French separators (best-effort)
  /^-{3,}\s*(Mensaje original|Message d'origine|Ursprüngliche Nachricht)\s*-{3,}/im,

  // Outlook reply header block (no separator) — "From:" on its own line, followed shortly
  // by "Sent:" or "Date:" on a nearby line. Conservative anchor to avoid stripping
  // legitimate "From: Me" mentions in body text.
  /^\s*From:\s.+\r?\n\s*(?:Sent|Date):\s.+/im,

  // Apple Mail "On <date>, <person> wrote:" (slightly different shape; covered above
  // but kept as a backup with looser whitespace).
  /^\s*On\s.+,\s*\d{4}.{0,200}wrote:\s*$/im,

  // Horizontal rules used by some clients
  /^_{5,}\s*$/m,
  /^-{5,}\s*$/m,

  // Forwarded-message header
  /^-{3,}\s*Forwarded message\s*-{3,}/im,
  /^Begin forwarded message:/im,
]

// RFC 3676: a run of >=2 consecutive lines starting with ">" indicates
// quoted text. We trim from the START of the first such run, but only if
// it appears after some non-quoted content (otherwise the entire email is
// a quote, which means there's no new content to keep and we leave it).
function findRfc3676QuoteStart(text: string): number {
  const lines = text.split(/\r?\n/)
  let firstQuoteLine = -1
  let consecutive = 0

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i])) {
      if (consecutive === 0) firstQuoteLine = i
      consecutive++
      if (consecutive >= 2) {
        // We found a quote block. Was there non-empty non-quote content before it?
        let hasContentAbove = false
        for (let j = 0; j < firstQuoteLine; j++) {
          if (lines[j].trim().length > 0) {
            hasContentAbove = true
            break
          }
        }
        if (!hasContentAbove) return -1
        // Compute character index of firstQuoteLine in the original text.
        let charIdx = 0
        for (let j = 0; j < firstQuoteLine; j++) {
          charIdx += lines[j].length + 1 // +1 for the newline
        }
        return charIdx
      }
    } else {
      consecutive = 0
      firstQuoteLine = -1
    }
  }
  return -1
}

export function stripQuotedReply(body: string): string {
  if (!body) return body

  let earliest = body.length

  for (const marker of QUOTE_MARKERS) {
    const m = marker.exec(body)
    if (m && m.index < earliest) earliest = m.index
  }

  const rfcIdx = findRfc3676QuoteStart(body)
  if (rfcIdx >= 0 && rfcIdx < earliest) earliest = rfcIdx

  if (earliest >= body.length) return body.trimEnd()

  return body.slice(0, earliest).trimEnd()
}
