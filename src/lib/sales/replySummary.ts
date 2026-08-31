/**
 * One-line summaries of what our agent actually said back.
 *
 * Wes, 2026-08-29, on the Responded section: "the viewable tile of the
 * thread should be the client's last outreach … an AI summary of our
 * agent response."
 *
 * The client's side needs no AI — we have their email, and showing their
 * own words is both cheaper and more trustworthy than a paraphrase. Our
 * side does: a staff reply arrives as a wall of quoted chain, signature
 * block, hours-of-operation footer and link list, and the two sentences
 * that matter are buried in the middle.
 *
 * ── Cost ───────────────────────────────────────────────────────────
 *
 * Cached on the message row. A sent email never changes, so this is one
 * Haiku call per reply for the life of the message — not one per page
 * load, which for a panel this heavily used would be the difference
 * between negligible and silly.
 *
 * ── Never throws ───────────────────────────────────────────────────
 *
 * A missing summary degrades to the stripped first line of the reply.
 * The tile is a convenience; it must not be able to break the queue that
 * sales works from.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { SUMMARY_MODEL } from '@/lib/ai/models'
import { stripQuotedReply } from '@/lib/email/strip-quote'

/** Signature and footer noise that survives quote-stripping. */
const SIGNATURE_MARKERS = [
  /^--\s*$/m,
  /SirReel Studio Services/i,
  /Hours:\s*Mon/i,
  /Stages\s*\|\s*Vehicles/i,
  /Leave a Review/i,
]

/**
 * Reduce a raw email body to the part a human wrote.
 *
 * Exported because the fallback path and the tests both need to agree
 * with what the model is actually shown.
 */
export function readableReplyBody(body: string): string {
  let text = stripQuotedReply(body || '')
  for (const marker of SIGNATURE_MARKERS) {
    const m = text.match(marker)
    if (m?.index !== undefined) text = text.slice(0, m.index)
  }
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** Crude fallback when AI is unavailable — the first real sentence. */
export function fallbackSummary(body: string): string | null {
  const clean = readableReplyBody(body)
  if (!clean) return null
  const firstLine = clean
    .split('\n')
    .map((l) => l.trim())
    // Skip the greeting: "Hi Nan," tells the reader nothing.
    .find((l) => l.length > 12 && !/^(hi|hey|hello|good (morning|afternoon))\b/i.test(l))
  if (!firstLine) return null
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
}

/**
 * Summarise one outbound reply, using the cache when present.
 *
 * Returns null only when there is nothing usable to show at all.
 */
export async function summariseReply(message: {
  id: string
  bodyText: string | null
  snippet: string | null
  replySummary: string | null
}): Promise<string | null> {
  if (message.replySummary) return message.replySummary

  const raw = message.bodyText || message.snippet || ''
  const clean = readableReplyBody(raw)
  if (!clean) return null

  if (!process.env.ANTHROPIC_API_KEY) return fallbackSummary(raw)

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content:
            'SirReel rents production vehicles to film and TV productions in LA. ' +
            'Below is a reply one of our agents sent a client.\n\n' +
            'Write ONE sentence, max 18 words, saying what WE told them or committed to. ' +
            'Start with the verb — "Sent the quote for…", "Confirmed the 3-ton for…", ' +
            '"Asked whether they need a lift gate…". No greeting, no sign-off, no preamble.\n\n' +
            `---\n${clean.slice(0, 1500)}\n---`,
        },
      ],
    })
    const block = res.content.find((c) => c.type === 'text')
    const summary = block && block.type === 'text' ? block.text.trim() : ''
    if (!summary) return fallbackSummary(raw)

    // Cache it. Best-effort — a failed write costs one repeat call, and
    // must not fail the request the rep is waiting on.
    await prisma.emailMessage
      .update({
        where: { id: message.id },
        data: { replySummary: summary, replySummaryAt: new Date() },
      })
      .catch(() => undefined)

    return summary
  } catch {
    return fallbackSummary(raw)
  }
}

/** Trim a client's own message for display. Their words, not a paraphrase. */
export function clientExcerpt(body: string | null, snippet: string | null, max = 260): string | null {
  const clean = readableReplyBody(body || '') || (snippet || '').trim()
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
