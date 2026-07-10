import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { resolvePersonByEmail } from '@/lib/people/email'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl, portalBaseUrl } from '@/lib/portal/portalUrl'
import { startWelcomeInvite } from '@/lib/portal/welcomeStart'
import {
  ensureSignedAgreementForOrder,
  ensureBaselineRentalDocumentToSign,
} from '@/lib/orders/signedAgreement'

/**
 * Public rental-agreement email gate — ALL intelligence lives in the emailed
 * message; the page response is a constant regardless of what the address
 * matches (anti-enumeration, non-negotiable).
 *
 * Branching (per Wes: every valid address gets an email):
 *   A  confirm      — known Person with OPEN jobs (QUOTED/ACTIVE/HOLD) whose
 *                     rental agreement is UNSIGNED: lists those jobs, each
 *                     with a "This is my job →" confirm link, plus a
 *                     "This is a new job →" option.
 *   B  all-set      — known Person whose open jobs are ALL signed:
 *                     "You're all set for … Starting something new? →".
 *   C  welcome-back — known Person, no open jobs: "Welcome back — let's get
 *                     your new job started →".
 *   C' get-started  — no matching Person: "Let's get started →".
 *
 * Job creation NEVER happens here — the START_NEW form's submit routes
 * through the SAME WelcomeInvite click-to-create path (startWelcomeInvite),
 * so idempotency lives in one place. Agreement text always renders from
 * contractClauses.ts via the existing baseline flow.
 */

const ENTRY_TTL_DAYS = 7
const OPEN_JOB_STATUSES = ['QUOTED', 'ACTIVE', 'HOLD'] as const
const SIGNED = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'])

function entryToken(): string {
  return randomBytes(32).toString('hex')
}
function expiry(): Date {
  return new Date(Date.now() + ENTRY_TTL_DAYS * 24 * 60 * 60 * 1000)
}
export function confirmEntryUrl(token: string): string {
  return `${portalBaseUrl()}/api/public/agreement-entry/${token}`
}
export function startNewUrl(token: string): string {
  return `${portalBaseUrl()}/portal/agreement-start/${token}`
}

interface OpenJob {
  id: string
  name: string
  company: string
  startDate: Date | null
  endDate: Date | null
  firstOrderId: string | null
  signed: boolean
}

/** Person's open jobs via JobContact ∪ PortalAccess, with signed-state. */
async function openJobsForPerson(personId: string): Promise<OpenJob[]> {
  const [viaContacts, viaAccess] = await Promise.all([
    prisma.jobContact.findMany({
      where: { personId, job: { status: { in: [...OPEN_JOB_STATUSES] } } },
      select: { jobId: true },
    }),
    prisma.portalAccess.findMany({
      where: { contactId: personId, revokedAt: null, order: { job: { status: { in: [...OPEN_JOB_STATUSES] } } } },
      select: { order: { select: { jobId: true } } },
    }),
  ])
  const jobIds = [
    ...new Set([
      ...viaContacts.map((c) => c.jobId),
      ...viaAccess.map((a) => a.order.jobId).filter((id): id is string => Boolean(id)),
    ]),
  ]
  if (jobIds.length === 0) return []
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      company: { select: { name: true } },
      orders: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          signedAgreements: { where: { contractType: 'RENTAL_AGREEMENT' }, select: { status: true } },
        },
      },
    },
  })
  return jobs.map((j) => ({
    id: j.id,
    name: j.name,
    company: j.company.name,
    startDate: j.startDate,
    endDate: j.endDate,
    firstOrderId: j.orders[0]?.id ?? null,
    signed: j.orders.some((o) => o.signedAgreements.some((a) => SIGNED.has(a.status))),
  }))
}

const fmtD = (d: Date | null) =>
  d ? d.toISOString().slice(0, 10) : null
