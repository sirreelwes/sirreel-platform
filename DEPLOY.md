# DEPLOY — Inventory Locations + Sales Pipeline Overhaul

> **For Claude Code:** read this file cold and execute step-by-step. **Always pause for the user's confirmation before any step marked 🔴.** Do not run a step if its pre-check fails — surface the failure and stop.

---

## What ships in this deploy

- **Inventory locations** — DB-backed `InventoryLocation` table replaces the hardcoded `Location` enum on the dropdown. Admin page at `/admin/locations`. Old enum kept for backward compat (additive only).
- **Sales pipeline funnel metrics** — KPI strip at the top of `/sales/pipeline` (new leads, conversion %, $ won MoM, top open deals).
- **Sales signals strip** — chips for stale quotes, dormant clients (60d+), pending COIs, unlinked inbox emails. Click expands a panel.
- **Quote follow-up cadence** — `QuoteFollowUp` table + hourly Vercel cron at `/api/cron/follow-ups` that drafts day-0 / day-1 / day-3 follow-up emails for SENT quotes. Drafts surface in a "Follow-ups Due" panel — agent reviews and clicks "Send & open mail" (mailto:). No silent auto-send.
- **Mark Lost** — per-card button on Open Quotes (DRAFT/SENT) + 7-day badge in the stale-quotes panel. Reason picker (Other vendor / Budget / No response / Timing / Other). Sets Job→LOST + all open Orders→LOST.
- **Inquiries-as-suggestions** — section is now blank-slate. Pulls inbound emails categorized as `BOOKING_INQUIRY` / `RENTAL_REQUEST`. "Capture & Quote" creates an Inquiry and routes to `/orders/new-quote`. Manual "+ New Inquiry" also routes to new-quote on submit.
- **Visual fix** — `/sales/pipeline` headings were white-on-white; now use `text-gray-900`.

## Risk summary

| Surface | Risk | Why it's low |
|---|---|---|
| DB migration | additive only — `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`. Confirmed via `prisma migrate diff`. | No `DROP`, no data loss path. |
| Inventory dropdown | items keep their legacy enum value AND get a new `locationId` FK after seed. UI prefers the FK, falls back to the enum. | If seed fails, UI falls back gracefully. |
| Sales emails | follow-ups are **draft-only**, no auto-send. | `lib/email.ts` is still mock; the agent reviews + clicks mailto:. Wrong email cannot be sent silently. |
| Mark Lost | manual reclassification only — no automatic 7-day Lost trigger. | All transitions agent-confirmed. |
| Cron | new hourly schedule on `/api/cron/follow-ups`. | Idempotent; creates rows that show in a UI panel; nothing is sent without human action. |

---

## Order of operations

**DB first, code second.** Pushing to `main` auto-deploys to Vercel. The new code references new columns/tables, so the schema must already be in place when the deploy lands.

1. Pre-flight checks
2. 🔴 `prisma db push` against prod
3. 🔴 Run inventory locations seed/backfill
4. (User action in Vercel UI) Set `CRON_SECRET`
5. Remove stray `.bak` file
6. 🔴 Commit + push to `main`
7. Verify

---

## Step 1 — Pre-flight checks (no risk)

Run from the project root:

```bash
cd ~/Downloads/sirreel-platform
```

### 1a. Type-check must be clean

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules
echo "exit: $?"
```

**Expected:** no output, exit 0 (or exit 1 only because `grep -v` matched nothing — confirm with a separate `npx tsc --noEmit; echo $?` which should exit 0).

If errors appear: stop, fix them first.

### 1b. Migration preview must be purely additive

```bash
export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

**Expected (full output):** only `CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, foreign key `ALTER TABLE … ADD CONSTRAINT`. The summary should mention adds for:
- enums `FollowUpStage`, `FollowUpStatus`
- tables `inventory_locations`, `quote_followups`
- columns `sr_orders.lost_reason`, `inventory_items.location_id`
- indexes `inventory_items_location_id_idx`, `sr_orders_quote_status_sent_at_idx`, `quote_followups_status_due_at_idx`

**Stop if you see any of these:** `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `ALTER COLUMN … TYPE`, `RENAME`. Surface the diff to the user and do not continue.

### 1c. Confirm git state

```bash
git status --short
git rev-parse --abbrev-ref HEAD     # should be 'main'
```

The expected dirty set:

