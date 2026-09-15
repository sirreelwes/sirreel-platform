/**
 * POST /api/crm/companies/[id]/logo/from-website — find the client's logo
 * on their own site, from the domain their people email us from.
 *
 * Wes 2026-09-14: "If you can pull it from their website (look at the email
 * addresses to find) then we can use that too."
 *
 * Two steps, so nobody saves a logo they have not looked at:
 *   { }                       → search the best-ranked domain; returns a preview
 *   { domain }                → search that domain instead (the "try another" list)
 *   { domain, save: true }    → search again and save what it finds
 * The preview is a data: URI of the fetched bytes — the same bytes the save
 * step would store, re-fetched rather than trusted back from the browser.
 * Same editor gate as the upload route beside it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'
import { companyEmailDomains, saveFoundLogo } from '@/lib/companies/companyLogoFinder'
import { findLogoForDomain } from '@/lib/companies/logoFromWebsite'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error

  const body = (await req.json().catch(() => ({}))) as { domain?: string; save?: boolean }
  const info = await companyEmailDomains(params.id)
  if (!info) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  // Only a domain we already hold for this company — the route is not a
  // general-purpose fetcher.
  const asked = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
  const domain = asked ? info.domains.find((d) => d.domain === asked)?.domain : info.domains[0]?.domain
  if (!domain) {
    return NextResponse.json({
      ok: false,
      domains: info.domains,
      error: info.domains.length
        ? 'That domain is not one of this company’s addresses.'
        : 'No company email domain on file — everyone here writes from Gmail-type addresses.',
    })
  }

  const search = await findLogoForDomain(domain)
  if (!search.found) {
    return NextResponse.json({ ok: false, domain, domains: info.domains, error: search.error, rejected: search.rejected })
  }

  if (body.save) {
    try {
      await saveFoundLogo(params.id, search.found, g.user.id)
    } catch (err) {
      console.error('[company logo from-website] save failed:', err)
      return NextResponse.json({ error: 'Found it, but saving failed — the blob store may be misconfigured.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, saved: true, domain })
  }

  const f = search.found
  return NextResponse.json({
    ok: true,
    domain,
    domains: info.domains,
    sourceUrl: f.sourceUrl,
    via: f.via,
    preview: `data:${f.contentType};base64,${f.bytes.toString('base64')}`,
  })
}
