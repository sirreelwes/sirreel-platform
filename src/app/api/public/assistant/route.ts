/**
 * POST /api/public/assistant — the public site's after-hours AI chat.
 *
 * Answers the basic questions agents field after hours, and runs the
 * driver-verification flow for lost vehicle access codes.
 *
 * SECURITY MODEL:
 *  - The access code is NEVER in the prompt. The model calls the
 *    verify tool; src/lib/assistant/afterHours.ts decides
 *    deterministically, and only a passing verification returns the
 *    code (inside the tool result). The model cannot leak what it
 *    never sees.
 *  - Every release/denial is audit-logged + notifies the team inbox.
 *  - Public + unauthenticated → per-IP rate limit, strict input caps,
 *    bounded tool rounds.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { ASSISTANT_MODEL } from '@/lib/ai/models'
import { verifyAndRelease, fileAfterHoursCallback, alertOnCallTeam } from '@/lib/assistant/afterHours'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

export const dynamic = 'force-dynamic'

// Native fetch — the SDK 0.39 node-fetch shim read-ETIMEDOUTs on
// larger uploads; harmless and safer here too.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

const MAX_MESSAGES = 30
const MAX_CHARS = 2000
const MAX_TOOL_ROUNDS = 3

const SYSTEM_PROMPT = `You are the SirReel Studio Services after-hours assistant on sirreel.com. SirReel rents production vehicles (cube trucks, cargo vans, passenger vans), stages, and production supplies to film/TV productions in Los Angeles.

FACTS YOU MAY STATE:
- Phone (24/7 line): ${PUBLIC_CONTACT.phone}
- Email: ${PUBLIC_CONTACT.email}
- Address: ${PUBLIC_CONTACT.address}
- Payment/ACH details: NEVER state them. Direct people to sirreel.com/payment-info (details are emailed to the address on file).
- Quotes and new rentals: direct to the order form at /order/supplies or the contact page /contact. An agent follows up.

AFTER-HOURS ACCESS (lot gate code + vehicle lockbox code) — your most important job:
1. Ask for their JOB CODE — the code on their SirReel job page (looks like "48210"). This is the main way we verify them.
2. Ask for ONE corroborating detail: the last 4 of their vehicle's VIN, OR the driver's full name on the booking. Also ask which unit they're driving (e.g. "Cube 27") so we know which vehicle's lockbox code to release.
3. Call verify_and_release_code. NEVER state or invent a code yourself — only relay codes the tool returns.
4. On RELEASED: give the gateCode (the lot gate) and, if present, the lockboxCode with its vehicle name — clearly, once each. If gateCode is null, say the gate code isn't on file and to call ${PUBLIC_CONTACT.phone}. If lockboxHint is NEED_VEHICLE or AMBIGUOUS, ask which unit they're driving (or the VIN last 4) and call the tool again.
5. On NOT_VERIFIED: do NOT reveal whether any job/vehicle exists or who is on the booking. Say you couldn't verify them and point them to the 24/7 line at ${PUBLIC_CONTACT.phone} — that is the fastest way to reach someone after hours. Do NOT promise that an agent will "reach out," call them back, or respond "ASAP," and NEVER hand out an individual person's phone number. Do NOT offer to file a callback as a routine option. ONLY if the caller clearly states it is a genuine emergency (a safety issue, or a time-critical, on-the-clock production that is blocked right now) may you offer to file a callback with file_callback_request — and even then make clear that after-hours callbacks are not immediate, so ${PUBLIC_CONTACT.phone} is best for anything urgent. If they mention a QR code sticker in the vehicle's glove box, tell them to call the number printed with it.

EMERGENCIES: If — and ONLY if — the caller clearly states a GENUINE emergency (a safety issue, or a blocked, time-critical, on-the-clock production that cannot wait): first collect their name, a callback number, and a short description of what's wrong, then call alert_on_call_team with those. On ALERTED, tell them our on-call team has been texted their request and will call back if it warrants one — for immediate help the 24/7 line is ${PUBLIC_CONTACT.phone}. On NO_ONCALL, give them the 24/7 line. NEVER promise a specific callback time and NEVER give out anyone's number. Don't use this for routine lost codes or general questions — those go to the 24/7 line.

STYLE: brief, warm, practical. One question at a time. Never make up policy, pricing, or availability. Anything you can't answer → direct them to the 24/7 line at ${PUBLIC_CONTACT.phone}. Refuse anything unrelated to SirReel.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'verify_and_release_code',
    description:
      "Verify an after-hours caller against SirReel's active rentals and, on success, release the lot GATE code and the vehicle LOCKBOX code. Best signal is the JOB CODE (from the client's SirReel job page) plus one corroborator (VIN last-4 or the driver's full name). The unit number pins which vehicle's lockbox code to release. Call once you have a job code plus one other detail, or (fallback) a unit number plus the driver's name.",
    input_schema: {
      type: 'object' as const,
      properties: {
        jobCode: { type: 'string', description: 'The job access code from the client\'s SirReel job page, e.g. "48210"' },
        driverName: { type: 'string', description: "Driver's full name as stated" },
        vehicleNumber: { type: 'string', description: 'Vehicle unit, e.g. "Cube 27" or "27"' },
        vinLast4: { type: 'string', description: 'Last 4 characters of the vehicle VIN' },
      },
      required: [],
    },
  },
  {
    name: 'file_callback_request',
    description:
      'File an urgent after-hours callback for a SirReel agent. Use when verification fails or the question needs a human.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        contact: { type: 'string', description: 'Phone or email to reach them' },
        message: { type: 'string', description: 'Short description of what they need' },
      },
      required: ['name', 'contact', 'message'],
    },
  },
  {
    name: 'alert_on_call_team',
    description:
      "Text SirReel's on-call agents about a GENUINE emergency so they can review it and decide whether to call the caller back. Use ONLY for a real emergency — a safety issue, or a blocked, time-critical, on-the-clock production that cannot wait. NEVER for a routine lost code or a general question. First collect the caller's name, a callback number, and a short description of the emergency.",
    input_schema: {
      type: 'object' as const,
      properties: {
        callerName: { type: 'string', description: "The caller's name" },
        callbackNumber: { type: 'string', description: 'A phone number to reach the caller' },
        emergency: { type: 'string', description: 'Short description of the emergency' },
      },
      required: ['callerName', 'callbackNumber', 'emergency'],
    },
  },
]

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`assistant:${ip}`, { windowMs: 10 * 60 * 1000, max: 20 })
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many messages — slow down a moment.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: 'messages[] required' }, { status: 400 })
  }
  if (body.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ ok: false, error: 'Conversation too long — refresh to start over.' }, { status: 400 })
  }

  const messages: Anthropic.MessageParam[] = []
  for (const raw of body.messages as Array<{ role?: unknown; content?: unknown }>) {
    const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null
    const content = typeof raw.content === 'string' ? raw.content.slice(0, MAX_CHARS) : null
    if (!role || !content) {
      return NextResponse.json({ ok: false, error: 'invalid message shape' }, { status: 400 })
    }
    messages.push({ role, content })
  }
  if (messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'last message must be from the user' }, { status: 400 })
  }

  try {
    let rounds = 0
    let response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })

    while (response.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
      rounds++
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        let resultPayload: unknown
        if (block.name === 'verify_and_release_code') {
          const inp = block.input as {
            jobCode?: string
            driverName?: string
            vehicleNumber?: string
            vinLast4?: string
          }
          resultPayload = await verifyAndRelease({
            jobCode: inp.jobCode ? String(inp.jobCode).slice(0, 40) : null,
            driverName: inp.driverName ? String(inp.driverName).slice(0, 200) : null,
            vehicleNumber: inp.vehicleNumber ? String(inp.vehicleNumber).slice(0, 60) : null,
            vinLast4: inp.vinLast4 ? String(inp.vinLast4).slice(0, 20) : null,
            ip,
          })
        } else if (block.name === 'file_callback_request') {
          const inp = block.input as { name?: string; contact?: string; message?: string }
          resultPayload =
            inp.name && inp.contact && inp.message
              ? await fileAfterHoursCallback({
                  name: String(inp.name),
                  contact: String(inp.contact),
                  message: String(inp.message),
                  ip,
                })
              : { ok: false, error: 'missing fields' }
        } else if (block.name === 'alert_on_call_team') {
          const inp = block.input as { callerName?: string; callbackNumber?: string; emergency?: string }
          resultPayload = await alertOnCallTeam({
            callerName: inp.callerName ? String(inp.callerName).slice(0, 200) : '',
            callbackNumber: inp.callbackNumber ? String(inp.callbackNumber).slice(0, 60) : '',
            emergency: inp.emergency ? String(inp.emergency).slice(0, 500) : '',
            ip,
          })
        } else {
          resultPayload = { error: 'unknown tool' }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(resultPayload),
        })
      }
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      response = await client.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    return NextResponse.json({
      ok: true,
      reply: text || `I hit a snag — please call us at ${PUBLIC_CONTACT.phone} and an agent will help right away.`,
    })
  } catch (err) {
    console.error('[assistant] chat failed:', err)
    return NextResponse.json({
      ok: true,
      reply: `I'm having trouble right now — please call us at ${PUBLIC_CONTACT.phone} and an agent will help right away.`,
    })
  }
}
