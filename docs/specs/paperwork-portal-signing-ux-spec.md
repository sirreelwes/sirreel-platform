# Paperwork Portal — Signing Flow UX Specification

**Purpose:** Detailed UX spec for the contract signing experience. Complements the technical brief in `paperwork-portal-signing-feature-brief.md`. Use both together when handing off to Claude Code.

---

## Design Philosophy

Production coordinators sign rental contracts in 2-3 minutes between location scouts. They're on their phone, distracted, in a hurry. Every friction point costs the deal momentum. Build for that human.

**Quality benchmark:** Stripe checkout, Linear onboarding, Vercel domain setup. The bar is "I forgot this was a contract signing flow because it felt that clean."

**Five principles guiding every decision:**

1. **Context before legal.** Never dump someone into a wall of contract text without first showing them what they're signing and why.
2. **Pre-fill aggressively.** They typed their company info once into the order. Don't make them type it again.
3. **Multiple signature options.** Some people draw, some type, some upload. Let them pick.
4. **Mobile is the primary device.** Desktop is the secondary case. Design touch-first, scale up.
5. **Audit transparency builds trust.** Show them what was captured. "Signed at 2:47 PM PT from Los Angeles" feels professional, not surveillance.

---

## User Journey — Screen by Screen

### Screen 1: Welcome & Context

**URL:** `/portal/[token]/agreement`
**State:** `PORTAL_GENERATED`

What the client sees when they first land:

```
┌─────────────────────────────────────────┐
│ [SirReel logo]                          │
│                                          │
│ Hi Julia,                                │
│                                          │
│ You have a rental agreement to sign     │
│ for 1323-0526 King / Love.              │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ Rental Summary                  │    │
│ │ ─────────────────────────────── │    │
│ │ Equipment: 12 items              │    │
│ │ Vehicles: 2 cubes, 1 stakebed    │    │
│ │ Rental period: 5/12 – 5/15       │    │
│ │ Pickup: SirReel Sun Valley       │    │
│ │ Total: $2,847.50                 │    │
│ │                                  │    │
│ │ [View detailed quote ↗]          │    │
│ └─────────────────────────────────┘    │
│                                          │
│ How would you like to proceed?           │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ ✓ Sign and accept                │    │
│ │   Get your equipment locked in   │    │
│ └─────────────────────────────────┘    │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ ⬇ Download for legal review      │    │
│ │   We'll work through any changes │    │
│ └─────────────────────────────────┘    │
│                                          │
│ Questions? Just reply to this thread.    │
└─────────────────────────────────────────┘
```

**Key UX moves on this screen:**

- **Greeting by first name** (pulled from order contact data)
- **Job name visible immediately** so they know which booking
- **Rental summary card** with the items they care about (equipment count, dates, total) before any legal language
- **Two clearly-differentiated CTAs.** Sign is primary (filled button), download for review is secondary (outline button). Both equally accessible — no dark pattern hiding the review option.
- **Simple reply-to contact** at the bottom — reduces signing anxiety without requiring named rep maintenance
- **No legal text on this screen.** Save it for screen 2.

---

### Screen 2: Review Agreement

**Triggered by:** Click "Sign and accept" on Screen 1
**Status:** Transitions to in-progress (not persisted yet)

```
┌─────────────────────────────────────────┐
│ ← Back to summary           Step 1 of 3 │
│                                          │
│ Review your rental agreement             │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ EQUIPMENT AND/OR VEHICLE         │    │
│ │ TERMS & CONDITIONS               │    │
│ │                                  │    │
│ │ Please read carefully. You are   │    │
│ │ liable for our equipment and     │    │
│ │ vehicles from the time they      │    │
│ │ leave our premises until...      │    │
│ │ [scrollable embedded PDF]        │    │
│ │                                  │    │
│ │ [📌 Key term: Insurance ▼]       │    │
│ │ You must maintain insurance...    │    │
│ │                                  │    │
│ │ [continuing content...]          │    │
│ └─────────────────────────────────┘    │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░ 42% read              │
│                                          │
│ [Continue to sign →]                     │
│ Available after you've reviewed          │
│ the full agreement                        │
└─────────────────────────────────────────┘
```

- Embedded PDF in a scrollable viewer
- Sticky progress bar at bottom showing % read (based on scroll position)
- Key terms callouts inline ("📌 Key term: Insurance", "📌 Key term: Liability") — clickable to expand plain-English explanations without leaving the document context
- Continue button enabled at 80%+ scroll OR after 30 seconds with at least 50% scroll (gives quick-readers an out without abandoning read-enforcement entirely)

