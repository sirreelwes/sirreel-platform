/**
 * POST /api/claims/parse-paste
 *
 * Server-side parse of a pasted (forwarded) email chain into the
 * structured fields the claim-onboarding form needs. Routes through
 * Sonnet via parsePastedClaim() for accuracy on the money fields.
 *
 * Adds two non-LLM layers to the response so the UI can guide the
 * rep through correct disposition:
 *
 *   1. Dedup check — if the extracted carrierClaimNumber matches an
 *      existing claim, return that row so the modal can warn before
 *      proceeding ("you already have SR-CLM-0012 against this same
 *      carrier #"). Avoids double-onboarding the same claim.
 *
 *   2. Company match — search the CRM for companies whose name fuzzy-
 *      matches the extracted clientCompanyName. The modal renders the
 *      top hits so the rep picks an existing Company row instead of
 *      accidentally creating a duplicate. NEVER auto-create here.
 *
 * Auth: getServerSession-guarded. No DB writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { parsePastedClaim } from '@/lib/claims/parsePastedClaim'

export const dynamic = 'force-dynamic'
// Sonnet calls can take 4-6s. Bump from Vercel's default 10s to give
// breathing room for long chains.
export const maxDuration = 30

const TEXT_MIN_CHARS = 30
const TEXT_MAX_CHARS = 200_000

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text : ''
  if (text.trim().length < TEXT_MIN_CHARS) {
    return NextResponse.json(
      { error: `text must be at least ${TEXT_MIN_CHARS} characters` },
      { status: 400 },
    )
  }
  if (text.length > TEXT_MAX_CHARS) {
    return NextResponse.json(
      { error: `text exceeds ${TEXT_MAX_CHARS} characters — trim to the relevant chain` },
      { status: 400 },
    )
  }

  // ── (1) LLM extraction ────────────────────────────────────
  const extracted = await parsePastedClaim(text)

  // ── (2) Dedup check on carrierClaimNumber ──────────────────
  // We don't enforce uniqueness at the DB layer because rare cases
  // exist (carrier reuses the same number across claims for the
  // same renter, manual data-entry collisions). Surface the conflict
  // and let the rep decide. NO write here.
  let duplicate: {
    found: boolean
    existing?: {
      id: string
      claimNumber: string
      status: string
      filedAgainst: string
      createdAt: string
    }
  } = { found: false }
  if (extracted.carrierClaimNumber) {
    const dup = await prisma.insuranceClaim.findFirst({
      where: { carrierClaimNumber: extracted.carrierClaimNumber },
      select: {
        id: true, claimNumber: true, status: true, filedAgainst: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (dup) {
      duplicate = {
        found: true,
        existing: {
          ...dup,
          createdAt: dup.createdAt.toISOString(),
        },
      }
    }
  }

  // ── (3) Company-match suggestions ──────────────────────────
  // Same `contains` filter the CRM list uses. Cap at 8 hits so the
  // UI dropdown stays scannable. Empty array when the LLM returned
  // null clientCompanyName.
  const companyMatches = extracted.clientCompanyName
    ? await prisma.company.findMany({
        where: { name: { contains: extracted.clientCompanyName, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 8,
      })
    : []

  return NextResponse.json({
    ok: true,
    extracted,
    duplicate,
    companyMatches,
  })
}
