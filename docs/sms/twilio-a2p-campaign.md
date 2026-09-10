# Twilio A2P 10DLC campaign — what is filed

Campaign `CMadf71a842a44855e507d1cfbb9436cb0` · use case ACCOUNT_NOTIFICATION ·
Messaging Service `MGda3482bd81e2c26b45cc188de36124dc` · number (747) 335-1665.
Brand `BN8ceaba8e959be179480ba5034eabe104` (APPROVED, STANDARD, VERIFIED).

## APPROVED 2026-09-10

Twilio's compliance email ("Your A2P 10DLC campaign is approved … registered
with carriers") arrived 2026-09-10 after three 30909 rejections (log at the
bottom). The fourth filing — the one citing
https://sirreel.com/sms-terms/opt-in-examples with that page made crawlable
and the footer link to the Text Message Terms — is what passed. Nothing in
this file needs to change for the campaign; the rest of the document stays
as the record of what is on file, and `KEYWORD_REPLIES` in
`src/lib/sms/threads.ts` must keep matching it.

### Go-live checklist (the approval is not the switch-on)

The email's own condition: *"You can begin sending messages on this
Campaign by adding phone numbers to the linked messaging service."*
Carriers treat a text as registered only when it leaves THROUGH the
messaging service. A text from a bare number that is not in the service is
filtered as unregistered (error 30034 on the delivery receipt, nothing at
send time), which would look exactly like "the campaign is approved but
nobody gets our texts".

1. **Console → Messaging → Services → the MG service → Sender Pool.** Confirm
   (747) 335-1665 is listed; add it if not.
2. **Vercel Production env: `TWILIO_MESSAGING_SERVICE_SID=MGda3482bd81e2c26b45cc188de36124dc`.**
   `sendSms` then sends `MessagingServiceSid` and NO `From` — the service
   picks its sender, and a number that is not in the service cannot be
   picked, so step 1 being wrong fails at send time instead of silently.
   `TWILIO_FROM_NUMBER` stays as the fallback for an environment without
   the service. Redeploy after setting it (env changes need a build).
3. **Console → the MG service → Integration.** Set "Send a webhook" to
   `https://hq.sirreel.com/api/public/sms/inbound?key=<TWILIO_WEBHOOK_SECRET>`
   — or leave "Defer to sender's webhook" and keep the webhook on the
   number itself. Once sends go through the service, replies route by the
   SERVICE's inbound setting, not only the number's. Same for the status
   callback (`/api/public/sms/status`), which `sendTracked` passes per
   message either way.
4. **Console → the MG service → Opt-Out Management (Advanced Opt-Out).**
   Paste the opt-out and help messages below as the custom replies, so what
   the person receives matches what is filed (Twilio's defaults carry no
   brand name).
5. **Verify with `GET /api/admin/a2p-campaign`** (admin login,
   production). Read three lines: `campaigns[0].status` should be
   `VERIFIED`; `service.fromNumberInService` must be `true`;
   `sendPath.mode` should be `messaging-service` with
   `matchesQueriedService: true`. Then text START to (747) 335-1665 from a
   staff phone and confirm the opt-in reply arrives, and send one job text
   from a job page and watch its row reach `delivered` on the status
   webhook.

`npm run test:sms-config` pins the send-path shape (service SID → no From;
no service → normalised From).

Public pages reviewers read: https://sirreel.com/sms-terms (CTA at `#opt-in`)
and https://sirreel.com/privacy. Both must stay reachable without login.

---

## Campaign description

```
SirReel Studio Services (SirReel Production Vehicles, Inc.) rents production vehicles and stage space to film and TV productions in Los Angeles. This campaign sends transactional account notifications about a rental the recipient or their production has booked with us: booking confirmations, day-of logistics (a changed call time, delivery address or pickup window), a link to the recipient's booking or driver page, and replies to questions the recipient texted us. Recipients are production staff who booked with us, the on-site contact they named for a delivery, and the drivers delivering or collecting a vehicle. No marketing or promotional content is sent. Every message identifies SirReel Studio Services and ends with "Reply STOP to opt out."
```

## Message flow / how end users opt in (the 30909 fix)