**Key UX moves on this screen:**

- **Progress indication** (Step 1 of 3) shows it's a short journey
- **Inline key-term callouts** with plain-English explanations reduce confusion without forcing the client to read a separate FAQ — supports comprehension while preserving the full legal text as the binding document
- **Read enforcement is soft** — 80% scroll OR 30 seconds with 50% scroll. Prevents accidental signings and bots without being patronizing.
- **Help link visible** — "Questions about something specific?" → opens contact form

---

### Screen 3: Sign

**Triggered by:** Click "Continue to sign" on Screen 2
**Status:** Still in-progress

```
┌─────────────────────────────────────────┐
│ ← Back to review            Step 2 of 3 │
│                                          │
│ Sign the agreement                       │
│                                          │
│ Your information                         │
│ ─────────────────                        │
│ Name: Julia Kostenevich         [edit]   │
│ Title: [Prod Coordinator        ]        │
│ Email: juliakostenevich@gmail.com [edit] │
│ Company: Happy Place, Inc.      [edit]   │
│                                          │
│ Your signature                           │
│ ─────────────────                        │
│ How would you like to sign?              │
│                                          │
│ ○ Draw     ● Type     ○ Upload           │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │                                  │    │
│ │    Julia Kostenevich             │    │
│ │    [auto-rendered in Allura]     │    │
│ │                                  │    │
│ └─────────────────────────────────┘    │
│                                          │
│ ☐ I have read, understood, and agree    │
│   to the terms and conditions of this   │
│   Equipment and Vehicle Rental          │
│   Agreement. I have authority to bind   │
│   Happy Place, Inc. to this Agreement.  │
│                                          │
│ [Continue to confirm →]                  │
└─────────────────────────────────────────┘
```

**Three signature input options:**

1. **Type** (default, fastest): User name pre-filled, rendered in a script-style font. Three font options to pick from. Most users will accept the default and move on. Fastest UX path.

2. **Draw**: Touch-friendly signature pad. Big canvas (full width on mobile, ~600px on desktop). Clear button. Stroke smoothing. Auto-trims whitespace on capture.

3. **Upload**: For users who have a saved signature image (often legal/exec users). Accepts PNG/JPG, max 2MB. Auto-crops and converts to consistent format.

**All three options produce a consistent stored format** (PNG with transparent background, ~600x200) so the resulting signed PDF looks uniform regardless of input method.

**Pre-filled identity fields** all editable but pre-populated from order data. Title is the one field most likely to need updating (the order has "Position" which may not match title for signing).

**Acknowledgment checkbox** with verbatim text. Must be checked before Continue enables. Text mentions the specific company name for personalized accountability.

**Continue is disabled** until: name, title, signature, AND acknowledgment all present.

**Key UX moves on this screen:**

- **Type as default** — fastest path for most users
- **Pre-fill identity** — they typed their info once during quote; don't make them repeat
- **Mobile-friendly signature pad** in draw mode — supports landscape rotation, large touch area
- **Specific company name in acknowledgment** — reads as "I have authority to bind Happy Place, Inc." rather than generic "the Lessee"
- **Single combined screen** — name/title/signature/acknowledgment all together, not three separate screens

---

### Screen 4: Confirm

**Triggered by:** Click "Continue to confirm" on Screen 3

```
┌─────────────────────────────────────────┐
│ ← Edit signature            Step 3 of 3 │
│                                          │
│ Confirm and sign                         │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ Julia Kostenevich                │    │
│ │ Prod Coordinator, Happy Place    │    │
│ │ juliakostenevich@gmail.com       │    │
│ │                                  │    │
│ │ Will sign for:                   │    │
│ │ • Rental Agreement (29 clauses)  │    │
│ │ • Job: 1323-0526 King / Love     │    │
│ │ • Period: May 12 – 15, 2026      │    │
│ │ • Total: $2,847.50               │    │
│ │                                  │    │
│ │ Signature:                       │    │
│ │ ┌──────────────────────────┐    │    │
│ │ │ Julia Kostenevich        │    │    │
│ │ └──────────────────────────┘    │    │
│ └─────────────────────────────────┘    │
│                                          │
│ ⚠ By clicking "Sign agreement" below,    │
│ you create a legally binding electronic │
│ signature under the U.S. E-SIGN Act     │
│ and California UETA.                     │
│                                          │
│ [Sign agreement] [Make changes ←]        │
└─────────────────────────────────────────┘
```

**Final review card** shows everything they're committing to in one glance:
- Their identity
- Document being signed (clause count + job summary)
- Their signature preview

