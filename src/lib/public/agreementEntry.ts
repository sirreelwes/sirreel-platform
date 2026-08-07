import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createJobFromDraft } from '@/lib/jobs/resolveJob'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { notifyPublicSubmission } from '@/lib/email/notifyPublicSubmission'
import { resolvePersonByEmail } from '@/lib/people/email'
import { companyNameKey } from '@/lib/companies/normalize'
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

export function entryToken(): string {
  return randomBytes(32).toString('hex')
}
export function expiry(): Date {
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
export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Email shell, tuned for Apple Mail / iCloud — a large share of SirReel's
 * clients read there.
 *
 *  - color-scheme "light dark" + supported-color-schemes: previously this
 *    declared LIGHT ONLY, which makes Apple Mail apply its own inversion
 *    in dark mode. That flipped the black masthead to white and took the
 *    white logo with it — an invisible header for every dark-mode reader.
 *    Declaring both, and supplying explicit dark values, stops Apple
 *    guessing.
 *  - format-detection telephone=no: Apple auto-links phone numbers and
 *    addresses and restyles them blue-and-underlined, which reads as a
 *    broken link in the footer.
 *  - Hidden preheader: controls the grey preview line in the inbox list.
 *    Without one, Apple pulls the first text it finds.
 *  - Buttons are padded to a 44px minimum height, Apple's HIG tap target.
 *    The old 11px padding gave ~36px, under the threshold on a phone.
 */
export function emailShell(title: string, bodyHtml: string, preheader?: string): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no,address=no,date=no" />
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .sr-bg   { background:#141414 !important; }
    .sr-card { background:#1e1e1e !important; }
    .sr-h1   { color:#f5f5f3 !important; }
    .sr-p    { color:#d6d2c8 !important; }
    .sr-foot { color:#9a958a !important; }
  }
</style>
</head>
<body class="sr-bg" style="margin:0;padding:0;background:#f5f5f3;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader ?? title)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="sr-bg" style="background:#f5f5f3;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="sr-card" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0a0a0a;padding:28px 24px;text-align:center;">
        <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel Studio Services" width="180" style="max-width:180px;height:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <h1 class="sr-h1" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:400;color:#1a1a1a;">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td class="sr-foot" style="padding:18px 32px 26px;font-size:13px;line-height:1.5;color:#767676;">SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// 14px padding + 16px line-height clears Apple's 44pt minimum tap target;
// the old 11px padding rendered ~36px, which is fiddly on a phone and
// fails WCAG 2.5.5.
export const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;line-height:16px;padding:14px 24px;border-radius:6px;min-height:16px;">${esc(label)}</a>`
// 15px body: Apple Mail doesn't auto-zoom, so small type just stays small.
export const P = (s: string) => `<p class="sr-p" style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;">${s}</p>`

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
  // Real plain-text alternative, built per variant.
  //
  // This used to be a stub — "Open this email in an HTML mail client to
  // continue" — which is one of the strongest spam signals a transactional
  // message can carry: an HTML part full of links beside a text part with
  // none. Filters compare the two alternatives, and Apple weights the
  // mismatch heavily. It also stranded anyone reading in plain text, since
  // the link they needed existed only in the HTML.
  let textBody: string
  // The grey preview line beside the subject in the inbox list. Apple
  // shows ~90 chars; without one it scrapes the first text in the body,
  // which here would just repeat the greeting.
  let preheader: string
  let variant: 'confirm' | 'all-set' | 'welcome-back' | 'get-started'

  if (unsigned.length > 0) {
    // A — confirm which open job this agreement is for (or a new one).
    variant = 'confirm'
    // One pass builds BOTH renderings from the same token, so the text
    // alternative can't drift from the HTML or miss a link.
    const built = await Promise.all(
      unsigned.map(async (j) => {
        const t = await prisma.agreementEntry.create({
          data: { token: entryToken(), email, kind: 'CONFIRM_JOB', personId: person!.id, jobId: j.id, expiresAt: expiry() },
          select: { token: true },
        })
        const url = confirmEntryUrl(t.token)
        return {
          html: `<div style="border:1px solid #e6e2d8;border-radius:8px;padding:12px 14px;margin:0 0 10px;">
          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${esc(j.name)}</div>
          <div style="font-size:12px;color:#777;margin:2px 0 10px;">${esc(j.company)} · ${esc(jobDates(j))}</div>
          ${btn(url, 'This is my job →')}
        </div>`,
          label: `${j.name} — ${j.company} · ${jobDates(j)}`,
          url,
        }
      }),
    )
    const rows = built.map((b) => b.html)
    const textRows = built.map((b) => ({ label: b.label, url: b.url }))
    subject = 'Your SirReel rental agreement — which job is this for?'
    title = 'Which job is this agreement for?'
    preheader = "Pick the job and we'll take you straight to the paperwork."
    body =
      P(hi) +
      P('You asked to fill out the SirReel rental agreement. We have the following open with you — pick the job it belongs to and we’ll take you straight to the paperwork:') +
      rows.join('') +
      P(`Working on something else? ${btn(startHref, 'This is a new job →')}`)
    textBody =
      `You asked to fill out the SirReel rental agreement. We have these open with you — ` +
      `open the link for the job it belongs to:\n\n` +
      textRows.map((r) => `  ${r.label}\n  ${r.url}`).join('\n\n') +
      `\n\nWorking on something else? Start a new job:\n  ${startHref}`
  } else if (jobs.length > 0) {
    // B — everything already signed.
    variant = 'all-set'
    const names = jobs.map((j) => esc(j.name)).join(', ')
    subject = 'You’re all set — SirReel rental agreement'
    title = 'You’re all set.'
    preheader = "Your rental agreement is already signed — nothing to fill out."
    body =
      P(hi) +
      P(`Your rental agreement is already signed for <strong>${names}</strong> — nothing more to fill out there.`) +
      P(`Starting something new? ${btn(startHref, 'Start a new job →')}`)
    textBody =
      `Your rental agreement is already signed for ${jobs.map((j) => j.name).join(', ')} — ` +
      `nothing more to fill out there.\n\nStarting something new?\n  ${startHref}`
  } else if (person) {
    // C — known person, nothing open.
    variant = 'welcome-back'
    subject = 'Welcome back to SirReel — let’s get started'
    title = 'Welcome back.'
    preheader = "Tell us about the new job and we'll set up your paperwork in one step."
    body =
      P(hi) +
      P('Good to see you again. Tell us a little about the new job and we’ll set up your paperwork and portal in one step.') +
      P(btn(startHref, 'Get started →'))
    textBody =
      `Good to see you again. Tell us a little about the new job and we'll set up ` +
      `your paperwork and portal in one step.\n\nGet started:\n  ${startHref}`
  } else {
    // C' — unknown email.
    variant = 'get-started'
    subject = 'Let’s get started with SirReel'
    title = 'Let’s get you started.'
    preheader = "Tell us about your job and we'll set up your agreement and portal."
    body =
      P('Hi,') +
      P('Thanks for your interest in SirReel Studio Services. Tell us a little about your job and we’ll set up your rental agreement and portal in one step.') +
      P(btn(startHref, 'Get started →'))
    textBody =
      `Thanks for your interest in SirReel Studio Services. Tell us a little about ` +
      `your job and we'll set up your rental agreement and portal in one step.\n\n` +
      `Get started:\n  ${startHref}`
  }

  const html = emailShell(title, body, preheader)
  // Mirrors the HTML: same greeting, same content, same links, plus a
  // real signature block. A text part that stands on its own.
  const text =
    `${hi}\n\n${textBody}\n\n` +
    `--\nSirReel Studio Services\n8500 Lankershim Blvd, Sun Valley, CA 91352\n` +
    `(888) 477-7335 · info@sirreel.com\n\n` +
    `You received this because someone entered this address on sirreel.com. ` +
    `If that wasn't you, you can ignore this email.`
  // The result was previously discarded. sendAgreementEmail never throws —
  // it returns { ok:false, reason } — and it writes no EmailDelivery row,
  // so a rejected send left NO trace anywhere: the token row existed, the
  // page said "check your email", and nothing had been delivered. The
  // response stays neutral (anti-enumeration), but the failure is now
  // loud in the server logs.
  const sent = await sendAgreementEmail({ to: [email], subject, html, text, label: 'agreement-entry' })
  if (!sent.ok) {
    console.error(
      `[agreement-entry] DELIVERY FAILED for ${email} (variant=${variant}): ${sent.reason}`,
    )
  }

  // Tell the team a NEW prospect showed up. Only the get-started variant:
  // it means the address matched no Person at all, so this is someone we
  // have never dealt with raising their hand — a lead that previously
  // reached nobody, since every branch here emails only the client. The
  // other variants are existing contacts with existing jobs; they are
  // already visible in HQ, and notifying on them would bury this signal.
  //
  // notifyClient:false — the client already got their branch-specific mail
  // immediately above. Fire-and-forget, and deliberately AFTER the client
  // send so an internal-notify problem can never delay their email.
  //
  // Anti-enumeration is unaffected: this is an internal email, and the
  // route's response to the browser is the same constant either way.
  if (variant === 'get-started') {
    notifyPublicSubmission({
      kind: 'agreement-entry',
      inquiryId: null,
      notifyClient: false,
      contact: { email },
      details: [
        { label: 'Source', value: 'Rental agreement page — email gate' },
        { label: 'Match', value: 'No existing contact for this address' },
      ],
    })
  }
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
  /**
   * "I am an authorized representative of this company."
   * true = ticked · false = shown and refused · null = never shown.
   */
  authorizedRepresentative?: boolean | null
}

interface StartedRows {
  jobId: string
  inquiryId: string | null
  /** Set ONLY when createJobFromDraft reports it created these. */
  companyId: string | null
  personId: string | null
}

/**
 * Undo a self-serve start that failed before the portal ever opened.
 *
 * The submit below commits in four steps — Job, Inquiry, invite, then the
 * Order mint — and it is the last one that can fail. Without this, such a
 * failure left a permanent Job (and sometimes a Company and a Person) in
 * the real book, indistinguishable from a genuine lead. SR-JOB-0094 and
 * SR-JOB-0095 came from exactly that.
 *
 * Every id here was captured from a row THIS request created, which is
 * what the captured-ID rule requires (CLAUDE.md): nothing is matched by
 * name, prefix, shape or entity scope. Company and Person are touched
 * only when createJobFromDraft reports it created them — a submit that
 * resolved to an existing client leaves that client entirely alone.
 *
 * Two guards, because "created seconds ago" is an assumption and this is
 * the production database:
 *   - a Job that has acquired an Order is LEFT ALONE. The mint partly
 *     succeeded, so the row is real work, not litter.
 *   - Company / Person are kept if anything else already points at them.
 *
 * Best-effort throughout. A failed cleanup must never mask the original
 * error or take down the response, so it logs and returns.
 */
async function unwindFailedStart(entryId: string, rows: StartedRows): Promise<void> {
  try {
    // Clear the pointer FIRST. created_inquiry_id has no FK constraint, so
    // deleting the Inquiry would leave it dangling — and the retry reads
    // it as "already submitted" and dead-ends in resolveExisting().
    await prisma.agreementEntry.update({ where: { id: entryId }, data: { createdInquiryId: null } })

    const orders = await prisma.order.count({ where: { jobId: rows.jobId } })
    if (orders > 0) {
      console.error(
        `[agreement-start] NOT unwinding job ${rows.jobId}: it has ${orders} order(s). Leaving it for an agent.`,
      )
      return
    }

    // Inquiry first — WelcomeInvite cascades from it. JobContact cascades
    // from Job. Order is a RESTRICT relation, which is the backstop for
    // the count above.
    if (rows.inquiryId) await prisma.inquiry.deleteMany({ where: { id: rows.inquiryId } })
    await prisma.job.deleteMany({ where: { id: rows.jobId } })

    if (rows.companyId) {
      const c = await prisma.company.findUnique({
        where: { id: rows.companyId },
        select: { _count: { select: { jobs: true, orders: true, inquiries: true, bookings: true } } },
      })
      const refs = c ? Object.values(c._count).reduce((a, b) => a + b, 0) : -1
      if (refs === 0) await prisma.company.deleteMany({ where: { id: rows.companyId } })
      else if (refs > 0) console.error(`[agreement-start] kept company ${rows.companyId} — ${refs} other reference(s)`)
    }

    if (rows.personId) {
      const p = await prisma.person.findUnique({
        where: { id: rows.personId },
        select: {
          _count: {
            select: { jobContacts: true, inquiries: true, welcomeInvites: true, orderContacts: true, bookings: true },
          },
        },
      })
      const refs = p ? Object.values(p._count).reduce((a, b) => a + b, 0) : -1
      if (refs === 0) await prisma.person.deleteMany({ where: { id: rows.personId } })
      else if (refs > 0) console.error(`[agreement-start] kept person ${rows.personId} — ${refs} other reference(s)`)
    }

    console.error(`[agreement-start] unwound failed start — job ${rows.jobId} removed; the entry can be retried`)
  } catch (err) {
    console.error('[agreement-start] unwind FAILED, rows may remain:', rows, err)
  }
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

  // Re-derive the existing-client match HERE rather than trusting the
  // browser. The form shows the "authorized representative" checkbox when
  // the typed name matches a client, and a check that only exists in the
  // page is not a check — this endpoint is reachable with curl. Same
  // normalizer createJobFromDraft uses to link, so the two can't disagree
  // about what counts as a match.
  const companyKey = companyNameKey(companyName)
  const matchesExistingClient = companyKey
    ? (await prisma.company.findMany({ select: { name: true } })).some(
        (c) => companyNameKey(c.name) === companyKey,
      )
    : false
  if (matchesExistingClient && form.authorizedRepresentative !== true) {
    // Checked BEFORE the claim below, so a refusal leaves the token usable.
    return {
      kind: 'error',
      message: 'Please confirm you’re authorized to book for this company.',
    }
  }

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

  // Captured as each row lands, so the unwind below can prove ownership of
  // everything it deletes even if we fail partway through.
  const started: StartedRows = { jobId: '', inquiryId: null, companyId: null, personId: null }
  // Nothing was stamped, so a retry can claim the entry again.
  const releaseClaim = () =>
    prisma.agreementEntry
      .updateMany({ where: { id: entry.id, createdInquiryId: null }, data: { usedAt: null } })
      .catch(() => {})

  try {
    // Default agent for self-serve entries: first active ADMIN (house book).
    const agent = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!agent) throw new Error('no active ADMIN user for self-serve assignment')

    // Job-as-root: startWelcomeInvite REFUSES an invite with no resolved
    // Job, so this path has been dead since that refactor (Jul 2026) —
    // it built an Inquiry and an invite with no jobId, and every submit
    // ended at "Setup failed".
    //
    // createJobFromDraft is the ONE creation primitive, and it also does
    // company/person resolve-or-create with proper name normalization —
    // better than the exact-match this used to do, which spawned a
    // duplicate company whenever the client typed the name slightly
    // differently.
    //
    // It always creates a NEW Job rather than attaching to a match. The
    // resolver's discipline is "the machine discovers, the AGENT
    // decides", and a self-serve client is not an agent: silently
    // attaching them to someone else's open job would put a stranger on
    // that job's paperwork. A duplicate job an agent merges is the
    // recoverable failure; the Inquiry below is the triage handle.
    const created = await createJobFromDraft(
      {
        name: jobName,
        companyName,
        contactName: [firstName, lastName].filter(Boolean).join(' ') || null,
        contactEmail: entry.email,
        startDate: form.startDate ?? null,
        endDate: form.endDate ?? null,
        status: 'QUOTED',
        notes: `Self-serve rental-agreement entry (public form) on ${new Date().toISOString().slice(0, 10)}.`,
      },
      agent.id,
    )
    started.jobId = created.job.id
    // Only what createJobFromDraft actually created is ours to remove.
    started.companyId = created.companyCreated ? created.job.companyId : null
    started.personId = created.personCreated ? created.personId : null

    // createJobFromDraft resolved-or-created the Person off this same
    // email and hands the id back — reuse it rather than looking it up
    // again and risking a second row.
    const personId = created.personId
    if (!personId) throw new Error('person not resolved after job creation')

    const inquiry = await prisma.inquiry.create({
      data: {
        title: jobName,
        description:
          `Self-serve rental-agreement entry (public form). Company: ${companyName}. ` +
          `Contact: ${firstName} ${lastName} <${entry.email}>.` +
          (created.companyResolution ? ` Company resolution: ${created.companyResolution}.` : '') +
          (created.contactWarning ? ` Contact note: ${created.contactWarning}.` : '') +
          // Recorded because this submit attached a stranger's job to an
          // EXISTING client record on nothing but their say-so. It is an
          // attestation, not a verification — the value here is that if the
          // claim was false, there is a dated record of who made it.
          (matchesExistingClient
            ? ` ATTESTATION: confirmed they are an authorized representative of "${companyName}" (existing client) on ${new Date().toISOString()}.`
            : ''),
        source: 'WEB_FORM',
        personId,
        companyId: created.job.companyId,
        assignedToId: agent.id,
        preferredStartDate: startDate,
        preferredEndDate: endDate,
        // Deliberately NOT setting convertedJobId here. It looks right —
        // the Job does exist — but startWelcomeInvite reads it as "another
        // path already converted this AND created an order", then looks
        // for that order, finds none on a brand-new Job, and bails to the
        // landing page. Which surfaces as "Setup failed".
        //
        // The invite's jobId is the piece that was actually missing.
        // convertedJobId gets stamped by whichever path mints the Order —
        // welcomeStart does it in the claim below.
      },
      select: { id: true },
    })
    const invite = await prisma.welcomeInvite.create({
      data: {
        token: entryToken(),
        inquiryId: inquiry.id,
        personId,
        jobId: created.job.id,
        expiresAt: expiry(),
      },
      select: { token: true },
    })
    started.inquiryId = inquiry.id
    await prisma.agreementEntry.update({ where: { id: entry.id }, data: { createdInquiryId: inquiry.id } })

    // The SAME click-to-create path as the welcome email — one idempotent mint.
    const r = await startWelcomeInvite(invite.token)
    if (r.kind !== 'redirect') {
      // The mint refused. Everything above is now unreachable litter in
      // the real book, so take it back out and free the entry — the
      // client can simply submit the form again.
      console.error(`[agreement-start] mint refused for entry ${entry.id} (job ${created.job.id}) — unwinding`)
      await unwindFailedStart(entry.id, started)
      await releaseClaim()
      return { kind: 'error', message: 'Setup failed — please contact your SirReel rep.' }
    }
    // A client just created a real Job + Order on the public site with no
    // agent involved. Nothing announced this before — the only email in
    // this module goes to the client — so the highest-value event on the
    // public surface was also the quietest one.
    //
    // Placed AFTER the mint succeeded, so an unwound attempt (see the
    // refusal branch above) never announces a job that no longer exists.
    // notifyClient:false — startWelcomeInvite hands them the portal.
    notifyPublicSubmission({
      kind: 'job-created',
      inquiryId: inquiry.id,
      notifyClient: false,
      contact: { name: `${firstName} ${lastName}`.trim(), email: entry.email },
      subjectHint: [companyName, jobName].filter(Boolean).join(' · ') || null,
      details: [
        { label: 'Job', value: jobName },
        { label: 'Company', value: companyName },
        {
          label: 'Dates',
          value:
            startDate || endDate
              ? `${startDate?.toISOString().slice(0, 10) ?? '?'} → ${endDate?.toISOString().slice(0, 10) ?? '?'}`
              : 'not specified',
        },
      ],
      internalOnlyDetails: [
        {
          label: 'Company match',
          value: matchesExistingClient
            ? 'Attested they represent an EXISTING client — self-declared, not verified. Worth a look.'
            : 'New company record',
        },
        // The assignee is whichever ADMIN was created first, not a real
        // sales assignment — so "assigned" here should not be read as
        // "somebody owns this".
        { label: 'Assignment', value: 'Auto-assigned to fallback admin — needs a real owner' },
      ],
    })

    return { kind: 'ok', portalUrl: r.url, orderFormUrl }
  } catch (err) {
    console.error('[agreement-start] submit failed:', entry.id, err)
    // A throw can land anywhere in the sequence above; unwind whatever had
    // already committed. The unwind clears createdInquiryId, which is what
    // lets releaseClaim's guard pass and the entry be retried.
    if (started.jobId) await unwindFailedStart(entry.id, started)
    await releaseClaim()
    return { kind: 'error', message: 'Something went wrong — please try again.' }
  }
}