```
M prisma/schema.prisma
M src/app/(dashboard)/inventory/page.tsx
M src/app/(dashboard)/sales/pipeline/page.tsx
M src/app/api/inventory/items/[id]/route.ts
M src/app/api/inventory/items/route.ts
M src/components/sales/ActiveJobsKanban.tsx
M src/components/sales/InquiriesSection.tsx
M src/components/sales/NewInquiryModal.tsx
M src/components/sales/OpenQuotesKanban.tsx
M src/lib/permissions.ts
M vercel.json
?? prisma/seeds/2026-05-10-inventory-locations.ts
?? src/app/(dashboard)/admin/locations/
?? src/app/api/admin/locations/
?? src/app/api/cron/
?? src/app/api/inventory/locations/
?? src/app/api/jobs/[id]/mark-lost/
?? src/app/api/sales/
?? src/components/sales/FollowUpsDuePanel.tsx
?? src/components/sales/FunnelMetricsStrip.tsx
?? src/components/sales/MarkLostModal.tsx
?? src/components/sales/NudgeModal.tsx
?? src/components/sales/SalesSignalsStrip.tsx
?? src/lib/auth-admin.ts
?? src/lib/sales/followUpDraft.ts
```

Plus one stray file to delete in step 5: `?? src/app/api/tools/contract-review/route.ts.bak`.

If the working tree differs significantly, **stop and ask the user** what they want included.

---

## Step 2 — 🔴 Push schema to prod DB

Confirm Step 1b's diff one more time. Then:

```bash
export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
npx prisma db push
```

**Expected output:** "🚀  Your database is now in sync with your Prisma schema."

After this completes, **do not push code yet** — the new tables exist but are empty. The next step seeds them.

If push fails: read the error. The migration is additive, so most common failure is connectivity or wrong `DATABASE_URL`. Do not retry until you understand why it failed.

---

## Step 3 — 🔴 Seed + backfill inventory locations

This creates the 9 location rows and links every existing `InventoryItem` via `locationId`. Idempotent (uses upsert + `WHERE locationId IS NULL` on backfill), so safe to re-run.

```bash
npx tsx prisma/seeds/2026-05-10-inventory-locations.ts
```

**Expected output:**
```
Seeding InventoryLocation rows…
  • LANKERSHIM → <uuid>
  • NAPA → <uuid>
  • UTAH → <uuid>
  • ON_RENTAL → <uuid>
  • IN_TRANSIT → <uuid>
  • BODY_SHOP → <uuid>
  • HIGH_TECH → <uuid>
  • CHESTNUT → <uuid>
  • LIMA → <uuid>

Backfilling InventoryItem.locationId from legacy enum…
  • LANKERSHIM: <N> item(s) linked
  • …
Done. Linked <total> item(s).
```

If any items remain unlinked (e.g., no enum value matched), they fall back to displaying the legacy enum string in the UI — not a blocker.

---

## Step 4 — Cron secret on Vercel (user action)

Pause and ask the user to do this in the Vercel UI before the code deploy. It is **optional** but recommended.

> Open Vercel → project `sirreel-platform` → Settings → Environment Variables → Add:
> - **Key:** `CRON_SECRET`
> - **Value:** any long random string (e.g. `openssl rand -hex 32` from a terminal)
> - **Environments:** Production (and Preview if you want)
> - Save.
>
> Vercel will pass this as `Authorization: Bearer …` automatically when running the hourly cron. Without it, `/api/cron/follow-ups` is open — fine for testing, less ideal for prod.

When the user confirms (or says skip), continue.

---

## Step 5 — Tidy up before commit

Drop the stale backup that's gitignored but showing up as untracked:

```bash
rm -f src/app/api/tools/contract-review/route.ts.bak
```

---

## Step 6 — 🔴 Commit + push

Two logical commits make the history easier to read later:

```bash
# Commit 1 — inventory locations
git add prisma/schema.prisma \
        prisma/seeds/2026-05-10-inventory-locations.ts \
        src/lib/auth-admin.ts \
        src/lib/permissions.ts \
        src/app/api/admin/locations \
        src/app/api/inventory/locations \
        src/app/api/inventory/items \
        'src/app/(dashboard)/admin/locations' \
        'src/app/(dashboard)/inventory/page.tsx'

git commit -m "$(cat <<'EOF'
Inventory locations: admin-editable + DB-backed dropdown

Adds InventoryLocation model + locationId FK on InventoryItem (legacy
Location enum kept for backward compat). New /admin/locations page for
ADMIN role. Inventory edit dropdown now reads from the DB. Idempotent
seed script populates the 9 known values and backfills item.locationId
from the existing enum.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Commit 2 — sales pipeline overhaul
git add -A

git commit -m "$(cat <<'EOF'
Sales pipeline: metrics, signals, follow-up cadence, mark-lost,
inbox-suggested inquiries

- FunnelMetricsStrip: MTD KPIs (new leads, conversion, $ won MoM,
  top open deals) with My/Team scope.
- SalesSignalsStrip: stale quotes, dormant clients (60d+), pending
  COIs, unlinked inbox emails. 7d+ stale quotes get a red badge with
  inline Mark Lost.
- QuoteFollowUp cadence (DAY_0/DAY_1/DAY_3) generated by hourly
  /api/cron/follow-ups. Drafts surface in FollowUpsDuePanel for agent
  review; "Send & open mail" PATCHes the row + opens mailto:. No
  silent auto-send (lib/email.ts still mock).
- Mark Lost on Job: reason picker, transitions Job + open Orders,
  expires pending follow-ups.
- Inquiries section becomes blank-slate. Suggestions pulled from
  inbound emails categorized as BOOKING_INQUIRY/RENTAL_REQUEST. Capture
  creates Inquiry + redirects to new-quote. Persistent NEW backlog
  hidden from this section (still in DB).
- Fixed white-on-white headings on /sales/pipeline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push origin main
```

`git push` triggers the Vercel deploy. Watch it in the Vercel dashboard until it says "Ready."

---

## Step 7 — Verify after Vercel deploys

Open `https://hq.sirreel.com` in a logged-in browser session and confirm:

### Inventory
- `/inventory` loads. Existing items show their location (from the new FK or the legacy enum fallback).
- Click **Edit** on any item — the Location dropdown populates from the DB.
- Save a location change — it persists on refresh.

### Locations admin (ADMIN role only)
- `/admin/locations` — list shows the 9 seeded rows with item counts.
- Add a test location, rename it, deactivate it, delete it (delete should fail if items reference it — that's correct).

### Sales pipeline
- `/sales/pipeline` heading is dark/readable.
- KPI strip renders (zeros are OK if no MTD activity yet).
- Signals chips render (likely all zero on first load — correct).
- Inquiries section is **empty** unless inbound emails are categorized.
- Open Quotes cards: hover shows "Nudge" + "Lost" buttons on SENT cards (or "Lost" on DRAFT). Click "Lost" → reason picker modal opens.

### Cron
Manually trigger to confirm the route is live:

```bash
# If CRON_SECRET set:
curl -i -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com/api/cron/follow-ups

# Otherwise:
curl -i https://hq.sirreel.com/api/cron/follow-ups
```

Expected `200` with JSON like `{ now: "...", scannedOrders: N, created: 0, expired: 0 }`. The hourly Vercel cron will fire automatically once `vercel.json` is on `main`.

---

## Rollback

| Symptom | Action |
|---|---|
| App regression after deploy | `git revert` the relevant commit on `main` and push. Vercel redeploys the previous version. New DB columns/tables are unused but harmless. |
| Inventory dropdown empty | Re-run the seed (`npx tsx prisma/seeds/2026-05-10-inventory-locations.ts`). UI falls back to the legacy enum string regardless. |
| Cron firing badly | Remove the `/api/cron/follow-ups` entry from `vercel.json`, push. The route still exists for manual triggers. |
| `quote_followups` rows look wrong | `DELETE FROM quote_followups WHERE status = 'PENDING';` — the next cron run regenerates them from `sentAt`. |
| Mark Lost applied to wrong job | The route is reversible by directly updating the Order row: `UPDATE sr_orders SET quoteStatus='SENT', lostAt=NULL, lostReason=NULL WHERE id='<orderId>';` and `UPDATE sr_jobs SET status='QUOTED' WHERE id='<jobId>';` |

Schema is purely additive, so no DB-level rollback is required for code reverts.

---

## Notes for the operator

- The **CHOXIEE inquiry** from before this work is now hidden from the Pipeline UI but still in the DB. If you want to clean it up, ask Claude Code to run a one-shot delete after deploy.
- **Email send is still mock.** Follow-up "Send & open mail" uses `mailto:` and marks the draft as SENT. When real Gmail send is wired (`src/lib/email.ts`), swap the modal's `<a>` for a POST.
- **Auto-Lost is intentionally not enabled.** 7d+ stale quotes are surfaced in the signals strip with a one-click manual Mark Lost. Per the design discussion, never silently transition deals.
- The **`Location` enum** in `prisma/schema.prisma` is now redundant for InventoryItem but still used by `User.location`. Don't drop it without a separate migration plan.