const jobDates = (j: OpenJob) => {
  const s = fmtD(j.startDate)
  const e = fmtD(j.endDate)
  if (s && e) return `${s} – ${e}`
  if (s) return `from ${s}`
  return 'dates TBD'
}

const GOLD = '#D4A547'
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="color-scheme" content="light" /></head>
<body style="margin:0;padding:0;background:#f5f5f3;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f3;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0a0a0a;padding:28px 24px;text-align:center;">
        <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel Studio Services" width="180" style="max-width:180px;height:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:400;">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 32px 26px;font-size:11px;color:#888;">SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:6px;">${esc(label)}</a>`
const P = (s: string) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#333;">${s}</p>`

/**
 * Look up the email + send the branch email. Returns which variant fired —
 * for logging/tests ONLY; the HTTP layer must never surface it.
 */
export async function processAgreementEntryRequest(rawEmail: string): Promise<'confirm' | 'all-set' | 'welcome-back' | 'get-started' | 'invalid'> {
  const email = rawEmail.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'invalid'

  const person = (await resolvePersonByEmail(email, {
    select: { id: true, firstName: true },
  })) as { id: string; firstName: string } | null

  const jobs = person ? await openJobsForPerson(person.id) : []
  const unsigned = jobs.filter((j) => !j.signed && j.firstOrderId)
  const hi = person?.firstName ? `Hi ${esc(person.firstName)},` : 'Hi,'

  // Every variant carries a START_NEW option.
  const startNew = await prisma.agreementEntry.create({
    data: { token: entryToken(), email, kind: 'START_NEW', personId: person?.id ?? null, expiresAt: expiry() },
    select: { token: true },
  })
  const startHref = startNewUrl(startNew.token)

  let subject: string
  let title: string
  let body: string
  let variant: 'confirm' | 'all-set' | 'welcome-back' | 'get-started'

  if (unsigned.length > 0) {
    // A — confirm which open job this agreement is for (or a new one).
    variant = 'confirm'
    const rows = await Promise.all(
      unsigned.map(async (j) => {
        const t = await prisma.agreementEntry.create({
          data: { token: entryToken(), email, kind: 'CONFIRM_JOB', personId: person!.id, jobId: j.id, expiresAt: expiry() },
          select: { token: true },
        })
        return `<div style="border:1px solid #e6e2d8;border-radius:8px;padding:12px 14px;margin:0 0 10px;">
          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${esc(j.name)}</div>
          <div style="font-size:12px;color:#777;margin:2px 0 10px;">${esc(j.company)} · ${esc(jobDates(j))}</div>
          ${btn(confirmEntryUrl(t.token), 'This is my job →')}
        </div>`
      }),
    )
    subject = 'Your SirReel rental agreement — which job is this for?'
    title = 'Which job is this agreement for?'
    body =
      P(hi) +
      P('You asked to fill out the SirReel rental agreement. We have the following open with you — pick the job it belongs to and we’ll take you straight to the paperwork:') +
      rows.join('') +
      P(`Working on something else? ${btn(startHref, 'This is a new job →')}`)
  } else if (jobs.length > 0) {
    // B — everything already signed.
    variant = 'all-set'
    const names = jobs.map((j) => esc(j.name)).join(', ')
    subject = 'You’re all set — SirReel rental agreement'
    title = 'You’re all set.'
    body =
      P(hi) +
      P(`Your rental agreement is already signed for <strong>${names}</strong> — nothing more to fill out there.`) +
      P(`Starting something new? ${btn(startHref, 'Start a new job →')}`)
  } else if (person) {
    // C — known person, nothing open.
    variant = 'welcome-back'
    subject = 'Welcome back to SirReel — let’s get started'
    title = 'Welcome back.'
    body =
      P(hi) +
      P('Good to see you again. Tell us a little about the new job and we’ll set up your paperwork and portal in one step.') +
      P(btn(startHref, 'Get started →'))
  } else {
    // C' — unknown email.
    variant = 'get-started'
    subject = 'Let’s get started with SirReel'
    title = 'Let’s get you started.'
    body =
      P('Hi,') +
      P('Thanks for your interest in SirReel Studio Services. Tell us a little about your job and we’ll set up your rental agreement and portal in one step.') +
      P(btn(startHref, 'Get started →'))
  }

  const html = emailShell(title, body)
  const text = `${title}\n\nOpen this email in an HTML mail client to continue, or contact us at (888) 477-7335.`
  await sendAgreementEmail({ to: [email], subject, html, text, label: 'agreement-entry' })
  return variant
}

