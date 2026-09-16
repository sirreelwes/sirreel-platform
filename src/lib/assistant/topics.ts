/**
 * AHA troubleshooting topics — read for the prompt, the public pages and
 * the admin editor.
 *
 * Wes 2026-09-16: "a bunch of sections in AHA that we can modify regarding
 * specific troubleshooting tasks that we encounter from our clients." Ops
 * edits the rows; nothing here needs a deploy to change.
 *
 * WHERE THE CONTENT LIVES. `AhaTopic` rows are the truth. When the table is
 * empty — before the seed runs — or missing (before `prisma db push`) this
 * falls back to the code registry in src/lib/site/troubleshooting.ts, so
 * AHA never loses its tutorials mid-rollout. Same fail-soft shape as the
 * AhaGrant reads.
 *
 * WHY THE BRIEF IS GENERATED. A topic's steps and its stop conditions are
 * the thing a person edits. If the prompt text were a separate field they
 * had to remember to update, the two would drift and AHA would keep
 * quoting the old instruction — exactly what the setup-guide module warns
 * about. So `assistantBrief` is derived from the fields unless someone
 * deliberately overrides it.
 */
import { prisma } from '@/lib/prisma'
import { TROUBLESHOOTING_GUIDES, type TroubleshootingGuide } from '@/lib/site/troubleshooting'

/** A topic in the shape the prompt and the pages consume. */
export interface Topic {
  slug: string
  title: string
  eyebrow: string
  summary: string
  symptoms: string[]
  /** `title` is the short imperative; `body` may be empty for a bare line. */
  checks: Array<{ title: string; body: string }>
  stopIf: string[]
  tellUs: string[]
  assistantBrief: string
  /** True when this came from the code fallback rather than an editable row. */
  fromSeed: boolean
}

/** Split a textarea into clean lines. Blank lines and stray bullets go. */
export function lines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
}

/**
 * "Start the truck — it runs off the battery" → title + body.
 * An em dash, an en dash, or a colon splits it; without one the whole line
 * is the title, which is how a one-liner step should read.
 */
export function splitCheck(line: string): { title: string; body: string } {
  const m = line.match(/^(.{3,90}?)\s+[—–]\s+(.+)$/) ?? line.match(/^([^:]{3,90}):\s+(.+)$/)
  return m ? { title: m[1].trim(), body: m[2].trim() } : { title: line, body: '' }
}

/**
 * The prompt block for one topic. Generated so that editing a step in the
 * admin page changes what AHA says, with no prompt rewrite.
 */
export function buildBrief(t: {
  title: string
  symptoms: string[]
  checks: Array<{ title: string; body: string }>
  stopIf: string[]
}): string {
  const steps = t.checks.map((c, i) => `${i + 1}. ${c.title}${c.body ? ` — ${c.body}` : ''}`).join('\n')
  const said = t.symptoms.length ? `\nThey might say: ${t.symptoms.join('; ')}.` : ''
  const stop = t.stopIf.length
    ? `\nSTOP and get them a person — do not offer one more thing to try — if any of these is true: ${t.stopIf.join('; ')}.`
    : ''
  return `${t.title.toUpperCase()} — work these in order, one at a time:${said}\n${steps}${stop}`
}

function fromGuide(g: TroubleshootingGuide): Topic {
  return {
    slug: g.slug,
    title: g.title,
    eyebrow: g.eyebrow,
    summary: g.summary,
    symptoms: g.symptoms,
    checks: g.checks.map((c) => ({ title: c.title, body: c.body })),
    stopIf: g.stopIf,
    tellUs: g.tellUs,
    assistantBrief: g.assistantBrief,
    fromSeed: true,
  }
}

/** Shape a stored row, generating the brief when it carries no override. */
export function fromRow(r: {
  slug: string
  title: string
  eyebrow: string
  summary: string
  symptoms: string
  checks: string
  stopIf: string
  tellUs: string
  assistantBrief: string | null
}): Topic {
  const symptoms = lines(r.symptoms)
  const checks = lines(r.checks).map(splitCheck)
  const stopIf = lines(r.stopIf)
  const override = (r.assistantBrief ?? '').trim()
  return {
    slug: r.slug,
    title: r.title,
    eyebrow: r.eyebrow,
    summary: r.summary,
    symptoms,
    checks,
    stopIf,
    tellUs: lines(r.tellUs),
    assistantBrief: override || buildBrief({ title: r.title, symptoms, checks, stopIf }),
    fromSeed: false,
  }
}

/** Every live topic, newest edit wins over the seed. */
export async function listTopics(opts: { includeDisabled?: boolean } = {}): Promise<Topic[]> {
  try {
    const rows = await prisma.ahaTopic.findMany({
      where: opts.includeDisabled ? {} : { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        slug: true, title: true, eyebrow: true, summary: true,
        symptoms: true, checks: true, stopIf: true, tellUs: true, assistantBrief: true,
      },
    })
    if (rows.length) return rows.map(fromRow)
  } catch (err) {
    // Table not pushed yet — the seed content keeps AHA answering.
    console.error('[aha-topics] falling back to the code registry:', err)
  }
  return TROUBLESHOOTING_GUIDES.map(fromGuide)
}

export async function getTopic(slug: string): Promise<Topic | null> {
  const all = await listTopics()
  return all.find((t) => t.slug === slug) ?? null
}
