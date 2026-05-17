# Client Relationship Hub — Feature Brief

**Project:** SirReel HQ Platform
**Scope:** End-to-end client experience system covering unbooked quote cadence, booked job cadence, Job Page (multi-contact portal), Company-level paperwork management (annual MSA/COI, negotiated terms), DOT packet surfacing, lost quote tracking, and AI-assisted reply classification.

**Strategic frame:** This system is the technical implementation of **The SirReel Experience (TSX)** — the brand promise that working with SirReel feels effortless. Every feature should be evaluated against: *does this make the client's experience easier?*

**Builds on:** Paperwork portal signing feature spec (yesterday), contract negotiation playbook (yesterday), Gmail integration (existing), AI email classification (existing), magic link auth (existing).

---

## Section 1 — TSX Values & Feature Mapping

Use this as the design north star. Every feature below ties to one or more TSX values.

| TSX Value | System enhancement |
|-----------|-------------------|
| Great communication | Automated touchpoints with personal tone, never generic; rep direct contact surfaced everywhere |
| Quick quotes | AI-assisted quote creation (existing) |
| Smooth paperwork | Single-portal access to agreement, COI, invoices, DOT packet, all status-tracked |
| After-hours accessibility | On-call number in pre-pickup emails, in Job Page, in signature blocks |
| Parking ease | Specific parking instructions per job in pre-pickup email and Job Page |
| Quick invoicing | Invoice generated within 24-48 hours of return, auto-delivered |
| Institutional memory | Company-level negotiated terms remembered across jobs; never re-negotiate |

---

## Section 2 — Data Model Changes

### Order/Job model additions

```prisma
model Order {
  // ... existing fields ...
  
  // Cadence state
  cadenceState           CadenceState  @default(QUOTE_DRAFT)
  cadencePausedUntil     DateTime?
  cadenceManualOverride  Boolean       @default(false)
  
  // Lost quote tracking
  lostAt                 DateTime?
  lostReason             LostReason?
  pickupDateAtLoss       DateTime?
  
  // Re-engagement tracking
  reengagementSentAt     DateTime?
  reengagementResponded  Boolean       @default(false)
  
  // Portal access
  portalSlug             String        @unique  // for portal URL
  portalCreatedAt        DateTime      @default(now())
  portalSunsetAt         DateTime?     // 2yr after job wrap
  
  // Relations
  cadenceEvents          CadenceEvent[]
  portalAccesses         PortalAccess[]
}

enum CadenceState {
  QUOTE_DRAFT
  QUOTE_SENT          // initial state when quote sent
  QUOTE_ACKNOWLEDGED  // client replied with acknowledgment (no booking)
  QUOTE_DISCUSSING    // active back-and-forth, cadence paused
  BOOKED              // agreement signed, booked cadence starts
  PICKUP_CONFIRMED    // T-24h confirmed
  IN_PROGRESS         // rental active
  RETURNED            // equipment back
  INVOICED            // invoice sent
  PAID                // invoice paid
  WRAPPED             // fully closed
  LOST                // quote closed without booking
  CANCELLED           // booked but cancelled
}

enum LostReason {
  NO_RESPONSE              // never replied
  ACKNOWLEDGED_NO_BOOK     // replied but didn't book
  EXPLICIT_REJECTION       // chose another vendor
  MANUAL_CLOSE             // rep closed manually
}
```

### CadenceEvent model (new)

Tracks every automated and manual touchpoint for reporting and debugging.

```prisma
model CadenceEvent {
  id            String   @id @default(uuid())
  orderId       String
  order         Order    @relation(fields: [orderId], references: [id])
  eventType     CadenceEventType
  scheduledFor  DateTime
  executedAt    DateTime?
  skipped       Boolean  @default(false)
  skipReason    String?
  emailId       String?  // link to sent EmailMessage if applicable
  createdAt     DateTime @default(now())
  
  @@index([orderId])
  @@index([scheduledFor, executedAt])
}

enum CadenceEventType {
  // Unbooked cadence
  QUOTE_NUDGE_24H
  QUOTE_CHECKIN_T72
  QUOTE_CLOSEDOWN_T24
  QUOTE_LOST_MARK
  
  // Acknowledged-state cadence
  ACK_QUESTIONS_PROMPT_24H
  ACK_SWEETEN_T72
  ACK_CLOSEDOWN_T24
  
  // Booked cadence
  BOOKING_WELCOME
  COI_RECEIVED_ACK
  PRE_PICKUP_DETAILS_T48
  FINAL_CONFIRM_T24
  PICKUP_DAY_AM
  MID_RENTAL_CHECKIN  // optional, for >5 day rentals
  RETURN_REMINDER_T24
  RETURN_ACKNOWLEDGMENT
  WRAP_THANKS_T24
  INVOICE_DELIVERY
  PAYMENT_REMINDER_T14
  REPEAT_BUSINESS_T30
  
  // Re-engagement
  LOST_REENGAGEMENT_2W
  LOST_SOFT_CHECKIN_90D
  
  // Annual paperwork
  ANNUAL_EXPIRY_60D
  ANNUAL_EXPIRY_30D
  ANNUAL_EXPIRY_7D
  
  // Portal lifecycle
  PORTAL_SUNSET_REMINDER_23M
}
```

### Company model additions

```prisma
model Company {
  // ... existing fields ...
  
  // Annual paperwork
  annualAgreementUrl           String?
  annualAgreementEffectiveDate DateTime?
  annualAgreementExpiresAt     DateTime?
  annualAgreementSignedBy      String?
  annualAgreementApprovedBy    String?  // userId of Wes or Dani
  annualAgreementApprovedAt    DateTime?
  
  annualCoiUrl                 String?
  annualCoiEffectiveDate       DateTime?
  annualCoiExpiresAt           DateTime?
  annualCoiCoverageGL          Decimal?  // General Liability limit
  annualCoiCoverageAuto        Decimal?  // Auto liability limit
  annualCoiApprovedBy          String?
  annualCoiApprovedAt          DateTime?
  
  // Negotiated terms (institutional memory)
  negotiatedTermsUrl           String?
  negotiatedTermsSummary       String?   @db.Text
  negotiatedTermsNegotiatedAt  DateTime?
  negotiatedTermsApprovedBy    String?
  negotiatedTermsApprovedAt    DateTime?
  negotiatedTermsActiveAsOf    DateTime?
  negotiatedTermsReviewDueDate DateTime? // 12-month review reminder
}
```

