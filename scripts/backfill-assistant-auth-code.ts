#!/usr/bin/env tsx
/**
 * One-time backfill — assigns a random assistantAuthCode to every Job that
 * doesn't have one yet. Idempotent: only touches jobs where
 * assistantAuthCode IS NULL, so it's safe to re-run.
 *
 *   npx tsx scripts/backfill-assistant-auth-code.ts --dry-run   # print only
 *   npx tsx scripts/backfill-assistant-auth-code.ts             # apply
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import path from 'path'

function loadEnvFile(file: string) {
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnvFile(path.join(process.cwd(), '.env.local'))

import { generateAssistantAuthCode } from '../src/lib/jobs/assistantAuthCode'

const prisma = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill-assistant-code] dryRun=${dryRun}`)

  const rows = await prisma.job.findMany({
    where: { assistantAuthCode: null },
    select: { id: true, jobCode: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`[backfill-assistant-code] ${rows.length} jobs with null assistantAuthCode`)

  let updated = 0
  for (const r of rows) {
    const code = await generateAssistantAuthCode(prisma)
    if (!dryRun) {
      await prisma.job.update({ where: { id: r.id }, data: { assistantAuthCode: code } })
    }
    console.log(`  ${r.jobCode} (${r.name}) -> ${code}${dryRun ? '  [dry-run]' : ''}`)
    updated++
  }
  console.log(`[backfill-assistant-code] ${updated} rows ${dryRun ? 'would be' : 'were'} updated`)
}

main()
  .catch((e) => console.error('[backfill-assistant-code] fatal:', e))
  .finally(() => prisma.$disconnect())
