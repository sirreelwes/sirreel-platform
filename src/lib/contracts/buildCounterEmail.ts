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

const REASONING_TRUNCATE = 200

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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + '…'
}

interface NoteItem {
  ref: string
  text: string
  decision: 'COUNTER' | 'REJECT'
}

function collectNotes(args: BuildCounterEmailArgs): NoteItem[] {
  const items: NoteItem[] = []
  for (const d of args.decisions) {
    if (d.decision !== 'COUNTER' && d.decision !== 'REJECT') continue
    const note = (d.note || '').trim()
    let text = note
    if (!text) {
      const change =
        (typeof d.changeIndex === 'number' ? args.aiChanges[d.changeIndex] : undefined) ||
        args.aiChanges.find((c) => String(c.clause || '').trim() === d.clauseRef)
      const reasoning = (change?.reasoning || '').trim()
      if (reasoning) text = truncate(reasoning, REASONING_TRUNCATE)
    }
    if (text) items.push({ ref: d.clauseRef, text, decision: d.decision })
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
  const notes = collectNotes(args)
  const hasNotesSection = notes.length > 0

  const greetingName = firstName(args.primaryContact?.fullName ?? null)
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi there,'

  const jobName = args.job?.name?.trim() || ''
  const lead = jobName
    ? `Thanks for sending over the redlined agreement for ${jobName}. Attached is SirReel's counter-proposal reflecting our response to each of your proposed changes.`
    : `Thanks for sending over the redlined agreement. Attached is SirReel's counter-proposal reflecting our response to each of your proposed changes.`

  const summaryLines: string[] = []
  if (accepted.length > 0) {
    summaryLines.push(`Accepted as proposed: ${formatRefList(accepted)}`)
  }
  if (countered.length > 0) {
    summaryLines.push(
      `Counter-proposed: ${formatRefList(countered)} (see counter-PDF for proposed language)`
    )
  }
  if (rejected.length > 0) {
    const suffix = hasNotesSection ? ' (see notes below)' : ''
    summaryLines.push(`Original retained: ${formatRefList(rejected)}${suffix}`)
  }

  const noteLines = hasNotesSection
    ? ['Notes:', ...notes.map((n) => `- §${n.ref}: ${n.text}`)]
    : []

  const closing = 'Happy to jump on a call to discuss any of these items.'

  const senderName = args.senderName?.trim() || 'the SirReel team'
  const signature = `${senderName}\nSirReel Production Vehicles, Inc.`

  const sections: string[] = [greeting, lead]
  if (summaryLines.length > 0) sections.push(summaryLines.join('\n'))
  if (noteLines.length > 0) sections.push(noteLines.join('\n'))
  sections.push(closing)
  sections.push(signature)

  const body = sections.join('\n\n')

  return { subject, body }
}