```
The call to action is displayed publicly at https://sirreel.com/sms-terms#opt-in and reads: "Get booking updates by text. Text START to (747) 335-1665. You'll receive confirmations and day-of logistics for rentals you or your production has booked with SirReel. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of renting." The same public page hosts a web opt-in form: a mobile-number field with an unchecked consent checkbox beside it reading "I agree to receive text messages from SirReel Studio Services at the mobile number above about my rental bookings, including confirmations and day-of logistics changes. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of renting.", with links to the Text Message Terms (https://sirreel.com/sms-terms) and the Privacy Policy (https://sirreel.com/privacy). Submitting it records the opt-in and sends the confirmation message. End users also opt in by texting START to (747) 335-1665, and on three booking forms that show the same consent checkbox beside the mobile-number field: the client portal's on-site delivery contact, a vehicle partner's delivery-contact page, and a driver's own profile. Those three sit behind private booking links, so each is reproduced exactly as the user sees it on a public page: https://sirreel.com/sms-terms/opt-in-examples. Checkboxes are unchecked by default and consent is recorded only when the user ticks the box; each opt-in is stored with its timestamp and source. Messages are transactional only: booking confirmations, day-of logistics, and replies to questions the user texted us. No marketing is sent. Every message ends with "Reply STOP to opt out." STOP, END, CANCEL, UNSUBSCRIBE, QUIT, OPTOUT and REVOKE are honored immediately with one confirmation and block all further sends until the user texts START. HELP returns our email and phone number.
```

(1,988 characters; the field limit is 2,048.)

## Sample messages (five, as filed 2026-09-08)

Every sample names the brand in full and ends with the STOP line that
`sendTracked` appends. Links stay on sirreel.com domains (the client portal is
tsx.sirreel.com). Driver pages really live on utliiz.com; keep them out of the
samples so the reviewer sees one brand domain.

```
SirReel Studio Services: Call time for your rental on job SR-JOB-0231 has moved to 6:30 AM Thu 9/10. Delivery address is unchanged. Questions? Reply here. Reply STOP to opt out.
```
```
SirReel Studio Services: Your 3-ton grip truck is confirmed for pickup Mon 9/14 at 7:00 AM, 8500 Lankershim Blvd, Sun Valley. Booking details: https://tsx.sirreel.com/portal/job/forgotten-island Reply STOP to opt out.
```
```
SirReel Studio Services: The delivery address for Fri 9/11 is now on your booking page: https://tsx.sirreel.com/portal/job/forgotten-island Gate code follows by text the morning of. Reply STOP to opt out.
```
```
SirReel Studio Services: Gate access has changed for today's delivery. Use Gate 3 and tell security you're with transpo. Questions? Reply here. Reply STOP to opt out.
```
```
SirReel Studio Services: Your vehicle return is scheduled today by 6:00 PM at 8500 Lankershim Blvd, Sun Valley. Reply here if you're running late. Reply STOP to opt out.
```

## Keywords and replies (must match `KEYWORD_REPLIES`)

Opt-in keywords: `START, YES, UNSTOP`

Opt-in message
```
SirReel Studio Services: You're opted in to booking updates and day-of logistics texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.
```

Opt-out keywords: `STOP, END, CANCEL, UNSUBSCRIBE, QUIT, STOPALL, OPTOUT, REVOKE`

Opt-out message
```
SirReel Studio Services: You've opted out and won't receive more texts from us. Reply START to opt back in.
```

Help keywords: `HELP, INFO`

Help message
```
SirReel Studio Services: We text about your rental booking only. Email info@sirreel.com or call (888) 477-7335. Msg & data rates may apply. Reply STOP to opt out.
```

### Twilio sends its own STOP/HELP replies too

The number sits in a Messaging Service, and Twilio answers STOP and HELP
itself with its default text before our webhook's reply (and an opted-out
number cannot be texted, so our STOP reply never lands). To make what is
filed match what the person receives, paste the opt-out and help messages
above into Messaging Services → the service → Opt-Out Management (Advanced
Opt-Out) as the custom replies. Do not file Twilio's defaults: the default
help reply carries no brand name or contact, which reviewers reject.

## Campaign attributes

| Attribute | Answer |
|---|---|
| Subscriber opt-in | Yes |
| Subscriber opt-out | Yes |
| Subscriber help | Yes |
| Embedded links | Yes (sirreel.com booking/driver links only; no public shorteners) |
| Embedded phone numbers | Yes (our office number in the HELP reply) |
| Number pooling | No |
| Age-gated content | No |
| Direct lending / loan arrangement | No |
| Affiliate marketing | No |

## The campaign exists, but is DETACHED from the messaging service (2026-09-09 — superseded by the approval above; kept as the record of how the Console and API disagree)

Two sources disagreed, and the Console is the accurate one:

- **Console** → Trust Hub → Registrations → A2P 10DLC Campaigns lists
  campaign `CMadf71a…` as **Rejected**, brand SirReel `BN8ceaba…`,
  use case Account Notification, messaging service `MGda3482…`.
