import { prisma } from '@/lib/prisma'
import type { JobStatus, Prisma } from '@prisma/client'
import { companyNameKey } from '@/lib/companies/normalize'
import { makeProvisionalCompanyName } from '@/lib/companies/provisional'
import { resolveCompanyByNameKey } from '@/lib/companies/resolveCompanyByName'
import { resolvePersonByEmail, normalizeEmail } from '@/lib/people/email'
import { nextJobCode } from '@/lib/jobs/nextJobCode'
import { generateAssistantAuthCode } from '@/lib/jobs/assistantAuthCode'
// Re-exported so server callers can reach it from the module they
// already import; the definition is Prisma-free because the Review Quote
// page is a client component. See jobDisambiguation.ts.
export { needsJobDisambiguation, SAME_JOB_EVIDENCE_SCORE } from '@/lib/jobs/jobDisambiguation'

/**
 * The Job-as-root keystone: every entry point (gantt drag, email
 * intake, Quick Reply, Planyo import, manual) resolves to a Job
 * through this ONE primitive.
 *
 * Discipline (inherited from the Planyo cart matcher): the machine
 * does DISCOVERY, the agent DECIDES. resolveJob() is PURE — read,
 * rank, draft; it never creates a Job, Company, or Person and never
 * auto-picks on ambiguity. Creation happens only in
 * createJobFromDraft(), called when an agent explicitly chooses
 * "New Job".
 *
 * Ranking ladder (each rung annotates its reason on the candidate):
 *   ① email thread already attached to a Job (EmailThread.jobId)
 *   ② planyoCartId on the Job or one of its Bookings
 *   ③ same company + date overlap (±7 days), status not WRAPPED/LOST
 *   ④ same contact person on JobContact
 *   ⑤ fuzzy jobNameHint vs Job.name
 *
 * Bucket semantics:
 *   CLEAN_MATCH — a single candidate anchored by an identity rung
 *                 (①/②). Shown as the highlighted default in the UI,
 *                 but the agent still confirms — assist, don't decide.
 *   CANDIDATES  — plausible matches found; agent picks or creates.
 *   NO_MATCH    — nothing plausible; draft pre-fills the new-Job form.
 */

export interface ResolveJobContext {
  companyId?: string | null
  companyName?: string | null
  contactEmail?: string | null
  contactName?: string | null
  contactPhone?: string | null
  jobNameHint?: string | null
  dates?: { start: string; end: string } | null
  threadId?: string | null
  planyoCartId?: string | null
  /** Free-form provenance ("gantt-drag", "email:<id>", "manual") */
  sourceRef?: string | null
}

export interface RankedJobCandidate {
  jobId: string
  jobCode: string
  name: string
  status: JobStatus
  companyId: string | null
  companyName: string | null
  startDate: string | null
  endDate: string | null
  agentName: string | null
  score: number
  reasons: string[]
}

export interface JobDraft {
  name: string
  companyId?: string | null
  companyName?: string | null
  /** Agent explicitly has no company yet — create a provisional one and
   *  let the reply ask the client. See lib/companies/provisional.ts. */
  companyUnknown?: boolean
  /** Everyone the client CC'd on the inbound email. Each becomes a
   *  Person (email is the dedup anchor) and a JobContact, so the people
   *  already on the thread are on the Job too. See lib/email/inboundCc.ts. */
  ccContactEmails?: string[]
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  startDate?: string | null
  endDate?: string | null
  status?: JobStatus
  notes?: string | null
  // Passthroughs so the legacy /api/jobs payload can use the same
  // creation home without losing fields.
  productionType?: string | null
  productionTypeProfileId?: string | null
  estimatedValue?: number | null
  contacts?: { personId: string; role: string; isPrimary?: boolean }[]
}

export interface ResolveJobResult {
  bucket: 'CLEAN_MATCH' | 'CANDIDATES' | 'NO_MATCH'
  candidates: RankedJobCandidate[]
  resolvedCompany: { id: string; name: string } | null
  /** >1 company matched the name key — the agent-facing note. */
  companyAmbiguity: string | null
  resolvedPerson: { id: string; name: string; email: string } | null
  draft: JobDraft
}