**Explicit E-SIGN notice** — not legalese-heavy, but clear that this is legally binding. Builds confidence rather than fear.

**Two clear actions** — "Sign agreement" (primary, filled) or "Make changes" (secondary, link-style back). Easy to back out.

**Key UX moves on this screen:**

- **Single source of truth view** — everything they're signing on one screen
- **Plain-language E-SIGN notice** — explains binding nature without lawyer-speak
- **Easy backtrack** — "Make changes" link goes back to Screen 3 with all data preserved
- **No dark patterns** — both buttons clearly visible, no hidden "cancel" options

---

### Screen 5: Success

**Triggered by:** Click "Sign agreement" on Screen 4
**Status:** `SIGNED_BASELINE` or `SIGNED_NEGOTIATED`

```
┌─────────────────────────────────────────┐
│                                          │
│            ✓                             │
│         (subtle check animation)         │
│                                          │
│      You're all set, Julia!              │
│                                          │
│ Your rental agreement is signed and      │
│ your equipment is locked in for          │
│ May 12 – 15.                             │
│                                          │
│ ┌─────────────────────────────────┐    │
│ │ ⬇ Download signed agreement      │    │
│ └─────────────────────────────────┘    │
│                                          │
│ A copy has been emailed to:              │
│ • juliakostenevich@gmail.com (you)       │
│ • Your SirReel account team              │
│                                          │
│ ─────────────────────────────────        │
│                                          │
│ What happens next:                       │
│                                          │
│ 📅 May 11 (1 day before)                 │
│    Pickup confirmation email             │
│                                          │
│ 📍 May 12, 8:00 AM                       │
│    Equipment ready at SirReel            │
│    8500 Lankershim Blvd, Sun Valley      │
│                                          │
│ 🚚 May 15, 5:00 PM                       │
│    Return by this time                   │
│                                          │
│ [+ Add to calendar]  [📋 Job paperwork]  │
│                                          │
│ ─────────────────────────────────        │
│                                          │
│ Signed at 2:47 PM PT on May 12, 2026     │
└─────────────────────────────────────────┘
```

**Subtle celebration:** Animated check mark appears, brief and professional. No confetti explosion — this is a contract signing, not a game show. The check feels like accomplishment without feeling juvenile.

**Personalized confirmation** — "You're all set, Julia!" Uses their name.

**Outcome-focused message:** "Your equipment is locked in for May 12–15." Speaks to what they care about (the rental working), not the abstract (legal binding).

**Download signed PDF** prominent — they want this for their records.

**Email confirmation** — explicit list of who got copies. Reassuring.

**Next steps timeline** — calendar-style view of upcoming dates. Add-to-calendar button generates `.ics` for both pickup and return.

**Audit transparency, kept simple:** Shows timestamp only — visible reassurance the signing was captured, without surveillance-style location/device data that can feel invasive.

---

## Component Specifications

### Multi-Option Signature Capture

State-managed component handling three input modes:

**Type Mode:**
```
- Auto-renders signer name in Allura script font
- Live preview updates as user types name
- Final output rendered to PNG at 600x200, transparent background
- Signer name field above (editable)
- Falls back to draw mode if no name provided
```

**Draw Mode:**
```
- HTML5 canvas, signature_pad library
- Mobile: 350px height, full width, supports both portrait and landscape
- Desktop: 200px height, 600px width
- Stroke smoothing on, velocity-based line width
- Clear button (top-right of canvas)
- Auto-trims whitespace on capture
- Outputs PNG at 600x200, transparent background
```

**Upload Mode:**
```
- Drag-drop or click-to-upload
- Accepts PNG, JPG, max 2MB
- Background removal (basic) — converts white background to transparent
- Auto-crops to signature bounds
- Resizes to fit 600x200 max while preserving aspect ratio
- Preview shows result before continuing
```

All three modes produce the same output format so downstream PDF generation is consistent.

### Progress Indicator

Top of every screen during signing flow:

```
←  Step 1 of 3      ━━━━━━━━━━━━━━━━━━━━━
                    Review  •  Sign  •  Confirm
```

Or simpler:

```
←                                Step 2 of 3
```

Mobile: minimal, just "Step X of 3" left-aligned.
Desktop: stepper visualization with labels.

Back button always returns to previous step with state preserved (no data loss).

### Agreement Viewer

Single-mode embedded PDF viewer (no toggle):