/**
 * Branch A click — "This is my job →". No creation of any kind: prepares the
 * job's baseline agreement (render + release; idempotent) and mints a fresh
 * magic link into the job portal, where "Sign agreement →" is live. Repeat
 * clicks / forwards land in the same portal.
 */
export async function confirmJobEntry(token: string): Promise<{ kind: 'redirect'; url: string } | { kind: 'invalid' }> {
  const entry = await prisma.agreementEntry.findUnique({
    where: { token },
    select: { id: true, kind: true, personId: true, jobId: true, expiresAt: true, usedAt: true },
  })
  if (!entry || entry.kind !== 'CONFIRM_JOB' || !entry.jobId || !entry.personId) return { kind: 'invalid' }
  if (entry.expiresAt < new Date() && !entry.usedAt) return { kind: 'invalid' }

  const order = await prisma.order.findFirst({
    where: { jobId: entry.jobId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, portalSlug: true },
  })
  if (!order?.portalSlug) return { kind: 'invalid' }

  // Paperwork ready — same idempotent baseline path the signing flow uses
  // (renders from contractClauses.ts; never touches signed/negotiated rows).
  try {
    await ensureSignedAgreementForOrder(order.id)
    await ensureBaselineRentalDocumentToSign(order.id)
    await prisma.signedAgreement.updateMany({
      where: { orderId: order.id, contractType: 'RENTAL_AGREEMENT', status: 'PORTAL_GENERATED', documentToSignUrl: { not: null } },
      data: { status: 'PORTAL_RELEASED' },
    })
  } catch (err) {
    console.error('[agreement-entry] paperwork prep failed (non-blocking):', order.id, err)
  }

  if (!entry.usedAt) {
    await prisma.agreementEntry.updateMany({ where: { id: entry.id, usedAt: null }, data: { usedAt: new Date() } })
  }
  const issued = await issueJobMagicLink({ orderId: order.id, contactId: entry.personId })
  return { kind: 'redirect', url: portalJobUrl(order.portalSlug, issued.token) }
}

export interface StartNewForm {
  jobName: string
  companyName: string
  firstName: string
  lastName: string
  startDate?: string | null
  endDate?: string | null
}

/**
 * Branch C submit — the client's explicit "create my job" action. Creates
 * Person/Company/Inquiry as needed, then routes through the SAME
 * WelcomeInvite click-to-create path (startWelcomeInvite) so Job+Order mint
 * idempotency lives in exactly one place. Repeat submits / double-clicks
 * resolve to the SAME job via the entry's createdInquiryId → WelcomeInvite.
 */