const RUNG_SCORES = {
  thread: 100,
  planyoCart: 90,
  companyDates: 60,
  contact: 50,
  nameHint: 40,
} as const

const EXCLUDED: JobStatus[] = ['WRAPPED', 'LOST']

/** Loose name key for rung ⑤ — lowercase alnum only. */
function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function resolveJob(ctx: ResolveJobContext): Promise<ResolveJobResult> {
  // ── Company resolution (existing normalizer; never creates) ───────
  let resolvedCompany: { id: string; name: string } | null = null
  let companyAmbiguity: string | null = null
  if (ctx.companyId) {
    resolvedCompany = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { id: true, name: true },
    })
  } else if (ctx.companyName?.trim()) {
    // Shared key-match discipline (also used by parse-quote).
    const keyed = await resolveCompanyByNameKey(ctx.companyName)
    resolvedCompany = keyed.company
    companyAmbiguity = keyed.ambiguity
  }

  // ── Person resolution (existing merge-safe resolver; never creates) ─
  let resolvedPerson: { id: string; name: string; email: string } | null = null
  if (ctx.contactEmail?.trim()) {
    const p = await resolvePersonByEmail(normalizeEmail(ctx.contactEmail))
    if (p) resolvedPerson = { id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), email: p.email }
  }

  // ── Candidate gathering, rung by rung ──────────────────────────────
  type Bag = Map<string, { score: number; reasons: string[] }>
  const bag: Bag = new Map()
  const add = (jobId: string, score: number, reason: string) => {
    const cur = bag.get(jobId) ?? { score: 0, reasons: [] }
    cur.score += score
    cur.reasons.push(reason)
    bag.set(jobId, cur)
  }

  // ① email thread → Job (email-in-Job, step 6). ctx.threadId accepts
  //   EmailThread.id OR the raw Gmail thread id (ingest paths disagree
  //   on which they hand around). An attached thread is the strongest
  //   identity signal there is — the operator explicitly filed it.
  if (ctx.threadId) {
    const t = await prisma.emailThread.findFirst({
      where: {
        OR: [{ id: ctx.threadId }, { gmailThreadId: ctx.threadId }],
        jobId: { not: null },
      },
      select: { jobId: true },
    })
    if (t?.jobId) add(t.jobId, RUNG_SCORES.thread, 'this email thread is already attached to the job')
  }

  // ② planyoCartId on Job or its Bookings
  if (ctx.planyoCartId) {
    const byJob = await prisma.job.findUnique({
      where: { planyoCartId: ctx.planyoCartId },
      select: { id: true },
    })
    if (byJob) add(byJob.id, RUNG_SCORES.planyoCart, `Planyo cart ${ctx.planyoCartId} is linked to this job`)
    const byBooking = await prisma.booking.findFirst({
      where: { planyoCartId: ctx.planyoCartId, jobId: { not: null } },
      select: { jobId: true },
    })
    if (byBooking?.jobId) add(byBooking.jobId, RUNG_SCORES.planyoCart, `Planyo cart ${ctx.planyoCartId} is on a booking of this job`)
  }

  // ③ same company + date overlap (±7d), open statuses
  if (resolvedCompany && ctx.dates?.start && ctx.dates?.end) {
    const pad = 7 * 86_400_000
    const winStart = new Date(new Date(ctx.dates.start + 'T00:00:00Z').getTime() - pad)
    const winEnd = new Date(new Date(ctx.dates.end + 'T00:00:00Z').getTime() + pad)
    const hits = await prisma.job.findMany({
      where: {
        companyId: resolvedCompany.id,
        status: { notIn: EXCLUDED },
        OR: [
          { startDate: { lte: winEnd }, endDate: { gte: winStart } },
          // date-less leads at the same company still deserve a look
          { startDate: null },
        ],
      },
      select: { id: true, startDate: true },
      take: 10,
    })
    for (const h of hits) {
      add(
        h.id,
        RUNG_SCORES.companyDates - (h.startDate ? 0 : 20),
        h.startDate
          ? `same company with overlapping dates (±7d of ${ctx.dates.start}–${ctx.dates.end})`
          : 'same company, job has no dates yet',
      )
    }
  } else if (resolvedCompany) {
    // company known, no dates given — surface the company's open jobs
    const hits = await prisma.job.findMany({
      where: { companyId: resolvedCompany.id, status: { notIn: EXCLUDED } },
      select: { id: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    })
    for (const h of hits) add(h.id, RUNG_SCORES.companyDates - 25, 'open job at the same company')
  }

  // ④ same contact person on JobContact
  if (resolvedPerson) {
    const hits = await prisma.job.findMany({
      where: {
        status: { notIn: EXCLUDED },
        jobContacts: { some: { personId: resolvedPerson.id } },
      },
      select: { id: true },
      take: 10,
    })
    for (const h of hits) add(h.id, RUNG_SCORES.contact, `${resolvedPerson.name} is a contact on this job`)
  }

  // ⑤ fuzzy jobNameHint vs Job.name
  if (ctx.jobNameHint?.trim()) {
    const hint = ctx.jobNameHint.trim()
    const hintKey = looseKey(hint)
    const hits = await prisma.job.findMany({
      where: {
        status: { notIn: EXCLUDED },
        ...(resolvedCompany ? { companyId: resolvedCompany.id } : {}),
        name: { contains: hint.slice(0, 40), mode: 'insensitive' as Prisma.QueryMode },
      },
      select: { id: true, name: true },
      take: 10,
    })
    for (const h of hits) add(h.id, RUNG_SCORES.nameHint, `job name matches "${hint}"`)
    if (hintKey.length >= 4) {
      const scope = await prisma.job.findMany({
        where: { status: { notIn: EXCLUDED }, ...(resolvedCompany ? { companyId: resolvedCompany.id } : {}) },
        select: { id: true, name: true },
        take: 200,
        orderBy: { createdAt: 'desc' },
      })
      for (const j of scope) {
        if (bag.has(j.id)) continue
        const k = looseKey(j.name)
        if (k.includes(hintKey) || hintKey.includes(k)) {
          add(j.id, RUNG_SCORES.nameHint - 10, `job name is close to "${hint}"`)
        }
      }
    }
  }

  // ── Hydrate + rank ────────────────────────────────────────────────
  const ids = Array.from(bag.keys())
  const jobs = ids.length
    ? await prisma.job.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, jobCode: true, name: true, status: true,
          startDate: true, endDate: true,
          company: { select: { id: true, name: true } },
          agent: { select: { name: true } },
        },
      })
    : []
  const candidates: RankedJobCandidate[] = jobs
    .map((j) => ({
      jobId: j.id,
      jobCode: j.jobCode,
      name: j.name,
      status: j.status,
      companyId: (j.company as { id?: string } | null)?.id ?? null,
      companyName: j.company?.name ?? null,
      startDate: fmtDate(j.startDate),
      endDate: fmtDate(j.endDate),
      agentName: j.agent?.name ?? null,
      score: bag.get(j.id)!.score,
      reasons: bag.get(j.id)!.reasons,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  // CLEAN_MATCH only on identity-anchored, unambiguous top hits.
  const top = candidates[0]
  const bucket: ResolveJobResult['bucket'] =
    top && top.score >= RUNG_SCORES.planyoCart && (candidates.length === 1 || top.score - candidates[1].score >= 30)
      ? 'CLEAN_MATCH'
      : candidates.length > 0
        ? 'CANDIDATES'
        : 'NO_MATCH'

  return {
    bucket,
    candidates,
    resolvedCompany,
    companyAmbiguity,
    resolvedPerson,
    draft: {
      name: ctx.jobNameHint?.trim() || '',
      companyId: resolvedCompany?.id ?? null,
      companyName: resolvedCompany?.name ?? ctx.companyName?.trim() ?? null,
      contactName: resolvedPerson?.name ?? ctx.contactName?.trim() ?? null,
      contactEmail: resolvedPerson?.email ?? (ctx.contactEmail ? normalizeEmail(ctx.contactEmail) : null),
      contactPhone: ctx.contactPhone?.trim() ?? null,
      startDate: ctx.dates?.start ?? null,
      endDate: ctx.dates?.end ?? null,
      status: 'NEW',
    },
  }
}

// ─── Creation — the ONE home for making a Job ────────────────────────
// Extracted from POST /api/jobs (step 1), which now delegates here.
// Called only when an agent explicitly chooses "New Job".

export interface CreateJobResult {
  job: { id: string; jobCode: string; name: string; status: JobStatus; companyId: string }
  companyResolution: string | null
  contactWarning: string | null
  /// Provenance for callers that may need to UNWIND this creation — a
  /// self-serve flow that fails downstream has to clean up after itself,
  /// and it may only delete rows it can prove it made. `companyResolution`
  /// carries the same information in prose, but matching on a string
  /// meant for humans is not proof. These are.
  companyCreated: boolean
  personCreated: boolean
  /// The resolved-or-created lead contact. Null when the draft carried no
  /// email (the dedup anchor), in which case no Person was touched.
  personId: string | null
}

export async function createJobFromDraft(draft: JobDraft, agentId: string): Promise<CreateJobResult> {
  if (!draft.name?.trim()) throw new Error('Job name is required')
  if (!agentId) throw new Error('agentId is required')

  // Company: resolve-or-create via the existing normalizer.
  let companyId = draft.companyId || null
  let companyResolution: string | null = null
  let companyCreated = false
  let companyName = draft.companyName?.trim() || ''
  // No company yet, and the agent said so explicitly: stand up a
  // per-job placeholder so the Job can exist and the reply can go out.
  // Quick Reply recognises the suffix and offers to ask the client.
  if (!companyId && !companyName && draft.companyUnknown) {
    companyName = makeProvisionalCompanyName({
      contactName: draft.contactName,
      jobName: draft.name,
    })
    companyResolution = `no company supplied — created provisional "${companyName}"`
  }
  if (!companyId && companyName) {
    const key = companyNameKey(companyName)
    const all = await prisma.company.findMany({ select: { id: true, name: true } })
    const matches = all.filter((c) => companyNameKey(c.name) === key)
    if (matches.length >= 1) {
      companyId = matches[0].id
      companyResolution =
        matches.length === 1
          ? `matched existing company "${matches[0].name}"`
          : `AMBIGUOUS: ${matches.length} companies match "${companyName}" — linked "${matches[0].name}"; disambiguate when the Job resolver ships full company handling`
    } else {
      const created = await prisma.company.create({
        data: { name: companyName, notes: `created from new-job lead on ${new Date().toISOString().slice(0, 10)}` },
        select: { id: true, name: true },
      })
      companyId = created.id
      companyCreated = true
      companyResolution = `created new company "${created.name}"`
    }
  }
  if (!companyId) throw new Error('companyId or companyName is required')

  // Person: resolve-or-create (email is the dedup anchor; enrichment
  // fills EMPTY fields only).
  let leadContactPersonId: string | null = null
  let personCreated = false
  let contactWarning: string | null = null
  const contactEmail = draft.contactEmail ? normalizeEmail(draft.contactEmail) : ''
  const contactName = draft.contactName?.trim() || ''
  const contactPhone = draft.contactPhone?.trim() || ''
  if (contactEmail) {
    const existing = await resolvePersonByEmail(contactEmail)
    if (existing) {
      leadContactPersonId = existing.id
      if (contactPhone && !existing.phone) {
        await prisma.person.update({ where: { id: existing.id }, data: { phone: contactPhone } })
      }
    } else {
      const parts = contactName.split(/\s+/).filter(Boolean)
      const created = await prisma.person.create({
        data: {
          firstName: parts[0] || '(unknown)',
          lastName: parts.slice(1).join(' ') || '',
          email: contactEmail,
          phone: contactPhone || null,
        },
        select: { id: true },
      })
      leadContactPersonId = created.id
      personCreated = true
    }
  } else if (contactName || contactPhone) {
    contactWarning =
      'Contact not saved: an email address is required to create or match a person record (dedup anchor). Add one on the Job later.'
  }

  // ── CC'd clients become Job contacts ─────────────────────────────
  // Wes 2026-08-25: the people the client copied belong on the Job, not
  // just on the reply. Email is the dedup anchor exactly as it is for the
  // lead, so a coordinator already in the CRM is LINKED, never duplicated.
  // The lead is skipped — they're added below as primary.
  const ccPersonIds: string[] = []
  for (const raw of draft.ccContactEmails ?? []) {
    const email = normalizeEmail(raw || '')
    if (!email) continue
    if (contactEmail && email === contactEmail) continue
    const existing = await resolvePersonByEmail(email)
    if (existing) {
      if (!ccPersonIds.includes(existing.id)) ccPersonIds.push(existing.id)
      continue
    }
    // No name to work from — the header gave us an address. A placeholder
    // first name keeps the row findable and the email is what matters.
    const created = await prisma.person.create({
      data: { firstName: email.split('@')[0] || '(unknown)', lastName: '', email },
      select: { id: true },
    })
    if (!ccPersonIds.includes(created.id)) ccPersonIds.push(created.id)
  }

  const jobCode = await nextJobCode(prisma)
  const assistantAuthCode = await generateAssistantAuthCode(prisma)
  const job = await prisma.job.create({
    data: {
      jobCode,
      assistantAuthCode,
      name: draft.name.trim(),
      companyId,
      productionType: (draft.productionType as never) || 'OTHER',
      productionTypeProfileId:
        typeof draft.productionTypeProfileId === 'string' && draft.productionTypeProfileId
          ? draft.productionTypeProfileId
          : null,
      status: draft.status || 'NEW',
      startDate: draft.startDate ? new Date(draft.startDate) : null,
      endDate: draft.endDate ? new Date(draft.endDate) : null,
      agentId,
      notes:
        [draft.notes, companyResolution ? `[company: ${companyResolution}]` : null].filter(Boolean).join('\n') || null,
      estimatedValue: draft.estimatedValue == null ? null : draft.estimatedValue,
      // Contacts: an explicit list wins; otherwise the lead (primary) plus
      // anyone the client CC'd. CC'd people get role OTHER and isPrimary
      // false — we know they were on the thread, not what they do on the
      // production, and guessing a role would be worse than leaving it
      // for whoever works the job. The composite unique is
      // (jobId, personId, role), so a CC who IS the lead would collide;
      // they're filtered out above.
      ...(() => {
        if (draft.contacts && draft.contacts.length > 0) {
          return {
            jobContacts: {
              create: draft.contacts.map((c) => ({
                personId: c.personId,
                role: c.role as never,
                isPrimary: c.isPrimary || false,
              })),
            },
          }
        }
        const rows: Array<{ personId: string; role: 'OTHER'; isPrimary: boolean }> = []
        if (leadContactPersonId) {
          rows.push({ personId: leadContactPersonId, role: 'OTHER', isPrimary: true })
        }
        for (const pid of ccPersonIds) {
          if (pid === leadContactPersonId) continue
          rows.push({ personId: pid, role: 'OTHER', isPrimary: false })
        }
        return rows.length > 0 ? { jobContacts: { create: rows } } : {}
      })(),
    },
    select: { id: true, jobCode: true, name: true, status: true, companyId: true },
  })

  return {
    job,
    companyResolution,
    contactWarning,
    companyCreated,
    personCreated,
    personId: leadContactPersonId,
  }
}
