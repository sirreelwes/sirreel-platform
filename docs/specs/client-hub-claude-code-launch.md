# Client Relationship Hub — Claude Code Launch

**Purpose:** Ready-to-paste prompts for Claude Code to execute the Client Relationship Hub build across 7 phases / ~17 commits.

**Spec reference:** `docs/specs/client-relationship-hub-brief.md` (the full brief — Claude Code reads this for context)

---

## Pre-flight Checklist (do these once, before any Claude Code session)

### 1. Copy the brief into your repo

```bash
cd /Users/wesbailey/Downloads/sirreel-platform

mkdir -p docs/specs
cp ~/Downloads/client-relationship-hub-brief.md ./docs/specs/

git add docs/specs/client-relationship-hub-brief.md
git commit -m "docs(crh): add client relationship hub feature brief"
git push
```

### 2. Verify environment

- [ ] Vercel Cron is enabled on the `sirreel-fleet` project
- [ ] `RESEND_API_KEY` is in Vercel env (already done per platform notes)
- [ ] DATABASE_URL exported in local terminal
- [ ] Git identity: Wes Bailey / wes@sirreel.com
- [ ] Yesterday's paperwork portal signing feature (Commits 2.1-2.5 from claude-code-launch.md) is committed and on main

### 3. Conventions reminder for Claude Code

These are already in your repo's standard practice but worth a refresh at the start of each session:

- `prisma db push` not `migrate dev`
- Always preview with `prisma migrate diff` before schema changes
- `npx tsc --noEmit` before each commit
- All file writes via python3 heredocs (zsh-safe)
- `@default(uuid())` not cuid()
- Auth via `getServerSession()` + email-to-user lookup
- Session-start context line: *"You'll be working through implementation prompts I'll paste sequentially. Each is one commit. Read referenced specs in docs/specs/ as needed."*

---

# Phase 1 — Data Model + Cadence Infrastructure

Foundation phase. Three commits, no user-facing changes yet. ~2-3 hours total.

## Commit 1.1 — Schema updates

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 2 "Data Model 
Changes" for full context.

Task: Add all schema changes for the Client Relationship Hub. No code 
changes yet — just the Prisma schema and database push.

Implementation:

1. Add to prisma/schema.prisma:

   Order model additions:
   - cadenceState (enum CadenceState, default QUOTE_DRAFT)
   - cadencePausedUntil (DateTime?)
   - cadenceManualOverride (Boolean, default false)
   - lostAt (DateTime?)
   - lostReason (enum LostReason?)
   - pickupDateAtLoss (DateTime?)
   - reengagementSentAt (DateTime?)
   - reengagementResponded (Boolean, default false)
   - portalSlug (String, unique)
   - portalCreatedAt (DateTime, default now())
   - portalSunsetAt (DateTime?)
   - cadenceEvents: relation to CadenceEvent[]
   - portalAccesses: relation to PortalAccess[]

   New enum CadenceState:
   QUOTE_DRAFT, QUOTE_SENT, QUOTE_ACKNOWLEDGED, QUOTE_DISCUSSING, BOOKED, 
   PICKUP_CONFIRMED, IN_PROGRESS, RETURNED, INVOICED, PAID, WRAPPED, LOST, 
   CANCELLED

   New enum LostReason:
   NO_RESPONSE, ACKNOWLEDGED_NO_BOOK, EXPLICIT_REJECTION, MANUAL_CLOSE

   New CadenceEvent model:
   - id (uuid PK)
   - orderId (FK to Order)
   - eventType (enum CadenceEventType)
   - scheduledFor (DateTime)
   - executedAt (DateTime?)
   - skipped (Boolean, default false)
   - skipReason (String?)
   - emailId (String?)
   - createdAt (DateTime, default now())
   - Indexes on orderId and (scheduledFor, executedAt)

   New enum CadenceEventType — all values from brief Section 2

   New PortalAccess model:
   - id (uuid PK)
   - orderId (FK to Order)
   - contactId (FK to Contact)
   - magicLinkToken (String, unique)
   - magicLinkExpiresAt (DateTime)
   - passwordHash (String?)
   - createdAt (DateTime, default now())
   - revokedAt (DateTime?)
   - revokedBy (String?)
   - lastAccessedAt (DateTime?)
   - accessCount (Int, default 0)
   - Indexes on orderId, contactId, magicLinkToken

   Company model additions:
   - annualAgreementUrl (String?)
   - annualAgreementEffectiveDate (DateTime?)
   - annualAgreementExpiresAt (DateTime?)
   - annualAgreementSignedBy (String?)
   - annualAgreementApprovedBy (String?)
   - annualAgreementApprovedAt (DateTime?)
   - annualCoiUrl (String?)
   - annualCoiEffectiveDate (DateTime?)
   - annualCoiExpiresAt (DateTime?)
   - annualCoiCoverageGL (Decimal?)
   - annualCoiCoverageAuto (Decimal?)
   - annualCoiApprovedBy (String?)
   - annualCoiApprovedAt (DateTime?)
   - negotiatedTermsUrl (String?)
   - negotiatedTermsSummary (String? @db.Text)
   - negotiatedTermsNegotiatedAt (DateTime?)
   - negotiatedTermsApprovedBy (String?)
   - negotiatedTermsApprovedAt (DateTime?)
   - negotiatedTermsActiveAsOf (DateTime?)
   - negotiatedTermsReviewDueDate (DateTime?)

   Vehicle model additions (check if already present first):
   - registrationUrl (String?)
   - registrationExpiresAt (DateTime?)
   - licensePlate (String?)
   - bitCertificateUrl (String?)
   - bitCertificateExpiresAt (DateTime?)
   - insuranceCardUrl (String?) — internal use only
   - insurancePolicyNumber (String?) — internal use only

   EmailMessage model additions:
   - replyClassification (enum ReplyClassification?)
   - replyClassificationConfidence (Float?)

   New enum ReplyClassification:
   PURE_ACKNOWLEDGMENT, ACTIVE_DISCUSSION, BOOKING_SIGNAL, EXPLICIT_REJECTION, 
   UNCLEAR

2. Before pushing, run prisma migrate diff to preview the changes. Confirm 
   no unexpected drops or data losses.

3. Apply with prisma db push.

4. Generate Prisma client: npx prisma generate

5. Run npx tsc --noEmit to confirm all generated types resolve correctly 
   throughout the codebase (any existing references to Order/Company should 
   still compile with the new optional fields).

Test plan:
- Schema applies cleanly via prisma db push
- New tables (CadenceEvent, PortalAccess) created
- New columns added to Order, Company, Vehicle, EmailMessage without 
  affecting existing data
- npx tsc --noEmit passes

