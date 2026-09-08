import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveCompanyByNameKey } from '@/lib/companies/resolveCompanyByName'
import { AiJsonError } from '@/lib/ai/extractJson'
import { correctImpossibleYear } from '@/lib/orders/parsedDateYear'
// The line pipeline — prompt, catalog resolution, walkie bundling, kit
// pieces — lives in the lib so /api/orders/[id]/parse-lines runs the SAME
// one. See src/lib/sales/parseQuoteItems.ts for why it moved.
import { parseQuoteText, resolveParsedItems, type AiItem } from '@/lib/sales/parseQuoteItems'

// Structured extraction over a long thread can run long — give the
// function headroom beyond the plan default.
export const maxDuration = 120

interface AiContact {
  name: string
  email: string
  title: string | null
  phone: string | null
  company: string | null
  suggested_role: 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'OTHER' | null
  source: 'header' | 'signature' | 'body_mention'
  confidence: 'high' | 'medium' | 'low'
}

// What we return to the UI after dedup + Person table enrichment.
export interface ResolvedContact extends AiContact {
  match_status: 'existing' | 'new' | 'possible_match'
  existing_person_id: string | null
  candidate_person_id: string | null
}

const SIRREEL_DOMAIN = '@sirreel.com'
const NOREPLY_RE = /(^|[^a-z])(no-?reply|notifications?|mailer-daemon|do-?not-?reply|postmaster|bounce[s]?)([^a-z]|$)/i

function shouldDropContact(email: string): boolean {
  const e = email.toLowerCase().trim()
  if (!e || !e.includes('@')) return true
  if (e.endsWith(SIRREEL_DOMAIN)) return true
  if (NOREPLY_RE.test(e)) return true
  return false
}

// Pick the "most complete" record when the AI returned more than one
// row for the same email — count non-null fields, ties broken by
// highest source confidence.
function completenessScore(c: AiContact): number {
  let s = 0
  if (c.name) s++
  if (c.title) s++
  if (c.phone) s++
  if (c.company) s++
  if (c.suggested_role) s++
  if (c.confidence === 'high') s += 2
  else if (c.confidence === 'medium') s += 1
  return s
}

