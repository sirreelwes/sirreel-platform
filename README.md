# SirReel Platform

## Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Database:** PostgreSQL + Prisma ORM
- **Auth:** NextAuth.js with Google Workspace OAuth
- **Hosting:** Vercel
- **AI:** Anthropic Claude API
- **Email:** Gmail API (sync) + SendGrid/Resend (campaigns)
- **Styling:** Tailwind CSS

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables (copy .env.example to .env)
cp .env.example .env
# Then fill in your actual values

# 3. Push database schema
npx prisma db push

# 4. Seed database with Planyo migration data
npx prisma db seed

# 5. Run development server
npm run dev
```

## Environment Variables Required

```
DATABASE_URL=postgresql://user:password@host:5432/sirreel
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

# Google Workspace OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Anthropic (AI)
ANTHROPIC_API_KEY=your-anthropic-key

# RentalWorks
RENTALWORKS_URL=https://yourcompany.rentalworksweb.com
RENTALWORKS_TOKEN=your-rw-token

# SendGrid (mass email - Phase 2)
SENDGRID_API_KEY=your-sendgrid-key

# File Storage
S3_BUCKET=sirreel-files
S3_REGION=us-west-2
S3_ACCESS_KEY=your-key
S3_SECRET_KEY=your-secret
```

## Database: 21 Tables

| Section | Tables | Count |
|---------|--------|-------|
| Fleet | asset_categories, assets | 2 |
| CRM | companies, contacts | 2 |
| Drivers | drivers | 1 |
| Bookings | bookings, booking_items, booking_assignments | 3 |
| Checkout | checkout_records | 1 |
| Maintenance | maintenance_records | 1 |
| Dispatch | dispatch_tasks | 1 |
| Damage | inspections, damage_items | 2 |
| Insurance | insurance_claims, claim_documents, claim_timeline | 3 |
| AI | ai_decisions | 1 |
| Email | email_accounts, email_threads, email_messages | 3 |
| Users | users | 1 |
| Audit | audit_log | 1 |

## Project Structure

```
sirreel-platform/
├── prisma/
│   ├── schema.prisma          # Database schema (21 tables)
│   └── seed.ts                # Planyo data migration seed
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with auth
│   │   ├── page.tsx           # Dashboard redirect
│   │   ├── (auth)/
│   │   │   └── login/         # Google Workspace login
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx     # Sidebar + role-based nav
│   │   │   ├── calendar/      # Calendar view
│   │   │   ├── gantt/         # Gantt timeline
│   │   │   ├── bookings/      # Booking list + smart booking
│   │   │   ├── maintenance/   # Maintenance tracker
│   │   │   ├── fleet/         # Fleet status (asset manager)
│   │   │   ├── dispatch/      # Task board
│   │   │   ├── crm/           # Client profiles + email
│   │   │   ├── claims/        # Insurance claims
│   │   │   └── reporting/     # Analytics
│   │   └── api/
│   │       ├── auth/          # NextAuth routes
│   │       ├── bookings/      # Booking CRUD + AI analysis
│   │       ├── assets/        # Asset status changes
│   │       ├── maintenance/   # Maintenance CRUD
│   │       ├── dispatch/      # Task management
│   │       ├── drivers/       # Driver registry
│   │       ├── claims/        # Claim management
│   │       ├── ai/            # Claude AI endpoints
│   │       ├── email/         # Gmail sync + campaigns
│   │       └── rentalworks/   # RW sync endpoints
│   ├── components/
│   │   ├── calendar/
│   │   ├── gantt/
│   │   ├── booking/
│   │   ├── fleet/
│   │   ├── crm/
│   │   ├── ai/
│   │   ├── claims/
│   │   └── ui/               # Shared UI components
│   ├── lib/
│   │   ├── prisma.ts         # Prisma client
│   │   ├── auth.ts           # Auth config
│   │   ├── ai.ts             # Claude API helpers
│   │   ├── gmail.ts          # Gmail API sync
│   │   ├── rentalworks.ts    # RW API client
│   │   ├── permissions.ts    # Role-based access
│   │   └── utils.ts          # Date helpers, formatters
│   └── types/
│       └── index.ts          # TypeScript types
├── public/
│   └── logo.png
├── .env.example
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.js
```

## Build Phases

### Phase 1: Fleet Hub (4-6 weeks)
- Calendar, Gantt, Fleet Status, Maintenance, Dispatch
- Smart Booking with AI availability check
- Role-based views (4 departments)
- AI chat assistant
- Planyo data migration
- Database + Auth + Hosting

### Phase 2: CRM + Gmail + Claims (4-5 weeks)
- Client profiles, segmentation, follow-up tracking
- Gmail API auto-logging
- Mass email campaigns
- Insurance claims with AI demand letters
- RentalWorks booking sync

### Phase 3: Damage Workflow (2-3 weeks)
- DamageID integration
- Checkout/return inspections
- Driver registry + checkout records
- Damage-to-claim pipeline

### Phase 4: Public Site (3-4 weeks)
- Marketing homepage
- Fleet catalog with live availability
- Online booking portal
- Client self-service portal
- SEO optimization
