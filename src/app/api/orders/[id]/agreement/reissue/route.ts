import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { ensureBaselineRentalDocumentToSign } from '@/lib/orders/signedAgreement'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { pickCanonicalRecipient } from '@/lib/email/recipients'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/orders/[id]/agreement/reissue
 *
 * Re-send an agreement for signature under the CORRECT company.
 *
 * The case this exists for (Wes, 2026-08-25): the production company on the
 * job was wrong — usually caught when the COI's named insured didn't match —
 * and the client had ALREADY signed. A signature against the wrong entity is
 * not a contract with the company that is actually renting, so the paper has
 * to go out again under the right account.
 *
 * SignedAgreement is unique on (orderId, contractType), so re-releasing
 * necessarily overwrites the signature fields on the live row. Every
 * superseded signature is therefore snapshotted into AgreementReissue FIRST —
 * who signed, when, and the signed PDF's URL — so a re-send never erases the
 * fact that a client did sign something. The snapshot is written in the same
 * transaction as the reset: no window where the signature is gone from both.
 *
 * Body:
 *   reason        — required, free text (what was wrong)
 *   contractType  — RENTAL_AGREEMENT (default) | STAGE_CONTRACT
 *   notify        — email the client the portal link (default true)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })

  const body = (await req.json().catch(() => ({}))) as {
    reason?: unknown
    contractType?: unknown
    notify?: unknown
    priorCompanyName?: unknown
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required — it is the audit record.' }, { status: 400 })
  }
  const contractType =
    body.contractType === 'STAGE_CONTRACT' ? ('STAGE_CONTRACT' as const) : ('RENTAL_AGREEMENT' as const)
  const notify = body.notify !== false
  const priorCompanyName =
    typeof body.priorCompanyName === 'string' && body.priorCompanyName.trim()
      ? body.priorCompanyName.trim().slice(0, 200)
      : null

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      portalSlug: true,
      companyId: true,
      company: {
        select: {
          name: true,
          negotiatedTermsUrl: true,
          negotiatedTermsApprovedAt: true,
          negotiatedTermsActiveAsOf: true,
        },
      },
      agent: { select: { name: true, email: true, phone: true } },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      job: {
        select: {
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      signedAgreements: { where: { contractType }, select: { id: true, status: true, documentType: true, signedAt: true, signerName: true, signerEmail: true, signedDocumentUrl: true } },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  const agreement = order.signedAgreements[0]
  if (!agreement) {
    return NextResponse.json(
      { error: 'This order has no agreement of that type to re-issue.' },
      { status: 404 },
    )
  }

  // Does the CURRENT company carry standing negotiated terms? Same test as
  // ensureSignedAgreementForOrder — a re-issue lands on whichever document
  // the company would get if the order were papered today.
  const co = order.company
  const hasStanding =
    !!co?.negotiatedTermsUrl &&
    !!co.negotiatedTermsApprovedAt &&
    (co.negotiatedTermsActiveAsOf == null || co.negotiatedTermsActiveAsOf <= new Date())

  // Stage contracts are generated per-order from negotiated stage terms
  // (/api/orders/[id]/generate-stage-contract); this route can reset one for
  // signature but cannot re-render it. Say so rather than handing back a
  // stale PDF that still names the old company.
  const isStage = contractType === 'STAGE_CONTRACT'

  const reset = isStage
    ? {
        // No document we can regenerate here — drop back to "preparing" so
        // nobody signs the old PDF, and tell the caller to regenerate.
        status: 'PORTAL_GENERATED' as const,
        documentToSignUrl: null,
      }
    : hasStanding && co?.negotiatedTermsUrl
      ? {
          status: 'NEGOTIATED_READY' as const,
          documentType: 'NEGOTIATED' as const,
          documentToSignUrl: co.negotiatedTermsUrl,
        }
      : {
          status: 'PORTAL_RELEASED' as const,
          documentType: 'BASELINE' as const,
          // Null so ensureBaselineRentalDocumentToSign re-renders below —
          // the baseline PDF prints the company name, so the old file is
          // exactly the wrong document.
          documentToSignUrl: null,
          baselineVersion: new Date().toISOString().slice(0, 10),
        }

  await prisma.$transaction([
    prisma.agreementReissue.create({
      data: {
        orderId: order.id,
        contractType,
        reason,
        priorStatus: agreement.status,
        priorSignedAt: agreement.signedAt,
        priorSignerName: agreement.signerName,
        priorSignerEmail: agreement.signerEmail,
        priorSignedDocumentUrl: agreement.signedDocumentUrl,
        priorCompanyName,
        newCompanyName: co?.name ?? null,
        createdById: actor?.id ?? null,
        createdByName: actor?.name ?? null,
      },
    }),
    prisma.signedAgreement.update({
      where: { id: agreement.id },
      data: {
        ...reset,
        // The superseded signature lives in the AgreementReissue row created
        // above; clearing it here is what makes the portal ask again.
        signedAt: null,
        signerName: null,
        signerTitle: null,
        signerEmail: null,
        signatureImageData: null,
        acknowledgmentText: null,
        signerIpAddress: null,
        signerUserAgent: null,
        signedDocumentUrl: null,
      },
    }),
  ])

  // Re-render the baseline against the current company. Best-effort: the
  // portal's own lazy-fill paths repair a render hiccup, and the reset above
  // has already invalidated the wrong document either way.
  let documentToSignUrl: string | null = null
  if (!isStage && !hasStanding) {
    documentToSignUrl = await ensureBaselineRentalDocumentToSign(order.id).catch((err) => {
      console.error('[agreement/reissue] baseline re-render failed:', order.id, err)
      return null
    })
  } else if (!isStage) {
    documentToSignUrl = co?.negotiatedTermsUrl ?? null
  }

  // Tell the client. A re-issue they don't hear about is a portal row that
  // silently un-signs itself.
  let emailed = false
  let emailError: string | null = null
  if (notify && !isStage) {
    try {
      const picked =
        order.jobContact?.email
          ? {
              id: order.jobContact.id,
              email: order.jobContact.email,
              name: [order.jobContact.firstName, order.jobContact.lastName].filter(Boolean).join(' '),
            }
          : pickCanonicalRecipient(order.job, order.jobContact)
      if (!picked?.email || !order.portalSlug) {
        emailError = 'No client contact or portal link to send to — re-send the portal link manually.'
      } else {
        const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: picked.id })
        const portalUrl = portalJobUrl(order.portalSlug, link.token)
        const firstName = (picked.name || '').split(' ')[0] || 'there'
        const projectName = order.job?.name || order.orderNumber
        const companyLine = co?.name ? ` under <b>${escapeHtml(co.name)}</b>` : ''
        const res = await sendAgreementEmail({
          label: `agreement/reissue:${order.orderNumber}`,
          to: [picked.email],
          // "Reach out to <rep>" — so a plain Reply must actually reach
          // them, not the unmonitored notifications@ sender.
          replyTo: order.agent?.email ?? undefined,
          subject: `Please re-sign: rental agreement for ${projectName}`,
          html: `<p>Hi ${escapeHtml(firstName)},</p>
<p>We've re-issued the rental agreement for <b>${escapeHtml(projectName)}</b>${companyLine}. ${escapeHtml(reason)}</p>
<p>The previous version is no longer the one on file, so we need a fresh signature on the corrected agreement:</p>
<p><a href="${portalUrl}">Open your portal and sign →</a></p>
<p>Sorry for the extra step — reach out to ${escapeHtml(order.agent?.name || 'your SirReel rep')} with any questions.</p>`,
          text: `Hi ${firstName},

We've re-issued the rental agreement for ${projectName}${co?.name ? ` under ${co.name}` : ''}. ${reason}

The previous version is no longer the one on file, so we need a fresh signature on the corrected agreement:
${portalUrl}

Sorry for the extra step — reach out to ${order.agent?.name || 'your SirReel rep'} with any questions.`,
        })
        emailed = res.ok
        if (!res.ok) emailError = res.reason || 'Email send failed.'
      }
    } catch (err) {
      console.error('[agreement/reissue] notify failed:', err)
      emailError = 'Could not email the client — re-send the portal link manually.'
    }
  }

  return NextResponse.json({
    ok: true,
    contractType,
    status: reset.status,
    documentToSignUrl,
    companyName: co?.name ?? null,
    emailed,
    emailError,
    needsStageRegeneration: isStage,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