function dedupContacts(raw: AiContact[]): AiContact[] {
  const byEmail = new Map<string, AiContact>()
  for (const c of raw) {
    if (!c || typeof c.email !== 'string') continue
    if (shouldDropContact(c.email)) continue
    const key = c.email.toLowerCase().trim()
    const existing = byEmail.get(key)
    if (!existing || completenessScore(c) > completenessScore(existing)) {
      byEmail.set(key, { ...c, email: key })
    }
  }
  return Array.from(byEmail.values())
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Server enrichment: for each contact, look up the Person table by
// email. If we miss but find a same-name candidate, surface that for
// human review as 'possible_match' instead of silently creating a
// duplicate.
async function enrichContacts(contacts: AiContact[]): Promise<ResolvedContact[]> {
  if (contacts.length === 0) return []
  const emails = contacts.map((c) => c.email.trim().toLowerCase())
  const exact = await prisma.person.findMany({
    where: { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
  const byEmail = new Map(exact.map((p) => [p.email.toLowerCase(), p]))
  // Alias-aware: any email that didn't hit Person.email directly may
  // still resolve via a merged-loser alias. Fold those into byEmail
  // keyed by the alias address (not the survivor's canonical email)
  // so the per-contact lookup below finds them.
  const missed = emails.filter((e) => !byEmail.has(e))
  if (missed.length > 0) {
    const aliases = await prisma.personEmailAlias.findMany({
      where: { email: { in: missed, mode: 'insensitive' } },
      select: { email: true, personId: true },
    })
    if (aliases.length > 0) {
      const survivors = await prisma.person.findMany({
        where: { id: { in: aliases.map((a) => a.personId) } },
        select: { id: true, email: true, firstName: true, lastName: true },
      })
      const survivorById = new Map(survivors.map((s) => [s.id, s]))
      for (const a of aliases) {
        const survivor = survivorById.get(a.personId)
        if (survivor) byEmail.set(a.email.toLowerCase(), survivor)
      }
    }
  }

  const out: ResolvedContact[] = []
  for (const c of contacts) {
    const match = byEmail.get(c.email.trim().toLowerCase())
    if (match) {
      out.push({ ...c, match_status: 'existing', existing_person_id: match.id, candidate_person_id: null })
      continue
    }
    // Possible match — same first+last name, different email. pg_trgm
    // isn't installed in this DB, so exact-name match is the floor.
    const { firstName, lastName } = splitName(c.name)
    let candidateId: string | null = null
    if (firstName && lastName) {
      const candidates = await prisma.person.findMany({
        where: {
          firstName: { equals: firstName, mode: 'insensitive' },
          lastName: { equals: lastName, mode: 'insensitive' },
        },
        select: { id: true },
        take: 2,
      })
      if (candidates.length === 1) candidateId = candidates[0].id
    }
    out.push({
      ...c,
      match_status: candidateId ? 'possible_match' : 'new',
      existing_person_id: null,
      candidate_person_id: candidateId,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  try {
    const body = await req.json()
    const { text } = body

    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })
    }

    let parsed: Awaited<ReturnType<typeof parseQuoteText>>
    try {
      parsed = await parseQuoteText(text)
    } catch (e) {
      if (e instanceof AiJsonError && e.truncated) {
        return NextResponse.json(
          { error: 'This document is too long to parse automatically — paste just the relevant email text, or enter items manually.' },
          { status: 422 }
        )
      }
      return NextResponse.json(
        { error: "Couldn't read this document — try again, paste the email text, or enter items manually." },
        { status: 500 }
      )
    }

    // Correct the QUOTE-LEVEL dates once, at the source, so the order
    // header, the job window and every line all inherit the same repair.
    // Fixing only the lines would have left the header a year out.
    {
      const todayYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
      const s0 = correctImpossibleYear(parsed.startDate, todayYmd)
      const e0 = correctImpossibleYear(parsed.endDate, todayYmd)
      if (s0 && s0 !== parsed.startDate) {
        console.warn(`[parse-quote] impossible year on startDate ${parsed.startDate} -> ${s0}`)
        parsed.startDate = s0
      }
      if (e0 && e0 !== parsed.endDate) {
        console.warn(`[parse-quote] impossible year on endDate ${parsed.endDate} -> ${e0}`)
        parsed.endDate = e0
      }
    }

    const items = await resolveParsedItems(parsed.items, {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    })

    // Contacts: dedupe + filter at the gateway, then enrich with Person
    // table match status. The AI is asked to filter @sirreel/noreply too
    // but we re-check on the server — never trust the model alone.
    const rawContacts: AiContact[] = Array.isArray(parsed.contacts)
      ? (parsed.contacts as AiContact[])
      : []
    const dedupedContacts = dedupContacts(rawContacts)
    const contacts = await enrichContacts(dedupedContacts)

    // Client matching — the resolver's companyNameKey discipline first
    // (exact normalized-key match, ambiguity FLAGGED via the shared
    // resolveCompanyByNameKey), with the legacy contains-cascade kept
    // only as a fuzzy fallback for prefill. clientMatchMeta tells
    // consumers whether the top hit is safe to adopt without asking
    // (exact = a single key match); fuzzy hits are NEVER auto-picked.
    let clientMatch: { id: string; name: string; tier: string; coiOnFile: boolean; defaultAgentId: string | null }[] = []
    let clientMatchMeta: { exact: boolean; ambiguity: string | null } = { exact: false, ambiguity: null }
    if (parsed.clientName) {
      const keyed = await resolveCompanyByNameKey(parsed.clientName)
      if (keyed.matches.length > 0) {
        const rows = await prisma.company.findMany({
          where: { id: { in: keyed.matches.map((m) => m.id) } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
        })
        const rank = new Map(keyed.matches.map((m, i) => [m.id, i]))
        clientMatch = rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        clientMatchMeta = { exact: keyed.matches.length === 1, ambiguity: keyed.ambiguity }
      }
    }
    if (parsed.clientName && clientMatch.length === 0) {
      const stripSuffixes = (s: string) =>
        s
          .toLowerCase()
          .replace(/[,.]/g, ' ')
          .replace(
            /\b(llc|inc|llp|ltd|corp|co|corporation|company|productions?|films?|studios?|media|entertainment|group|pictures)\b/g,
            ''
          )
          .replace(/\s+/g, ' ')
          .trim()
      const stripped = stripSuffixes(parsed.clientName)
      const words = stripped.split(' ').filter((w) => w.length >= 3)

      let companies = await prisma.company.findMany({
        where: { name: { contains: parsed.clientName, mode: 'insensitive' } },
        select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
        take: 10,
      })
      if (companies.length === 0 && stripped) {
        companies = await prisma.company.findMany({
          where: { name: { contains: stripped, mode: 'insensitive' } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        })
      }
      if (companies.length === 0 && words.length > 0) {
        companies = await prisma.company.findMany({
          where: { name: { contains: words[0], mode: 'insensitive' } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        })
      }
      clientMatch = companies
    }

    return NextResponse.json({
      parsed,
      items,
      clientMatch,
      clientMatchMeta,
      contacts,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[parse-quote] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
