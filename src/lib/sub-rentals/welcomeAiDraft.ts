/**
 * "Write it from one line" — the AI option behind the partner introduction.
 *
 * Wes types a single instruction ("shorter", "mention we can start with two
 * generators next week", "warmer, he's an old friend") and gets a draft back in
 * the box. It is a DRAFT: it lands in the same fields he was already editing,
 * he previews it like anything else, and he presses Send. Nothing here sends,
 * stamps or mints.
 *
 * ── The model is never asked to know the deal ───────────────────────────────
 * The load-bearing risk in an AI-written business email is a hallucinated term.
 * A model that invents "we take 30%" or promises a generator is free next
 * Tuesday does damage a typo never could, and Wes would be signing his name to
 * it. So the real numbers are computed here, from the vendor row, and handed to
 * the model as FACTS it may restate but never derive. It is told, in the
 * strongest terms available, to invent no figure that is not in that block.
 *
 * When the deal is not set, the facts say so and the model is told to write
 * around it rather than pick a number — the same thing buildIntroDraft does.
 *
 * ── Still no link ───────────────────────────────────────────────────────────
 * The introduction never carries the account link; that is the second mail,
 * gated on this one having gone (sendVendorInvite). The model is told.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { EMAIL_SUGGEST_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import { partnerVocab } from '@/lib/sub-rentals/partnerKind'
import type { IntroDraft } from '@/lib/sub-rentals/welcomeSender'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Belt and braces: strip anything link-shaped the model slipped in anyway. */
function stripLinks(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[\w.-]+\.(com|net|org|io)\/\S*/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export async function draftFromPrompt(a: {
  vendorId: string
  prompt: string
  current: { subject: string; body: string }
  senderName: string
}): Promise<IntroDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('AI drafting is not configured on this environment.'), { status: 503 })
  }

  const v = await prisma.vendor.findUnique({
    where: { id: a.vendorId },
    select: { name: true, contactName: true, partnerKind: true, partnerSharePercent: true },
  })
  if (!v) throw Object.assign(new Error('Vendor not found'), { status: 404 })

  const words = partnerVocab(v.partnerKind)
  const share = v.partnerSharePercent == null ? null : Number(v.partnerSharePercent)
  const theirs = share == null ? null : Math.round((100 - share) * 100) / 100
  const first = v.contactName?.trim().split(/\s+/)[0] || null

  // Everything the model is permitted to assert. Anything not here is not a
  // fact it has.
  const facts = [
    `Partner company: ${v.name}`,
    `SirReel's standing: 30 years of reputation and a customer base in production — that is what SirReel puts behind the partner's ${words.many}.`,
    `How it works, in order: SirReel features the partner's products and services on its website and in its communications with clients. When a client orders, SirReel gets that information to the partner instantly. The partner confirms by email, text, or on a portal SirReel provides. SirReel handles all client contracts, insurance and client interaction. The same portal gives the partner the delivery information, the site contact and any instructions from the client. At the end of the job SirReel bills the client, collects the money and passes it along to the partner minus SirReel's percentage.`,
    `SirReel's role: ${v.name}'s OUTSIDE SALES PARTNER — SirReel features their ${words.many} on sirreel.com and in its quotes, and brings them the bookings; the client books through SirReel and the job lands on the partner's page with dates, location and contact.`,
    `Their contact: ${v.contactName ?? 'unknown — do not invent a name'}${first ? ` (first name "${first}")` : ''}`,
    `What they rent us: ${words.many}`,
    share == null
      ? `The revenue split: NOT AGREED YET. Do not state any percentage. Say the exact split will be confirmed before anything is booked.`
      : `The revenue split: the production pays the partner's listed rate; the partner receives ${theirs}% of it and SirReel keeps ${share}%. SirReel's share comes out of the partner's side, NOT added on top, so going through SirReel costs the production nothing.`,
    `Payment: the partner invoices SirReel after a booking comes back; SirReel pays within 30 days.`,
    words.drivers
      ? `Ancillaries billed on top at the partner's own rates, paid to them in full: delivery, mileage, generator hours, driver time.`
      : `Ancillaries billed on top at the partner's own rates, paid to them in full: delivery and collection, fuel, cable and distribution, technician time.`,
    `Why productions like it: one agreement with SirReel, one certificate of insurance, one invoice. They never set the partner up as a new vendor, and the partner's ${words.many} ${words.drivers ? 'are' : 'is'} covered under the same agreement and insurance as SirReel's own.`,
    `What the partner gets: their own page — their ${words.many}, their rates (theirs to change any time), their own photos, delivery contacts, and every booking in one place.`,
    `What SirReel needs back: the partner agreement signed, and a certificate of insurance naming SirReel.`,
    `The sender: ${a.senderName}, who owns SirReel — a Los Angeles company that has rented production vehicles to film and TV for 30 years.`,
  ].join('\n')

  const system = [
    'You are drafting a short business email for the owner of SirReel, a Los Angeles production-rental company, to the owner of a company he wants to partner with.',
    '',
    'CONTEXT THAT SETS THE TONE: this is FIRST CONTACT. The reader may never have heard of SirReel. Open with one line saying who he is and what SirReel is (from the FACTS), then get to the substance. Do not assume any earlier conversation, and do not pad the opening with pleasantries about reaching out.',
    '',
    'HARD RULES, in order of importance:',
    '1. Every factual claim must come from the FACTS block. Invent NO percentage, price, date, availability, unit count or deadline that is not written there. If the instruction asks for something the facts do not support, write around it rather than making it up.',
    '2. Include NO links or URLs. The account-page link is a separate email sent later.',
    '3. Spell it "SirReel" — capital S, capital R. Never "SirReel Production Vehicles"; that entity name is for contracts only.',
    '4. Write as him, first person, plain, warm and direct — the voice of an owner who has done this for 30 years and is always looking for a way to offer more. No marketing voice, no bullet lists; short paragraphs separated by a blank line. At most one exclamation mark, at the close ("a win/win!" is his).',
    '5. Keep it under 200 words unless told otherwise. This is the FIRST email: a hook, not a terms sheet. Lead with SirReel wanting to be their outside sales partner and what that does for them; the fine detail of the page and the paperwork comes in a later email.',
    '',
    'FACTS:',
    facts,
    '',
    'Return ONLY JSON: {"subject": "...", "body": "..."} — body is plain text with \\n\\n between paragraphs, opening with a greeting and ending with a sign-off from him.',
  ].join('\n')

  const user = [
    'Here is the current draft.',
    '',
    `SUBJECT: ${a.current.subject || '(empty)'}`,
    'BODY:',
    a.current.body || '(empty)',
    '',
    'Rewrite it according to this instruction. If the draft is empty, write it from scratch.',
    '',
    `INSTRUCTION: ${a.prompt}`,
  ].join('\n')

  const res = await anthropic.messages.create({
    model: EMAIL_SUGGEST_MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }],
  })

  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
  const parsed = parseAiJson<{ subject?: unknown; body?: unknown }>(text, {
    tag: 'partner-welcome-draft',
    stopReason: res.stop_reason,
  })
  const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : ''
  const body = typeof parsed?.body === 'string' ? parsed.body.trim() : ''
  if (!body) throw Object.assign(new Error('The model did not return a draft — try rephrasing.'), { status: 502 })

  return {
    subject: stripLinks(subject) || a.current.subject,
    body: stripLinks(body),
  }
}
