# Paperwork Portal — Contract Signing Feature Brief

**Session goal:** Build dual-path contract signing into the SirReel HQ paperwork portal — clients can either sign the baseline agreement as-is (Path B, primary), or download a Word version for legal review/redline that feeds into the existing Contract Review flow (Path A). Both paths converge on a native signing experience with audit trail and PDF generation.

---

## Context

- **Project:** hq.sirreel.com (Next.js 14 + Prisma + Neon + Vercel)
- **Working dir:** `/Users/wesbailey/Downloads/sirreel-platform`
- **Existing systems to integrate with:**
  - Paperwork portal with magic links (already working end-to-end for vehicle + stage contracts)
  - ContractReview / CoiCheck Prisma models (existing redline review flow)
  - Vercel Blob store `sirreel-paperwork` (private, auth-gated reads)
  - `@react-pdf/renderer` PDF generation pipeline
  - Resend email (domain `sirreel.com` verified, send from `notifications@sirreel.com`)
- **Prerequisite:** Canonical baseline corrections (per `canonical-baseline-corrections.md`) MUST be applied to the source `.docx` and PDF before this feature ships to clients. Otherwise you're auto-distributing the $2M typo and LCDW phantom references at scale.

---

## Workflow Overview

### Path B — Sign as-is (PRIMARY, most common)

```
Order created → Paperwork portal magic link sent → Client visits portal
  → Sees agreement summary + two buttons
  → Clicks "Sign and accept"
  → Reads agreement (scrollable view)
  → Checks acknowledgment box
  → Enters name, title
  → Draws signature on signature pad
  → Submits
  → Server: captures IP/UA, generates signed PDF, saves to Blob, emails copies
  → Status: SIGNED_BASELINE → job paperwork complete
```

### Path A — Legal review path

```
Order created → Paperwork portal magic link sent → Client visits portal
  → Sees agreement summary + two buttons
  → Clicks "Download for review"
  → Server: generates .docx with job data prefilled, triggers download
  → Notifies SirReel sales (this client wants legal review)
  → Status: DOWNLOAD_SENT
  → [Client redlines offline, returns to portal]
  → Clicks "Upload redline"
  → Uploads redlined .docx or PDF
  → Server: creates ContractReview record from upload, transitions status
  → Status: REDLINE_UPLOADED → UNDER_REVIEW
  → [SirReel team uses existing Contract Review UI to process redline, generate counter, negotiate]
  → When ContractReview marked "Accepted" by operator:
     → Server: generates final negotiated PDF, saves to Blob
     → Updates SignedAgreement.documentToSignUrl = negotiated PDF
     → Status: NEGOTIATED_READY
     → Emails client: "negotiated version ready to sign"
  → Client returns to portal
  → Sees "Sign negotiated version" button (no more redline option)
  → Same signing flow as Path B, but signing the negotiated PDF instead of baseline
  → Status: SIGNED_NEGOTIATED → job paperwork complete
```

---

## State Machine

```
                  ┌─────────────────────┐
                  │  PORTAL_GENERATED   │ ◄─── Order created
                  └──────────┬──────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
        "Sign as-is"           "Download for review"
                  │                     │
                  ▼                     ▼
        ┌─────────────────┐    ┌─────────────────┐
        │  SIGNING_FLOW   │    │ DOWNLOAD_SENT   │
        └────────┬────────┘    └────────┬────────┘
                 │                      │
            (signed)                "Upload redline"
                 │                      │
                 ▼                      ▼
        ┌─────────────────┐    ┌─────────────────┐
        │ SIGNED_BASELINE │    │REDLINE_UPLOADED │
        └─────────────────┘    └────────┬────────┘
                                        │
                                  ContractReview created
                                        │
                                        ▼
                               ┌─────────────────┐
                               │  UNDER_REVIEW   │
                               └────────┬────────┘
                                        │
                              Operator marks "Accepted"
                                        │
                                        ▼
                               ┌─────────────────┐
                               │NEGOTIATED_READY │
                               └────────┬────────┘
                                        │
                                 Client signs
                                        │
                                        ▼
                               ┌──────────────────┐
                               │SIGNED_NEGOTIATED │
                               └──────────────────┘
```

