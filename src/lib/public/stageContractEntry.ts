import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { resolvePersonByEmail } from '@/lib/people/email'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl, portalBaseUrl } from '@/lib/portal/portalUrl'
import { isStageLineItem } from '@/lib/orders/stageLines'
import { emailShell, btn, P, esc, entryToken, expiry } from '@/lib/public/agreementEntry'

/**
 * Public stage-contract email gate — the STUDIO counterpart to the rental
 * gate in agreementEntry.ts, and it follows the same rules: the page
 * response is a constant regardless of what the address matches, and every
 * branch lives inside the emailed message (anti-enumeration, non-negotiable).
 *
 * The one structural difference from the rental flow, and the reason this
 * can't just reuse it: a stage contract CANNOT be self-served. It renders
 * from StageBookingTerms — negotiated day rate, day length, overtime rate,
 * which spaces, which dates — and a client has no business setting those.
 * Wes was explicit that a SirReel agent sets the terms before anything goes
 * out for signature. So "request to sign" means exactly that: a request.
 *
 * Branching:
 *   A  ready       — the agent has already prepared a contract on an open
 *                    job and it is unsigned: link straight to the portal to
 *                    review and sign.
 *   B  preparing   — open job with stage lines but NO prepared contract:
 *                    tell the client their rep is setting terms, and email
 *                    the rep so someone actually does it.
 *   C  all-set     — already signed. Nothing to do.
 *   D  get-started — no match, or no stage work: point at a quote.
 *
 * Branch D deliberately does NOT notify staff. An unknown address reaching
 * a public form is not a lead, and wiring one to an inbox turns this into a
 * spam relay. Branch B notifies because a KNOWN client with a REAL stage job
 * asked for paperwork, which is a genuine action item.
 */

const OPEN_JOB_STATUSES = ['QUOTED', 'ACTIVE', 'HOLD'] as const
const SIGNED = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'])
/** Prepared and awaiting the client's signature. */
const READY = new Set(['PORTAL_GENERATED', 'PORTAL_RELEASED'])

export function stageEntryUrl(token: string): string {
  return `${portalBaseUrl()}/api/public/stage-entry/${token}`
}

interface StageJob {
  id: string
  name: string
  company: string
  startDate: Date | null
  endDate: Date | null
  orderId: string | null
  /** A STAGE_CONTRACT exists, is unsigned, and has a PDF to sign. */
  ready: boolean
  signed: boolean
}

const fmtD = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const jobDates = (j: StageJob) => {
  const s = fmtD(j.startDate)
  const e = fmtD(j.endDate)
  if (s && e) return `${s} – ${e}`
  if (s) return `from ${s}`
  return 'dates TBD'
}

/**
 * Open jobs for this person that involve STAGE work, with contract state.
 *
 * "Involves stages" is true if the job either already has a STAGE_CONTRACT
 * row or carries stage line items. The line-item test goes through
 * isStageLineItem — the same single source the invoicing and scheduling
 * surfaces use, so a job can't read as a stage job in one place and not
 * another.
 */
async function openStageJobsForPerson(personId: string): Promise<StageJob[]> {
  const [viaContacts, viaAccess] = await Promise.all([
    prisma.jobContact.findMany({
      where: { personId, job: { status: { in: [...OPEN_JOB_STATUSES] } } },
      select: { jobId: true },
    }),
    prisma.portalAccess.findMany({
      where: {
        contactId: personId,
        revokedAt: null,
        order: { job: { status: { in: [...OPEN_JOB_STATUSES] } } },
      },
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
          signedAgreements: {
            where: { contractType: 'STAGE_CONTRACT' },
            select: { status: true, documentToSignUrl: true },
          },
          lineItems: {
            select: {
              department: true,
              fulfillmentLane: true,
              inventoryItem: { select: { description: true, slug: true } },
            },
          },
        },
      },
    },
  })

  return jobs
    .map((j): StageJob | null => {
      const agreements = j.orders.flatMap((o) => o.signedAgreements)
      const hasStageLines = j.orders.some((o) => o.lineItems.some((li) => isStageLineItem(li)))
      if (agreements.length === 0 && !hasStageLines) return null

      // The order to send them to is the one carrying the contract, falling
      // back to the one with stage lines, then the first order.
      const withContract = j.orders.find((o) => o.signedAgreements.length > 0)
      const withStage = j.orders.find((o) => o.lineItems.some((li) => isStageLineItem(li)))
      return {
        id: j.id,
        name: j.name,
        company: j.company.name,
        startDate: j.startDate,
        endDate: j.endDate,
        orderId: (withContract ?? withStage ?? j.orders[0])?.id ?? null,
        ready: agreements.some((a) => READY.has(a.status) && a.documentToSignUrl),
        signed: agreements.some((a) => SIGNED.has(a.status)),
      }
    })
    .filter((j): j is StageJob => j !== null)
}

