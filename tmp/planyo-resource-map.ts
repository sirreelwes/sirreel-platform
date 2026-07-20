import { prisma } from '../src/lib/prisma'

async function main() {
  const u = new URL('https://www.planyo.com/rest/')
  u.searchParams.set('method', 'list_resources')
  u.searchParams.set('api_key', process.env.PLANYO_API_KEY!)
  u.searchParams.set('site_id', process.env.PLANYO_SITE_ID!)
  u.searchParams.set('format', 'json')
  const raw: any = await (await fetch(u.toString())).json()
  const results = raw?.data?.results ?? raw?.results ?? []
  const cats = await prisma.assetCategory.findMany({
    select: { name: true, planyoResourceId: true, isActive: true, _count: { select: { assets: true } } },
  })
  const byPlanyoId = new Map(cats.filter(c => c.planyoResourceId != null).map(c => [String(c.planyoResourceId), c]))
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  console.log('resourceId | resourceName | mapped HQ category | confidence')
  for (const r of results) {
    const id = String(r.id ?? r.resource_id)
    const name = r.name ?? ''
    const mapped = byPlanyoId.get(id)
    if (mapped) { console.log(`${id} | ${name} | ${mapped.name} (${mapped._count.assets} units) | exact (seeded planyoResourceId)`); continue }
    const exact = cats.find(c => norm(c.name) === norm(name))
    const fuzzy = cats.find(c => norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name)))
    if (exact) console.log(`${id} | ${name} | ${exact.name} | exact-name (UNSEEDED)`)
    else if (fuzzy) console.log(`${id} | ${name} | ${fuzzy.name}? | fuzzy (NOT seeded — Wes to rule)`)
    else console.log(`${id} | ${name} | — | none (NOT seeded — Wes to rule)`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
