# SirReel HQ — Claude Code Context

## Project
Internal operations platform for SirReel Production Vehicles, Inc.
Next.js 14 (app router, src/ directory) + Prisma + Neon PostgreSQL + Vercel.
Repo: github.com/sirreelwes/sirreel-platform
Live: hq.sirreel.com

## People
- **Wes Bailey** (CEO/owner, primary user) — wes@sirreel.com
- **Dani** — operations/co-owner
- **Hugo** — GM
- **Ana** — collections/billing
- **Jose Pacheco, Oliver Carlson** — sales
- **Julian** — dispatch/fleet
- **Chris Valencia** — fleet associate

## Critical Workflow Rules

### Before Prisma migrations
```bash
export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
```

### Before every git push
```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
```
Must be clean.

### Schema changes — DO NOT use `prisma migrate dev`
Migration history has known drift from live DB. Use `prisma db push` instead.
Always preview first:
```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```
Confirm output is purely additive (no DROP TABLE / DROP COLUMN) before pushing.

### Python file edits
Use `python3 - << 'EOF'` heredoc syntax to avoid zsh parsing issues.

## Architecture

### Data Sources of Truth
- **Planyo** (Site ID 36171) = scheduling source of truth
- **RentalWorks** = billing source of truth (being deprecated long-term — design new features for SirReel HQ-native workflow, not RW alignment)
- **CardPointe** (UAT, MID 496152163887) = card processing

### Key Database Concepts
- **Order** (`sr_orders`) — invoiceable rental, ties to a Job
- **Job** (`sr_jobs`) — production/show that owns one or more orders. Status: QUOTED → ACTIVE → WRAPPED, with HOLD/CANCELLED off-ramps
- **JobContact** (`sr_job_contacts`) — person + role (PRODUCER/PM/PC/TRANSPO/ACCOUNTING/OTHER) on a job. Primary contact computed: PM → PC → first marked primary → first contact
- **Person** (`people`) — contacts, NOT scoped to a single company (works with multiple via JobContact)
- **Company** (`companies`) — clients
- **Booking** — Planyo-driven; lifecycle: REQUEST → AI_REVIEW → PENDING_APPROVAL → CONFIRMED → ACTIVE → RETURNED → CANCELLED → ARCHIVED

### Key API patterns
- All API routes use singleton `import { prisma } from '@/lib/prisma'` (NOT `new PrismaClient()`)
- Most API routes use `export const dynamic = 'force-dynamic'`
- Person search is typeahead-only via `/api/persons?q=` (min 1 char, max 8 results)
- Order numbers: `SR-ORD-0001` format. Job codes: `SR-JOB-0001` format
- RentalWorks API: agent field is `Agent` (NOT `CustomerServiceRepresentative`), formatted `Lastname, Firstname` — reverse and trim to match UI display names. Outstanding balance = `Total - InvoicedAmount`

### UI Conventions
- Dark theme: `bg-zinc-900` containers, `bg-zinc-800` inputs, `border-zinc-700`, `text-white`, `text-zinc-400` labels, `text-zinc-500` hints
- Accent: `bg-amber-600 hover:bg-amber-500` for primary CTAs
- Reference existing components in `src/components/orders/` for styling

## Git
- Identity set globally as Wes Bailey / wes@sirreel.com
- Main branch: `main` (auto-deploys to Vercel)
- Don't commit `.bak.*` files (in .gitignore) or pulled schema reference files

## Things to Avoid
- Do NOT run `prisma migrate reset` — would wipe production data
- Do NOT run `prisma migrate dev` — schema drift causes false destructive proposals
- Do NOT use `localStorage` / `sessionStorage` in components
- Do NOT assume RentalWorks alignment for new features — it's being phased out

## Recently Shipped (April 18, 2026)
- Job + JobContact models with full UI integration in `/orders/new`
- Schema drift recovery (added back 6 missing models: Alert, ClientSession, DismissedEmail, EodReport, JobMessage, PaymentLog)
- Orders now require jobId
- new-quote page has temporary auto-create-job fallback (production name → job name); proper UX redesign deferred

## Active Roadmap
1. Julian's dispatch view
2. AI fleet optimization
3. RentalWorks token refresh automation
4. Standalone /jobs list + /jobs/[id] detail page
5. Replace new-quote auto-create-job fallback with proper UX
6. Update Timeline page to use real jobId instead of cart_id