### PortalAccess model (new)

Per-contact portal access tracking.

```prisma
model PortalAccess {
  id                  String   @id @default(uuid())
  orderId             String
  order               Order    @relation(fields: [orderId], references: [id])
  contactId           String
  contact             Contact  @relation(fields: [contactId], references: [id])
  magicLinkToken      String   @unique
  magicLinkExpiresAt  DateTime
  passwordHash        String?  // optional password setup for persistent access
  createdAt           DateTime @default(now())
  revokedAt           DateTime?
  revokedBy           String?
  lastAccessedAt      DateTime?
  accessCount         Int      @default(0)
  
  @@index([orderId])
  @@index([contactId])
  @@index([magicLinkToken])
}
```

### Vehicle model additions (if not already present)

Verify these exist in your fleet schema. If not, add:

```prisma
model Vehicle {
  // ... existing fields ...
  
  registrationUrl       String?
  registrationExpiresAt DateTime?
  licensePlate          String?
  bitCertificateUrl     String?
  bitCertificateExpiresAt DateTime?
  
  // Internal only — NEVER expose in client portal
  insuranceCardUrl      String?  @internal
  insurancePolicyNumber String?  @internal
}
```

### EmailMessage classification additions

Extend the existing AI email classifier output:

```prisma
model EmailMessage {
  // ... existing fields ...
  
  replyClassification     ReplyClassification?
  replyClassificationConfidence Float?  // 0.0 to 1.0
}

enum ReplyClassification {
  PURE_ACKNOWLEDGMENT      // "thanks, will look"
  ACTIVE_DISCUSSION        // questions, change requests
  BOOKING_SIGNAL           // "let's do it, how do we sign?"
  EXPLICIT_REJECTION       // "going with another vendor"
  UNCLEAR                  // low confidence, treat as DISCUSSING
}
```

---

## Section 3 — Email Cadence System

### Architecture

A cron-style job runs every 15 minutes via Vercel Cron, checking for cadence events whose `scheduledFor` is in the past and `executedAt` is null. Each due event triggers its corresponding email send (via Resend) or system action.

### Cadence transitions

```
QUOTE_DRAFT
  ↓ (rep sends quote)
QUOTE_SENT
  ├→ [+24h, if pickup >48h out] QUOTE_NUDGE_24H email sent
  │     ↓
  │   (still QUOTE_SENT, no state change from automated send)
  │
  ├→ [inbound reply, AI classifies]
  │     ├→ PURE_ACKNOWLEDGMENT → QUOTE_ACKNOWLEDGED
  │     ├→ ACTIVE_DISCUSSION → QUOTE_DISCUSSING (cadence pauses)
  │     ├→ BOOKING_SIGNAL → notify rep urgently, no state auto-change
  │     └→ EXPLICIT_REJECTION → LOST (reason: EXPLICIT_REJECTION)
  │
  ├→ [T-72h from pickup] QUOTE_CHECKIN_T72 email sent
  ├→ [T-24h from pickup] QUOTE_CLOSEDOWN_T24 email sent
  └→ [pickup day arrives, no booking] → LOST (reason: NO_RESPONSE)

QUOTE_ACKNOWLEDGED (sub-cadence)
  ├→ [+24h after acknowledgment, if pickup >48h out] ACK_QUESTIONS_PROMPT_24H
  ├→ [T-72h] ACK_SWEETEN_T72
  ├→ [T-24h] ACK_CLOSEDOWN_T24
  └→ [pickup day, no booking] → LOST (reason: ACKNOWLEDGED_NO_BOOK)

QUOTE_DISCUSSING
  → Cadence paused. Rep handles manually.
  → If client signs agreement → BOOKED
  → If rep manually closes → LOST (reason: MANUAL_CLOSE)

BOOKED (entered when agreement is signed via portal)
  ├→ [immediately] BOOKING_WELCOME email
  ├→ [when COI received] COI_RECEIVED_ACK email
  ├→ [T-48h from pickup] PRE_PICKUP_DETAILS_T48 email
  ├→ [T-24h from pickup] FINAL_CONFIRM_T24 email
  ├→ [pickup day AM, 8:00 AM rep timezone] PICKUP_DAY_AM email
  ├→ [if rental >5 days, midway] MID_RENTAL_CHECKIN (optional, rep toggle)
  ├→ [T-24h from return] RETURN_REMINDER_T24 email
  ├→ [return day, on equipment scan-in] RETURN_ACKNOWLEDGMENT
  ├→ [return +24h] WRAP_THANKS_T24
  ├→ [invoice generated] INVOICE_DELIVERY
  ├→ [invoice +14d, if unpaid] PAYMENT_REMINDER_T14
  └→ [wrap +30d] REPEAT_BUSINESS_T30

LOST
  ├→ [LOST +10-14d, if reason ≠ EXPLICIT_REJECTION] LOST_REENGAGEMENT_2W
  └→ [LOST +60-90d] LOST_SOFT_CHECKIN_90D (optional)

Portal lifecycle
  └→ [job wrap +23 months] PORTAL_SUNSET_REMINDER_23M to active contacts
  └→ [job wrap +24 months] Portal access auto-revoked for client contacts (SirReel retains internal access)
```

### Cadence pause/resume rules