Commit message: feat(crh): add schema for cadence, portal access, and 
company-level paperwork
```

## Commit 1.2 — Cadence cron job + event runner

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 3 "Email Cadence 
System" for full context.

Task: Build the cadence cron infrastructure that fires scheduled cadence 
events. No email templates yet — just the runner that picks up due events 
and marks them executed.

Implementation:

1. Create src/lib/cadence/CadenceEventRunner.ts:
   - fetchDueEvents(): returns CadenceEvents where scheduledFor <= now() 
     AND executedAt IS NULL AND skipped = false
   - executeEvent(event): dispatches to event handler based on eventType
   - For now, handlers just log and mark executedAt (we'll wire actual 
     email sends in Phase 2)

2. Create src/lib/cadence/CadenceEventCreator.ts:
   - createEventsForState(orderId, newState): creates appropriate 
     CadenceEvents based on transition
   - For QUOTE_SENT: schedule QUOTE_NUDGE_24H, QUOTE_CHECKIN_T72, 
     QUOTE_CLOSEDOWN_T24, QUOTE_LOST_MARK (with conditional logic for 
     pickup proximity)
   - For QUOTE_ACKNOWLEDGED: schedule ACK_QUESTIONS_PROMPT_24H, 
     ACK_SWEETEN_T72, ACK_CLOSEDOWN_T24
   - For BOOKED: schedule full booked cadence (all 11 booked event types)
   - For LOST: schedule LOST_REENGAGEMENT_2W (if reason != EXPLICIT_REJECTION), 
     LOST_SOFT_CHECKIN_90D
   - All timing keyed to pickup/return dates in the job's time zone 
     (default America/Los_Angeles)

3. Create src/lib/cadence/CadenceStateMachine.ts:
   - transitionState(orderId, newState, context?): updates Order.cadenceState 
     and triggers CadenceEventCreator
   - Handles pause/resume logic
   - When pickup date changes: delete all unexecuted future events for the 
     order and regenerate via createEventsForState

4. Create src/app/api/cron/cadence/route.ts:
   - GET handler (Vercel Cron uses GET)
   - Verify cron secret in Authorization header (CRON_SECRET env var)
   - Calls CadenceEventRunner.fetchDueEvents() then executeEvent() for each
   - Returns summary of events processed

5. Create vercel.json or update existing:
   {
     "crons": [
       { "path": "/api/cron/cadence", "schedule": "*/15 * * * *" }
     ]
   }

6. Add CRON_SECRET to .env.local and Vercel env (generate random 32 char string)

7. Build admin debug endpoint at /api/admin/cadence/preview/[orderId]:
   - Returns all scheduled CadenceEvents for an order (visualization aid)
   - Auth-gated to Wes/Dani

Test plan:
- Manually transition a test Order from QUOTE_DRAFT to QUOTE_SENT via 
  Prisma Studio
- Verify CadenceEvents are created with correct scheduledFor times
- Manually run the cron endpoint (curl with auth header)
- Verify due events get marked executedAt
- Test pickup date change: update pickupDate, verify old events deleted 
  and new ones created with updated timing
- Verify CRON_SECRET prevents unauthorized cron access

Run npx tsc --noEmit before commit.

Commit message: feat(crh): cadence cron infrastructure with state machine 
and event runner
```

## Commit 1.3 — Email template engine

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 10 "Email Template 
Library" for full context (all 20+ email templates).

Task: Build the email template rendering system that converts CadenceEvent 
+ Order data into actual emails sent via Resend.

Implementation:

1. Install Handlebars:
   npm install handlebars
   npm install --save-dev @types/handlebars

2. Create src/lib/email/templates/ directory with one .hbs file per template:
   - quote-nudge-24h.hbs
   - quote-checkin-t72.hbs
   - quote-closedown-t24.hbs
   - ack-questions-prompt-24h.hbs
   - ack-sweeten-t72.hbs
   - ack-closedown-t24.hbs
   - booking-welcome.hbs
   - coi-received-ack.hbs
   - pre-pickup-details-t48.hbs
   - final-confirm-t24.hbs
   - pickup-day-am.hbs
   - return-reminder-t24.hbs
   - return-acknowledgment.hbs
   - wrap-thanks-t24.hbs
   - invoice-delivery.hbs
   - payment-reminder-t14.hbs
   - repeat-business-t30.hbs
   - lost-reengagement-2w.hbs
   - annual-expiry-30d.hbs
   - portal-sunset-reminder-23m.hbs
   - add-contact-authorization.hbs

   Copy the exact body and subject from brief Section 10 into each template.

3. Create src/lib/email/templateConfig.ts:
   - Map each CadenceEventType to:
     - template file
     - "from" address (rep email or ana@sirreel.com for invoices)
     - subject template

4. Create src/lib/email/TemplateRenderer.ts:
   - renderTemplate(eventType, order, context): returns { subject, html, 
     from, to, replyTo }
   - Pulls variables from Order/Company/Contact/User (rep) records
   - Variable list per brief Section 10

5. Create src/lib/email/EmailSender.ts:
   - sendCadenceEmail(event, order): uses TemplateRenderer + Resend SDK
   - Returns sent EmailMessage record (linked back to event.emailId)
   - Includes attachments where relevant (e.g., quote PDF on QUOTE_NUDGE_24H, 
     invoice PDF on INVOICE_DELIVERY)
   - Sets reply-to to the rep's email so client replies hit the rep's inbox

6. Wire EmailSender into CadenceEventRunner.executeEvent():
   - For each due event, call EmailSender.sendCadenceEmail
   - On success, set executedAt and emailId
   - On failure, log error but don't mark executed (will retry next cron run)

7. Add safety checks in EmailSender:
   - If Order.cancelled or Order.cadenceState === CANCELLED → skip
   - If Order.cadenceManualOverride === true → skip
   - If Order.cadencePausedUntil > now() → skip
   - Log skip reason in CadenceEvent.skipReason

8. Build admin preview endpoint at /api/admin/cadence/preview-email/
   [eventType]?orderId=[id]:
   - Returns rendered HTML preview without sending
   - Helps verify template output before going live

Test plan:
- Use admin preview endpoint to verify each template renders correctly with 
  real Order data
- Test variable interpolation (firstName, jobName, etc.)
- Send a single test cadence email manually (set scheduledFor to past, 
  trigger cron)
- Verify reply-to is set to rep's email
- Verify safety checks: set cadenceManualOverride and verify email skipped

Run npx tsc --noEmit before commit.

Commit message: feat(crh): email template engine with all locked cadence 
templates
```

---

# Phase 2 — Unbooked Cadence

The most immediate operational value. Three commits. ~2-3 hours.

## Commit 2.1 — AI reply classifier

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 4 "AI Reply 
Classifier" for full context.

Task: Extend the existing AI email classifier with reply classification 
for unbooked quote responses.

Implementation:

1. Locate existing AI email classifier code (likely in src/lib/email/ or 
   src/lib/ai/). Identify where inbound emails are classified.

2. Add new classification step that runs on inbound EmailMessages where:
   - The thread has an associated Order
   - The Order.cadenceState is QUOTE_SENT or QUOTE_ACKNOWLEDGED

3. Create src/lib/ai/replyClassifier.ts:
   - classifyReply(emailMessage, order): returns { classification, 
     confidence, reasoning }
   - Uses the prompt structure from brief Section 4
   - Calls Claude API (or whichever LLM you're using) with the prompt
   - Parses JSON response, validates structure

4. Wire into the existing email ingestion pipeline:
   - When a new inbound email is processed and matches the trigger criteria, 
     call classifyReply
   - Store classification + confidence on EmailMessage record
   - Trigger CadenceStateMachine transition based on classification:
     - PURE_ACKNOWLEDGMENT (confidence >= 0.85) → QUOTE_ACKNOWLEDGED
     - ACTIVE_DISCUSSION → QUOTE_DISCUSSING (cadence pauses)
     - BOOKING_SIGNAL → notify rep urgently via Slack, no auto state change
     - EXPLICIT_REJECTION (confidence >= 0.85) → LOST with reason 
       EXPLICIT_REJECTION
     - UNCLEAR or confidence < 0.75 → QUOTE_DISCUSSING (default safe)

5. Confidence handling rules (critical):
   - >= 0.85: auto-apply classification
   - 0.75-0.85: apply classification but create review flag for rep
   - < 0.75: default to ACTIVE_DISCUSSION, no state transition without rep 
     review

6. Build rep notification system:
   - For BOOKING_SIGNAL: Slack DM to assigned rep with link to order
   - For EXPLICIT_REJECTION: Slack DM with link, no follow-up suggested
   - For low confidence: in-app notification on pipeline dashboard

7. Backfill existing emails:
   - Create scripts/backfill-reply-classifications.ts
   - Iterates through recent inbound EmailMessages on Orders in unbooked 
     states
   - Runs classifyReply for each
   - Stores result (but does NOT trigger state transitions for backfill — 
     just classification storage)

Test plan:
- Hand-label 20 recent client reply emails as PURE_ACKNOWLEDGMENT / 
  DISCUSSING / BOOKING / REJECTION
- Run classifier on those, verify agreement rate >= 85%
- Test confidence threshold: a clear "thanks!" reply should hit confidence 
  >= 0.9
- Test ambiguous: a reply that's mostly thanks but mentions one question 
  should be DISCUSSING
- Verify state transitions fire correctly based on classification
- Verify Slack notifications send for BOOKING_SIGNAL

Run npx tsc --noEmit before commit.

Commit message: feat(crh): AI reply classifier with confidence-based state 
transitions
```

