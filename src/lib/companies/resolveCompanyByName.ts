import { prisma } from '@/lib/prisma'
import { companyNameKey } from '@/lib/companies/normalize'

/**
 * The ONE way to resolve a company from a free-text name (Job-as-root
 * step 4): exact normalized-key match via companyNameKey, with
 * ambiguity FLAGGED instead of silently picking. Shared by resolveJob()
 * and the parse-quote endpoint so every entry point inherits the same
 * flag-on-ambiguity discipline. Read-only — never creates.
 */
export interface CompanyNameResolution {
  /** Every company whose normalized key equals the input's key. */
  matches: { id: string; name: string }[]
  /** First match — null when nothing matched. */
  company: { id: string; name: string } | null
  /** Set when >1 company shares the key — the agent-facing note. */
  ambiguity: string | null
}

export async function resolveCompanyByNameKey(name: string): Promise<CompanyNameResolution> {
  const trimmed = name.trim()
  const key = trimmed ? companyNameKey(trimmed) : ''
  if (!key) return { matches: [], company: null, ambiguity: null }
  const all = await prisma.company.findMany({ select: { id: true, name: true } })
  const matches = all.filter((c) => companyNameKey(c.name) === key)
  return {
    matches,
    company: matches[0] ?? null,
    ambiguity:
      matches.length > 1
        ? `${matches.length} companies match "${trimmed}" — showing "${matches[0].name}"; verify before creating`
        : null,
  }
}
