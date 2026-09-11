/**
 * Platform memory — what AHA can tell an ADMIN about how SirReel HQ works
 * and what has been happening.
 *
 * Wes 2026-09-11, on the backup CEO (who that is stays private — do not
 * name them anywhere in the repo): "If anything ever happens to me, AHA
 * can explain to them everything that I've been doing to the extent that
 * it can and walk them through anything they don't understand."
 *
 * This is NOT a hidden door. It is an explicit capability of the admin
 * level, listed on /admin/assistant, offered only to a number or login
 * that resolves to ADMIN, and every use is audited. Two sources:
 *
 *   platform_memory(query) — the written record: CLAUDE.md (how the
 *     platform is built and why), SHIPLOG.md (every shipped change, newest
 *     first, with the reasoning), and the markdown under docs/ (runbooks,
 *     the SMS filing, specs). docs/owners/ is the exception: it is read
 *     ONLY for an owner (src/lib/assistant/owners.ts) — the succession
 *     notes are for the owners, not for every admin. Split into sections at headings, ranked by
 *     term overlap, top sections returned trimmed. Lines that look like a
 *     credential are redacted before anything leaves this module.
 *
 *   recent_activity(days) — the audit log for the ADMIN users: what
 *     actions, on what, when. Counts plus the latest rows. Never the
 *     stored old/new values, which can carry client data.
 *
 * Files are read at request time from the deployed bundle — see
 * outputFileTracingIncludes in next.config.js, which is what makes the
 * markdown exist inside the lambda at all.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { isOwnersPath } from '@/lib/assistant/owners'

export interface MemorySection {
  source: string
  heading: string
  text: string
  score: number
}

const CORPUS_FILES = ['CLAUDE.md', 'SHIPLOG.md']
const CORPUS_DIRS = ['docs']
const MAX_SECTION_CHARS = 1600
const TOP_N = 4

/** Anything that looks like a key, token or password value. Conservative on purpose. */
const SECRET_LINE = /(secret|token|password|api[_-]?key|authorization|bearer)\s*[:=]\s*\S|(^|[^A-Za-z0-9])(sk|rk|re|pk|whsec|SK|AC)_?[A-Za-z0-9]{24,}/i

export function redact(text: string): string {
  return text
    .split('\n')
    .map((l) => (SECRET_LINE.test(l) ? '[redacted]' : l))
    .join('\n')
}

/** Split markdown into heading-led sections. Pure. */
export function splitSections(source: string, md: string): Array<Pick<MemorySection, 'source' | 'heading' | 'text'>> {
  const out: Array<Pick<MemorySection, 'source' | 'heading' | 'text'>> = []
  let heading = source
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) out.push({ source, heading, text })
    buf = []
  }
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.*)$/)
    if (m) {
      flush()
      heading = m[2].trim()
    } else buf.push(line)
  }
  flush()
  return out
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'how', 'what', 'does', 'do', 'we', 'our',
  'with', 'this', 'that', 'be', 'by', 'at', 'as', 'was', 'are', 'i', 'me', 'my', 'you', 'about', 'tell', 'explain',
])

export function terms(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP.has(t)),
    ),
  )
}

/** Rank sections by how many query terms they contain, heading hits weighted. Pure. */
export function rankSections(
  query: string,
  sections: Array<Pick<MemorySection, 'source' | 'heading' | 'text'>>,
  topN = TOP_N,
): MemorySection[] {
  const ts = terms(query)
  if (ts.length === 0) return []
  const scored = sections.map((s) => {
    const h = s.heading.toLowerCase()
    const body = s.text.toLowerCase()
    let score = 0
    for (const t of ts) {
      if (h.includes(t)) score += 3
      const n = body.split(t).length - 1
      score += Math.min(n, 5)
    }
    return { ...s, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

async function readCorpus(includeOwners: boolean): Promise<Array<Pick<MemorySection, 'source' | 'heading' | 'text'>>> {
  const root = process.cwd()
  const files: string[] = []
  for (const f of CORPUS_FILES) files.push(path.join(root, f))
  for (const d of CORPUS_DIRS) {
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (!includeOwners && isOwnersPath(path.relative(root, p))) continue
        if (e.isDirectory()) await walk(p)
        else if (e.isFile() && e.name.endsWith('.md')) files.push(p)
      }
    }
    await walk(path.join(root, d))
  }
  const sections: Array<Pick<MemorySection, 'source' | 'heading' | 'text'>> = []
  for (const f of files) {
    const md = await fs.readFile(f, 'utf8').catch(() => null)
    if (md === null) continue
    sections.push(...splitSections(path.relative(root, f), md))
  }
  return sections
}

export async function platformMemory(
  query: string,
  opts: { owner?: boolean } = {},
): Promise<{ query: string; sections: Array<{ source: string; heading: string; text: string }>; note?: string }> {
  const q = query.trim().slice(0, 300)
  if (!q) return { query: q, sections: [], note: 'ask a question' }
  const corpus = await readCorpus(Boolean(opts.owner))
  if (corpus.length === 0) {
    return { query: q, sections: [], note: 'The written record is not available in this deployment (markdown not traced into the bundle).' }
  }
  const top = rankSections(q, corpus)
  return {
    query: q,
    sections: top.map((s) => ({ source: s.source, heading: s.heading, text: redact(s.text).slice(0, MAX_SECTION_CHARS) })),
    note: top.length ? undefined : 'Nothing in the written record matches those words. Try other terms, or say the record does not cover it.',
  }
}

export async function recentActivity(days: number): Promise<{
  days: number
  people: string[]
  byAction: Array<{ action: string; count: number }>
  latest: Array<{ at: string; who: string | null; action: string; entityType: string }>
}> {
  const d = Math.max(1, Math.min(90, Math.round(days || 14)))
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000)
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true, name: true } })
  const rows = await prisma.auditLog.findMany({
    where: { userId: { in: admins.map((a) => a.id) }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 400,
    select: { action: true, entityType: true, createdAt: true, user: { select: { name: true } } },
  })
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1)
  return {
    days: d,
    people: admins.map((a) => a.name),
    byAction: Array.from(counts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
    latest: rows.slice(0, 25).map((r) => ({ at: r.createdAt.toISOString(), who: r.user?.name ?? null, action: r.action, entityType: r.entityType })),
  }
}