---

## Database Schema Additions

```prisma
enum AgreementDocumentType {
  BASELINE
  NEGOTIATED
}

enum AgreementStatus {
  PORTAL_GENERATED
  DOWNLOAD_SENT
  REDLINE_UPLOADED
  UNDER_REVIEW
  NEGOTIATED_READY
  SIGNED_BASELINE
  SIGNED_NEGOTIATED
}

model SignedAgreement {
  id                    String   @id @default(uuid())
  orderId               String   @unique
  order                 Order    @relation(fields: [orderId], references: [id])
  
  // Document tracking
  documentType          AgreementDocumentType  @default(BASELINE)
  baselineVersion       String?   // e.g., "2026-05-12" — pointer to canonical PDF version
  contractReviewId      String?   // FK to ContractReview if NEGOTIATED
  contractReview        ContractReview? @relation(fields: [contractReviewId], references: [id])
  
  // Document URLs (Vercel Blob)
  documentToSignUrl     String?   // PDF being signed (baseline or negotiated)
  redlineUploadUrl      String?   // Client's uploaded redline (Path A)
  signedDocumentUrl     String?   // Final signed PDF
  wordDocumentUrl       String?   // Generated .docx if Path A downloaded
  
  // Signing details
  signedAt              DateTime?
  signerName            String?
  signerTitle           String?
  signerEmail           String?
  signatureImageData    String?   @db.Text  // base64 PNG of captured signature
  
  // Audit trail for E-SIGN compliance
  acknowledgmentText    String?   @db.Text  // the "I have read..." text shown to user
  signerIpAddress       String?
  signerUserAgent       String?
  
  // Status
  status                AgreementStatus  @default(PORTAL_GENERATED)
  
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  @@index([orderId])
  @@index([status])
}

// Add to Order model:
//   signedAgreement      SignedAgreement?
```

**Migration note:** Use `prisma db push` per convention. Preview with `prisma migrate diff` first.

---

## API Routes

### Public portal routes (magic-link token authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/portal/[token]/agreement` | Returns current state + allowed actions + document URLs |
| `GET` | `/api/portal/[token]/agreement/download` | Generates and streams `.docx` with job data prefilled (Path A start) |
| `POST` | `/api/portal/[token]/agreement/upload-redline` | Accepts uploaded redline file → creates ContractReview record → transitions status |
| `POST` | `/api/portal/[token]/agreement/sign` | Signature submission → audit capture → PDF gen → blob save → email → state update |
| `GET` | `/api/portal/[token]/agreement/signed-copy` | Returns signed PDF for client to download their copy |

### Internal routes (session authenticated, sales/admin only)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/orders/[orderId]/contract-review/accept` | Operator marks ContractReview accepted → generates negotiated PDF → updates SignedAgreement.documentToSignUrl → status NEGOTIATED_READY → emails client |
| `POST` | `/api/orders/[orderId]/agreement/resend-link` | Re-sends portal magic link if client lost it |

### Request/response shapes

**`GET /api/portal/[token]/agreement` response:**
```typescript
{
  status: AgreementStatus,
  documentType: AgreementDocumentType,
  documentToSignUrl: string | null,    // PDF preview/sign URL
  wordDocumentAvailable: boolean,       // true if Path A download possible
  allowedActions: Array<'sign' | 'download' | 'upload-redline' | 'view-signed'>,
  job: {
    name: string,
    number: string,
    company: string,
    rentalStart: string,
    rentalEnd: string
  },
  signedAt: string | null,
  signerName: string | null
}
```

**`POST /api/portal/[token]/agreement/sign` request:**
```typescript
{
  signerName: string,
  signerTitle: string,
  signerEmail: string,
  signatureImageData: string,   // base64 PNG
  acknowledgmentText: string,   // verbatim text shown to client
  acknowledged: true            // confirms checkbox checked
}
```