**Auto-pause triggers:**
- Inbound client reply detected (during QUOTE_SENT or QUOTE_ACKNOWLEDGED states)
- Pickup date moves (re-baseline all future timing)
- Manual rep override (`cadenceManualOverride = true`)

**Auto-resume triggers:**
- AI classifies subsequent client reply as PURE_ACKNOWLEDGMENT after ACTIVE_DISCUSSION (rare; rep should review)
- Rep manually clears override

**Critical safeguard:** If `replyClassificationConfidence < 0.75`, default to ACTIVE_DISCUSSION (rep handles). Better to err on the side of pausing cadence than to send a "haven't heard back" email to someone who's actively engaged.

---

## Section 4 — AI Reply Classifier

### Implementation

Extends the existing AI email classifier (which currently outputs general type). New output: `replyClassification` and `replyClassificationConfidence`.

### Classifier prompt structure

```
You are classifying an inbound email reply from a client in the context of 
an active quote. The client received a quote and has now replied.

Quote context:
- Job: [Job Name]
- Quote sent: [Date]
- Current state: [QUOTE_SENT or QUOTE_ACKNOWLEDGED]

Client reply content:
[email body]

Classify into ONE of:

PURE_ACKNOWLEDGMENT — Client acknowledges receipt without booking or asking 
  questions. Examples: "Thanks", "Got it, will review", "Appreciate it, 
  will be in touch", "Let me check with my team."

ACTIVE_DISCUSSION — Client has questions, change requests, or substantive 
  back-and-forth. Examples: "Can you swap the box truck for a cube?", 
  "What about insurance coverage?", "What if we extend by 2 days?"

BOOKING_SIGNAL — Client signals intent to book. Examples: "Looks great, 
  let's go", "Send the contract", "How do we sign?", "We're in."

EXPLICIT_REJECTION — Client declines or chooses another vendor. Examples: 
  "Going with another vendor", "Project got cancelled", "Not for us, 
  thanks anyway."

UNCLEAR — Reply is ambiguous, mixed signals, or doesn't fit cleanly.

Respond in JSON:
{
  "classification": "PURE_ACKNOWLEDGMENT" | "ACTIVE_DISCUSSION" | "BOOKING_SIGNAL" | "EXPLICIT_REJECTION" | "UNCLEAR",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation"
}
```

### Confidence handling

| Confidence | Action |
|------------|--------|
| ≥ 0.85 | Auto-apply classification |
| 0.75 - 0.85 | Apply classification but flag for rep review |
| < 0.75 | Default to ACTIVE_DISCUSSION (cadence pauses, rep handles) |

---

## Section 5 — Job Page (Multi-Contact Portal)

### URL structure

`hq.sirreel.com/portal/[portalSlug]?token=[magicLinkToken]`

After first visit + magic link validation, session cookie established. Token can be expired/refreshed.

### Page sections (vertical scroll)

**1. Header**
- Client company name + job name
- Current job status (visual progress bar: Quote → Booked → Pickup → Return → Wrapped)
- Pickup countdown if pre-pickup
- Rep contact: photo, name, phone, email (direct connection to TSX value of "great communication")
- After-hours line surfaced

**2. Quick actions panel (varies by state)**
- If quote unsigned: "Sign Agreement" CTA
- If COI not received: "Upload COI" CTA
- If quote pending review: "Review & Accept Quote" CTA
- If invoice unpaid: "Pay Invoice" CTA

**3. Schedule**
- Pickup date/time/location
- Return date/time/location
- "Add to calendar" button (.ics download)

**4. Equipment list**
- All assigned items (vehicles, grip/electric, supplies)
- Quantity, type, daily rate (no internal cost data)

**5. Paperwork section**

Two subsections:

**Your paperwork** (client provides):
- Rental Agreement (status: Pending / Sent / Reviewing / Signed)
- COI (status: Pending / Received / Approved / Rejected)
- Custom docs (waivers, exhibits — varies per job)

**SirReel paperwork** (we provide):
- Quote PDF (downloadable)
- Order PDF (when generated)
- Invoice PDF (when generated, with payment status)
- DOT Packet per vehicle:
  - Registration (downloadable)
  - License plate (displayed)
  - BIT inspection certificate (downloadable)
  - Combined "Vehicle Paperwork PDF" download for driver's cab
- **NOT included:** SirReel's insurance card / policy proof (internal only)

**6. Contacts**

**Your team** (client contacts with portal access):
- List of contacts with portal access
- "Add team member" button (rep sees this; client sees only their team list)

**Your SirReel team:**
- Sales rep (primary)
- Ops contact (Dani / Julian)
- After-hours line

**7. Activity feed** (collapsed by default)
- "You signed the rental agreement on May 15"
- "Sarah viewed the quote PDF on May 16"
- "Equipment list updated by [Rep] on May 17"
- Transparent record of what's happened

### Multi-contact access flow

**When a new email address is detected on the job thread:**

System creates a Contact record (or links to existing) and surfaces this to the rep in the platform:

```
┌─ New Contact Detected ─────────────────────────┐
│ Sarah Chen <sarah@productionco.com>             │
│ Seen on thread: "Re: Quote for Big Production"  │
│                                                  │
│ Suggested actions:                              │
│ □ Add to job team (no portal access yet)        │
│ □ Send portal access invitation                  │
│ □ Ask Lisa (existing contact) to authorize       │
│   [Send Lisa: "Should we share portal with     │
│   Sarah?"]                                       │
│                                                  │
│ [Take Action] [Dismiss]                         │
└──────────────────────────────────────────────────┘
```

When rep selects "Ask Lisa to authorize," system sends Lisa a quick email:

> Subject: Quick question — adding Sarah Chen to the [Job Name] portal
>
> Hi Lisa,
>
> We noticed Sarah Chen has been on our email thread about [Job Name]. Would you like her to have access to the project portal? She'd be able to see paperwork, the schedule, and the equipment list.
>
> [Yes, give her access] [No thanks]
>
> Best,
> [Rep Name]

