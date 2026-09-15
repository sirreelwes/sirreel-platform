/**
 * Backfill client logos from their websites — the domain their people email
 * us from (Wes 2026-09-14: "If you can pull it from their website (look at
 * the email addresses to find) then we can use that too").
 *
 *   npx tsx scripts/fetch-company-logos.ts --dump <dir>     # dry run + contact sheet (<dir>/index.html)
 *   npx tsx scripts/fetch-company-logos.ts --write --ids <id,id,…>
 *   npx tsx scripts/fetch-company-logos.ts --days 120      # widen "active"
 *
 * Scope: companies with NO logo whose job or order was touched in the window
 * (default 60 days). A company that already has a logo is never touched.
 *
 * --write saves ONLY the ids passed in --ids — ones a person picked off the
 * contact sheet. There is deliberately no "save everything that matched":
 * the 2026-09-14 dry run found Amazon's logo on Seed Media Arts' header and
 * Telemundo's on Latin Entertainment Works', both on domains that carried
 * the company's own name. The sheet marks ✓ (domain carries the name) and
 * ? (it does not) to help the eye, not to decide.
 *
 * Raster logos go to the private blob store, which needs
 * BLOB_READ_WRITE_TOKEN — not in .env.local. Run the write under
 * `vercel env run -e production -- npx tsx scripts/fetch-company-logos.ts --write`.
 * Without a token, SVGs still save (inline) and rasters report "no blob token".
 *
 * Journal of every company id written: journals/fetch-company-logos-*.json.
 * To undo one, clear logoUrl/logoSvg/logoUploadedAt on THAT id.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import { companyEmailDomains, saveFoundLogo } from '../src/lib/companies/companyLogoFinder'
import { findLogoForDomain } from '../src/lib/companies/logoFromWebsite'

const args = process.argv.slice(2)
const write = args.includes('--write')
const ids = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',').map((x) => x.trim()).filter(Boolean) : null
if (write && !ids?.length) {
  console.error('--write needs --ids <id,id,…> — pick them off the --dump contact sheet (file names are company ids).')
  process.exit(1)
}
const days = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 60
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null

async function main() {
  const since = new Date(Date.now() - days * 86_400_000)
  const companies = await prisma.company.findMany({
    where: ids
      ? { id: { in: ids } }
      : {
          logoUrl: null,
          logoSvg: null,
          OR: [{ jobs: { some: { updatedAt: { gte: since } } } }, { orders: { some: { updatedAt: { gte: since } } } }],
        },
    select: { id: true, name: true, logoUrl: true, logoSvg: true },
    orderBy: { name: 'asc' },
  })
  console.log(`${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} ${ids ? ' picked' : ` without a logo, active in ${days}d`} — ${write ? 'WRITE' : 'dry run'}\n`)

  const journal: Array<{ companyId: string; name: string; domain: string; via: string; sourceUrl: string; stored: 'svg' | 'blob' }> = []
  const sheet: string[] = []
  const tally = { saved: 0, foundUnconfident: 0, noDomain: 0, notFound: 0, skippedHasLogo: 0, failed: 0 }

  for (const co of companies) {
    if (co.logoUrl || co.logoSvg) {
      tally.skippedHasLogo++
      console.log(`· ${co.name} — already has a logo, left alone`)
      continue
    }
    const info = await companyEmailDomains(co.id)
    const top = info?.domains[0]
    if (!top) {
      tally.noDomain++
      console.log(`· ${co.name} — no company email domain`)
      continue
    }
    const confident = top.fromWebsite || top.matchesName
    const search = await findLogoForDomain(top.domain)
    if (!search.found) {
      tally.notFound++
      console.log(`✗ ${co.name} — ${top.domain}: ${search.error}`)
      for (const r of search.rejected.slice(0, 3)) console.log(`    passed over ${r.url} — ${r.why}`)
      continue
    }
    const f = search.found
    const line = `${co.name} — ${top.domain} (${f.via}, ${f.contentType}) ${f.sourceUrl}`
    if (dump) {
      mkdirSync(dump, { recursive: true })
      const file = `${co.id}.${f.contentType.split('/')[1].replace('svg+xml', 'svg')}`
      writeFileSync(`${dump}/${file}`, f.bytes)
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      sheet.push(
        `<figure><div><img src="${file}"></div><figcaption>${confident ? '✓' : '?'} ${esc(co.name)}<br><small>${esc(top.domain)} · ${f.via}</small></figcaption></figure>`,
      )
    }
    if (!write) {
      if (confident) tally.saved++
      else tally.foundUnconfident++
      console.log(`${confident ? '✓' : '?'} ${line}${confident ? '' : '\n    domain does not carry the company name'}`)
      continue
    }
    if (f.contentType !== 'image/svg+xml' && !process.env.BLOB_READ_WRITE_TOKEN) {
      tally.failed++
      console.log(`! ${line}\n    raster needs the blob store — no blob token here (run under vercel env run -e production)`)
      continue
    }
    try {
      await saveFoundLogo(co.id, f, null)
      tally.saved++
      journal.push({
        companyId: co.id,
        name: co.name,
        domain: top.domain,
        via: f.via,
        sourceUrl: f.sourceUrl,
        stored: f.contentType === 'image/svg+xml' && f.bytes.length <= 256 * 1024 ? 'svg' : 'blob',
      })
      console.log(`✓ ${line}  [saved]`)
    } catch (e) {
      tally.failed++
      console.log(`! ${line}\n    save failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`\n${write ? `saved ${tally.saved}` : `found ${tally.saved} name-matched`} · found on another domain ${tally.foundUnconfident} · nothing usable ${tally.notFound} · no domain ${tally.noDomain}${tally.failed ? ` · failed ${tally.failed}` : ''}${tally.skippedHasLogo ? ` · already had one ${tally.skippedHasLogo}` : ''}`)

  if (dump && sheet.length) {
    writeFileSync(
      `${dump}/index.html`,
      `<style>body{font:12px system-ui;display:grid;grid-template-columns:repeat(auto-fill,220px);gap:12px;padding:16px;background:#F8F7F4}figure{margin:0}figure div{height:64px;background:#fff;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;padding:6px}img{max-height:44px;max-width:200px}</style>${sheet.join('')}`,
    )
    console.log(`contact sheet: ${dump}/index.html`)
  }

  if (write && journal.length) {
    mkdirSync('journals', { recursive: true })
    const path = `journals/fetch-company-logos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(path, JSON.stringify({ ranAt: new Date().toISOString(), days, written: journal }, null, 2))
    console.log(`journal: ${path}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
