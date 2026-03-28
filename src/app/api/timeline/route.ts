import { NextResponse } from "next/server"

const BASE_URL = "https://sirreel.rentalworks.cloud"
const TOKEN = process.env.RENTALWORKS_TOKEN || ""

async function rwPost(path: string, body: object = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { error: `${res.status}` }
  return res.json()
}

const STATUS_MAP: Record<string, string> = {
  ACTIVE: 'active',
  CONFIRMED: 'booked',
  HOLD: 'hold',
  QUOTE: 'quoted',
  INQUIRY: 'inquiry',
  COMPLETE: 'complete',
  CLOSED: 'closed',
}

const AGENT_MAP: Record<string, string> = {
  'Pacheco, Jose': 'Jose',
  'Carlson, Oliver': 'Oliver',
  'Novoa, Dani': 'Dani',
  'Bailey, Wes': 'Wes',
}

// Map RW description keywords to vehicle categories
function detectCategories(description: string): string[] {
  const d = description.toLowerCase()
  const cats: string[] = []
  if (d.match(/cube|box truck|3.?ton|5.?ton|super cube/)) cats.push('cube')
  if (d.match(/cargo|sprinter|transit/)) cats.push('cargo')
  if (d.match(/passenger|pass van|15.?pass|15 pass/)) cats.push('pass')
  if (d.match(/pop.?van|popvan/)) cats.push('pop')
  if (d.match(/dlux|de luxe/)) cats.push('dlux')
  if (d.match(/camera|cam cube/)) cats.push('cam')
  if (d.match(/scout|vtr|pro.?scout/)) cats.push('scout')
  if (d.match(/studio/)) cats.push('studio')
  if (d.match(/stakebed|stake/)) cats.push('stakebed')
  if (cats.length === 0) cats.push('general')
  return cats
}

export async function GET() {
  try {
    if (!TOKEN) return NextResponse.json({ error: "No RW token" }, { status: 500 })

    // Fetch recent and upcoming orders — last 7 days to next 30 days
    const today = new Date()
    const from = new Date(today)
    from.setDate(from.getDate() - 7)
    const to = new Date(today)
    to.setDate(to.getDate() + 30)

    const data = await rwPost("/api/v1/order/browse", {
      pageNo: 1,
      pageSize: 200,
    })

    if (data.error) return NextResponse.json({ error: data.error }, { status: 500 })

    const cols = data.ColumnIndex
    const rows: any[][] = data.Rows || []

    const jobs = rows
      .map((row: any[]) => {
        const status = row[cols.Status]
        const startDate = row[cols.EstimatedStartDate]
        const endDate = row[cols.EstimatedStopDate]

        // Skip if no dates or status is closed/complete
        if (!startDate || !endDate) return null
        if (['CLOSED', 'COMPLETE'].includes(status)) return null

        const agentRaw = row[cols.Agent] || ''
        const agent = AGENT_MAP[agentRaw] || agentRaw.split(',')[1]?.trim() || agentRaw

        const description = row[cols.Description] || ''
        const categories = detectCategories(description)

        return {
          id: row[cols.OrderId],
          orderNumber: row[cols.OrderNumber],
          company: row[cols.Customer] || 'Unknown',
          jobName: description,
          agent,
          status: STATUS_MAP[status] || 'general',
          startDate,
          endDate,
          total: row[cols.Total] || 0,
          poNumber: row[cols.PoNumber] || '',
          categories,
          items: categories.map(cat => ({
            cat,
            qty: 1, // RW doesn't give us qty in browse — would need order items API
            start: startDate,
            end: endDate,
          }))
        }
      })
      .filter(Boolean)

    // Sort by start date
    jobs.sort((a: any, b: any) => a.startDate.localeCompare(b.startDate))

    return NextResponse.json({ ok: true, jobs, total: jobs.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