If Lisa clicks "Yes," Sarah gets her own magic link via email.

### Portal access controls (rep-side)

In the Job detail page, a "Portal Access" section shows all contacts with their access status:

| Contact | Status | Last accessed | Actions |
|---------|--------|---------------|---------|
| Lisa Park | Active | 2 hours ago | [Revoke] [Regenerate link] |
| Sarah Chen | Active | 5 days ago | [Revoke] [Regenerate link] |
| Mike Torres | Invited (not yet accepted) | Never | [Resend invite] [Cancel] |
| Bob Smith | Revoked | 1 month ago | [Reactivate] |

### Portal session model

- First visit: magic link in URL → validate token → set session cookie (30 days)
- Optional: contact can set a password during first visit for persistent login
- Session cookie persists for 30 days, refreshed on activity
- Hard expiration: 2 years after job wrap (`portalSunsetAt`)
- SirReel staff can access any portal via internal admin route regardless of client expiration

---

## Section 6 — Company-Level Paperwork Management

### Annual MSA / COI workflow

**Upload flow:**
1. Sales rep uploads client's Annual MSA or COI via Company detail page
2. AI Contract Review (for MSA) automatically runs against playbook
3. AI surfaces concerns, suggests counters, scores against playbook
4. Sales rep reviews AI output and either:
   - Accepts as-is and submits for Wes/Dani approval
   - Requests counter-negotiation with client
5. Wes or Dani receives notification: "Annual MSA awaiting approval — PM Productions"
6. Wes/Dani reviews AI summary + raw document, then approves
7. Once approved, marked as `annualAgreementApprovedAt` and active

**For COI specifically:**
- AI parses COI document for coverage amounts, expiration date, additional insured language
- Validates against SirReel's minimum coverage requirements
- Flags missing required language
- Wes/Dani approves

**Active annual paperwork affects job creation:**

When rep creates a new job for a company:

```javascript
function checkAnnualPaperwork(company, jobRequirements) {
  const checks = {
    annualMsa: {
      active: company.annualAgreementUrl 
              && company.annualAgreementApprovedAt
              && company.annualAgreementExpiresAt > addDays(now, 7),
      expiringSoon: company.annualAgreementExpiresAt 
                    && company.annualAgreementExpiresAt < addDays(now, 30),
    },
    annualCoi: {
      active: company.annualCoiUrl
              && company.annualCoiApprovedAt
              && company.annualCoiExpiresAt > jobRequirements.returnDate,
      coverageMet: company.annualCoiCoverageGL >= jobRequirements.requiredGL,
    }
  };
  return checks;
}
```

If annual MSA is active → skip per-job agreement signing. Job paperwork section shows: "Covered by annual agreement (signed [date]). [View annual agreement]"

If annual COI is active AND meets coverage requirements → skip per-job COI request. Show: "Covered by annual COI (expires [date]). [View COI]"

If annual COI active but coverage insufficient → flag rep: "Annual COI covers $1M GL but this job requires $2M. Request supplemental coverage."

### Expiration monitoring widget

New widget on Sales dashboard: "Expiring Annual Paperwork"

```
┌─ Expiring Annual Paperwork ─────────────────────────┐
│                                                       │
│ 🔴 EXPIRED                                            │
│   • Big Studio LLC — Annual COI expired 2 days ago   │
│     [Renew] [Contact client]                          │
│                                                       │
│ 🟠 EXPIRING IN 7 DAYS                                 │
│   • PM Productions — Annual MSA expires May 24       │
│     [Send renewal email] [Contact client]            │
│                                                       │
│ 🟡 EXPIRING IN 30 DAYS                                │
│   • Indie Films Co — Annual COI expires June 14      │
│     • Bright House — Annual MSA expires June 12      │
│                                                       │
│ ⚪ EXPIRING IN 60 DAYS                                │
│   • [3 more companies — view all]                    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Cron job runs daily, creates ANNUAL_EXPIRY_60D / 30D / 7D cadence events for each expiring annual paperwork item. Renewal emails auto-send at T-30 and T-7.

### Negotiated terms management

**Activation flow:**

After a successful contract negotiation (like Nick's v3 yesterday), the rep or Wes navigates to the Company detail page and uploads the final negotiated agreement.

```
┌─ Mark Negotiated Terms ───────────────────────────────┐
│                                                         │
│ Company: PM Productions                                │
│                                                         │
│ Negotiated agreement document:                          │
│ [pm-productions-master-agreement-v3-final.pdf]         │
│ [Upload]                                                │
│                                                         │
│ Summary of negotiated differences from standard:        │
│ [Cl. 23 narrowed to enjoining Recordings only.         │
│  Cl. 21 includes 12hr non-payment cure window.          │
│  Cl. 14 bilateral consequential damages waiver.]        │
│                                                         │
│ Negotiated on: [May 15, 2026]                          │
│ Active as of:  [May 15, 2026]                          │
│                                                         │
│ Approved by: Wes Bailey ▾                              │
│                                                         │
│ Review due date: [May 15, 2027] (1 year)               │
│                                                         │
│ [Activate Negotiated Terms]                            │
└─────────────────────────────────────────────────────────┘
```

**Effect on future jobs:**

When a new job is created for a company with `negotiatedTermsUrl` set:

```javascript
function selectAgreementTemplate(company, job) {
  if (company.negotiatedTermsUrl && company.negotiatedTermsApprovedAt) {
    return {
      url: company.negotiatedTermsUrl,
      type: 'NEGOTIATED',
      banner: `📋 This client has negotiated terms from ${formatDate(company.negotiatedTermsNegotiatedAt)}. Quote uses negotiated agreement.`
    };
  }
  return {
    url: STANDARD_AGREEMENT_URL,
    type: 'STANDARD',
    banner: null
  };
}
```

The Job creation flow renders the banner prominently when negotiated terms are used. Sales rep is reminded that the negotiation paid forward.

**AI Contract Review with negotiated baseline:**

If the client redlines the negotiated agreement (asking for further changes), the AI Contract Review feature uses the NEGOTIATED version as baseline, not the standard SirReel template. The playbook still applies for hard limits and Do Not Accept items, but the starting position is the company's negotiated baseline.

**Annual review reminder:**

12 months after negotiation activation, system creates a reminder task for Wes: "Negotiated terms with PM Productions are due for review. Industry-standard language may have shifted. Review and re-approve or update."

---

## Section 7 — DOT Packet Surfacing

### What gets surfaced per vehicle

For each Vehicle assigned to a Job, the portal shows:

| Item | Source field | Display |
|------|--------------|---------|
| Vehicle make/model | Vehicle.makeModel | Text |
| Registration document | Vehicle.registrationUrl | Download link + expiration warning if <30 days |
| License plate | Vehicle.licensePlate | Display only |
| BIT certificate | Vehicle.bitCertificateUrl | Download link + expiration warning if <30 days |
| Combined "DOT Packet for cab" | Generated PDF | Single download bundling registration + BIT |

### What is NEVER surfaced to clients

| Item | Reason |
|------|--------|
| SirReel's insurance card / policy proof | Contractual: SirReel insurance is secondary to client's required primary coverage. Surfacing it suggests accessibility and could undermine the primary/secondary insurance structure. |
| Driver assignments | Internal ops |
| Internal maintenance records | Internal ops |
| Daily rental cost / fleet acquisition cost | Confidential |

### Internal fleet alerts

Cron job runs daily, checks for vehicles with `registrationExpiresAt` or `bitCertificateExpiresAt` within 30 days. Creates alerts in fleet dashboard for Julian and Chris.

**Block on job creation:**

If a vehicle is being assigned to a job whose return date is after the vehicle's registration or BIT expiration:

```
⚠️ Cannot assign Vehicle #137 to this job:
   Registration expires June 1, 2026
   Job return date: June 15, 2026
   
   Please renew registration before assigning, or select another vehicle.
