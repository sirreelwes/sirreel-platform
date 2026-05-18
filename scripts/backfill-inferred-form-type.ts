#!/usr/bin/env tsx
/**
 * One-time backfill — scans every EmailMessage with inferredFormType IS
 * NULL and writes whatever inferFormTypeFromSubject() returns for the
 * row's Subject. No AI call; just regex.
 *
 * Idempotent. Re-running only touches rows that haven't been classified
 * yet. Cheap enough to run unbounded — no rate limit.
 *
 *   npx tsx scripts/backfill-inferred-form-type.ts             # all rows
 *   npx tsx scripts/backfill-inferred-form-type.ts --dry-run   # print only
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

import { inferFormTypeFromSubject } from '../src/lib/email/inferFormType'

const prisma = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill-form-type] dryRun=${dryRun}`)

  const rows = await prisma.emailMessage.findMany({
    where: { inferredFormType: null },
    select: { id: true, subject: true },
    orderBy: { sentAt: 'desc' },
  })
  console.log(`[backfill-form-type] ${rows.length} EmailMessages with null inferredFormType`)

  const dist: Record<string, number> = {}
  let updated = 0
  for (const r of rows) {
    const t = inferFormTypeFromSubject(r.subject)
    if (!t) continue
    dist[t] = (dist[t] || 0) + 1
    if (!dryRun) {
      await prisma.emailMessage.update({ where: { id: r.id }, data: { inferredFormType: t } })
    }
    updated++
  }
  console.log(`[backfill-form-type] ${updated} rows ${dryRun ? 'would be' : 'were'} updated`)
  console.log('[backfill-form-type] distribution:', dist)
}

main().catch((e) => console.error('[backfill-form-type] fatal:', e)).finally(() => prisma.$disconnect())