- **API** → `/v1/Services/MGda3482…/Compliance/Usa2p` returns an EMPTY
  list, and fetching that campaign SID under that service returns
  **404 / 20404**.

Read together: the campaign record still exists in the A2P registry, but
its association with the messaging service was torn down when it was
rejected. The `Usa2p` resource IS that association, which is why the API
cannot see it. Do not conclude from the 404 alone that the campaign is
gone — check the Console list too.

That still explains the Console crash: "Update campaign details" on the
onboarding checklist tries to load the campaign through the association
that no longer exists, and throws React #310.

**The brand is fine — do not re-register it.** `BN8ceaba8e959be179480ba5034eabe104`
is APPROVED, brand type STANDARD, identity VERIFIED.

**Next step:** open the campaign from the Campaigns list (click its SID)
and see what actions it offers. If it can be edited and resubmitted, file
the fields below. If a rejected campaign cannot be edited — which is
common — use **Create A2P Campaign** on that page and file the same
fields against the existing brand and messaging service. Verify either
way with `/api/admin/a2p-campaign`: once a campaign is properly
associated it appears in `campaigns[]` and carries the reviewer's own
`errors` text after any future rejection.

## What the Console says that the email does not (2026-09-09)

The campaign page's own banner: *"rejected due to issues verifying the
Call to Action (CTA) provided for the campaign"*. The email only ever said
30909. **Read the Console banner, not the email.**

The stored fields there also proved the 9/8 edits SAVED — the flow on file
is the four-path version citing `/sms-terms/opt-in-examples`. So the
rejections were neither lost edits nor bad wording; the reviewer could not
VERIFY the call to action.

Verified good on 2026-09-09: every sample-message link resolves 200, the
CTA and the consent form are server-rendered (present with JS disabled),
and the home-page footer links both legal pages.

Fixed: `/sms-terms/opt-in-examples` carried `noindex, nofollow` — the very
page the campaign cites for the gated opt-in paths, which a vetting
crawler may decline to evaluate. It is now crawlable and, with `/sms-terms`
and `/privacy`, listed in the sitemap.

**Use "Edit & resubmit" on the campaign page.** The onboarding checklist's
"Update campaign details" button is the one that throws React #310.

## Rejection log

| # | Rejected | What was filed | Read |
|---|---|---|---|
| 1 | 2026-09-07 | Original flow: START keyword only | 30909 |
| 2 | 2026-09-08 ~10:37 | Flow describing all four opt-in paths | 30909 |
| 3 | 2026-09-08 (after the 3rd filing) | Flow citing /sms-terms/opt-in-examples | 30909 |
| — | **2026-09-10 APPROVED** | Same flow, opt-in-examples page crawlable + footer link to the terms | — |

The Twilio Console threw **React error #310** on the campaign edit form on
both 9/8 attempts. That is a bug in Twilio's own app, not in the data — but
it means an edit may never have been saved. The rejection email always
prints the campaign's ORIGINAL submitted timestamp (2026-09-07T16:37Z), so
it cannot distinguish a fresh verdict from a stale one either.

**Before rewriting anything a fourth time, prove what Twilio actually
holds:** `node tmp/a2p-resubmit.mjs --read` (untracked; needs
TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID/SECRET in the shell). It prints the
stored message flow, the reviewer's own `errors` text — which the email
omits — and says outright whether the stored text matches this document.
If it does not match, the console edits were lost and the fix is
`--write`, not new copy.

If the stored text DOES match and 30909 still comes back, the remaining
candidates, in order:
1. **Use case.** ACCOUNT_NOTIFICATION but the description and samples say we
   reply to inbound questions. `CUSTOMER_CARE` or `MIXED` fits what we
   actually send; a use-case mismatch is read as an unverifiable flow.
2. **30919 (website).** sirreel.com's home page never mentions the texting
   program. Reviewers start at the brand's domain; a link in the footer to
   the Text Message Terms is the cheap fix.
3. **Twilio support ticket.** Three rejections on a generic code with no
   specific sub-code is what support is for; they can see the vetting
   vendor's actual note.

## If Twilio comes back with 30921 (login-protected flows)

Paths 3 and 4 sit behind client, partner and driver logins, so a reviewer
cannot open them. The public form at `#opt-in` carries identical language and
is the reviewable example. If a reviewer asks to see the gated forms, host
screenshots of the portal Deliveries card, the partner delivery-contact card
and the driver profile (each showing the number field + unchecked box + the
disclosure) under `public/sms/` and add the URLs to the Message Flow text.