```

### "Request SirReel COI" workflow (out of scope for this brief; future ticket)

Some productions require SirReel's COI before allowing vehicles on set or lot. This is a one-off document delivered via email, NOT auto-surfaced in the portal. Future ticket: build a request workflow where:
- Client requests SirReel COI via portal (form)
- Ops (Dani or Ana) reviews request and issues from SirReel's broker
- Issued with proper "additional insured" language naming the client company
- Delivered via email, tracked but not portal-surfaced

---

## Section 8 — Lost Quote Tracking & Re-engagement

### Lost reasons (locked enum)

```
NO_RESPONSE          — Client never replied. Lost via cadence completion (pickup day passed).
ACKNOWLEDGED_NO_BOOK — Client replied but didn't book. Lost via ACKNOWLEDGED cadence completion.
EXPLICIT_REJECTION   — Client actively declined or chose another vendor. Lost immediately on AI detection.
MANUAL_CLOSE         — Rep manually closed the quote (e.g., known cancelled production).
```

### Re-engagement cadence

| Timing | Action | Condition |
|--------|--------|-----------|
| LOST + 10-14 days | Re-engagement email | `lostReason ≠ EXPLICIT_REJECTION` |
| LOST + 60-90 days | Optional soft check-in | Any reason |
| Beyond 90d | Manual rep outreach only | — |

### Re-engagement reporting

New report in admin dashboard:
- Loss rate by `lostReason` (helps Wes see WHERE losses happen)
- Loss rate by sales rep (training signal)
- Average time-from-quote-sent to LOST
- Re-engagement email conversion rate (does the 2-week follow-up turn into a quote?)
- Companies with multiple LOST quotes (potential relationship issue)

---

## Section 9 — Portal Access Lifecycle

### States

```
INVITED       — magic link sent, not yet accepted
ACTIVE        — contact has accessed at least once
WRAPPED       — job is complete but access continues (informational badge)
EXPIRING_SOON — within 30 days of 2-year sunset (notification sent at 23 months)
SUNSET        — 2 years post-wrap, client access expired
REVOKED       — manually removed by rep
```

### 23-month notification email

Auto-sent to all `ACTIVE` portal accesses on a wrapped job at 23 months post-wrap:

```
Subject: Your SirReel portal access for [Job Name] is closing soon

Hi [FirstName],

Heads up — your portal access for the [Job Name] project from [Year] will 
sunset on [Date]. If you'd like to download anything (invoices, paperwork) 
for your records, now's the time.

[Portal link]

If you've got upcoming projects, just reach out and we'll get a fresh 
portal set up.

Best,
[Rep Name or generic from notifications@]
```

### SirReel internal access

After client access expires:
- Portal URL still resolves for SirReel staff (auth check against User.email)
- Job data, paperwork, communication history remain accessible indefinitely
- Useful for: repeat business context, dispute resolution, financial audits, future negotiation reference

---

## Section 10 — Email Template Library

All email copy locked. Templates use Handlebars syntax with these standard variables:

`{{firstName}}`, `{{jobName}}`, `{{pickupDate}}`, `{{returnDate}}`, `{{repName}}`, `{{repPhone}}`, `{{repEmail}}`, `{{afterHoursLine}}`, `{{portalLink}}`, `{{companyName}}`, `{{pickupTime}}`, `{{pickupAddress}}`, `{{opsContactName}}`, `{{opsContactPhone}}`, `{{parkingInstructions}}`, `{{invoiceAmount}}`, `{{invoiceDueDate}}`, `{{payLink}}`.

### Unbooked — SILENT cadence

**QUOTE_NUDGE_24H** (+24h, only if pickup >48h)
```
Subject: Quick check on your SirReel quote

Hi {{firstName}},

Just confirming the quote I sent over for {{jobName}} landed safely. 
Happy to walk through anything, swap equipment if it'd help, or jump 
on a call. No rush — just here when you need.