- Embedded PDF using PDF.js or similar
- Scrollable within container (not page scroll)
- Sticky progress bar at bottom shows scroll position
- Search bar at top
- Section nav menu (clauses 1-29, addenda) on desktop / hamburger on mobile
- **Inline key-term callouts:** clickable annotations on key clauses (insurance, liability, indemnity, default) with plain-English explanations expandable inline. Tapping a callout shows a tooltip-style overlay with the simplified explanation; full legal text remains the binding document. This is the comprehension aid — not a substitute for reading the actual agreement.

### Sticky Action Bar (Mobile)

Bottom of screen, persistent:
```
┌─────────────────────────────────────────┐
│ [Continue to sign →]                     │
└─────────────────────────────────────────┘
```

Always visible on mobile during scroll. Buttons inset from screen edges. Background subtly blurred to maintain context.

### Save and Continue Later

Available on Screens 2 and 3:

```
[Save and continue later]  → opens modal:

┌─────────────────────────────────────────┐
│ Continue signing later                   │
│                                          │
│ We'll email you a link to pick up        │
│ right where you left off.                │
│                                          │
│ Email: juliakostenevich@gmail.com        │
│                                          │
│ [Send link]    [Cancel]                  │
└─────────────────────────────────────────┘
```

Saves current state to SignedAgreement record with a `pendingResumeToken`. Sends email with magic link that resumes the flow at the same step.

---

## Mobile-First Design Approach

**Breakpoints:**
- Mobile: 320–767px (primary design target)
- Tablet: 768–1023px
- Desktop: 1024px+

**Mobile-specific behaviors:**