/** Email the agent on the job (falling back to the house inbox) that a client asked for their contract. */
async function notifyRepPreparing(jobs: StageJob[], contactEmail: string, contactName: string): Promise<void> {
  const agents = await prisma.job.findMany({
    where: { id: { in: jobs.map((j) => j.id) } },
    select: { id: true, jobCode: true, name: true, agent: { select: { email: true, name: true } } },
  })
  const to = [...new Set(agents.map((a) => a.agent?.email).filter((e): e is string => Boolean(e)))]
  const recipients = to.length ? to : ['info@sirreel.com']

  const rows = agents
    .map((a) => `  • ${a.jobCode} — ${a.name}${a.agent?.name ? ` (agent: ${a.agent.name})` : ' (no agent assigned)'}`)
    .join('\n')
  const body =
    P(`<strong>${esc(contactName || contactEmail)}</strong> asked to sign a stage contract from the public site, ` +
      `but no contract has been prepared on their job yet.`) +
    P(`Set the booking terms (rate, day length, overtime, spaces, dates), then generate the stage contract — ` +
      `that releases it to their portal and they can sign.`) +
    P(`<strong>Jobs:</strong><br />${esc(rows).replace(/\n/g, '<br />')}`) +
    P(`Contact: ${esc(contactEmail)}`)

  const sent = await sendAgreementEmail({
    to: recipients,
    subject: `Stage contract requested — ${contactName || contactEmail}`,
    html: emailShell('Stage contract requested', body, 'A client asked to sign; terms are not set yet.'),
    text:
      `${contactName || contactEmail} asked to sign a stage contract from the public site, but no contract ` +
      `has been prepared on their job yet.\n\nSet the booking terms, then generate the stage contract — that ` +
      `releases it to their portal.\n\nJobs:\n${rows}\n\nContact: ${contactEmail}\n`,
    label: 'stage-contract-request-notify',
  })
  if (!sent.ok) {
    console.error(`[stage-contract-entry] rep notify FAILED for ${contactEmail}: ${sent.reason}`)
  }
}

/**
 * Look up the email and send the branch message. The returned variant is for
 * logging and tests ONLY — the HTTP layer must never surface it.
 */