Best,
{{repName}}
{{repPhone}}
```

**QUOTE_CHECKIN_T72**
```
Subject: Following up on {{jobName}}

Hi {{firstName}},

I wanted to follow up and make sure I haven't missed anything you might 
need for your upcoming job. We show the pickup as {{pickupDate}} and 
I haven't heard back from you yet.

If anything's changed or you have questions, just let me know.

Best,
{{repName}}
{{repPhone}}
```

**QUOTE_CLOSEDOWN_T24**
```
Subject: Closing your SirReel quote for {{jobName}}

Hi {{firstName}},

I haven't heard back, so I'm going to close this quote down. We're 
always here for you, and should you need anything at all, we are 
standing by.

Best,
{{repName}}
{{repPhone}}
```

### Unbooked — ACKNOWLEDGED cadence

**ACK_QUESTIONS_PROMPT_24H** (+24h after acknowledgment, if pickup >48h)
```
Subject: SirReel quote for {{jobName}}

Hi {{firstName}},

Please let me know if you have any questions on the quote or if there's 
anything I can help clarify.

Best,
{{repName}}
{{repPhone}}
```

**ACK_SWEETEN_T72**
```
Subject: Earning your business on {{jobName}}

Hi {{firstName}},

Let me know if I can answer any questions or sweeten this quote in some 
way to earn your business. Happy to work with your budget or adjust the 
package.

Best,
{{repName}}
{{repPhone}}
```

**ACK_CLOSEDOWN_T24**
```
Subject: Closing your SirReel quote for {{jobName}}

Hi {{firstName}},

I haven't heard back about a booking, so I'm going to close this quote 
down. We're always here for you, and should you need anything at all, 
we are standing by.

Best,
{{repName}}
{{repPhone}}
```

### Booked cadence

**BOOKING_WELCOME**
```
Subject: You're booked! {{jobName}}

Hi {{firstName}},

You're all set for {{pickupDate}} — {{jobName}}. We'll take it from here.

A few things you can do anytime through your portal:
• Upload your COI
• Review pickup info
• See your equipment list and schedule

[View your job portal]({{portalLink}})

Reach me directly at {{repPhone}} if anything changes. After-hours line 
is {{afterHoursLine}} for any urgent issues.

Looking forward to it.

Best,
{{repName}}
```

**COI_RECEIVED_ACK**
```
Subject: Got your insurance for {{jobName}}

Hi {{firstName}},

Your COI is in. Our team is reviewing it and we'll let you know if 
anything needs adjusting — otherwise consider it locked in.

Best,
{{repName}}
```

**PRE_PICKUP_DETAILS_T48**
```
Subject: Pickup details for {{jobName}} — {{pickupDate}}

Hi {{firstName}},

Quick rundown for pickup at {{pickupTime}} on {{pickupDate}}:

• Address: {{pickupAddress}}
• Parking: {{parkingInstructions}}
• Your contact on-site: {{opsContactName}} at {{opsContactPhone}}
• After-hours line: {{afterHoursLine}}

Everything is also live in your [job portal]({{portalLink}}) if helpful.

See you {{pickupDayOfWeek}}!

Best,
{{repName}}
```

**FINAL_CONFIRM_T24**
```
Subject: Tomorrow's pickup — {{jobName}}

Hi {{firstName}},

Just confirming we're all set for {{pickupTime}} tomorrow. Equipment is 
staged. If anything changes overnight, hit me on {{repPhone}}.

Best,
{{repName}}
```

**PICKUP_DAY_AM**
```
Subject: Today's the day — {{jobName}}

Hi {{firstName}},

We're ready when you are. {{opsContactName}} will be on-site at 
{{opsContactPhone}} if you need anything during pickup. After-hours line 
is {{afterHoursLine}}.

Have a great shoot.

Best,
{{repName}}
```

**RETURN_REMINDER_T24**
```
Subject: Tomorrow's return — {{jobName}}

Hi {{firstName}},

Return is set for {{returnTime}} tomorrow at {{pickupAddress}}. A few 
quick notes:

• Please return fueled to the level it was picked up at
• Equipment should come back clean — anything substantial gets billed 
  at cost
• Need extra time? Just text me — we can adjust if available

Best,
{{repName}}
```

**RETURN_ACKNOWLEDGMENT**
```
Subject: Equipment back — thanks for {{jobName}}

Hi {{firstName}},

Got the equipment back. Our team will do the walk-through and we'll 
get your final invoice to you within 24-48 hours.

Thanks for working with us.

Best,
{{repName}}
```

**WRAP_THANKS_T24**
```
Subject: Thanks again for {{jobName}}

Hi {{firstName}},

Just wanted to say thanks for the work. Hope the shoot went well and 
the equipment held up its end. If anything was less than great, I'd 
love to hear it — we always want to be better.

When the next one comes up, you know where to find us.

Best,
{{repName}}
```

**INVOICE_DELIVERY** (from Ana)
```
Subject: Invoice for {{jobName}}

Hi {{firstName}},

Your invoice for {{jobName}} is in your [job portal]({{portalLink}}) 
and attached here. Total is {{invoiceAmount}}, due {{invoiceDueDate}}.

Payment options:
• Pay online through the portal
• Wire details available on request
• Mail check to 8500 Lankershim Blvd, Sun Valley, CA 91352

Let me know if you have any questions.

Best,
Ana DeAngelis
SirReel Studio Services
```

**PAYMENT_REMINDER_T14** (from Ana)
```
Subject: Friendly reminder — invoice for {{jobName}}

Hi {{firstName}},

Just a friendly nudge — invoice for {{jobName}} (dated {{invoiceDate}}) 
is showing unpaid in our system. If it's already been sent, just let me 
know and I'll track it down on our end.

[Pay invoice]({{payLink}})

Best,
Ana DeAngelis
SirReel Studio Services
```

**REPEAT_BUSINESS_T30**
```
Subject: Anything coming up?

