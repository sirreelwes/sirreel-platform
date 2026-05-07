import type { AiChange, ChangeDecisionValue } from './ContractDocument'

export interface CounterEmailDecision {
  clauseRef: string
  decision: ChangeDecisionValue
  note: string | null
  changeIndex?: number
}

export interface CounterEmailCompany {
  name: string | null
}

export interface CounterEmailJob {
  jobCode: string | null
  name: string | null
}

export interface CounterEmailContact {
  fullName: string | null
  email: string | null
}

export interface BuildCounterEmailArgs {
  aiChanges: AiChange[]
  decisions: CounterEmailDecision[]
  company: CounterEmailCompany | null
  job: CounterEmailJob | null
  primaryContact: CounterEmailContact | null
  senderName: string
}

export interface BuiltCounterEmail {
  subject: string
  body: string
}

function refSortKey(ref: string): [number, string] {
  const m = /^(\d+)/.exec(ref)
  if (m) return [parseInt(m[1], 10), ref]
  return [Number.MAX_SAFE_INTEGER, ref]
}

function sortRefs(refs: string[]): string[] {
  return [...refs].sort((a, b) => {
    const [an, as] = refSortKey(a)
    const [bn, bs] = refSortKey(b)
    if (an !== bn) return an - bn
    return as.localeCompare(bs)
  })
}

function formatRefList(refs: string[]): string {
  return sortRefs(refs)
    .filter((r) => r.length > 0)
    .map((r) => `§${r}`)
    .join(', ')
}

function buildSubject(args: BuildCounterEmailArgs): string {
  const jobCode = args.job?.jobCode?.trim() || ''
  const jobName = args.job?.name?.trim() || ''
  const companyName = args.company?.name?.trim() || ''

  if (jobCode && jobName) return `SirReel Counter-Proposal — [${jobCode}] ${jobName}`
  if (jobName) return `SirReel Counter-Proposal — ${jobName}`
  if (jobCode) return `SirReel Counter-Proposal — [${jobCode}]`
  if (companyName) return `SirReel Counter-Proposal — ${companyName}`
  return 'SirReel Counter-Proposal'
}

function firstName(full: string | null | undefined): string {
  if (!full) return ''
  const trimmed = full.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/\s+/)
  return parts[0] || ''
}

interface UserNote {
  ref: string
  text: string
}

function collectUserNotes(args: BuildCounterEmailArgs): UserNote[] {
  // Per spec: only user-typed notes on COUNTER or REJECT decisions are
  // surfaced to clients. The AI `reasoning` field is internal strategic
  // analysis and must not leak into the email.
  const items: UserNote[] = []
  for (const d of args.decisions) {
    if (d.decision !== 'COUNTER' && d.decision !== 'REJECT') continue
    const note = (d.note || '').trim()
    if (!note) continue
    items.push({ ref: d.clauseRef, text: note })
  }
  items.sort((a, b) => {
    const [an, as] = refSortKey(a.ref)
    const [bn, bs] = refSortKey(b.ref)
    if (an !== bn) return an - bn
    return as.localeCompare(bs)
  })
  return items
}

export function buildCounterEmail(args: BuildCounterEmailArgs): BuiltCounterEmail {
  const subject = buildSubject(args)

  const accepted = args.decisions.filter((d) => d.decision === 'ACCEPT').map((d) => d.clauseRef)
  const countered = args.decisions.filter((d) => d.decision === 'COUNTER').map((d) => d.clauseRef)
  const rejected = args.decisions.filter((d) => d.decision === 'REJECT').map((d) => d.clauseRef)
  const userNotes = collectUserNotes(args)

  const greetingName = firstName(args.primaryContact?.fullName ?? null)
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi there,'

  const jobName = args.job?.name?.trim() || ''
  const lead = jobName
    ? `Thanks so much for sending over your redlined Rental Agreement for ${jobName} — really appreciate the careful review on your end. Our team has gone through each of your proposed changes, and the attached counter-proposal reflects where we landed.`
    : `Thanks so much for sending over your redlined Rental Agreement — really appreciate the careful review on your end. Our team has gone through each of your proposed changes, and the attached counter-proposal reflects where we landed.`

  const summaryLines: string[] = []
  if (accepted.length > 0) {
    summaryLines.push(
      `Accepted as proposed: ${formatRefList(accepted)} — these fit cleanly with how we operate, and we're happy to incorporate them as written.`
    )
  }
  if (countered.length > 0) {
    summaryLines.push(
      `Counter-proposed: ${formatRefList(countered)} — we've offered alternative language that aims to address the concerns behind your changes while staying inside the framework our liability insurance and operational policies require. Our hope is the proposed wording gets us most of the way there.`
    )
  }
  if (rejected.length > 0) {
    summaryLines.push(
      `Original language retained: ${formatRefList(rejected)} — these clauses sit inside our existing insurance coverage and policy structure, and modifying them would affect our ability to underwrite the rental as currently insured. We've kept the SirReel baseline language for that reason.`
    )
  }

  const closing =
    "We're committed to making this work for you and your production. Happy to jump on a call to walk through any of these items in detail whenever works for you — we'd like to get this landed quickly."

  const senderName = args.senderName?.trim() || 'the SirReel team'
  const signature = `${senderName}\nSirReel Production Vehicles, Inc.`

  const sections: string[] = [greeting, lead]
  if (summaryLines.length > 0) {
    sections.push(['Where we ended up:', ...summaryLines].join('\n'))
  }
  if (userNotes.length > 0) {
    sections.push(
      ['A few specifics:', ...userNotes.map((n) => `- §${n.ref}: ${n.text}`)].join('\n')
    )
  }
  sections.push(closing)
  sections.push(signature)

  const body = sections.join('\n\n')

  return { subject, body }
}
