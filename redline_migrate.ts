import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const stmts = [
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_redline_url TEXT',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_redline_uploaded_at TIMESTAMP',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_redline_review JSONB',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_redline_reviewed_at TIMESTAMP',
  "ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_redline_status TEXT DEFAULT 'none'",
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_counter_url TEXT',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_counter_sent_at TIMESTAMP',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_approved_by TEXT',
  'ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS contract_approved_at TIMESTAMP',
];
(async () => {
  for (const s of stmts) { await prisma.$executeRawUnsafe(s); process.stdout.write('.'); }
  console.log(' Done!');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
