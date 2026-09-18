import { prisma } from '@/lib/prisma'
import { readCoiBroker, type CoiBroker } from '@/lib/coi/broker'

/**
 * The broker DIRECTORY — the list behind "who is this client's broker".
 *
 * Wes 2026-09-17: "Please start keeping a list of brokers … Barbara Wagner
 * and her email is barbara@worthingtoninsur.com."
 *
 * ── Why this exists beside broker.ts ───────────────────────────────────────
 * `readCoiBroker()` reads the producer block off ONE certificate. That is the
 * right home for a fact about a document and the wrong home for a list: it
 * cannot answer "who do we send to for this client" when the producer box did
 * not read, when the newest certificate is the one we are complaining about,
 * or when the person who knows is on their phone. So the facts we meet get
 * WRITTEN somewhere they outlive the document.
 *
 * ── Two rules carry the weight ─────────────────────────────────────────────
 * 1. **The email is the identity.** A broker is one row per address, so the
 *    same agent on a second certificate updates rather than duplicates. A
 *    producer block with no readable email is not recorded at all — a
 *    directory keyed on a name the model guessed is a list of misspellings.
 * 2. **A typed fact outranks a read one, and neither is overwritten by a
 *    blank.** A person who corrected "Barbara Wagner" must not have it
 *    reverted by the next certificate whose producer box says "Certificates
 *    Dept". Extraction FILLS gaps; only a MANUAL edit replaces.
 *
 * Every write here is BEST-EFFORT and every read fails soft: the tables are
 * created by additive SQL (brokerTableSql.ts) and until that has run a COI
 * review must behave exactly as it did before this shipped.
 */

/** How we learned a broker acts for a client. */
export type BrokerSource = 'CERTIFICATE' | 'CONTACTED' | 'MANUAL'

export interface BrokerFacts {
  email: string
  name?: string | null
  agency?: string | null
  phone?: string | null
  address?: string | null
}

export interface BrokerRow {
  id: string
  email: string
  name: string | null
  agency: string | null
  phone: string | null
  address: string | null
  notes: string | null
  lastSeenAt: Date | null
  lastContactedAt: Date | null
  timesContacted: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Postgres "table does not exist" / "column does not exist" — the tables
 *  have not been created yet. Never an error a COI review should surface. */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  return code === 'P2021' || code === 'P2022'
}

const trim = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/**
 * The cleaned, storable form — or null when there is nothing to key on.
 * Pure.
 */
export function normalizeBrokerFacts(input: BrokerFacts | null | undefined): BrokerFacts | null {
  if (!input) return null
  const email = trim(input.email, 254)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) return null
  return {
    email,
    name: trim(input.name, 200),
    agency: trim(input.agency, 200),
    phone: trim(input.phone, 40),
    address: trim(input.address, 300),
  }
}

/** The broker facts off a stored COI review, in directory shape. */
export function brokerFactsFromReview(ai: unknown): BrokerFacts | null {
  const b: CoiBroker = readCoiBroker(ai)
  if (!b.email) return null
  return normalizeBrokerFacts({
    email: b.email,
    name: b.contactName,
    agency: b.agency,
    phone: b.phone,
    address: b.address,
  })
}

/**
 * What to WRITE onto an existing row when we meet a broker again. Pure, so
 * the rule that protects a corrected name is testable without a database.
 *
 * `MANUAL` replaces any field it supplies (a person is editing the row on
 * purpose). Anything else only fills a blank — the producer box on the next
 * certificate is not permission to overwrite what someone typed.
 */
export function mergeBrokerFacts(
  existing: Pick<BrokerRow, 'name' | 'agency' | 'phone' | 'address'>,
  incoming: BrokerFacts,
  source: BrokerSource,
): Partial<Pick<BrokerRow, 'name' | 'agency' | 'phone' | 'address'>> {
  const out: Record<string, string> = {}
  const fields = ['name', 'agency', 'phone', 'address'] as const
  for (const f of fields) {
    const next = incoming[f]
    if (!next) continue
    if (source === 'MANUAL') {
      if (next !== existing[f]) out[f] = next
    } else if (!existing[f]) {
      out[f] = next
    }
  }
  return out
}

const SELECT = {
  id: true,
  email: true,
  name: true,
  agency: true,
  phone: true,
  address: true,
  notes: true,
  lastSeenAt: true,
  lastContactedAt: true,
  timesContacted: true,
} as const

/**
 * Record a broker we have met, and — when we know it — which client they act
 * for. Returns the row, or null when the tables are not there yet or the
 * facts carry no usable email.
 *
 * `contacted: true` is reserved for an actual send: it stamps
 * `lastContactedAt` and increments the count, which is what makes "we have
 * written to this person before" answerable later.
 */
