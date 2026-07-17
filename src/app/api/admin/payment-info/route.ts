/**
 * /api/admin/payment-info — Wes-managed payment/ACH details
 * (requireAdmin on every method).
 *
 * Storage (all server-side, never client-reachable outside this admin
 * surface; public delivery is EMAIL ONLY via /api/public/payment-info):
 *   - SiteSetting.paymentDetails   — plain-text banking details
 *   - SiteSetting.paymentPayeeName — canonical payee name in the email
 *   - two PRIVATE-Blob PDF slots (key + filename) attached to the email:
 *       'ach-form'  → "ACH Payment Information Form (bank)"
 *       'bank-info' → "ACH / Wire Banking Information (SirReel)"
 *
 * There is intentionally NO public route/proxy that serves the PDFs —
 * private storage + email attachment ONLY.
 *
 * AUDIT: every change logged with who/when + LENGTHS/filenames only —
 * NEVER the details or file contents.
 */

import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { validatePaymentDetails } from '@/lib/payments/paymentDetails'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'
const MAX_PDF_BYTES = 15 * 1024 * 1024

const SLOTS = {
  'ach-form': { keyField: 'paymentAchFormKey', nameField: 'paymentAchFormFilename', label: 'ACH Payment Information Form (bank)' },
  'bank-info': { keyField: 'paymentBankInfoKey', nameField: 'paymentBankInfoFilename', label: 'ACH / Wire Banking Information (SirReel)' },
} as const
type SlotKey = keyof typeof SLOTS

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      paymentPayeeName: true,
      paymentBankName: true,
      paymentAccountType: true,
      paymentAccountNumber: true,
      paymentRoutingAch: true,
      paymentRoutingWire: true,
      paymentRemittanceEmail: true,
      paymentBankAddress: true,
      paymentInstructions: true,
      paymentAchFormFilename: true,
      paymentAchFormKey: true,
      paymentBankInfoFilename: true,
      paymentBankInfoKey: true,
    },
  })
  return NextResponse.json({
    details: {
      payeeName: s?.paymentPayeeName ?? '',
      bankName: s?.paymentBankName ?? '',
      accountType: s?.paymentAccountType ?? '',
      accountNumber: s?.paymentAccountNumber ?? '',
      routingAch: s?.paymentRoutingAch ?? '',
      routingWire: s?.paymentRoutingWire ?? '',
      remittanceEmail: s?.paymentRemittanceEmail ?? '',
      bankAddress: s?.paymentBankAddress ?? '',
      instructions: s?.paymentInstructions ?? '',
    },
    // Filenames + presence only — the blob keys never leave the server.
    attachments: {
      'ach-form': { filename: s?.paymentAchFormFilename ?? null, present: !!s?.paymentAchFormKey },
      'bank-info': { filename: s?.paymentBankInfoFilename ?? null, present: !!s?.paymentBankInfoKey },
    },
  })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }

  // Validate the STRUCTURED record — FAIL on invalid, never warn-and-allow.
  const validated = validatePaymentDetails(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, field: validated.field }, { status: 400 })
  }
  const r = validated.record

  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: {
      id: SINGLETON,
      paymentPayeeName: r.payeeName,
      paymentBankName: r.bankName,
      paymentAccountType: r.accountType,
      paymentAccountNumber: r.accountNumber,
      paymentRoutingAch: r.routingAch,
      paymentRoutingWire: r.routingWire,
      paymentRemittanceEmail: r.remittanceEmail,
      paymentBankAddress: r.bankAddress,
      paymentInstructions: r.instructions,
    },
    update: {
      paymentPayeeName: r.payeeName,
      paymentBankName: r.bankName,
      paymentAccountType: r.accountType,
      paymentAccountNumber: r.accountNumber,
      paymentRoutingAch: r.routingAch,
      paymentRoutingWire: r.routingWire,
      paymentRemittanceEmail: r.remittanceEmail,
      paymentBankAddress: r.bankAddress,
      paymentInstructions: r.instructions,
    },
  })

  // Change log — which FIELDS were set, never any values.
  await prisma.auditLog.create({
    data: {
      userId: gate.user.id,
      action: 'admin.payment_details_updated',
      entityType: 'SiteSetting',
      entityId: SINGLETON,
      oldValues: {},
      newValues: {
        fieldsSet: Object.entries(r)
          .filter(([, v]) => !!v)
          .map(([k]) => k),
        at: new Date().toISOString(),
      },
    },
  })

  return NextResponse.json({ ok: true })
}

/** POST multipart { slot, file } → private Blob PDF, key persisted. */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const slot = String(form.get('slot') || '') as SlotKey
  if (!(slot in SLOTS)) {
    return NextResponse.json({ error: `slot must be one of: ${Object.keys(SLOTS).join(', ')}` }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'file must be a PDF' }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'file exceeds 15 MB' }, { status: 400 })
  }

  const cfg = SLOTS[slot]
  const data = Buffer.from(await file.arrayBuffer())
  const { blobKey } = await uploadPrivateImage({
    keyPrefix: 'payment-info',
    ownerId: SINGLETON,
    filename: file.name || `${slot}.pdf`,
    contentType: 'application/pdf',
    data,
  })

  // Best-effort clean-up of the previously stored blob for this slot.
  const prior = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { [cfg.keyField]: true } as Record<string, true>,
  })
  const priorKey = prior ? (prior as Record<string, string | null>)[cfg.keyField] : null

  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, [cfg.keyField]: blobKey, [cfg.nameField]: file.name || `${slot}.pdf` },
    update: { [cfg.keyField]: blobKey, [cfg.nameField]: file.name || `${slot}.pdf` },
  })

  if (priorKey && priorKey !== blobKey) {
    try {
      await del(priorKey)
    } catch (err) {
      console.error('[payment-info] prior blob delete failed:', err instanceof Error ? err.message : err)
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: gate.user.id,
      action: 'admin.payment_attachment_uploaded',
      entityType: 'SiteSetting',
      entityId: SINGLETON,
      oldValues: { slot: cfg.label, hadPrior: !!priorKey },
      // Filename + size only — never the file contents.
      newValues: { slot: cfg.label, filename: file.name, sizeBytes: file.size, at: new Date().toISOString() },
    },
  })

  return NextResponse.json({ ok: true, slot, filename: file.name })
}

/** DELETE ?slot=<slot> → clear that PDF slot. */
export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const slot = new URL(req.url).searchParams.get('slot') as SlotKey | null
  if (!slot || !(slot in SLOTS)) {
    return NextResponse.json({ error: `slot must be one of: ${Object.keys(SLOTS).join(', ')}` }, { status: 400 })
  }
  const cfg = SLOTS[slot]

  const prior = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { [cfg.keyField]: true } as Record<string, true>,
  })
  const priorKey = prior ? (prior as Record<string, string | null>)[cfg.keyField] : null

  await prisma.siteSetting.update({
    where: { id: SINGLETON },
    data: { [cfg.keyField]: null, [cfg.nameField]: null },
  })
  if (priorKey) {
    try {
      await del(priorKey)
    } catch (err) {
      console.error('[payment-info] blob delete failed:', err instanceof Error ? err.message : err)
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: gate.user.id,
      action: 'admin.payment_attachment_cleared',
      entityType: 'SiteSetting',
      entityId: SINGLETON,
      oldValues: { slot: cfg.label, hadPrior: !!priorKey },
      newValues: { slot: cfg.label, at: new Date().toISOString() },
    },
  })

  return NextResponse.json({ ok: true, slot })
}