---

## Word Template

**Path:** `public/contracts/sirreel-rental-agreement-template.docx`

**Approach:** Maintain a `.docx` template that mirrors the canonical PDF content (post-corrections) with Mustache-style `{{placeholder}}` fields. Fill at runtime with `docxtemplater`.

**Placeholders to support:**

```
{{companyName}}
{{companyType}}
{{companyAddress}}
{{companyEmail}}
{{companyPhone}}
{{jobName}}
{{jobNumber}}
{{jobType}}
{{rentalStart}}        // formatted MM/DD/YYYY
{{rentalEnd}}          // formatted MM/DD/YYYY
{{contactFirstName}}
{{contactLastName}}
{{contactPosition}}
{{contactEmail}}
{{contactPhone}}
{{generatedDate}}      // today's date when client downloads
```

**Maintenance:** When canonical PDF is updated (corrections applied or future changes), the template must be updated in parallel. Add a CI check or pre-deploy validation that compares clause count between PDF and template to catch drift.

---

## Library Additions

```json
{
  "dependencies": {
    "docxtemplater": "^3.x",
    "pizzip": "^3.x",                // docxtemplater dependency
    "signature_pad": "^4.x"          // canvas signature capture
  }
}
```

---

## UI Components

### Portal Agreement Page — `/portal/[token]/agreement`

State-driven render:

| Status | What client sees |
|--------|------------------|
| `PORTAL_GENERATED` | Agreement summary (rental dates, equipment, total) + "Sign and accept" button + "Download for review" button |
| `DOWNLOAD_SENT` | "You downloaded the agreement on [date]" + "Upload your redline here" file input + "Changed your mind? Sign the original instead" link |
| `REDLINE_UPLOADED` | "Your redline was received on [date]. Our team is reviewing it." + timeline of activity |
| `UNDER_REVIEW` | Same as above + "We'll notify you when ready to proceed" |
| `NEGOTIATED_READY` | "The negotiated version of your agreement is ready" + preview button + "Sign negotiated version" button |
| `SIGNED_BASELINE` or `SIGNED_NEGOTIATED` | "Signed on [date] by [name, title]" + "Download signed copy" button |

### Signing Flow Component (modal or sub-route)

Multi-step:
1. **Read agreement:** Embed PDF in scrollable iframe. Scroll-to-bottom detection enables next step.
2. **Acknowledgment:** Checkbox with verbatim text: *"I have read, understood, and agree to the terms and conditions of this Equipment and Vehicle Rental Agreement. I have authority to bind [Company Name] to this Agreement."*
3. **Identity capture:** Form for name, title, email (pre-filled from order data).
4. **Signature capture:** `signature_pad` canvas. Required to draw something. Clear button. Preview before continuing.
5. **Final confirmation:** "By clicking 'Submit and Sign', you are creating a legally binding electronic signature." → Submit button.
6. **Success state:** Confirmation page with download link for client's copy.

### Redline Upload Component

Drag-and-drop file input. Accepts `.docx`, `.pdf`. Max 10MB. On upload:
- Validate file type
- Upload to Vercel Blob (`sirreel-paperwork` under `redlines/{orderId}/`)
- Create ContractReview record linked to this SignedAgreement
- Transition status: `DOWNLOAD_SENT` → `REDLINE_UPLOADED`
- Trigger email to Wes/sales: "Redline received for [order]"

---

## Email Notifications

| Trigger | To | Subject | Content |
|---------|-----|---------|---------|
| `DOWNLOAD_SENT` | Sales (Jose, Oliver) | "[Client] downloaded agreement for review" | Order summary, link to admin view, encouragement to follow up in 2-3 days |
| `REDLINE_UPLOADED` | Wes + reviewer | "[Client] uploaded redline for [order]" | Link to ContractReview record, redline file attached |
| `NEGOTIATED_READY` | Client (signer email) | "Your negotiated agreement is ready to sign" | Portal magic link, brief explanation, next steps |
| `SIGNED_BASELINE` / `SIGNED_NEGOTIATED` | Client + Sales + Ana (billing) | "Agreement signed for [order]" | Signed PDF attached, order summary |

