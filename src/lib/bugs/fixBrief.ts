/**
 * The work order handed to Claude Code when Wes ticks reports on the board
 * and presses "Hand to Claude".
 *
 * Wes 2026-09-19: "Once it goes to reported issues and Wes either selects
 * the ones that he wants or he selects all, it should then send a prompt
 * back to here in Claude, and they should start working on the fix."
 *
 * The honest constraint: HQ runs on Vercel and Claude Code runs on Wes's
 * Mac. A web page cannot start a session on his laptop. So the hand-off is
 * a BRIEF plus a QUEUE, and there are two ways to collect it — the button
 * copies it for pasting, and `/fix-bugs` in the terminal pulls whatever is
 * queued straight out of the database. Both render through this one
 * function, so the pasted brief and the pulled brief are never different
 * documents.
 *
 * What goes in is everything a fixer would otherwise have to go and find:
 * the reporter's own words, the records the URLs resolved to, the requests
 * that actually failed, and the triage agent's read. What stays out is
 * anything that would read as an instruction to ship without looking —
 * the brief asks for a diagnosis first, because the agent's fix plan is a
 * starting point written from one sentence and a stack of URLs, not a spec.
 */

import type { BugReport } from '@prisma/client'
import type { BugContext } from '@/lib/bugs/clientContext'
import { KIND_LABEL, SEVERITY_LABEL } from '@/lib/bugs/vocab'

export interface BriefReport
  extends Pick<
    BugReport,
    | 'id' | 'title' | 'area' | 'severity' | 'kind' | 'body'
    | 'reasoning' | 'response' | 'suspects' | 'missingContext'
    | 'reportedByName' | 'createdAt'
  > {
  context: unknown
  duplicateCount?: number
}

function envelopeLines(raw: unknown): string[] {
  const ctx = raw as (BugContext & { resolved?: { label: string }[] }) | null
  if (!ctx) return []
  const out: string[] = []
  const resolved = ctx.resolved ?? []
  if (resolved.length) {
    out.push('  Records involved (resolved from the URLs, not typed by the reporter):')
    resolved.forEach((r) => out.push(`    - ${r.label}`))
  }
  if (ctx.failedRequests?.length) {
    out.push('  Requests that failed:')
    ctx.failedRequests.forEach((r) =>
      out.push(`    - ${r.method} ${r.url} → ${r.status === 0 ? 'never completed' : r.status}`),
    )
  }
  if (ctx.errors?.length) {
    out.push('  Errors thrown:')
    ctx.errors.forEach((e) => out.push(`    - ${e.message}`))
  }
  if (ctx.pages?.length) {
    out.push(`  Pages walked through: ${ctx.pages.map((p) => p.path).join(' → ')}`)
  }
  return out
}

function oneReport(r: BriefReport, n: number): string {
  const lines: string[] = []
  lines.push(`### ${n}. ${r.title ?? '(untitled)'}`)
  lines.push(
    `${SEVERITY_LABEL[r.severity]} · ${KIND_LABEL[r.kind]} · ${r.area ?? 'area unknown'} · reported by ${r.reportedByName}` +
      (r.duplicateCount ? ` · ${r.duplicateCount + 1} people hit this` : ''),
  )
  lines.push(`report id: ${r.id}`)
  lines.push('')
  lines.push(`What they wrote, verbatim:`)
  lines.push(`  "${r.body.replace(/\n/g, ' ')}"`)
  const env = envelopeLines(r.context)
  if (env.length) {
    lines.push('')
    lines.push('What the browser saw:')
    lines.push(...env)
  }
  if (r.reasoning) {
    lines.push('')
    lines.push(`Triage agent's read: ${r.reasoning}`)
  }
  if (r.response) {
    lines.push('')
    lines.push(`Triage agent's suggested fix (a starting point, not a spec): ${r.response}`)
  }
  if (r.suspects?.length) {
    lines.push('')
    lines.push(`Suspects it named: ${r.suspects.join(', ')}`)
  }
  if (r.missingContext) {
    lines.push('')
    lines.push(`It could NOT determine: ${r.missingContext}`)
  }
  return lines.join('\n')
}

/**
 * The whole work order. `batchId` is what `/fix-bugs` and the board use to
 * talk about the same hand-off, and what the fixer stamps back when done.
 */
export function composeFixBrief(reports: BriefReport[], batchId: string): string {
  if (reports.length === 0) return 'Nothing is queued for fixing.'

  const header = [
    `# Fix these ${reports.length} issue${reports.length === 1 ? '' : 's'} reported in SirReel HQ`,
    '',
    `Batch: ${batchId}`,
    '',
    'These came through the bug box on HQ Help and were triaged by the bug agent.',
    'Each one carries the reporter\'s own words, what the browser saw at the time,',
    'and the records the captured URLs resolved to.',
    '',
    '## How to work these',
    '',
    '- Reproduce or diagnose BEFORE changing anything. The suggested fix on each',
    '  item was written from one sentence and a few URLs — it is a lead, not a spec,',
    '  and it is confidently wrong often enough to matter.',
    '- Work them worst-first; they are listed in that order.',
    '- If an item turns out not to be a bug, say so and leave it — do not invent a',
    '  change to justify the ticket.',
    '- `npm run build` is the gate before any push (see CLAUDE.md), and this repo',
    '  has no ESLint, so put hooks above every early return by hand.',
    '- When one is genuinely fixed, mark it on the board (/admin/bugs) or run',
    '  `npx tsx scripts/fix-queue.ts --done <report id> --note "what you did"`.',
    '',
    '---',
    '',
  ].join('\n')

  return header + reports.map((r, i) => oneReport(r, i + 1)).join('\n\n---\n\n') + '\n'
}