Hi {{firstName}},

Hope you're well. Anything on the horizon we could help with? Always 
happy to put together a quick quote.

Best,
{{repName}}
{{repPhone}}
```

### Re-engagement

**LOST_REENGAGEMENT_2W**
```
Subject: Following up on {{jobName}}

Hi {{firstName}},

Hope your project went well. Wanted to reach back out in case there 
are upcoming projects we could quote for you. We'd love the chance to 
earn your business next time.

Best,
{{repName}}
{{repPhone}}
```

### Annual paperwork

**ANNUAL_EXPIRY_30D**
```
Subject: SirReel paperwork renewal — {{paperworkType}}

Hi {{firstName}},

Your annual {{paperworkType}} with SirReel expires on {{expirationDate}}. 
To keep things smooth for upcoming projects, let's get it renewed now.

[Renewal portal]({{renewalLink}})

Best,
{{repName}}
```

### Portal lifecycle

**PORTAL_SUNSET_REMINDER_23M**
```
Subject: Your SirReel portal access for {{jobName}} is closing soon

Hi {{firstName}},

Heads up — your portal access for the {{jobName}} project from {{year}} 
will sunset on {{sunsetDate}}. If you'd like to download anything 
(invoices, paperwork) for your records, now's the time.

[Portal link]({{portalLink}})

If you've got upcoming projects, just reach out and we'll get a fresh 
portal set up.

Best,
{{repName}}
```

### Multi-contact authorization ask

**ADD_CONTACT_AUTHORIZATION**
```
Subject: Quick question — adding {{newContactName}} to the {{jobName}} portal

Hi {{firstName}},

We noticed {{newContactName}} has been on our email thread about 
{{jobName}}. Would you like them to have access to the project portal? 
They'd be able to see paperwork, the schedule, and the equipment list.

[Yes, give them access]({{approveLink}}) [No thanks]({{declineLink}})

