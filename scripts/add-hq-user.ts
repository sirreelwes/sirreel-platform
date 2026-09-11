/**
 * Add (or update) an HQ user — the only way in, because sign-in is
 * Google OAuth on an allowed domain AND the email must already exist in
 * the users table (src/app/api/auth/[...nextauth]/route.ts denies unknown
 * emails). There is no user-creation page.
 *
 *   npx tsx scripts/add-hq-user.ts --name "Greyson Bailey" --email greyson@sirreel.com --role ADMIN --phone "(818) 555-0100" [--title "Backup CEO"]
 *
 * Needs DATABASE_URL in the shell (see CLAUDE.md "Before Prisma migrations").
 * Idempotent on email: re-running updates name / role / phone / title.
 *
 * Wes 2026-09-11: Greyson Bailey is backup CEO — "access to everything
 * that I have access to". ADMIN is that: every HQ permission, and the AHA
 * admin level (platform memory + recent activity) by text from the phone
 * given here and in the signed-in chat on /admin/assistant.
 */
import { PrismaClient, type UserRole } from '@prisma/client'
import { isAllowedEmailDomain } from '../src/lib/authDomains'

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

async function main() {
  const name = arg('name')
  const email = arg('email')?.toLowerCase()
  const role = (arg('role') ?? 'AGENT').toUpperCase() as UserRole
  const phone = arg('phone')
  const title = arg('title')
  if (!name || !email) {
    console.error('usage: --name "Full Name" --email who@sirreel.com [--role ADMIN|MANAGER|AGENT|BILLING] [--phone "(818) 555-0100"] [--title "Backup CEO"]')
    process.exit(1)
  }
  if (!['ADMIN', 'MANAGER', 'AGENT', 'BILLING'].includes(role)) {
    console.error(`role must be ADMIN, MANAGER, AGENT or BILLING (got ${role})`)
    process.exit(1)
  }
  if (!isAllowedEmailDomain(email)) {
    console.error(`${email} is not on an allowed sign-in domain (AUTH_ALLOWED_EMAIL_DOMAINS, default sirreel.com). They will not be able to sign in with it.`)
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d\'"\' -f2)')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, name: true } })
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, role, phone: phone ?? null, displayTitle: title ?? null, isActive: true },
      update: { name, role, isActive: true, ...(phone ? { phone } : {}), ...(title ? { displayTitle: title } : {}) },
      select: { id: true, email: true, name: true, role: true, phone: true },
    })
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: existing ? 'admin.user_updated_by_script' : 'admin.user_created_by_script',
        entityType: 'User',
        entityId: user.id,
        oldValues: existing ? { role: existing.role, name: existing.name } : {},
        newValues: { role, name, hasPhone: Boolean(phone), script: 'scripts/add-hq-user.ts', at: new Date().toISOString() },
      },
    })
    console.log(`${existing ? 'updated' : 'created'} ${user.name} <${user.email}> role=${user.role} phone=${user.phone ?? '—'} id=${user.id}`)
    console.log('They sign in at hq.sirreel.com with Google on that email. If a phone was given, AHA treats texts from it at the level of that role.')
  } finally {
    await prisma.$disconnect()
  }
}

void main()