## Commit 2.2 — SILENT cadence end-to-end

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 3 "Email Cadence 
System" — SILENT cadence flow specifically.

Task: Wire the full SILENT cadence end-to-end. Quote sent → automated 
follow-ups → LOST if no response.

Implementation:

1. Quote send trigger:
   - Locate where quote PDFs are currently sent to clients (existing 
     functionality)
   - After successful send, call CadenceStateMachine.transitionState(
     orderId, 'QUOTE_SENT')
   - Verify CadenceEvents are created for QUOTE_NUDGE_24H, QUOTE_CHECKIN_T72, 
     QUOTE_CLOSEDOWN_T24, QUOTE_LOST_MARK

2. QUOTE_NUDGE_24H conditional logic:
   - Only scheduled if pickup date is more than 48 hours after quote send 
     time
   - If pickup is closer than 48h, this event is created with skipped=true 
     and skipReason='Short lead time'
   - Or alternatively, not created at all (cleaner)

3. Short-lead handling (per brief edge cases):
   - If pickup is within 72h of quote send: skip QUOTE_NUDGE_24H AND 
     QUOTE_CHECKIN_T72
   - Single combined pickup-day-morning message instead
   - Then LOST at pickup day if no response

4. Cadence pause on reply:
   - When an inbound EmailMessage arrives on the thread:
     - If AI classifier returns PURE_ACKNOWLEDGMENT → transition to 
       QUOTE_ACKNOWLEDGED (cancels SILENT events, creates ACK events)
     - If ACTIVE_DISCUSSION → transition to QUOTE_DISCUSSING (pauses all 
       future events)
     - If EXPLICIT_REJECTION → transition to LOST immediately

5. Manual override controls (rep-side UI):
   - On the Order detail page, add a "Cadence" panel:
     - Current state display (QUOTE_SENT / QUOTE_ACKNOWLEDGED / etc.)
     - List of upcoming scheduled events with timestamps
     - "Pause cadence" button (sets cadencePausedUntil to 7 days from now)
     - "Resume cadence" button
     - "Manual override" toggle (sets cadenceManualOverride = true)
     - "Mark as LOST" button (with reason dropdown)

6. LOST transition automation:
   - QUOTE_LOST_MARK event handler: if state is still QUOTE_SENT on pickup 
     day, transition to LOST with reason NO_RESPONSE

7. Test with a real synthetic scenario:
   - Create a test Order with pickup date 7 days from now
   - Transition to QUOTE_SENT
   - Manually advance scheduledFor on the +24h nudge to "now"
   - Trigger cron
   - Verify QUOTE_NUDGE_24H email sends
   - Repeat for T-72 and T-24 events
   - Verify LOST state set on pickup day

Test plan:
- Full SILENT flow tested end-to-end
- QUOTE_NUDGE_24H skipped for short-lead bookings
- Cadence pauses when client replies
- Manual override works
- LOST transition fires correctly with NO_RESPONSE reason

Run npx tsc --noEmit before commit.

Commit message: feat(crh): SILENT cadence end-to-end with short-lead 
handling and rep override controls
```

## Commit 2.3 — ACKNOWLEDGED cadence

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 3 "Email Cadence 
System" — ACKNOWLEDGED cadence flow specifically.

Task: Wire the ACKNOWLEDGED sub-state cadence. Client acknowledged the 
quote but didn't book yet.

Implementation:

1. State transition to QUOTE_ACKNOWLEDGED:
   - Triggered when AI classifier returns PURE_ACKNOWLEDGMENT on an inbound 
     reply to a QUOTE_SENT order
   - Cancels any unexecuted QUOTE_NUDGE_24H, QUOTE_CHECKIN_T72, 
     QUOTE_CLOSEDOWN_T24 events
   - Creates new events: ACK_QUESTIONS_PROMPT_24H (if pickup >48h), 
     ACK_SWEETEN_T72, ACK_CLOSEDOWN_T24

2. ACK_QUESTIONS_PROMPT_24H conditional logic:
   - Scheduled for 24h after the acknowledgment (not 24h after original 
     quote send)
   - Only if pickup is still >48h away at that scheduled time

3. ACK_SWEETEN_T72 / ACK_CLOSEDOWN_T24:
   - Keyed to pickup date (not acknowledgment timestamp)

4. Subsequent state transitions from QUOTE_ACKNOWLEDGED:
   - If next inbound reply is ACTIVE_DISCUSSION → transition to 
     QUOTE_DISCUSSING (cancel ACK events)
   - If BOOKING_SIGNAL → notify rep, no auto state change
   - If EXPLICIT_REJECTION → LOST with that reason
   - If pickup day passes with no booking → LOST with reason 
     ACKNOWLEDGED_NO_BOOK

5. UI updates on Order detail page:
   - Cadence panel shows ACKNOWLEDGED state when active
   - Shows the trigger email (link to the EmailMessage that caused 
     transition)
   - Reps can manually transition back to QUOTE_SENT if AI mis-classified 
     (rare edge case)

Test plan:
- Send test quote, simulate client reply with "Thanks, will look"
- Verify AI classifies as PURE_ACKNOWLEDGMENT
- Verify state transitions to QUOTE_ACKNOWLEDGED
- Verify ACK cadence events created with correct timing
- Verify SILENT events cancelled
- Trigger ACK_QUESTIONS_PROMPT_24H manually, verify email sends with correct 
  template
- Simulate eventual no-booking, verify LOST with reason ACKNOWLEDGED_NO_BOOK

Run npx tsc --noEmit before commit.

Commit message: feat(crh): ACKNOWLEDGED cadence with sub-state transitions
```

---

# Phase 3 — Job Page (Client-Facing Portal)

Visible TSX artifact. Five commits. ~6-8 hours. This is the longest phase.

## Commit 3.1 — Portal slug + magic link infrastructure

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 5 "Job Page" and 
Section 9 "Portal Access Lifecycle".

Task: Set up portal infrastructure — slug generation, magic link per 
contact, session management.

Implementation:

1. Portal slug generation:
   - On Order creation (or on first quote send if portalSlug is null), 
     generate a 12-character random alphanumeric portalSlug
   - Ensure uniqueness with retry on collision
   - Set Order.portalCreatedAt

2. Magic link generation per Contact:
   - When a Contact is associated with a Job (either via job creation or 
     via the multi-contact flow in Commit 3.5), create a PortalAccess record
   - Generate magicLinkToken (32 char random)
   - Set magicLinkExpiresAt to 7 days from creation
   - PortalAccess.contactId links to Contact

3. Portal URL routes:
   - /portal/[portalSlug] — base portal page (requires session)
   - /portal/[portalSlug]/auth?token=[magicLinkToken] — magic link 
     validation endpoint

4. Magic link validation flow:
   - User clicks link in email → arrives at auth endpoint
   - Validate token matches a PortalAccess record, magicLinkExpiresAt > now, 
     revokedAt is null
   - Match portalSlug to the order via PortalAccess.orderId
   - Verify slug match (defense in depth — token + slug must align)
   - On success: set session cookie (HttpOnly, Secure, SameSite=Lax, 30 day 
     expiry), redirect to /portal/[portalSlug]
   - Increment PortalAccess.accessCount, set lastAccessedAt
   - On failure: render generic "Link expired or invalid" page with rep 
     contact info