All emails sent via Resend from `notifications@sirreel.com`. Reply-to set to relevant sales rep where applicable.

---

## Integration Points

### With existing ContractReview model

The redline upload (Path A) creates a ContractReview record. Existing ContractReview UI in `/tools/contract-review/[id]` handles the SirReel-side review:
- Pre-populated with the uploaded redline + canonical baseline
- Existing per-clause Accept/Counter/Reject UI
- When operator clicks "Accept Final" (new button — see Commit 4), it:
  - Generates the final negotiated PDF from accepted clauses
  - Updates the linked SignedAgreement
  - Triggers `NEGOTIATED_READY` email

### With existing Order / Job models

- `SignedAgreement` is 1:1 with `Order`
- When Order is created with `quoteStatus = SENT` and the portal link is generated, a `SignedAgreement` record is auto-created with status `PORTAL_GENERATED`
- The Job's paperwork section queries Orders with their SignedAgreements to display status

### With existing portal flow

The current portal flow works for vehicle+stage contracts. This feature **extends** rather than replaces:
- Existing portal page gets new contract-signing section
- Existing magic-link auth pattern reused
- New routes added under `/api/portal/[token]/agreement/...`

---

## Sequenced Commits

### Commit 1: Schema + base API routes

- Prisma migration: SignedAgreement model + enums
- API route stubs: GET agreement, GET word download, POST sign, POST upload-redline
- Type definitions for request/response

**Test:** Schema applies cleanly with `prisma db push`. Routes return 401 without valid token, 200 with valid token.

**Commit message:** `feat(portal): add SignedAgreement model and base API routes`

### Commit 2: Word template generation (Path A start)

- Add `public/contracts/sirreel-rental-agreement-template.docx` (manual creation — see template structure section above)
- Implement `GET /api/portal/[token]/agreement/download`
- Wire docxtemplater to fill placeholders from Order data
- Status transition: `PORTAL_GENERATED` → `DOWNLOAD_SENT`
- Email notification to sales

**Test:** Client downloads template, opens in Word, all placeholders correctly filled with job data.

**Commit message:** `feat(portal): Path A — Word download with job data prefill`

### Commit 3: Signing flow (Path B)

- UI component: signing flow with signature_pad
- API route: POST `/api/portal/[token]/agreement/sign`
- Audit capture (IP, UA, acknowledgment, timestamp)
- PDF generation: extend existing @react-pdf/renderer flow to include signature image
- Vercel Blob save under `signed-agreements/{orderId}/baseline.pdf`
- Email signed copies to client + sales + billing
- Status transition: `PORTAL_GENERATED` → `SIGNED_BASELINE`

**Test:** Full Path B signing flow works end-to-end. Signed PDF includes embedded signature. Email delivers. Status reflects in admin UI.

**Commit message:** `feat(portal): Path B — native signing flow with E-SIGN audit trail`

### Commit 4: Redline upload + ContractReview integration

- UI: redline upload component (drag-and-drop)
- API: POST `/api/portal/[token]/agreement/upload-redline`
- Creates ContractReview record linked to SignedAgreement
- Add "Accept Final" button to existing ContractReview UI
- "Accept Final" handler: generates negotiated PDF, updates SignedAgreement.documentToSignUrl, transitions status to NEGOTIATED_READY, emails client
- Status transitions: `DOWNLOAD_SENT` → `REDLINE_UPLOADED` → `UNDER_REVIEW` → `NEGOTIATED_READY`

**Test:** Path A end-to-end: client downloads, redlines, uploads, operator reviews/accepts, client gets notified, signs negotiated version, ends at `SIGNED_NEGOTIATED`.

**Commit message:** `feat(portal): Path A — redline upload, contract review integration, negotiated signing`

