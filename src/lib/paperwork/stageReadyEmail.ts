import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildStageReadyToSignEmail } from '@/lib/email/templates/stageReadyToSign'
import { portalBaseUrl } from '@/lib/portal/portalUrl'

/**
 * Client "ready to sign" notification for the v2 stage contract.
 *
 * Fired when agent-saved stage terms first make the studio contract
 * signable (areas + rate set), and manually via the agent tool's
 * "Resend signing link". Uses the same Resend pipeline as every other
 * agreement email (sendAgreementEmail).
 *
 * Once-only guard: `readyToSignEmailSentAt` stamped inside the
 * stageDetails JSON — auto-sends bail when it's set; `force: true`
 * (the manual resend) ignores it and re-stamps. Never sends once the
 * contract is signed, and skips gracefully (reason string, no throw)
 * when no client email is on file.
 */

export interface StageReadyEmailResult {
  sent: boolean
  to?: string
  sentAt?: string
  reason?: string
}

export async function sendStageReadyToSignEmail(
  token: string,
  opts: { force?: boolean } = {},
): Promise<StageReadyEmailResult> {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token },
    include: { booking: { include: { person: true, agent: true } } },
  })
  if (!request) return { sent: false, reason: 'Paperwork request not found' }
  if (request.studioContractSigned) return { sent: false, reason: 'Studio contract already signed' }

  let sd: any = null
  try {
    sd = request.stageDetails ? JSON.parse(request.stageDetails) : null
  } catch {
    sd = null
  }
  const sets: string[] = Array.isArray(sd?.sets) ? sd.sets : []
  const termsReady = sets.length > 0 && !!sd?.ratePerDay
  if (!termsReady) return { sent: false, reason: 'Terms are not complete (area + rate required)' }
  if (sd?.readyToSignEmailSentAt && !opts.force) {
    return { sent: false, reason: `Already sent ${sd.readyToSignEmailSentAt}` }
  }

  const to = (request.sentTo || request.booking?.person?.email || '').trim()
  if (!to) return { sent: false, reason: 'No client email on file for this request' }

  const email = buildStageReadyToSignEmail({
    firstName: request.booking?.person?.firstName || '',
    jobName: request.booking?.jobName || '',
    portalLink: `${portalBaseUrl()}/portal/v2/${token}`,
  })

  const result = await sendAgreementEmail({
    to: [to],
    replyTo: request.booking?.agent?.email || undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
    label: 'stage-ready-to-sign',
  })
  if (!result.ok) return { sent: false, reason: result.reason }

  const sentAt = new Date().toISOString()
  await prisma.paperworkRequest.update({
    where: { token },
    data: { stageDetails: JSON.stringify({ ...(sd || {}), readyToSignEmailSentAt: sentAt }) },
  })
  return { sent: true, to, sentAt }
}