5. Session validation:
   - Session cookie contains signed JWT with: contactId, orderId, expiresAt
   - Middleware on /portal/* routes validates session
   - If expired/invalid: redirect to magic-link-required page (asks for 
     email to send fresh link)

6. Fresh magic link request:
   - On /portal/[portalSlug]/request-link?email=[email]
   - Validate email exists as a Contact on the order
   - Generate new magic link, send via Resend
   - Generic success message regardless of email validity (prevent email 
     enumeration)

7. Optional password setup (deferred for now):
   - Add to PortalAccess.passwordHash later in commit 3.2 or 3.3
   - For now, magic link is the only auth method

8. Internal SirReel staff access:
   - /portal/[portalSlug] accessible to authenticated SirReel users 
     (User.email matches @sirreel.com) regardless of session/magic link
   - Allows ops/sales to view what client sees

9. Auto-create PortalAccess on quote send:
   - When QUOTE_SENT state transition happens, ensure all current Contacts 
     have PortalAccess records
   - Include the magic link URL in the quote email (template should already 
     reference {{portalLink}})

Test plan:
- Create a test Order with 2 Contacts
- Send quote
- Verify 2 PortalAccess records created with unique tokens
- Click magic link in test email
- Verify session cookie set, redirected to portal
- Verify session persists for 30 days
- Test expired token: returns to magic-link-required page
- Test fresh link request flow
- Test internal staff access (logged in as Wes/Dani user)

Run npx tsc --noEmit before commit.

Commit message: feat(crh): portal slug, magic links per contact, and 
session management
```

## Commit 3.2 — Portal UI base layout

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 5 "Job Page" — 
the page sections list.

Task: Build the Job Page UI shell — header, status bar, schedule, equipment 
list, contacts. NOT paperwork yet (that's Commit 3.3) and NOT DOT packet 
(Commit 3.4).

Design quality bar: Match Stripe Checkout / Linear onboarding. This page 
represents The SirReel Experience and clients will form lasting impressions 
of SirReel from this single page. Visual polish matters.

Implementation:

1. Page structure at /portal/[portalSlug]:
   
   Header section:
   - Client company name (large)
   - Job name (subtitle)
   - Status badge (current cadence state with friendly label: "Quote Sent" 
     / "Confirmed" / "Pickup in 2 days" / "Active rental" / etc.)
   - Pickup countdown if pre-pickup ("Pickup in 3 days, 4 hours")
   - Rep contact card: photo (if User has avatar), name, role, phone 
     (clickable), email (clickable)
   - After-hours line surfaced prominently

   Visual progress bar:
   - Horizontal stepper: Quote → Booked → Pickup → Return → Wrapped
   - Current step highlighted
   - Past steps shown as complete with checkmark
   - Future steps muted

   Quick actions panel (varies by state):
   - State QUOTE_SENT and unsigned agreement: "Review & Sign Agreement" 
     primary CTA
   - State BOOKED and no COI: "Upload your COI" primary CTA
   - State INVOICED with unpaid invoice: "Pay Invoice" primary CTA
   - Otherwise: friendly state-appropriate message

   Schedule section:
   - Pickup: date, time, location
   - Return: date, time, location
   - "Add to calendar" button (generates .ics download)

   Equipment list section:
   - Table of all assigned items
   - Columns: Item, Quantity, Daily Rate (no internal cost data)
   - Subtotal at bottom

   Your team section:
   - List of Contacts with portal access on this job
   - Each shows name, role, email
   - For client view: just informational
   - For rep view: includes "Manage access" button (will wire in Commit 3.5)

   SirReel team section:
   - Sales rep card (same as header)
   - Ops contact (Dani or Julian) with phone
   - After-hours emergency line

2. Visual design specifications:
   - Use the SirReel brand palette (verify with Wes if needed — likely 
     navy/black with accent color)
   - Typography: clean, readable, mobile-first (clients view on phones)
   - Generous whitespace
   - Status badges with semantic colors (green = good, yellow = action 
     needed, red = urgent)
   - All buttons have hover/active states
   - Loading states for any async content
   - Empty states are friendly, not error-looking

3. Mobile responsiveness:
   - Mobile-first design (~70% of clients view on phones)
   - All interactions thumb-reachable
   - Cards stack vertically on mobile
   - Typography scales appropriately

4. Activity feed (collapsed by default):
   - Last 10 events on the job: signatures, uploads, status changes
   - Each event timestamped with friendly relative time ("2 hours ago")
   - Filter: client-visible events only (not internal ops events)

5. Internal staff toolbar (only visible to SirReel users):
   - Bar at top: "Viewing as internal staff — client view"
   - Quick links to Order detail page, Cadence panel, raw data

6. Error states:
   - Order not found: friendly 404 with link to contact rep
   - Session expired: magic link request flow

Test plan:
- View portal as a client (via magic link)
- Verify all sections render with real data
- Test responsive behavior on mobile viewport
- Test status changes update header and progress bar
- Test internal staff view shows the additional toolbar
- Verify design quality matches Stripe Checkout level of polish

Run npx tsc --noEmit before commit.

Commit message: feat(crh): Job Page base UI with header, status, schedule, 
equipment, contacts
```

## Commit 3.3 — Paperwork section

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 5 "Job Page" — 
paperwork section specifically. Also reference yesterday's paperwork portal 
signing feature spec.

Task: Build the paperwork section of the Job Page. Two subsections — 
"Your paperwork" (client provides) and "SirReel paperwork" (we provide). 
DOT packet comes in Commit 3.4.

Implementation:

1. Paperwork section structure:

   Your paperwork (client provides):
   - Rental Agreement
     - Status badge: Pending / Sent / Reviewing / Signed
     - If signed: download link + signed date + signer info
     - If pending/sent: "Sign Agreement" CTA (links to yesterday's signing flow)
     - If reviewing (redline uploaded): "Under review by our team" message
   - Certificate of Insurance
     - Status badge: Pending / Received / Approved / Rejected
     - If pending: drag-drop upload zone
     - If received: download link + received date + "Under review" message
     - If approved: download link + approved date + green check
     - If rejected: rejection reason + "Upload revised COI" CTA
   - Custom docs (when applicable — varies per job)
     - Listed dynamically based on Job.requiredDocuments field (add this 
       field to Job model if not present)

   SirReel paperwork (we provide):
   - Quote PDF
     - Download link + sent date
     - "Viewed" indicator if client opened it
   - Order PDF (when generated)
     - Download link + generated date
   - Invoice PDF (when generated)
     - Download link + amount + payment status
     - "Pay Invoice" CTA if unpaid (link to payment portal — Stripe/ACH 
       integration TBD)

2. COI upload flow:
   - Drag-drop zone accepts PDF, max 10MB
   - On upload:
     - Validate file type and size
     - Store in Vercel Blob at `coi-uploads/{orderId}/{filename}.pdf`
     - Update Order.coiUrl, Order.coiReceivedAt
     - Send COI_RECEIVED_ACK email via cadence engine
     - Notify ops (Dani) via Slack DM for review
     - Optionally: run AI COI parser (if available) to extract coverage 
       amounts, expiration, additional insured language
   - UI shows upload progress, success state with check, error state with 
     retry

3. Agreement signing integration:
   - The "Sign Agreement" CTA links to the existing paperwork portal signing 
     flow from yesterday
   - Use the same URL pattern: /portal/[portalSlug]/agreement
   - On successful signing, status updates from Pending → Signed
   - Trigger BOOKING_WELCOME cadence email (state transition to BOOKED)

4. Activity logging:
   - Log every paperwork action to the activity feed:
     - "Sarah signed the rental agreement on May 15"
     - "Mike uploaded a COI on May 16"
     - "Lisa downloaded the invoice on May 17"

5. Negotiated agreement handling:
   - If Company.negotiatedTermsUrl exists, the rental agreement uses that 
     PDF instead of standard
   - Display banner on the rental agreement card: "Using your negotiated 
     agreement from [date]"
   - Otherwise use standard SirReel template

6. Annual MSA bypass:
   - If Company has active annualAgreementUrl AND annualAgreementApprovedAt:
     - Hide the "Sign Agreement" CTA
     - Show: "Covered by your annual agreement (signed [date])"
     - Provide download link to the annual agreement PDF
     - Skip Order.requiresAgreementSigning logic

7. Annual COI bypass:
   - If Company has active annualCoiUrl AND coverage meets job requirements:
     - Hide the COI upload zone
     - Show: "Covered by your annual COI (expires [date])"
     - Skip Order.requiresCoiUpload logic
   - If annual COI exists but coverage insufficient:
     - Show: "Your annual COI covers $1M GL but this job requires $2M. 
       Please provide a supplemental COI for this project."
     - Show upload zone for supplemental

Test plan:
- View portal as client with pending agreement → sign flow works
- View portal as client with annual MSA covering this job → no sign CTA, 
  banner shows
- Upload COI → file stored, status updates, COI_RECEIVED_ACK email sends, 
  Slack notifies Dani
- View portal as client with annual COI matching requirements → no upload 
  zone, banner shows
- View portal as client with annual COI but insufficient coverage → upload 
  zone for supplemental
- Verify activity feed captures all paperwork actions
- Negotiated agreement: verify correct PDF surfaces when 
  Company.negotiatedTermsUrl is set

Run npx tsc --noEmit before commit.

Commit message: feat(crh): paperwork section with COI upload, agreement 
integration, and annual/negotiated bypasses
```

## Commit 3.4 — DOT packet generation

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 7 "DOT Packet 
Surfacing".

CRITICAL: Section 13 Note #6 — SirReel's insurance card NEVER appears in 
any client-facing surface. This is a hard rule that protects SirReel's 
contractual insurance position (primary/secondary insurance structure).

Task: Build the DOT Packet section of the Job Page. Per-vehicle paperwork 
for clients operating SirReel vehicles.

Implementation:

1. DOT Packet section on Job Page:
   - Appears in "SirReel paperwork" subsection (added in Commit 3.3)
   - Title: "Vehicle Paperwork"
   - For each Vehicle assigned to the Order:
     - Vehicle make/model + ID/asset number
     - Registration download link + expiration date (red badge if <30 days)
     - License plate displayed
     - BIT Certificate download link + expiration date (red badge if <30 days)
     - "Download Vehicle DOT Packet" button — generates combined PDF

2. Combined DOT Packet PDF generation:
   - Use @react-pdf/renderer (already in stack from yesterday)
   - Bundles into single PDF: registration page + BIT certificate page
   - One PDF per vehicle (driver keeps in cab)
   - Filename: `dot-packet-{vehicleId}-{jobNumber}.pdf`
   - Header on each page: vehicle ID, plate, SirReel branding, "For use 
     during {{jobName}} rental period"

3. CRITICAL EXCLUSION:
   - In the Prisma select clauses for any portal-facing endpoint that 
     touches Vehicle, EXPLICITLY exclude:
     - insuranceCardUrl
     - insurancePolicyNumber
   - Use a typed function: `getClientVisibleVehicleData(vehicleId)` that 
     returns only DOT-relevant fields
   - Code review checkpoint: any new portal endpoint must use this helper, 
     never the raw Vehicle model

4. Internal fleet alerts (separate from client portal):
   - Cron job runs daily checking all Vehicles
   - For vehicles with registrationExpiresAt or bitCertificateExpiresAt 
     within 30 days:
     - Create internal alert in fleet dashboard (visible to Julian, Chris)
     - At 7 days: Slack DM to Julian + Chris

5. Block job creation with expired paperwork:
   - When assigning a vehicle to a job in the Order/Job creation flow:
     - If registrationExpiresAt < job.returnDate → block assignment with 
       clear error: "Vehicle #137 registration expires June 1. Job return 
       is June 15. Please renew or select another vehicle."
     - Same for bitCertificateExpiresAt
   - Block applies in the rep-facing job creation UI; no override possible 
     (compliance issue)

6. UI affordances:
   - Expiration badges color-coded:
     - Green: >60 days remaining
     - Yellow: 30-60 days
     - Orange: 7-30 days
     - Red: <7 days
     - Red with "EXPIRED" badge: past expiration
   - Tooltips explain what each document is

Test plan:
- View portal as client → see all assigned vehicles with their paperwork
- Download individual registration, BIT certificate
- Download combined DOT Packet PDF → verify both documents bundled
- Verify SirReel insurance card NEVER appears (check API response with 
  curl — should not contain insuranceCardUrl)
- Set a vehicle's registrationExpiresAt to 5 days from now → verify red 
  badge shown
- Try assigning expired-registration vehicle to a new job → verify block 
  with error
- Verify fleet alerts fire correctly (check Slack)

Run npx tsc --noEmit before commit.

Commit message: feat(crh): DOT packet generation with strict 
insurance-card exclusion and fleet alerts
```

## Commit 3.5 — Multi-contact access

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 5 "Job Page" — 
multi-contact access flow.

Task: Build the multi-contact access flow. New contacts detected on email 
threads can be added to portal access with authorization from existing 
contacts.

Implementation:

1. New contact detection:
   - Hook into existing email ingestion (Gmail integration)
   - When an inbound email arrives on a thread linked to an Order:
     - Extract all email addresses from To, CC, From
     - For each, check if a Contact exists for that email
     - If not, create a Contact record with email, parsed name, isNewContact 
       flag
     - Associate with the Order via Order.contacts
     - DO NOT auto-create PortalAccess yet — that requires rep authorization

2. Rep notification when new contact detected:
   - In-app notification on Order detail page: "New contact detected: Sarah 
     Chen <sarah@productionco.com>"
   - Rep sees three action options:
     - Add to job team (no portal access yet)
     - Send portal access invitation directly
     - Ask existing contact to authorize

3. "Ask existing contact" flow:
   - Rep clicks "Ask Lisa to authorize"
   - System sends ADD_CONTACT_AUTHORIZATION email to Lisa (template from 
     Section 10)
   - Email contains [Yes, give them access] and [No thanks] buttons
   - Buttons link to /portal/[portalSlug]/authorize-contact?contactId=X&
     approverId=Y&decision=approve|decline&token=Z

4. Authorization endpoint:
   - Validates token, matches PortalAccess of the approving contact
   - Records the decision in a new table or fields:
     - ContactAuthorization { id, orderId, requestingContactId, 
       approvingContactId, decision, decidedAt }
   - If approve:
     - Generate PortalAccess for the requesting contact (magic link)
     - Send portal access invitation email with magic link
     - Notify rep
   - If decline:
     - Log decision, notify rep
     - Do not create PortalAccess

5. Direct invite by rep:
   - "Send portal access invitation directly" creates PortalAccess + sends 
     magic link without requiring approval
   - Used when rep has direct authority/context

6. Portal access management UI (rep-side Order detail page):
   - Table of all contacts with their portal status:
     - Contact name, email
     - Status: Invited / Active / Revoked / Pending Authorization
     - Last accessed timestamp
     - Actions: Resend invite, Revoke, Regenerate link, Reactivate

7. Revoke access:
   - Sets PortalAccess.revokedAt and revokedBy
   - Invalidates session cookies (signed JWT validation now fails)
   - Optional: notification to revoked contact (rep discretion)

Test plan:
- Simulate new contact detection: receive a CC'd email on a thread
- Verify Contact created, rep sees notification
- Rep chooses "Ask Lisa to authorize"
- Lisa receives email, clicks "Yes"
- Verify Sarah gets PortalAccess + magic link
- Sarah clicks magic link, sees portal
- Test revoke flow: rep revokes Sarah's access, her session invalidates
- Test direct invite by rep: skips authorization

Run npx tsc --noEmit before commit.

Commit message: feat(crh): multi-contact portal access with authorization 
flow
```

---

# Phase 4 — Booked Cadence

Two commits. ~2 hours.

## Commit 4.1 — Full booked cadence wiring

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 3 "Email Cadence 
System" — booked cadence specifically.

Task: Wire all 11 booked cadence events end-to-end. Triggered on agreement 
signing, runs through invoice and repeat business outreach.

Implementation:

1. BOOKED state transition:
   - Triggered when SignedAgreement.status flips to SIGNED_BASELINE or 
     SIGNED_NEGOTIATED (from yesterday's paperwork portal work)
   - Calls CadenceStateMachine.transitionState(orderId, 'BOOKED')
   - Cancels all unbooked cadence events (QUOTE_*, ACK_*)
   - Creates all booked cadence events with appropriate timing

2. Booked cadence events (all keyed to pickup/return dates in job timezone):
   - BOOKING_WELCOME: immediately on state transition
   - COI_RECEIVED_ACK: triggered when COI uploaded (not time-based)
   - PRE_PICKUP_DETAILS_T48: pickup - 48 hours
   - FINAL_CONFIRM_T24: pickup - 24 hours
   - PICKUP_DAY_AM: pickup day at 8:00 AM local time
   - MID_RENTAL_CHECKIN: midpoint of rental, only if (returnDate - 
     pickupDate) >= 5 days AND optional flag is enabled
   - RETURN_REMINDER_T24: return - 24 hours
   - RETURN_ACKNOWLEDGMENT: triggered when equipment scanned back in (not 
     time-based)
   - WRAP_THANKS_T24: return + 24 hours
   - INVOICE_DELIVERY: triggered when invoice is generated (not time-based)
   - PAYMENT_REMINDER_T14: invoice + 14 days, only if invoice still unpaid
   - REPEAT_BUSINESS_T30: return + 30 days

3. Event-triggered (not time-based) events:
   - COI_RECEIVED_ACK: fires immediately on COI upload (Commit 3.3 already 
     hooks this)
   - RETURN_ACKNOWLEDGMENT: hook into the equipment return/scan-in flow 
     (existing — find and wire)
   - INVOICE_DELIVERY: hook into invoice generation (existing — find and 
     wire)

4. State transitions during booked cadence:
   - On pickup confirmed: BOOKED → PICKUP_CONFIRMED
   - On equipment picked up: PICKUP_CONFIRMED → IN_PROGRESS
   - On equipment returned: IN_PROGRESS → RETURNED
   - On invoice sent: RETURNED → INVOICED
   - On invoice paid: INVOICED → PAID
   - On all closeout complete: PAID → WRAPPED
   - WRAPPED triggers portal sunset countdown (Commit 7.1)

5. Conditional logic:
   - PAYMENT_REMINDER_T14 only sends if invoice.paidAt is null at scheduled time
   - MID_RENTAL_CHECKIN only created if rental duration >= 5 days
   - REPEAT_BUSINESS_T30 always sends (unless rep manually disables)

6. Rep controls:
   - In the Cadence panel on Order detail page:
     - Toggle MID_RENTAL_CHECKIN on/off per job
     - Toggle REPEAT_BUSINESS_T30 on/off per job
     - "Snooze cadence for 24h / 48h / until manually resumed"

7. Email "from" address selection:
   - Most cadence emails: from the rep's email (e.g., jose@sirreel.com)
   - INVOICE_DELIVERY and PAYMENT_REMINDER_T14: from ana@sirreel.com (per 
     brief)
   - Reply-to always set to enable client → rep direct communication

Test plan:
- Sign agreement on a test order → verify BOOKED transition, BOOKING_WELCOME 
  sends immediately
- Verify all 11 cadence events scheduled with correct timing
- Upload COI → COI_RECEIVED_ACK fires
- Manually advance clock (set scheduledFor to past) for each event, trigger 
  cron, verify each email sends
- Test invoice generation hook: INVOICE_DELIVERY fires from ana@
- Test payment scenario: pay invoice before T+14, verify PAYMENT_REMINDER_T14 
  is skipped
- Test rep toggles: disable REPEAT_BUSINESS_T30, verify it doesn't fire
- Test full happy path end-to-end

Run npx tsc --noEmit before commit.

Commit message: feat(crh): full booked cadence with 11 touchpoints end-to-end
```

## Commit 4.2 — Mid-rental check-in toggle

**Paste into Claude Code:**

```
Task: Build the optional mid-rental check-in for rentals >= 5 days.

Implementation:

1. Add to Order model:
   - midRentalCheckinEnabled (Boolean, default false)

2. Default behavior:
   - When a job's rental duration is >= 5 days and BOOKED state transition 
     fires:
     - System pre-checks midRentalCheckinEnabled but defaults to false
     - Slack DM to rep: "Big Production has a 7-day rental. Enable 
       mid-rental check-in?"
     - Rep can toggle on from notification or from Order detail page

3. When enabled:
   - MID_RENTAL_CHECKIN event scheduled at midpoint of rental
   - Email content: friendly "how's it going?" message
   - Email template (add to library):

   Subject: How's the shoot going for {{jobName}}?

   Hi {{firstName}},

   We're at the halfway point of your rental. Just checking in — is 
   everything working as expected? Any equipment issues or needs?

   Hit me back or call {{repPhone}} if anything's up.

   Best,
   {{repName}}

4. UI:
   - On Order detail page Cadence panel, show toggle: "Mid-rental check-in 
     (rental is 7 days)"
   - Visible only if rental duration >= 5 days

Test plan:
- Create 7-day rental, sign → Slack notification fires
- Enable toggle → MID_RENTAL_CHECKIN event scheduled
- Trigger event, verify email sends
- Create 3-day rental → no toggle visible

Run npx tsc --noEmit before commit.

Commit message: feat(crh): mid-rental check-in toggle for rentals 5+ days
```

---

# Phase 5 — Company-Level Paperwork

Three commits. ~3-4 hours.

## Commit 5.1 — Annual MSA + COI management

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 6 "Company-Level 
Paperwork Management".

Task: Build the upload, AI review, and approval workflow for annual MSA 
and COI documents at the Company level.

Implementation:

1. Company detail page — new "Paperwork" section:
   - Subsection: Annual Agreement (MSA)
     - If exists: show document, effective/expiration dates, signed by, 
       approved by, "View" and "Replace" buttons
     - If not exists: "Upload annual MSA" button
   - Subsection: Annual COI
     - If exists: show document, effective/expiration dates, coverage 
       amounts, approved by, "View" and "Replace" buttons
     - If not exists: "Upload annual COI" button

2. Upload flow:
   - Drag-drop accepting PDF, max 10MB
   - On upload:
     - For Annual MSA: trigger AI Contract Review using the existing 
       Contract Review feature (extends yesterday's playbook flow)
     - For Annual COI: trigger AI COI parser (if not present, just store 
       and require manual review)
     - Set status to "Pending approval"
     - Notify Wes and Dani via Slack: "Annual MSA awaiting approval — 
       {{companyName}}"

3. Approval workflow:
   - Wes/Dani receives notification with link to Company detail page
   - Reviews AI output (Contract Review summary) + raw document
   - Decision options: Approve / Counter-negotiate / Reject
   - On Approve:
     - Set annualAgreementApprovedBy = user.email, 
       annualAgreementApprovedAt = now
     - Mark as active
     - Job creation flow now uses this annual paperwork
   - On Counter:
     - Triggers existing contract negotiation flow (yesterday's playbook 
       and ContractReview)
     - Generates counter-proposal PDF, sends to client
   - On Reject:
     - Clears the upload, requires re-submission

4. Validation rules:
   - Annual MSA expiration > effective date
   - Annual COI must have coverage amounts entered (extracted by AI or 
     manually entered)
   - Annual COI expiration > effective date

5. Job creation integration:
   - When rep creates a new Order for a Company with active annual paperwork:
     - Show banners in the Job creation UI:
       - "📋 Annual MSA active, expires {{date}}. Job will use this 
         agreement."
       - "📋 Annual COI active, expires {{date}}. Coverage: $1M GL. Verify 
         this meets job requirements."
     - If coverage insufficient: warning banner asking for supplemental
     - If expired or expiring within 7 days: blocker with renewal CTA

6. Build Job.useAnnualAgreement and Job.useAnnualCoi flags:
   - Default: auto-determined from Company paperwork status
   - Override: rep can manually require per-job paperwork even if annual 
     exists (rare, for special job requirements)

Test plan:
- Upload annual MSA → AI review runs, Wes notified
- Wes approves → active, available for jobs
- Create new job for that company → banner shows annual MSA used
- Verify job paperwork section skips rental agreement signing (Commit 3.3 
  already handles this)
- Upload annual COI with $1M GL → approve
- Create job requiring $2M GL → warning banner asking for supplemental

Run npx tsc --noEmit before commit.

Commit message: feat(crh): annual MSA and COI management with AI review 
and Wes/Dani approval
```

## Commit 5.2 — Negotiated terms management

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 6 — negotiated 
terms specifically. References yesterday's PM/Nick negotiation.

Task: Build the activation flow for company-specific negotiated terms. 
After a successful one-time negotiation, those terms become the baseline 
for all future jobs with that company.

Implementation:

1. Company detail page — "Negotiated Terms" subsection:
   - If exists: show document, summary, negotiated date, approved by, 
     review due date, "View" and "Replace" buttons
   - If not exists: "Activate negotiated terms" button

2. Activation flow:
   - Rep or Wes navigates to Company → Paperwork → Negotiated Terms
   - Clicks "Activate negotiated terms"
   - Modal opens with:
     - Upload negotiated agreement PDF (max 10MB)
     - Summary text area (mandatory): plain-English description of what 
       differs from standard
       - Example placeholder: "Cl. 23 narrowed to enjoining Recordings 
         only. Cl. 21 includes 12hr non-payment cure window. Cl. 14 
         bilateral consequential damages waiver."
     - Negotiation date (date picker, defaults to today)
     - Approved by (auto-fills with current user, must be Wes or Dani)
     - Review due date (auto-set to 12 months from negotiation date, 
       editable)
   - On submit: marks negotiatedTermsActiveAsOf = now

3. Effect on future jobs:
   - When creating a new Order for Company with active negotiated terms:
     - Job creation UI shows banner: "📋 This client has negotiated terms 
       from {{negotiatedAt}}. Quote uses negotiated agreement: 
       {{summary}}"
     - Rental agreement on the job uses negotiatedTermsUrl PDF
     - Quote generation references negotiated terms in the email body

4. AI Contract Review integration:
   - When a client redlines the agreement on a future job:
     - AI Contract Review uses negotiatedTermsUrl as the baseline 
       (not standard SirReel template)
     - Playbook still applies (hard limits, Do Not Accept items)
     - Comparison shows redline against the negotiated baseline
     - Surface to operator: "Client has negotiated terms. Redline compared 
       against your negotiated baseline."

5. 12-month review reminder:
   - Cron job daily checks all Companies with 
     negotiatedTermsReviewDueDate <= today
   - Creates task in Wes's dashboard: "Negotiated terms with PM Productions 
     due for review. Industry-standard language may have shifted. Review 
     and re-approve or update."
   - Task is dismissible (sets review due date to +12 months) or actionable 
     (opens flow to update terms)

6. Display in Quote email and Job Page:
   - Quote email: subtle note "Using your negotiated agreement"
   - Job Page paperwork section: agreement card shows "Your negotiated 
     agreement from {{date}}"

Test plan:
- Activate negotiated terms for PM Productions (use yesterday's v3 PDF as 
  test data)
- Create new job for PM Productions → banner shows in job creation UI
- View job's portal → rental agreement uses negotiated terms PDF
- Simulate client redline → AI Contract Review uses negotiated baseline
- Test review reminder: backdate negotiatedTermsReviewDueDate to today, 
  verify task appears for Wes

Run npx tsc --noEmit before commit.

Commit message: feat(crh): negotiated terms management with annual review 
reminder
```

## Commit 5.3 — Expiration monitoring + auto-renewal emails

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 6 — expiration 
monitoring widget.

Task: Build the "Expiring Annual Paperwork" widget and auto-renewal email 
cadence.

Implementation:

1. Daily cron job at /api/cron/check-annual-expirations (schedule: 8:00 AM 
   daily):
   - Scans all Companies with non-null annualAgreementExpiresAt or 
     annualCoiExpiresAt
   - For each expiring item, create ANNUAL_EXPIRY_60D / 30D / 7D 
     CadenceEvents (one-time, with idempotency check to avoid duplicates)

2. Email sends:
   - ANNUAL_EXPIRY_30D: auto-send renewal email (template from Section 10)
   - ANNUAL_EXPIRY_7D: Slack DM to rep (no email yet)
   - ANNUAL_EXPIRY_60D: notification only, no client outreach yet

3. Sales dashboard widget — "Expiring Annual Paperwork":
   - Sections:
     - 🔴 EXPIRED (immediate attention)
     - 🟠 EXPIRING IN 7 DAYS
     - 🟡 EXPIRING IN 30 DAYS
     - ⚪ EXPIRING IN 60 DAYS
   - For each entry: company name, paperwork type, expiration date, action 
     buttons
   - Action buttons:
     - "Send renewal email" (if not already sent)
     - "Contact client" (opens compose with client contacts pre-filled)
     - "Mark as renewed" (after they upload new paperwork)
   - Click on company name → opens Company detail page

4. Expired paperwork affects job creation:
   - If Company has expired annual paperwork and rep tries to create job:
     - Warning: "Annual MSA/COI expired on {{date}}. New job requires 
       per-job paperwork OR renewed annual."
     - Block the auto-use of annual paperwork, force per-job paperwork 
       collection
     - Or rep can click "Renew now" to start the renewal flow with the 
       client

5. Renewal flow (when client uploads renewed paperwork):
   - Goes through the same annual upload + AI review + Wes/Dani approval 
     flow from Commit 5.1
   - On approval: updates effectiveDate and expirationDate, replaces 
     document URL
   - Cancels remaining ANNUAL_EXPIRY_* events for the prior expiration date

Test plan:
- Backdate a Company's annualCoiExpiresAt to 25 days from now
- Run the cron job manually
- Verify ANNUAL_EXPIRY_30D event created
- Trigger the event execution → renewal email sends to all company contacts
- Verify widget shows the entry in 🟡 section
- Renew the COI → verify event cancelled, widget updates
- Test EXPIRED state: backdate to past, verify red state on widget

Run npx tsc --noEmit before commit.

Commit message: feat(crh): annual paperwork expiration monitoring widget 
and auto-renewal emails
```

---

# Phase 6 — Lost Quote Tracking + Re-engagement

Three commits. ~2 hours.

## Commit 6.1 — LOST state transitions and reasons

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 8 "Lost Quote 
Tracking & Re-engagement".

Task: Wire all paths to LOST state with correct lostReason capture.

Implementation:

1. Auto-LOST transitions:
   - QUOTE_LOST_MARK cadence event handler (already exists from Phase 2): 
     if Order.cadenceState is still QUOTE_SENT or QUOTE_ACKNOWLEDGED on 
     pickup day, transition to LOST
   - Set lostReason based on state at time of transition:
     - From QUOTE_SENT → NO_RESPONSE
     - From QUOTE_ACKNOWLEDGED → ACKNOWLEDGED_NO_BOOK
   - Set pickupDateAtLoss = current Order.pickupDate (snapshot)

2. AI-classified EXPLICIT_REJECTION:
   - When AI classifier returns EXPLICIT_REJECTION with confidence >= 0.85:
     - Immediately transition to LOST
     - Set lostReason = EXPLICIT_REJECTION
     - Slack DM to rep: "{{client}} explicitly declined the quote for 
       {{jobName}}. No follow-up scheduled."

3. Manual LOST flow (rep-side):
   - In Order detail page Cadence panel, "Mark as LOST" button
   - Modal asks:
     - Reason (dropdown: NO_RESPONSE / ACKNOWLEDGED_NO_BOOK / 
       EXPLICIT_REJECTION / MANUAL_CLOSE)
     - Optional notes (text area)
   - On submit: transitions to LOST, captures reason

4. LOST state effects:
   - Cancels all unexecuted cadence events for the order
   - Order.cadenceState = LOST
   - Sets lostAt = now()
   - Creates re-engagement events (handled in Commit 6.2)

Test plan:
- Trigger QUOTE_LOST_MARK manually on QUOTE_SENT order → lostReason 
  NO_RESPONSE
- Same on QUOTE_ACKNOWLEDGED order → lostReason ACKNOWLEDGED_NO_BOOK
- Simulate client reply "going with another vendor" → AI classifies 
  EXPLICIT_REJECTION → LOST immediately
- Manual LOST flow tested

Run npx tsc --noEmit before commit.

Commit message: feat(crh): LOST state transitions with reason capture
```

## Commit 6.2 — Re-engagement cadence

**Paste into Claude Code:**

```
Task: Wire the post-LOST re-engagement cadence.

Implementation:

1. On LOST state transition, schedule re-engagement events:
   - LOST_REENGAGEMENT_2W: lostAt + 14 days (use 12 days for slight 
     variation if you want)
     - Skip if lostReason === EXPLICIT_REJECTION
   - LOST_SOFT_CHECKIN_90D: lostAt + 75 days
     - Any reason

2. LOST_REENGAGEMENT_2W email send:
   - Uses template from Section 10 ("Following up on {{jobName}}")
   - Sets reengagementSentAt on Order

3. Reply detection on re-engagement:
   - If client replies to re-engagement email:
     - Sets Order.reengagementResponded = true
     - AI classifies reply
     - If BOOKING_SIGNAL or ACTIVE_DISCUSSION: notify rep urgently 
       (potential reactivation)
     - If acknowledgment/declination: log but no further auto-actions

4. Rep controls:
   - On Order detail page (even in LOST state):
     - "Resend re-engagement now"
     - "Skip future re-engagement"

Test plan:
- Mark a test order as LOST with NO_RESPONSE reason
- Verify LOST_REENGAGEMENT_2W and LOST_SOFT_CHECKIN_90D events created
- Trigger LOST_REENGAGEMENT_2W manually → email sends
- Mark another order as LOST with EXPLICIT_REJECTION → verify 
  LOST_REENGAGEMENT_2W NOT created
- Simulate client reply to re-engagement → AI classifies, rep notified

Run npx tsc --noEmit before commit.

Commit message: feat(crh): re-engagement cadence for LOST quotes
```

## Commit 6.3 — Lost quote reporting dashboard

**Paste into Claude Code:**

```
Task: Build the LOST quote analytics dashboard.

Implementation:

1. New dashboard at /admin/reports/lost-quotes:
   - Accessible to Wes, Dani, and sales managers

2. Widgets:
   
   A. Loss rate by reason (last 90 days):
      - Pie/donut chart: NO_RESPONSE / ACKNOWLEDGED_NO_BOOK / 
        EXPLICIT_REJECTION / MANUAL_CLOSE
      - Total loss count
      - Total quote count for context
      - % of total quotes lost

   B. Loss rate by rep (last 90 days):
      - Bar chart: each rep, count of LOST orders
      - Color-coded by reason
      - Click rep → drill into their lost orders

   C. Time-from-quote-sent to LOST:
      - Average days
      - Distribution histogram
      - Helps Wes see whether short-lead or long-lead quotes are harder to 
        convert

   D. Re-engagement conversion:
      - Of LOST orders that received LOST_REENGAGEMENT_2W:
        - % that responded
        - % that converted to a new quote
        - % that converted to a booking

   E. Companies with multiple losses (relationship signal):
      - List of companies with 2+ LOST orders in last 12 months
      - Indicates potential relationship issues OR competitor preference

3. Filters:
   - Date range
   - Sales rep
   - Loss reason
   - Job size (revenue tier)

4. Export:
   - CSV download of all LOST orders matching filters

Test plan:
- Create several test LOST orders with varied reasons
- View dashboard → verify charts render correctly
- Test filters narrow data appropriately
- Test export

Run npx tsc --noEmit before commit.

Commit message: feat(crh): lost quote analytics dashboard
```

---

# Phase 7 — Portal Lifecycle

One commit. ~1-2 hours.

## Commit 7.1 — 2-year sunset for client access

**Paste into Claude Code:**

```
Read docs/specs/client-relationship-hub-brief.md Section 9 "Portal Access 
Lifecycle".

Task: Implement 2-year client access sunset with internal SirReel access 
retained indefinitely.

Implementation:

1. Set portalSunsetAt on WRAPPED state:
   - When Order.cadenceState transitions to WRAPPED:
     - Calculate portalSunsetAt = wrap date + 2 years
     - Save to Order.portalSunsetAt

2. Daily cron at /api/cron/portal-sunset (schedule: 3:00 AM):
   - Finds Orders where portalSunsetAt <= now AND any PortalAccess records 
     exist with revokedAt IS NULL
   - For each: revoke all PortalAccess records for client contacts (set 
     revokedAt = now, revokedBy = 'SYSTEM_SUNSET')
   - SirReel staff access not affected (they auth via User.email, not 
     PortalAccess)

3. 23-month notification:
   - Cron creates PORTAL_SUNSET_REMINDER_23M event when wrap_date + 23 
     months passes
   - Sends email to all still-active client contacts
   - Template from Section 10

4. Portal access validation:
   - Existing magic link / session validation logic already checks 
     revokedAt
   - After sunset, client magic links return "Link expired or invalid" 
     page
   - Friendly messaging: "Your portal access for this job ended on [date]. 
     For paperwork from this project, please contact your SirReel rep."

5. SirReel internal access (always works):
   - /portal/[portalSlug] is accessible to authenticated SirReel users 
     regardless of client revocation
   - UI shows "Internal staff view — Portal closed to client" banner
   - Allows historical lookup for audits, repeat business context, dispute 
     resolution

6. Annual archive option (future enhancement, stub now):
   - For portals 3+ years old, optionally archive into cold storage 
     (e.g., S3 Glacier)
   - Out of scope for this commit; just create the cron infrastructure to 
     support it later

Test plan:
- Create a test Order, transition to WRAPPED → verify portalSunsetAt set 
  to wrap + 2 years
- Backdate portalSunsetAt to yesterday, run cron → verify client 
  PortalAccess records revoked
- Test client magic link after sunset → returns expired page
- Test SirReel staff access → still works, shows internal banner
- Test 23-month reminder: backdate wrap date by 23 months, verify email 
  fires

Run npx tsc --noEmit before commit.

Commit message: feat(crh): 2-year portal sunset for clients with retained 
internal access
```

---

# After All Phases Ship

## End-to-end validation

Once Phase 7 commits, run a full real-world validation:

1. **Unbooked SILENT path**: Send a real quote to a test client (e.g., your 
   own email), don't reply, verify all three nudges fire on schedule, 
   verify LOST transition at pickup day

2. **Unbooked ACKNOWLEDGED path**: Reply with "thanks, will look", verify 
   classifier transitions to ACKNOWLEDGED, verify ACK cadence fires

3. **Booked path**: Sign agreement via portal, verify all 11 booked emails 
   fire on schedule for a 7-day rental

4. **Multi-contact portal**: Add new contact via email CC detection, run 
   authorization flow, verify new contact gets portal access

5. **Annual paperwork**: Upload an annual COI for a real client (PM 
   Productions), approve as Wes, create a new job, verify portal skips 
   COI upload

6. **Negotiated terms**: Activate PM's v3 agreement as negotiated terms, 
   create new job, verify the negotiated PDF is used and AI Contract 
   Review baseline switches

7. **Re-engagement**: Mark a quote LOST, wait 14 days (or backdate), verify 
   re-engagement email fires

8. **Portal sunset**: Wrap a test job, set portalSunsetAt to past, verify 
   client access revoked but internal access works

## Production rollout sequence

Once all phases verified:
- Soft launch with one client (your most forgiving one)
- Monitor cadence event logs for any false-positive sends
- Tune AI classifier confidence thresholds if needed
- Roll to broader client base over 2-3 weeks
- Train Jose and Oliver on the rep-side controls

---

# Reference Files in Repo (after pre-flight #1)

- `docs/specs/client-relationship-hub-brief.md` — the master spec
- `docs/specs/paperwork-portal-signing-feature-brief.md` — yesterday's portal work
- `docs/specs/paperwork-portal-signing-ux-spec.md` — yesterday's UX
- `contract-negotiation-playbook.md` (repo root) — read by AI Contract Review
- `docs/specs/canonical-baseline-corrections.md` — manual baseline updates

---

# Out of scope for these phases (deferred)

These were discussed but explicitly NOT in this build:

- "Request SirReel COI" workflow (manual gated request, future ticket)
- Damage/incident workflow during rentals (separate state machine)
- Payment integration beyond invoice link (Stripe/ACH setup)
- Annual archive of portals 3+ years old (cold storage)
- AI COI parser (if classifier doesn't exist already; manual review fallback)
- Advanced analytics beyond loss tracking (rep productivity, client lifetime 
  value, etc.)

---

*Launch document built: May 17, 2026. Estimated total build time: 25-35 
hours across multiple Claude Code sessions. Phase 1-2 first delivers most 
immediate value.*
