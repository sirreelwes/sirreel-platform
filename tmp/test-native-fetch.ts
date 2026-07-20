import { readFile } from 'fs/promises'

async function main() {
  const pdf = await readFile(process.env.SCRATCH + '/black-dog-redline.pdf')
  const baseline = await readFile('public/contracts/sirreel-rental-agreement.pdf')
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: baseline.toString('base64') } },
          { type: 'text', text: 'Reply with the single word OK.' },
        ],
      }],
    }),
  })
  console.log('status:', res.status, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  const j: any = await res.json()
  console.log('text:', j?.content?.[0]?.text ?? JSON.stringify(j).slice(0, 300))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