Best,
{{repName}}
```

---

## Section 11 — Phased Build Sequence

This is a substantial system. Recommended sequencing across multiple Claude Code sessions:

### Phase 1 — Data model + cadence infrastructure (foundational)

**Commit 1.1: Schema updates**
- Add Order fields (cadenceState, lostAt, lostReason, portal fields)
- Add CadenceEvent model
- Add PortalAccess model
- Add Company-level paperwork fields
- Add Vehicle fields (registrationUrl, bitCertificateUrl, etc.)
- Add EmailMessage reply classification fields
- `prisma db push` after validating with `prisma migrate diff`

**Commit 1.2: Cadence cron job + event runner**
- Create `/api/cron/cadence` endpoint (Vercel Cron, every 15 minutes)
- Build CadenceEventRunner: fetches due events, executes them, marks complete
- Build cadence event creation logic on state transitions
- Test with manual state transitions

**Commit 1.3: Email template engine**
- Create `/src/lib/email/templates/` directory
- Implement Handlebars rendering for all locked templates
- Build send-via-Resend wrapper that supports `from` per rep, attaches PDFs

### Phase 2 — Unbooked cadence (most immediate value)

**Commit 2.1: AI reply classifier**
- Extend existing email classifier with reply classification logic
- Add confidence-based handling (≥0.85 auto, 0.75-0.85 flag, <0.75 default to DISCUSSING)
- Backfill classifications for recent emails

**Commit 2.2: SILENT cadence**
- Wire QUOTE_SENT → QUOTE_NUDGE_24H → QUOTE_CHECKIN_T72 → QUOTE_CLOSEDOWN_T24 → LOST
- Test with synthetic data + real quote
- Add rep manual override controls

**Commit 2.3: ACKNOWLEDGED cadence**
- Wire QUOTE_ACKNOWLEDGED sub-cadence on reply classification
- Test transitions

### Phase 3 — Job Page (client-facing portal)

**Commit 3.1: Portal slug + magic link infrastructure**
- Generate portalSlug on quote send
- Implement magic link generation per Contact
- Build session management (cookie-based after token validation)

**Commit 3.2: Portal UI — base layout and read-only sections**
- Header (status bar, rep contact)
- Schedule, equipment list, contacts displays
- Activity feed (collapsed by default)
- Match TSX-quality polish (visual quality bar similar to Stripe Checkout)

**Commit 3.3: Paperwork section**
- Quote PDF, Order PDF, Invoice PDF surfacing
- Rental Agreement section (links to existing signing flow from yesterday)
- COI upload zone

**Commit 3.4: DOT packet generation**
- Per-vehicle paperwork display
- "Vehicle Paperwork PDF" bundled download
- Internal expiration alerts for fleet team
- **Critical: SirReel insurance card NEVER included in client-facing surfaces**

**Commit 3.5: Multi-contact access**
- "New contact detected" rep workflow
- Existing-contact authorization email
- Portal access management UI on rep-side Job page

### Phase 4 — Booked cadence

**Commit 4.1: Booked cadence wiring**
- BOOKING_WELCOME on agreement signed
- COI_RECEIVED_ACK on COI upload
- PRE_PICKUP_DETAILS_T48
- FINAL_CONFIRM_T24
- PICKUP_DAY_AM
- RETURN_REMINDER_T24
- RETURN_ACKNOWLEDGMENT
- WRAP_THANKS_T24
- INVOICE_DELIVERY
- PAYMENT_REMINDER_T14
- REPEAT_BUSINESS_T30

**Commit 4.2: Mid-rental check-in (optional toggle for >5 day rentals)**

### Phase 5 — Company-level paperwork

**Commit 5.1: Annual MSA + COI management UI**
- Company detail page paperwork section
- Upload flow with AI Contract Review integration
- Wes/Dani approval workflow
- Job creation flow uses annual paperwork when active

**Commit 5.2: Negotiated terms management**
- Activation flow (upload + summary + Wes approval)
- Quote/Job flow uses negotiated baseline
- AI Contract Review uses negotiated baseline for redlines
- 12-month review reminder

**Commit 5.3: Expiration monitoring**
- Sales dashboard widget
- Cron job creates ANNUAL_EXPIRY events
- Auto-renewal emails

### Phase 6 — Lost quote tracking + re-engagement

**Commit 6.1: LOST state transitions and reasons**
- Auto-set lostReason on cadence completion
- Auto-set on EXPLICIT_REJECTION classification
- Manual close flow for reps

**Commit 6.2: Re-engagement cadence**
- LOST_REENGAGEMENT_2W (skip for EXPLICIT_REJECTION)
- LOST_SOFT_CHECKIN_90D (optional)

**Commit 6.3: Lost quote reporting dashboard**
- Loss rate by reason
- Loss rate by rep
- Re-engagement conversion rate
- Companies with multiple losses

### Phase 7 — Portal lifecycle

**Commit 7.1: 2-year sunset**
- Set `portalSunsetAt` on wrap
- Cron job revokes client access at sunset
- PORTAL_SUNSET_REMINDER_23M email
- SirReel internal access retained indefinitely

---

## Section 12 — Testing Strategy

Each commit should include:

**Schema commits:**
- `prisma migrate diff` shows expected changes only
- No data loss on production push

**Cadence commits:**
- Synthetic Job created in test environment
- State transitions simulated
- All expected emails fire at expected times
- Cadence pauses on reply
- Manual override works

**AI classifier commits:**
- Hand-labeled corpus of 20-30 real client replies for validation
- Verify confidence thresholds prevent false-positive cadence sends
- Edge case: mixed-signal replies default to DISCUSSING

**Portal UI commits:**
- Visual quality bar: matches Stripe Checkout / Linear feel
- Mobile-first responsive (most clients on phones)
- Magic link validation, session persistence
- Multi-contact flow with role-based visibility

**Paperwork commits:**
- AI Contract Review properly runs on uploaded MSAs
- Wes/Dani approval blocks active status
- Job creation correctly selects template (negotiated vs annual vs standard)
- COI coverage validation against job requirements

**Lifecycle commits:**
- Sunset correctly revokes client access
- SirReel internal access still works post-sunset
- 23-month reminder fires

---

## Section 13 — Critical Implementation Notes

**1. Pickup date changes:** Whenever an Order's pickupDate is updated, the system must DELETE all unexecuted future CadenceEvents and REGENERATE them based on the new pickup date. This is essential to prevent stale timing.

**2. Time zone handling:** All "T-72h", "T-24h", "pickup day AM" timing is in the JOB'S time zone (pickup location), not the rep's. Default to America/Los_Angeles if unspecified.

**3. Email send safety:**
- Never auto-send a cadence email if the job has been marked CANCELLED
- Never auto-send if cadenceManualOverride is true
- Never auto-send if `cadencePausedUntil > now`
- Always log every cadence event to `cadenceEvents` table for debugging

**4. AI classifier safeguards:**
- If confidence < 0.75, NEVER auto-transition state. Always pause cadence and notify rep.
- If multiple inbound emails arrive in quick succession, classify the MOST RECENT only.
- If classification is BOOKING_SIGNAL or EXPLICIT_REJECTION, send Slack DM to rep immediately regardless of state.

**5. Portal security:**
- Magic link tokens expire 7 days after generation
- Optional password is stored hashed (bcrypt or argon2)
- Session cookies use HttpOnly + Secure + SameSite=Lax
- Rate limit failed access attempts per IP

**6. SirReel insurance card — ABSOLUTE RULE:**
- Vehicle.insuranceCardUrl is marked internal
- No client-facing portal surface ever queries or displays this field
- Code review checkpoint: any new portal-facing endpoint must explicitly exclude insurance fields in its Prisma select clause
- If a client requests proof of SirReel coverage, route through ops manually (out of scope for this build)

**7. Negotiated terms — institutional memory:**
- When marking negotiated terms active, store summary in plain English (not just the PDF)
- This summary appears in quote generation banners and Slack notifications to keep team aware
- Future-Wes (or whoever does the 12-month review) needs to understand WHAT was negotiated, not just THAT it was

**8. Existing system integration:**
- Hook into existing Gmail integration for reply detection (info@/jose@/oliver@/ana@)
- Hook into existing AI email classifier (extend, don't replace)
- Hook into existing magic link pattern from paperwork portal (yesterday's work)
- Hook into existing Contract Review feature (extend baseline source for negotiated terms)

---

## Section 14 — Pre-flight checklist

Before starting Phase 1:

- [ ] Confirm Vercel Cron is enabled on the project (free tier may need verification)
- [ ] Confirm Resend has email volume capacity for projected sends (10-50/day initially)
- [ ] Verify Vehicle schema has registration/BIT fields, or plan schema addition
- [ ] Confirm AI classifier infrastructure can take additional prompt
- [ ] Confirm magic link infrastructure from yesterday's paperwork portal is committed
- [ ] DATABASE_URL exported in local environment
- [ ] Git identity configured: Wes Bailey / wes@sirreel.com

---

## Closing

This brief covers the full Client Relationship Hub. It's substantial — probably 4-6 Claude Code sessions to build end-to-end. Each phase delivers standalone value, so shipping incrementally is the right approach.

**Recommended sequencing rationale:**
- **Phase 1-2 first** because unbooked cadence has the most immediate operational value (your sales team is currently doing this manually or not at all)
- **Phase 3 next** because Job Page is the visible client-facing artifact that embodies TSX
- **Phase 4 after** because booked cadence builds on Phase 3 portal infrastructure
- **Phase 5 strategic** because annual paperwork and negotiated terms are differentiators, not basics
- **Phase 6-7 closing** because tracking and lifecycle are important but not blockers to early value

Every feature in this system, when shipped, should make a SirReel client say *"these people make it easy."* That's the test.

---

*Spec locked: May 16, 2026. Ready for Claude Code execution.*
