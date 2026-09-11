/**
 * /api/vendors/[id]/welcome — the partner INTRODUCTION.
 *
 *   GET                 → the opening draft { subject, body } + its rendered html
 *   POST { prompt }     → rewrite the draft from ONE LINE of instruction (AI)
 *   POST { preview }    → re-render whatever Wes has typed, WITHOUT sending
 *   POST                → send it, and stamp the vendor
 *
 * Preview and send go through the SAME renderer (renderPartnerWelcome), so the
 * thing on screen is the thing that leaves. Wes 2026-09-10: "like always, I
 * need to preview the email before it sends."
 *
 * WES ONLY — an email allowlist, not a role check. ADMIN is held by both Wes
 * and Dani, so a role check would silently make Dani a second sender, and this
 * is a personal approach from the owner. See welcomeSender.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canSendPartnerWelcome, WES_SIGNATURE_TITLE } from '@/lib/sub-rentals/welcomeSender'
import { partnerIntroDraft, partnerWelcomeExtras, renderPartnerWelcome, sendPartnerWelcome } from '@/lib/sub-rentals/vendorInvite'
import { draftFromPrompt } from '@/lib/sub-rentals/welcomeAiDraft'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function wes() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  if (!email) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) }
  if (!canSendPartnerWelcome(email)) {
    return { error: NextResponse.json({ error: 'Only Wes sends the partner introduction.' }, { status: 403 }) }
  }
  // His cell lives on his User row (no other surface carries it) — the
  // sign-off wants it (Wes 2026-09-11: "Add my cell and email address").
  const u = await prisma.user.findUnique({ where: { email }, select: { name: true, phone: true } })
  // The title line is the owner's; a delegated sender (PARTNER_WELCOME_SENDERS) signs with name and contact only.
  const title = email.toLowerCase() === 'wes@sirreel.com' ? WES_SIGNATURE_TITLE : null
  return { email, name: session?.user?.name ?? u?.name ?? null, phone: u?.phone ?? null, title }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const g = await wes(); if ('error' in g) return g.error
  const { id } = await params
  try {
    const v = await prisma.vendor.findUnique({
      where: { id },
      select: { name: true, email: true, contactName: true, welcomeSentAt: true, welcomeSentTo: true, welcomeSubject: true },
    })
    if (!v) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const draft = await partnerIntroDraft(id, { name: g.name?.trim() || 'Wes Bailey', email: g.email, phone: g.phone, title: g.title })
    const { html } = renderPartnerWelcome({ vendorName: v.name, subject: draft.subject, body: draft.body, ...(await partnerWelcomeExtras(id)) })
    return NextResponse.json({
      draft,
      html,
      // Their contact address, so the To box opens filled rather than blank —
      // still editable, and Wes picks the address (KK, 2026-09-06).
      suggestedTo: v.email ?? null,
      alreadySent: v.welcomeSentAt
        ? { at: v.welcomeSentAt.toISOString(), to: v.welcomeSentTo, subject: v.welcomeSubject }
        : null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const g = await wes(); if ('error' in g) return g.error
  const { id } = await params
  const b = (await req.json().catch(() => ({}))) as {
    to?: string; subject?: string; body?: string; preview?: boolean; prompt?: string
  }
  const subject = typeof b.subject === 'string' ? b.subject : ''
  const body = typeof b.body === 'string' ? b.body : ''

  try {
    // ── Write it from one line ──────────────────────────────────────────
    // Steers the draft rather than replacing it: "shorter", "mention we can
    // start with two generators next week", "warmer". The model is handed the
    // REAL deal terms so it cannot invent a split, and whatever comes back
    // lands in the box for Wes to edit and preview like anything else.
    // Nothing is sent and nothing is stamped on this path.
    if (typeof b.prompt === 'string' && b.prompt.trim()) {
      const out = await draftFromPrompt({
        vendorId: id,
        prompt: b.prompt.trim(),
        current: { subject, body },
        senderName: g.name?.trim() || 'Wes Bailey',
        senderPhone: g.phone,
        senderEmail: g.email,
        senderTitle: g.title,
      })
      return NextResponse.json({ draft: out })
    }
    if (b.preview) {
      const v = await prisma.vendor.findUnique({ where: { id }, select: { name: true } })
      if (!v) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
      const { html, text } = renderPartnerWelcome({ vendorName: v.name, subject, body, ...(await partnerWelcomeExtras(id)) })
      // Nothing is sent and nothing is stamped on this path.
      return NextResponse.json({ preview: true, html, text })
    }
    const res = await sendPartnerWelcome({
      vendorId: id,
      to: typeof b.to === 'string' ? b.to : '',
      subject,
      body,
      sender: { email: g.email, name: g.name },
    })
    if (!res.ok) return NextResponse.json({ error: res.reason || 'not sent' }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