export async function startNewSubmit(
  token: string,
  form: StartNewForm,
): Promise<{ kind: 'ok'; portalUrl: string; orderFormUrl: string } | { kind: 'invalid' } | { kind: 'error'; message: string }> {
  const entry = await prisma.agreementEntry.findUnique({
    where: { token },
    select: { id: true, kind: true, email: true, personId: true, expiresAt: true, usedAt: true, createdInquiryId: true },
  })
  if (!entry || entry.kind !== 'START_NEW') return { kind: 'invalid' }

  const orderFormUrl = `${portalBaseUrl()}/order/supplies`
  const resolveExisting = async (inquiryId: string) => {
    const invite = await prisma.welcomeInvite.findUnique({ where: { inquiryId }, select: { token: true } })
    if (!invite) return { kind: 'invalid' as const }
    const r = await startWelcomeInvite(invite.token)
    return r.kind === 'redirect' ? { kind: 'ok' as const, portalUrl: r.url, orderFormUrl } : { kind: 'invalid' as const }
  }
  // Already submitted (repeat / forwarded / double-click) → same job.
  if (entry.createdInquiryId) return resolveExisting(entry.createdInquiryId)
  if (entry.expiresAt < new Date()) return { kind: 'invalid' }

  const jobName = form.jobName.trim().slice(0, 200)
  const companyName = form.companyName.trim().slice(0, 200)
  const firstName = form.firstName.trim().slice(0, 100)
  const lastName = form.lastName.trim().slice(0, 100)
  if (!jobName || !companyName || !firstName) {
    return { kind: 'error', message: 'Job name, company, and your name are required.' }
  }
  const parseDay = (s?: string | null) =>
    s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null
  const startDate = parseDay(form.startDate)
  const endDate = parseDay(form.endDate)

  // Atomic claim — exactly one submit creates; losers resolve to the winner.
  const claimed = await prisma.agreementEntry.updateMany({
    where: { id: entry.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) {
    for (let i = 0; i < 10; i++) {
      const again = await prisma.agreementEntry.findUnique({ where: { id: entry.id }, select: { createdInquiryId: true } })
      if (again?.createdInquiryId) return resolveExisting(again.createdInquiryId)
      await new Promise((r) => setTimeout(r, 300))
    }
    return { kind: 'invalid' }
  }

  try {
    // Person: the verified email is the identity; enrich the name if new.
    const existingPerson = (await resolvePersonByEmail(entry.email, { select: { id: true } })) as { id: string } | null
    const person =
      existingPerson ??
      (await prisma.person.create({
        data: { email: entry.email, firstName: firstName || entry.email.split('@')[0], lastName: lastName || '—' },
        select: { id: true },
      }))
    // Company: exact-name match else create (self-serve entries get triaged).
    const company =
      (await prisma.company.findFirst({ where: { name: { equals: companyName, mode: 'insensitive' } }, select: { id: true } })) ??
      (await prisma.company.create({ data: { name: companyName }, select: { id: true } }))
    // Default agent for self-serve entries: first active ADMIN (house book).
    const agent = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!agent) throw new Error('no active ADMIN user for self-serve assignment')

    const inquiry = await prisma.inquiry.create({
      data: {
        title: jobName,
        description: `Self-serve rental-agreement entry (public form). Company: ${companyName}. Contact: ${firstName} ${lastName} <${entry.email}>.`,
        source: 'WEB_FORM',
        personId: person.id,
        companyId: company.id,
        assignedToId: agent.id,
        preferredStartDate: startDate,
        preferredEndDate: endDate,
      },
      select: { id: true },
    })
    const invite = await prisma.welcomeInvite.create({
      data: { token: entryToken(), inquiryId: inquiry.id, personId: person.id, expiresAt: expiry() },
      select: { token: true },
    })
    await prisma.agreementEntry.update({ where: { id: entry.id }, data: { createdInquiryId: inquiry.id } })

    // The SAME click-to-create path as the welcome email — one idempotent mint.
    const r = await startWelcomeInvite(invite.token)
    if (r.kind !== 'redirect') return { kind: 'error', message: 'Setup failed — please contact your SirReel rep.' }
    return { kind: 'ok', portalUrl: r.url, orderFormUrl }
  } catch (err) {
    console.error('[agreement-start] submit failed:', entry.id, err)
    // Release the claim so a retry can succeed (nothing was stamped).
    await prisma.agreementEntry
      .updateMany({ where: { id: entry.id, createdInquiryId: null }, data: { usedAt: null } })
      .catch(() => {})
    return { kind: 'error', message: 'Something went wrong — please try again.' }
  }
}
