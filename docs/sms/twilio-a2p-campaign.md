# Twilio A2P 10DLC campaign — what is filed

Campaign `CMadf71a842a44855e507d1cfbb9436cb0` · use case ACCOUNT_NOTIFICATION ·
Messaging Service `MGda3482bd81e2c26b45cc188de36124dc` · number (747) 335-1665.

First submission (2026-09-07 16:37Z) was rejected with **error 30909**: the
Message Flow did not describe every opt-in path and its disclosures. This file
is the resubmission, field by field, and the source of truth for the keyword
replies in `src/lib/sms/threads.ts` (`KEYWORD_REPLIES`) — change one, change
the other.

Public pages reviewers read: https://sirreel.com/sms-terms (CTA at `#opt-in`)
and https://sirreel.com/privacy. Both must stay reachable without login.

---

## Campaign description

```
SirReel Studio Services (SirReel Production Vehicles, Inc.) rents production vehicles and stage space to film and TV productions in Los Angeles. This campaign sends transactional account notifications about a rental the recipient or their production has booked with us: booking confirmations, day-of logistics (a changed call time, delivery address or pickup window), a link to the recipient's booking or driver page, and replies to questions the recipient texted us. Recipients are production staff who booked with us, the on-site contact they named for a delivery, and the drivers delivering or collecting a vehicle. No marketing or promotional content is sent. Every message identifies SirReel Studio Services and ends with "Reply STOP to opt out."
```

## Message flow / how end users opt in (the 30909 fix)

```
End users opt in to SirReel Studio Services booking texts through one of four paths. Every path shows the same consent language beside the mobile-number field, with links to https://sirreel.com/sms-terms and https://sirreel.com/privacy: "OK for SirReel Studio Services to text this number about this booking - day-of changes to call time, delivery address or pickup. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of renting." Consent checkboxes are unchecked by default; no consent is recorded unless the user ticks the box. (1) Public web form at https://sirreel.com/sms-terms#opt-in: the user enters their mobile number, ticks the consent checkbox and submits, and receives the opt-in confirmation text. (2) Keyword: the user texts START to (747) 335-1665; the call to action "Text START to (747) 335-1665" with the full disclosure is displayed at the same public URL. (3) Client portal (login-protected): a client entering the on-site contact for their rental sees the mobile-number field and the consent checkbox on the same form with the language above; consent is recorded only when ticked. (4) Partner and driver pages (login-protected): a vehicle partner or driver entering their own number for a delivery sees the same field, checkbox and language. Each opt-in is stored against the number with the timestamp and source (form, keyword, portal, partner page, driver profile). Messages are transactional only: booking confirmations, day-of logistics and replies to questions the user texted us; no marketing. Every outbound message ends with "Reply STOP to opt out." STOP (also END, CANCEL, UNSUBSCRIBE, QUIT) is honored immediately with one confirmation and blocks all further sends, automated or staff-initiated, until the user texts START. HELP returns our email and phone number.
```

(1,863 characters; the field limit is 2,048.)

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

## If Twilio comes back with 30921 (login-protected flows)

Paths 3 and 4 sit behind client, partner and driver logins, so a reviewer
cannot open them. The public form at `#opt-in` carries identical language and
is the reviewable example. If a reviewer asks to see the gated forms, host
screenshots of the portal Deliveries card, the partner delivery-contact card
and the driver profile (each showing the number field + unchecked box + the
disclosure) under `public/sms/` and add the URLs to the Message Flow text.