export async function processStageContractEntryRequest(
  rawEmail: string,
): Promise<'ready' | 'preparing' | 'all-set' | 'get-started' | 'invalid'> {
  const email = rawEmail.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'invalid'

  const person = (await resolvePersonByEmail(email, {
    select: { id: true, firstName: true, lastName: true },
  })) as { id: string; firstName: string; lastName: string } | null

  const jobs = person ? await openStageJobsForPerson(person.id) : []
  const ready = jobs.filter((j) => j.ready && !j.signed && j.orderId)
  const preparing = jobs.filter((j) => !j.ready && !j.signed)
  const hi = person?.firstName ? `Hi ${esc(person.firstName)},` : 'Hi,'
  const quoteHref = `${portalBaseUrl()}/contact?prefill=${encodeURIComponent(
    "I'd like to book a stage or standing set.",
  )}`

  let subject: string
  let title: string
  let body: string
  let textBody: string
  let preheader: string
  let variant: 'ready' | 'preparing' | 'all-set' | 'get-started'

  if (ready.length > 0) {
    variant = 'ready'
    // Build HTML and text from the SAME tokens so the two renderings can
    // never drift or lose a link.
    const built = await Promise.all(
      ready.map(async (j) => {
        const t = await prisma.agreementEntry.create({
          data: {
            token: entryToken(),
            email,
            kind: 'CONFIRM_STAGE',
            personId: person!.id,
            jobId: j.id,
            expiresAt: expiry(),
          },
          select: { token: true },
        })
        const url = stageEntryUrl(t.token)
        return {
          html: `<div style="border:1px solid #e6e2d8;border-radius:8px;padding:12px 14px;margin:0 0 10px;">
          <div style="font-size:14px;font-weight:600;color:#1a1a1a;">${esc(j.name)}</div>
          <div style="font-size:12px;color:#777;margin:2px 0 10px;">${esc(j.company)} · ${esc(jobDates(j))}</div>
          ${btn(url, 'Review & sign →')}
        </div>`,
          label: `${j.name} — ${j.company} · ${jobDates(j)}`,
          url,
        }
      }),
    )
    subject = 'Your SirReel stage contract is ready to sign'
    title = 'Your stage contract is ready.'
    preheader = 'Review the terms and sign — it takes about a minute.'
    body =
      P(hi) +
      P('Your stage contract is prepared and waiting for your signature. Open it below to review the rates and terms, then sign:') +
      built.map((b) => b.html).join('') +
      P('The rates, day length and overtime rate are all shown on the contract before you sign.')
    textBody =
      `Your stage contract is prepared and waiting for your signature. Open the link for your job to ` +
      `review the rates and terms, then sign:\n\n` +
      built.map((b) => `  ${b.label}\n  ${b.url}`).join('\n\n')
  } else if (preparing.length > 0) {
    variant = 'preparing'
    await notifyRepPreparing(
      preparing,
      email,
      [person?.firstName, person?.lastName].filter(Boolean).join(' '),
    )
    const names = preparing.map((j) => esc(j.name)).join(', ')
    subject = 'We’re preparing your SirReel stage contract'
    title = 'We’re on it.'
    preheader = 'Your rep is setting the terms — the contract follows shortly.'
    body =
      P(hi) +
      P(`Thanks for asking. Your stage contract for <strong>${names}</strong> isn’t ready yet — a stage contract ` +
        `carries your negotiated rate, day length and overtime rate, so your SirReel rep sets those before it goes out.`) +
      P('We’ve let your rep know. You’ll get a link to review and sign as soon as the terms are set.') +
      P('Need it urgently? Call us at (888) 477-7335.')
    textBody =
      `Thanks for asking. Your stage contract for ${preparing.map((j) => j.name).join(', ')} isn't ready yet — ` +
      `a stage contract carries your negotiated rate, day length and overtime rate, so your SirReel rep sets ` +
      `those before it goes out.\n\nWe've let your rep know. You'll get a link to review and sign as soon as ` +
      `the terms are set.\n\nNeed it urgently? Call us at (888) 477-7335.`
  } else if (jobs.length > 0) {
    variant = 'all-set'
    const names = jobs.map((j) => esc(j.name)).join(', ')
    subject = 'You’re all set — SirReel stage contract'
    title = 'You’re all set.'
    preheader = 'Your stage contract is already signed — nothing to fill out.'
    body =
      P(hi) +
      P(`Your stage contract is already signed for <strong>${names}</strong> — nothing more to do.`) +
      P(`Booking another stage? ${btn(quoteHref, 'Start a request →')}`)
    textBody =
      `Your stage contract is already signed for ${jobs.map((j) => j.name).join(', ')} — nothing more to do.\n\n` +
      `Booking another stage?\n  ${quoteHref}`
  } else {
    variant = 'get-started'
    subject = 'Booking a SirReel stage'
    title = 'Let’s get you a stage.'
    preheader = 'Tell us the dates and we’ll put terms together.'
    body =
      P(hi) +
      P('Thanks for your interest in our stages and standing sets. A stage contract is written around your ' +
        'specific booking — which space, which dates, your rate and day length — so the first step is telling ' +
        'us what you need.') +
      P(btn(quoteHref, 'Tell us about your production →')) +
      P('Or call us at (888) 477-7335 and we’ll take it from there.')
    textBody =
      `Thanks for your interest in our stages and standing sets. A stage contract is written around your ` +
      `specific booking — which space, which dates, your rate and day length — so the first step is telling ` +
      `us what you need.\n\nTell us about your production:\n  ${quoteHref}\n\n` +
      `Or call us at (888) 477-7335 and we'll take it from there.`
  }

  const html = emailShell(title, body, preheader)
  const text =
    `${hi}\n\n${textBody}\n\n` +
    `--\nSirReel Studio Services\n8500 Lankershim Blvd, Sun Valley, CA 91352\n` +
    `(888) 477-7335 · info@sirreel.com\n\n` +
    `You received this because someone entered this address on sirreel.com. ` +
    `If that wasn't you, you can ignore this email.`

  const sent = await sendAgreementEmail({
    to: [email],
    subject,
    html,
    text,
    label: 'stage-contract-entry',
  })
  if (!sent.ok) {
    console.error(`[stage-contract-entry] DELIVERY FAILED for ${email} (variant=${variant}): ${sent.reason}`)
  }
  return variant
}

/**
 * "Review & sign →" click. Creates nothing: mints a fresh magic link into
 * the job portal, where the prepared stage contract is already surfaced for
 * signature. Repeat clicks and forwards land in the same portal.
 */
export async function confirmStageEntry(
  token: string,
): Promise<{ kind: 'redirect'; url: string } | { kind: 'invalid' }> {
  const entry = await prisma.agreementEntry.findUnique({
    where: { token },
    select: { id: true, kind: true, personId: true, jobId: true, expiresAt: true, usedAt: true },
  })
  if (!entry || entry.kind !== 'CONFIRM_STAGE' || !entry.jobId || !entry.personId) return { kind: 'invalid' }
  if (entry.expiresAt < new Date() && !entry.usedAt) return { kind: 'invalid' }

  // Prefer the order that actually carries the stage contract.
  const orders = await prisma.order.findMany({
    where: { jobId: entry.jobId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      portalSlug: true,
      signedAgreements: { where: { contractType: 'STAGE_CONTRACT' }, select: { id: true } },
    },
  })
  const target = orders.find((o) => o.signedAgreements.length > 0 && o.portalSlug) ?? orders.find((o) => o.portalSlug)
  if (!target?.portalSlug) return { kind: 'invalid' }

  if (!entry.usedAt) {
    await prisma.agreementEntry.updateMany({ where: { id: entry.id, usedAt: null }, data: { usedAt: new Date() } })
  }
  const issued = await issueJobMagicLink({ orderId: target.id, contactId: entry.personId })
  return { kind: 'redirect', url: portalJobUrl(target.portalSlug, issued.token) }
}