export async function recordBroker(args: {
  facts: BrokerFacts | null
  source: BrokerSource
  companyId?: string | null
  insuredName?: string | null
  contacted?: boolean
  actorUserId?: string | null
}): Promise<BrokerRow | null> {
  const facts = normalizeBrokerFacts(args.facts)
  if (!facts) return null
  const now = new Date()

  try {
    const existing = await prisma.broker.findUnique({ where: { email: facts.email }, select: SELECT })

    const contactBump = args.contacted
      ? { lastContactedAt: now, timesContacted: { increment: 1 } }
      : {}

    const row = existing
      ? await prisma.broker.update({
          where: { id: existing.id },
          data: {
            ...mergeBrokerFacts(existing, facts, args.source),
            // "Seen" is the certificate side; a send is not a sighting.
            ...(args.source === 'CERTIFICATE' ? { lastSeenAt: now } : {}),
            ...contactBump,
          },
          select: SELECT,
        })
      : await prisma.broker.create({
          data: {
            email: facts.email,
            name: facts.name,
            agency: facts.agency,
            phone: facts.phone,
            address: facts.address,
            lastSeenAt: args.source === 'CERTIFICATE' ? now : null,
            createdByUserId: args.actorUserId ?? null,
            ...(args.contacted ? { lastContactedAt: now, timesContacted: 1 } : {}),
          },
          select: SELECT,
        })

    if (args.companyId) {
      await linkBrokerToCompany({
        brokerId: row.id,
        companyId: args.companyId,
        insuredName: args.insuredName ?? null,
        source: args.source,
      })
    }
    return row
  } catch (err) {
    if (isMissingTable(err)) return null
    console.error('[brokerDirectory] recordBroker failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Tie a broker to one of our clients. CONTACTED outranks CERTIFICATE on an
 * existing link — "we have actually written to them for this client" is the
 * stronger statement and the one worth keeping.
 */
export async function linkBrokerToCompany(args: {
  brokerId: string
  companyId: string
  insuredName?: string | null
  source: BrokerSource
}): Promise<void> {
  const now = new Date()
  try {
    const link = await prisma.brokerClient.findUnique({
      where: { brokerId_companyId: { brokerId: args.brokerId, companyId: args.companyId } },
      select: { id: true, source: true, insuredName: true },
    })
    if (!link) {
      await prisma.brokerClient.create({
        data: {
          brokerId: args.brokerId,
          companyId: args.companyId,
          insuredName: trim(args.insuredName),
          source: args.source,
          lastSeenAt: now,
        },
      })
      return
    }
    await prisma.brokerClient.update({
      where: { id: link.id },
      data: {
        lastSeenAt: now,
        ...(link.source === 'CERTIFICATE' && args.source !== 'CERTIFICATE' ? { source: args.source } : {}),
        ...(!link.insuredName && trim(args.insuredName) ? { insuredName: trim(args.insuredName) } : {}),
      },
    })
  } catch (err) {
    if (isMissingTable(err)) return
    console.error('[brokerDirectory] linkBrokerToCompany failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * The brokers we know for one client, most recently useful first — what the
 * review desk offers when the certificate in front of it names nobody.
 * Empty array when the tables are missing.
 */
export async function brokersForCompany(companyId: string | null | undefined): Promise<
  (BrokerRow & { source: BrokerSource; insuredName: string | null })[]
> {
  if (!companyId) return []
  try {
    const links = await prisma.brokerClient.findMany({
      where: { companyId },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: { brokerId: true, source: true, insuredName: true },
    })
    if (!links.length) return []
    const brokers = await prisma.broker.findMany({
      where: { id: { in: links.map((l) => l.brokerId) }, isActive: true },
      select: SELECT,
    })
    const byId = new Map(brokers.map((b) => [b.id, b]))
    return links
      .map((l) => {
        const b = byId.get(l.brokerId)
        return b ? { ...b, source: l.source as BrokerSource, insuredName: l.insuredName } : null
      })
      .filter((r): r is BrokerRow & { source: BrokerSource; insuredName: string | null } => !!r)
  } catch (err) {
    if (isMissingTable(err)) return []
    console.error('[brokerDirectory] brokersForCompany failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export interface BrokerListRow extends BrokerRow {
  isActive: boolean
  clients: { companyId: string; companyName: string | null; source: BrokerSource }[]
}

/**
 * The whole directory for /admin/brokers. `missingTables` is reported rather
 * than thrown so the page can say "run the task" instead of erroring.
 */
export async function listBrokers(opts?: { q?: string | null; includeInactive?: boolean }): Promise<{
  brokers: BrokerListRow[]
  missingTables: boolean
}> {
  const q = trim(opts?.q, 120)
  try {
    const brokers = await prisma.broker.findMany({
      where: {
        ...(opts?.includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' as const } },
                { name: { contains: q, mode: 'insensitive' as const } },
                { agency: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastContactedAt: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: { ...SELECT, isActive: true },
    })
    if (!brokers.length) return { brokers: [], missingTables: false }

    const links = await prisma.brokerClient.findMany({
      where: { brokerId: { in: brokers.map((b) => b.id) } },
      orderBy: { lastSeenAt: 'desc' },
      select: { brokerId: true, companyId: true, source: true },
    })
    const companies = links.length
      ? await prisma.company.findMany({
          where: { id: { in: [...new Set(links.map((l) => l.companyId))] } },
          select: { id: true, name: true },
        })
      : []
    const companyName = new Map(companies.map((c) => [c.id, c.name]))

    return {
      brokers: brokers.map((b) => ({
        ...b,
        clients: links
          .filter((l) => l.brokerId === b.id)
          .map((l) => ({
            companyId: l.companyId,
            // A link whose company was deleted reads as unknown rather than
            // dropping the broker — there is no FK holding this together.
            companyName: companyName.get(l.companyId) ?? null,
            source: l.source as BrokerSource,
          })),
      })),
      missingTables: false,
    }
  } catch (err) {
    if (isMissingTable(err)) return { brokers: [], missingTables: true }
    console.error('[brokerDirectory] listBrokers failed:', err instanceof Error ? err.message : err)
    return { brokers: [], missingTables: false }
  }
}
