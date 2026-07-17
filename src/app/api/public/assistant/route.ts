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
import { verifyDriverForAccessCode, fileAfterHoursCallback } from '@/lib/assistant/afterHours'
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

LOST VEHICLE ACCESS CODE — your most important job. Mirror the agent script:
1. Ask for the driver's full name (first and last) and which vehicle they're driving (unit number, e.g. "Cube 27").
2. Optionally ask what job/production they're working on if the tool asks for a tie-breaker.
3. Call verify_driver_and_release_code. NEVER state or invent a code yourself — only relay a code the tool returns.
4. If the tool returns RELEASED, give the code clearly, once, with the vehicle name.
5. If verification fails (NAME_MISMATCH / VEHICLE_NOT_FOUND / NO_ACTIVE_RENTAL), do NOT reveal whether the vehicle exists or who is on the booking. Say you couldn't verify them, and offer: (a) call ${PUBLIC_CONTACT.phone}, or (b) file a callback with file_callback_request (collect name, phone/email, and a short message). If they mention a QR code sticker in the vehicle's glove box, tell them to call the number printed with it — QR verification is handled by an agent.
6. NO_CODE_ON_FILE: apologize, say the team has been notified and they should call ${PUBLIC_CONTACT.phone}.

STYLE: brief, warm, practical. One question at a time. Never make up policy, pricing, or availability. Anything you can't answer → offer the phone number or a callback. Refuse anything unrelated to SirReel.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'verify_driver_and_release_code',
    description:
      "Verify an after-hours caller against SirReel's active rentals and, on success, release the vehicle's access code. Call ONLY after collecting the driver's full name and the vehicle unit number.",
    input_schema: {
      type: 'object' as const,
      properties: {
        driverName: { type: 'string', description: "Driver's full name as stated" },
        vehicleNumber: { type: 'string', description: 'Vehicle unit, e.g. "Cube 27" or "27"' },
        jobName: { type: 'string', description: 'Production/job name if stated (optional tie-breaker)' },
      },
      required: ['driverName', 'vehicleNumber'],
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
        if (block.name === 'verify_driver_and_release_code') {
          const inp = block.input as { driverName?: string; vehicleNumber?: string; jobName?: string }
          resultPayload =
            inp.driverName && inp.vehicleNumber
              ? await verifyDriverForAccessCode({
                  driverName: String(inp.driverName).slice(0, 200),
                  vehicleNumber: String(inp.vehicleNumber).slice(0, 60),
                  jobName: inp.jobName ? String(inp.jobName).slice(0, 200) : null,
                  ip,
                })
              : { result: 'INVALID_INPUT' }
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