### Commit 5: Portal UI state machine polish

- Refine portal agreement page to display all states correctly
- Add timeline view (when downloaded, when redline uploaded, when accepted, when signed)
- Add admin view in `/orders/[id]` showing agreement status with manual override controls
- Add "Resend portal link" button for sales

**Commit message:** `feat(portal): state machine UI polish and admin override controls`

### Commit 6 (optional): Template drift detection

- Add CI script that validates template clause count matches canonical PDF
- Warn if template appears out of sync with canonical

**Commit message:** `chore(portal): add template drift detection for canonical sync`

---

## E-SIGN / Audit Trail Compliance

To satisfy E-SIGN Act and California UETA requirements, every signing event must capture and retain:

1. **Intent to sign electronically** — checkbox with verbatim acknowledgment text
2. **Consent to electronic records** — implicit in choosing to sign via portal, but make explicit in acknowledgment text
3. **Association of signature with record** — signature embedded in PDF, also stored separately
4. **Record retention** — signed PDFs stored in Vercel Blob with indefinite retention; SignedAgreement record retained indefinitely
5. **Reproducibility** — both client and SirReel can retrieve signed copy at any time

**Display in admin UI** for any signed agreement:
- Signer name, title, email
- Signature image
- IP address, user agent
- Timestamp
- Acknowledgment text (verbatim)
- Link to signed PDF
- Link to original document signed (baseline or negotiated)

---

## Testing

### Path B (sign as-is) — happy path

1. Create test order, generate portal link
2. Visit portal as client
3. Verify agreement summary displays correctly
4. Click "Sign and accept"
5. Read agreement (scroll to bottom)
6. Check acknowledgment
7. Enter name, title, signature
8. Submit
9. Verify: signed PDF generated with signature image embedded
10. Verify: emails sent to client, sales, billing
11. Verify: status = `SIGNED_BASELINE`
12. Verify: admin UI shows signed status with audit trail

### Path A (redline) — happy path

1. Create test order, generate portal link
2. Visit portal as client
3. Click "Download for review"
4. Verify: .docx downloads with job data prefilled
5. Verify: email sent to sales
6. Verify: status = `DOWNLOAD_SENT`
7. Modify .docx (simulate redline)
8. Return to portal, upload redline
9. Verify: ContractReview record created
10. Verify: status = `REDLINE_UPLOADED`
11. As operator: open ContractReview, process clauses, click "Accept Final"
12. Verify: negotiated PDF generated
13. Verify: status = `NEGOTIATED_READY`
14. Verify: email sent to client
15. As client: return to portal, sign negotiated version
16. Verify: signed PDF includes negotiated clauses + signature
17. Verify: status = `SIGNED_NEGOTIATED`

### Edge cases

- Client tries to sign without checking acknowledgment → error
- Client tries to sign with empty signature pad → error
- Client uploads non-.docx/.pdf file as redline → error
- Client tries to sign after already signing → blocked, shows "already signed" state
- Magic link expires → "link expired, request new one" state
- ContractReview rejected by operator → status returns to UNDER_REVIEW with operator notes, client sees "negotiation in progress"

---

## Open decisions / configurable items

1. **Magic link expiry duration?** Suggest 30 days for initial link, 14 days for "negotiated ready" link.
2. **Auto-reminder cadence?** Suggest: 3-day reminder if `DOWNLOAD_SENT` and no redline uploaded, 7-day reminder if signed and no return visit to download.
3. **Re-sign capability?** If client signs and SirReel needs an amendment, does that create a new SignedAgreement record or amend the existing? Suggest: new record, with reference to original.
4. **Multiple signers?** Some clients require dual signatures (production AND legal). Suggest: phase 2 enhancement, not in initial build.

---

## Out of scope for this brief

- Multi-signer support (phase 2)
- Auto-reminders (phase 2)
- Counter-PDF rendering bug fix (separate commit per earlier brief)
- Playbook integration with AI (separate brief)
- Admin reporting on signing metrics (phase 2)