- **Touch targets minimum 44x44px** (Apple HIG)
- **Sticky action buttons** at screen bottom — always reachable with thumb
- **Landscape support for signature pad** — rotate device prompts user "Rotate for easier signing" but doesn't require it
- **Native scroll behavior** preserved on agreement viewer (don't fight the OS)
- **Reduced motion respected** — `prefers-reduced-motion` disables the success check animation
- **Tap-to-zoom on PDF** — pinch and zoom support in agreement viewer
- **Form autofill** — proper `autocomplete` attributes on name/email fields so iOS/Android offer their saved data

---

## Error States & Recovery

### Network failure during signing

If the `POST /sign` request fails:
- Show error toast: "Connection lost. Don't worry — your signature is saved. Try again?"
- Retry button keeps all captured data (signature, name, etc.)
- Auto-retry once after 5 seconds if still on page

### Session expiry

If magic link token expires mid-flow:
- Show: "This signing link has expired. We'll send you a fresh one."
- Auto-trigger resend
- New link arrives in email, picks up where they left off

### Signature pad won't capture (browser issue)

- Detect canvas support; if missing, hide draw mode, default to type
- If draw mode fails mid-attempt, fall back gracefully with: "Trouble with drawing? Try typing instead."

### Browser back button

- Intercept back button on Screens 2-4
- Show confirmation: "Leave signing flow? Your progress will be saved."
- If yes: save state, return to portal landing
- If no: stay on current screen

### Already signed (concurrent sessions)

- If client opens portal in two tabs and signs in tab A, tab B detects via polling
- Tab B shows: "This agreement has already been signed. View signed copy?"

---

## Accessibility

- **WCAG 2.1 AA compliance** target
- **Keyboard navigation** through all flows — tab order matches visual order
- **Focus indicators** visible on all interactive elements
- **Screen reader support** — ARIA labels on signature pad, progress indicator, status updates
- **Color contrast** minimum 4.5:1 for body text, 3:1 for large text
- **Don't rely on color alone** — status indicators use icon + text
- **Reduced motion** respected — no auto-playing animations if user prefers reduced motion
- **Text resize** — layout works at 200% zoom
- **Alternative signature input** — users who can't draw or type can request a manual signing process via the "Questions? Contact us" link

---

## Trust & Reassurance Elements

**Subtle but present throughout:**

- **SirReel logo and branding** on every screen — confirms legitimacy
- **HTTPS lock + URL** visible (browser default, but ensure trustworthy domain)
- **"E-SIGN Act compliant" badge** in footer of signing screens
- **Account rep contact** accessible from every screen
- **Audit trail transparency** in success state — shows them exactly what was captured
- **Email confirmation explicitly listed** — they see who got copies
- **Professional design quality** — premium feels safe; cheap feels sketchy

**What NOT to do:**
- ❌ Pop-up modals demanding signature urgency
- ❌ Countdown timers
- ❌ "Limited time offer" framing
- ❌ Disabled close/back buttons
- ❌ Sketchy fonts or amateur graphic design
- ❌ Hidden costs revealed after signing

---

## Email Communications

### Pre-signing reminder

**Trigger:** Order paperwork generated, no signing activity after 24 hours
**Subject:** "Your SirReel rental agreement is ready"
**Tone:** Helpful nudge, not pushy

```
Hi Julia,

Quick reminder — your rental agreement for 
1323-0526 King / Love is ready to sign.

Equipment: 12 items
Rental period: May 12 – 15, 2026

[Review and sign]

Questions? Just reply.

The SirReel team
```

### Post-signing receipt

**Trigger:** Signing complete
**Subject:** "Your SirReel rental agreement is signed"
**Includes:**
- Signed PDF attached
- Rental summary
- Pickup details
- Calendar `.ics` files for pickup and return dates
- Account rep contact

```
Hi Julia,

You're all set. Your rental agreement for 
1323-0526 King / Love is signed and your 
equipment is locked in.

Pickup: May 12, 8:00 AM at SirReel Sun Valley
Return: May 15 by 5:00 PM

📎 Signed agreement attached
📅 Add to calendar (pickup) | (return)

Questions? Just reply to this email.

The SirReel team
```

### Resume signing link

**Trigger:** User clicks "Save and continue later"
**Subject:** "Continue signing your SirReel agreement"
**Body:** Brief, just gets them back to the flow

---

## Animations & Micro-interactions

Subtle, professional, performance-conscious:

- **Step transitions:** 200ms fade + 8px upward slide between screens
- **Button hover (desktop):** 100ms color shift + subtle shadow
- **Button press:** 100ms scale to 0.98
- **Signature pad clear:** 150ms fade-out of existing strokes
- **Success check animation:** SVG path animation, 600ms, ease-out
- **Loading states:** Subtle pulse on pending elements, not spinners
- **All animations respect `prefers-reduced-motion`** — replaced with instant transitions

---

## Visual Design Reference Points

When briefing designers or selecting UI libraries, reference these for quality bar:

- **Stripe checkout** — for cleanliness, clear hierarchy, trust signals
- **Linear** — for typography, spacing, subtle animations
- **Vercel domain setup** — for status states, success feedback
- **Notion's onboarding** — for warm, human tone
- **Figma's payment flow** — for premium feel without ostentation

**Avoid as anti-references:**
- Generic enterprise SaaS (too sterile)
- Consumer apps with heavy gamification (too playful)
- Government/insurance forms (too clinical and intimidating)

---

## Component Library Recommendations

For Claude Code to implement with consistent design:

- **shadcn/ui** for base components (button, input, dialog, etc.) — already mentioned in your stack
- **lucide-react** for icons (already in your stack)
- **react-pdf** for embedded PDF viewing
- **signature_pad** for draw-mode signature
- **react-dropzone** for upload-mode signature
- **framer-motion** (optional) for animations — adds bundle weight, but enables much higher-quality micro-interactions

---

## Implementation Priority

If building incrementally, here's the order of UX features by impact:

**Must-have (V1):**
1. Welcome screen with rental summary
2. Agreement viewer (full mode)
3. Type-mode signature
4. Acknowledgment checkbox
5. Confirmation screen
6. Success screen with download
7. Email confirmation with PDF attached
8. Mobile-responsive throughout

**High value (V1.1):**
9. Draw-mode signature
10. Save and continue later
11. Calendar attachments in email
12. Audit timestamp visible in success state
13. Progress indicator (steps)

**Nice to have (V2):**
14. Upload-mode signature
15. Key-term inline callouts in agreement viewer
16. Section navigation in agreement viewer
17. Animations and micro-interactions polish
18. Pre-signing reminder emails

---

## UX Decisions (Locked 2026-05-12)

The following decisions are locked. The spec above reflects them.

1. **Type signature font:** Allura only (no font picker; single locked option). Matches premium production-services positioning.

2. **Agreement reading:** Full agreement view only. No Quick Summary mode. Inline key-term callouts on insurance/liability/indemnity/default clauses provide comprehension aid without replacing the binding legal text. Soft read enforcement (80% scroll OR 30 seconds with 50% scroll) prevents accidental signings without being patronizing.

3. **Audit trail visibility:** Timestamp only. No IP address, location, or device displayed to the client in the success state. Full audit data (IP, user-agent, timestamp, acknowledgment text) is still captured and stored in the SignedAgreement record for E-SIGN compliance — it's just not surfaced back to the signer.

4. **Account rep contact:** Not surfaced in the signing flow or post-signing email. Replaced with generic "Reply to this email" / "Reply to this thread" contact patterns. Removes maintenance burden of keeping rep assignments synced and simplifies the experience.

5. **Pre-signing reminder timing:** TBD. Configurable in implementation; recommended default 24 hours after portal generation if no signing activity. Can be tuned based on observed conversion data after launch.
