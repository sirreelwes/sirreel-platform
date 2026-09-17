# One thread per job — design (2026-09-16, for Wes)

**Status:** Phase 1 SHIPPED 2026-09-17 (anchors + auto-filing —
`src/lib/email/jobThread.ts`, `jobThreadRules.ts`, the pubsub filing, seven
send sites + the job composer; `npm run test:job-thread`). Phases 2 and 3
are not built. Two things Phase 1 settled that the design left open: the
root subject ADOPTS the client's filed inquiry subject when one exists (a
minted `<job> — SirReel (<code>)` only when nothing is filed), and HQ's own
copy of a send arriving in jobs@ is folded onto the recorded row by an
`X-SirReel-Job-Message` marker header, so it does not matter whether Resend
honours a caller-set Message-ID. Sketch page: see the artifact link in the
session that produced this; the mechanism below is the part that matters if
the page is lost.

**The ask (Wes):** "figure out a way to have individual jobs stay on one
thread. For the client to have a single thread would be better … Is it that
we open a chat within the job itself and that chat feeds a single email
thread to the client? … If there's a way to let Oliver, Jose, Wes, Dani and
Ana work from their individual emails that also would be good."

## Decision

**Build the Job Thread: one conversation per job, living on the job page,
with email as its transport — and anchor every message so that a reply from
someone's own Gmail lands on the same thread.**

Wes's instinct is right, with one correction. It is not "an internal chat
that feeds an email thread" — two things, one copying into the other. It is
**the email thread itself, viewed and written from inside the job**, with
internal notes interleaved that never leave the building. And "work from
your own email" is not a competing design: once the anchors below are on
every message, replying from Gmail files onto the same thread. The job page
is the home; Gmail is a door.

What each person gets:

| Person | Today | With the Job Thread |
|---|---|---|
| Client | 5+ separate emails per job (quote, welcome, agreement, follow-up, invoice), different subjects, different reply addresses | One conversation in their inbox, one subject, the whole history in one place |
| Jose / Oliver | Reply from Gmail; HQ shows the client's half and not theirs unless filed by hand | Reply from the job page OR from Gmail; either way it is on the job |
| Wes | wes@ is private (LINKED mode); first replies to HQ mail could never link | First replies link, because HQ now knows its own Message-IDs |
| Ana | Invoice mail is its own thread from billing@ | Invoices ride the same thread; her replies file to the job |
| Dani | Sees mail in Gmail only | Sees the whole job conversation plus internal notes without being on every CC |

## Why the thread shatters today (troubleshooting, from the code)

1. **Every HQ send starts a new conversation.** 91 call sites go through
   `sendAgreementEmail` (`src/lib/email/sendAgreementEmail.ts`), which passes
   Resend only from/to/cc/replyTo/subject/html/text/attachments. No
   `In-Reply-To`, no `References`. The quote, the welcome, the paperwork
   summary, the follow-up and the invoice are five unrelated threads in the
   client's mail program.
2. **Five different subjects.** Gmail groups a conversation by the References
   chain AND a matching subject (prefixes stripped). Even with headers, the
   subjects would have to agree.
3. **Replies are aimed at different inboxes.** Reply-To is the agent on a
   quote or welcome, `billing@` on an invoice, and `hello@` is appended for
   `wes@`. So one client's replies land in jose@, billing@ and hello@.
4. **HQ threads are Gmail's per-mailbox thread ids.** `EmailThread.gmailThreadId`
   is unique and is the ingest upsert key. The same conversation seen from
   jose@ and from hello@ is two EmailThreads. Messages are deduped by RFC
   Message-ID (`duplicateOfId`); threads are not.
5. **Ingest never files a thread to a job.** `EmailThread.jobId` is written
   only by an explicit attach (ThreadDrawer, inquiry conversion, the job
   email send). A client's reply to a Resend-sent quote arrives under a Gmail
   thread id HQ has never seen, so it is a new, unfiled EmailThread.
   `recordOutboundOnThread.ts` says so in its own header: "needs filing to
   the Job by hand".
6. **HQ does not know its own Message-IDs.** Resend generates them; HQ stores
   only Resend's delivery id. `hasKnownConversationLink()` therefore cannot
   match a first reply — which is exactly why the hello@ capture trick exists
   (Wes 2026-08-28) and why wes@ could never be watched for replies only.
7. **Team visibility lives in a Google Group** (`rentals@`, `withTeamCc`) that
   HQ cannot watch, so "did someone already answer" is a Gmail question.

Nothing in this list is a bug in one file. It is the absence of one rule:
*an email about a job carries proof of which job it belongs to.*

## The mechanism — three anchors on every message

Every client-facing email on a job carries three anchors. Any one of them is
enough for the ingest to file the reply; together they survive subject
edits, forwards, reply-all and a client who answers from a different address.

### A. References chain (the strong one)
HQ mints its own Message-ID for every send — `<jt.<jobcode>.<ulid>@sirreel.com>`
— and sets `In-Reply-To` / `References` to the thread's root and its last
message. The minted id is stored on the outbound `EmailMessage.rfc822MessageId`
(the column exists; `recordOutboundOnThread` just never filled it). From then
on `hasKnownConversationLink()` — already written for wes@ — proves any
reply's membership, from any inbox, from any mail program.

*Verify before relying on it:* that Resend honours a caller-supplied
`Message-ID` header. If it rewrites it, anchor B still delivers HQ a copy of
its own send with the real id, so the chain is learned one hop later.

### B. The job address (the belt)
`jobs+sr-job-0219@sirreel.com` on the Cc of every outbound on the thread.
This is the driver-relay mechanism (`jobs+<tag>@`, `src/lib/sub-rentals/driverRelay.ts`)
already in production: plus-addressing lands in jobs@ — watched, SALES mode,
no Workspace change — and the pubsub route already parses the tag off To /
Cc / Delivered-To / X-Original-To. Three things it buys:

- HQ receives a copy of **its own** outbound with the real Message-ID.
- A reply-all from the client, or from a staff member in Gmail, carries the
  job code in the address — filed even if someone retitles the subject.
- A forward to a new person on the production keeps the tag.

Cc, **not** Reply-To. Reply-To replaces the human; the client's plain "Reply"
must still reach Jose. Reply-To stays the sender's own watched inbox exactly
as today (`agentReplyTo`), and the job address rides on Cc.

### C. Stable subject (what Gmail insists on)
`Big Production — SirReel (SR-JOB-0219)`, set on the first send, `Re:` +
the same on every later one. What the message *is* ("Your quote is ready",
"Rental agreement to sign", "Invoice S260912-003") moves into a bold
heading at the top of the body. This is the visible trade-off of one
thread: the client's inbox shows one growing conversation instead of a row
per document. That is the ask.

### Who it is From
- **Human-written messages go out from the author**: `Jose Pacheco <jose@sirreel.com>`
  through Resend's verified sirreel.com domain. The cadence runner already
  sends this way (`src/lib/cadence/runner.ts`), so DKIM/SPF are proven. The
  client sees a person, and their reply goes to that person's watched inbox.
- **System messages** (cadence follow-ups, portal notices, paperwork
  reminders) stay `SirReel HQ <notifications@sirreel.com>` with Reply-To the
  job's agent. Same thread, clearly a system voice.

### What the ingest does with an anchored message
In `/api/gmail/pubsub`: after the upsert, if the message's References chain
hits a stored message whose thread has a `jobId`, or the job address is in
its routing headers, **file the new EmailThread to that job** — fill-only,
never re-pointing a thread a person filed elsewhere (`fileThreadInJobIfUnfiled`
is that rule). This is the one change that makes replies appear on the job
page by themselves. Also: MONEY-mode inboxes (billing@, payments@) must keep
an anchored message even without an invoice keyword — today a client's
"thanks, paid" could be dropped by the positive filter.

## Working from your own email (Oliver, Jose, Wes, Dani, Ana)

With the anchors in place, no new tooling is needed for this:

- **Reply from Gmail to anything on the thread** → the send is in your SENT
  label → the ingest already pulls SENT → References chain → filed to the
  job, direction OUTBOUND, thread marked answered. Rule of thumb for the
  team: *reply, don't retitle; reply-all keeps the job address.*
- **Wes on wes@** (LINKED / private mode): an anchored reply links, and
  everything else still drops. Nothing about the privacy rule changes.
- **A brand-new email from Gmail** (not a reply) has no anchor. HQ cannot
  know the job; it shows up in New inbound with "Attach to SR-JOB-0219?" —
  the ThreadDrawer attach that exists today. Start it from the job page
  instead and it is on the thread from the first word.

What Gmail cannot do, and why the internal chat still matters: nobody in
Gmail can see that Jose is already typing an answer, leave a note for Ana
that the client must not see, or hand a thread to Dani. Those three things
are the reason to have the conversation in the job at all.

## The surface (Phase 2) — what the sketch shows

On `/jobs/[id]`, the "Email threads" section becomes **Conversation**:

- **Header:** the subject, the job address (copyable), participant chips
  (client contacts from JobContact + anyone the thread pulled in), and a
  "Jose is answering" claim chip.
- **Timeline:** one merged, chronological stream across every EmailThread
  filed to the job (canonical messages only, `duplicateOfId IS NULL`).
  Client messages on the left; SirReel messages on the right, with the
  author's name; system sends collapsed to one line ("Quote S260912-003
  sent · Jose · Sep 12", expandable); **internal notes** interleaved in a
  distinct style, marked "Internal — never sent", with @mentions.
- **Composer:** two tabs, *Reply to client* and *Internal note*. To = the
  canonical recipient (`pickCanonicalRecipient`), Cc = thread participants
  (`participantsForReply`, capped at 15 as today). The subject is fixed and
  shown greyed. A lock chip reads "filed to SR-JOB-0219" — the job address
  is implicit, never typed. "Send as Jose Pacheco". Attach the current
  quote / agreement / invoice PDF from a picker rather than from disk.
- **Every existing send button keeps working** (Send quote, Send welcome,
  Paperwork summary, Send invoice, follow-ups). They route through the same
  send function and appear in the timeline as system rows. A rep can tick
  "send as a separate email" on any of them for the rare case that needs
  it; the default is on-thread.

Out of scope for now, noted so it is not re-derived: the client portal has
no messaging surface (the client's channel is email, which this design
keeps); SMS threads are per phone number (`SmsThread`) and could be shown
in the same timeline later; `job_messages` is a dead legacy table keyed by
RentalWorks order number — do not resurrect it for internal notes.

## Where it lives (2026-09-17 — Wes asked)

Today `JobEmailThreads` is the twelfth of thirteen stacked blocks on
`/jobs/[id]`, above Activity, and renders nothing when no thread is filed.
The Conversation moves to where the width allows:

- **1280px and up (monitor, 15" laptop):** a pinned RAIL beside the job,
  not a section within it. The facts stay in the existing `max-w-5xl`
  column; the Conversation sits at ~400px on the right, full height, its
  own scroll, composer docked at the bottom. It stays put while the job
  scrolls, so the answer is written next to the quote lines or the COI
  status it depends on. `JobEmailButton` stops opening a modal and focuses
  the composer.
- **768–1279px (iPad landscape, small laptop, or the rail still open):**
  the rail folds into a TAB STRIP under the job header — Details |
  Conversation (unread count). One tap opens it full width.
- **Under 768px (phone; the jobs layout already hides the sidebar and gives
  the detail the whole screen):** same two tabs; Conversation is a
  full-screen chat — timeline scrolls, composer docked above the home bar,
  16px inputs so iOS Safari does not zoom (the /admin/maintenance rule),
  Reply / Internal note as the toggle above the box.
- **Deep link `/jobs/[id]?tab=conversation`** (same pattern as
  `/jobs?panel=incoming`) so a notification lands on the thread. The /jobs
  rail row gets an unread dot + the last line beside the cadence colour;
  the landing panel's New inbound shows a filed reply as "Sarah Chen ·
  SR-JOB-0219" pointing at the tab.
- **The order page gets NO composer** — send status as today plus a link to
  the job's Conversation. A second composer is a second thread by another
  name.

## Billing on the same thread (2026-09-17 — Wes asked whether Jose and Oliver would see it all)

An email thread is not a subscription: who receives a message is decided
by that message's To/Cc, never by the thread. The anchors file a message
to the job and add NO recipients. So Ana's invoice still goes to the
accounting contact with Reply-To `billing@` (unchanged), and Jose's Gmail
never carries the billing exchange unless the client copies him — also
true today. On the job page everyone sees the whole story, kept tidy by:

- **Lanes.** Each message gets a lane from where it landed / who sent it:
  SALES (jose@, oliver@, info@), BILLING (billing@, payments@, Ana),
  SYSTEM. Filter chips in the panel header; an AGENT's default is Sales.
  Notifications follow the lane — a reply into billing@ pings Ana and
  never enters Jose's New inbound. Lane is derived on read from
  `routingHeaders.deliveredTo` / the author's role; no column needed.
- **Hand to Billing.** The end-of-job "can we get the final invoice?" is a
  reply to whatever is on top (probably Jose's), so it reaches Jose — with
  two threads too. Jose taps "Hand to Billing"; Ana gets the ping, answers
  from the thread with Reply-To billing@, and the client's replies go to
  her from then on. This is the claim chip with a Billing target
  (`claimedByUserId` on `sr_job_threads`, plus a lane on the claim).
- **Role gate, optional.** The job page already money-gates cards by role;
  the Billing lane can be hidden from AGENT-role users the same way.
  Recommendation: leave it visible and rely on the filter — Jose knowing a
  client is 60 days late is useful to sales. Wes's call.

## Data (Phase 2 — additive SQL, never `db push`)

- `sr_job_threads` — one row per job, created lazily on the first send:
  `id, job_id UNIQUE, subject, root_rfc822_message_id, last_rfc822_message_id,
  last_inbound_at, last_outbound_at, claimed_by_user_id, claimed_at`.
- `sr_job_thread_notes` — internal notes: `id, job_id, author_user_id, body,
  anchored_email_message_id NULL, created_at`. A note can hang off a specific
  client message ("re: her generator question").
- Messages themselves stay `EmailMessage`. The thread view is a read across
  `EmailThread.jobId`, not a second copy of the mail.

Phase 1 needs **no schema change**: the minted Message-ID goes in the
existing `rfc822MessageId` column, and the job's root thread is the
`hq-job-…` EmailThread that `startThreadForJob` already creates.

## Phases

1. **Anchors + auto-filing.** `sendOnJobThread()` in `src/lib/email/jobThread.ts`
   wrapping `sendAgreementEmail`: mint Message-ID, set References, Cc the job
   address, fix the subject, record with the id. Pubsub files anchored
   threads to the job. Wire the six sends the client actually receives
   (quote, welcome, paperwork summary, follow-up, portal invite, invoice).
   *The client gets one thread from this phase alone.* One session.
2. **The Conversation surface + internal notes + claim.** Two tables, the
   merged timeline, the composer, `From` = author. Two to three sessions.
3. **Gmail-native sending (optional).** Add `gmail.send` to the service
   account's domain-wide-delegation grant (one Workspace admin action, the
   same place the read scopes were granted) and send human-written messages
   through `users.messages.send` as the author. What it adds over Phase 2:
   the message sits in the author's Gmail *Sent* and threads natively in
   their Gmail, so a rep who lives in Gmail sees the whole thread there too.
   Must be scoped so a session can only send as its own mailbox. One session.

## Decisions Wes should make

1. **Billing on the same thread?** Recommended yes (Ana was named). Invoice
   messages keep Reply-To `billing@`; her replies file to the job. The
   alternative is a second "money" thread per job.
2. **From = the person for human-written messages?** Recommended yes. The
   client sees Jose, not a system. System sends stay SirReel HQ.
3. **The job address is visible to the client** on Cc
   (`jobs+sr-job-0219@sirreel.com`). Live with the plus form, or add the
   Workspace routing rule for `sr-job-0219.jobs@` (driverRelay.ts explains
   the trade)? Recommended: live with it; nobody objects to a Cc.
4. **Phase 3 worth the admin change?** Only if the team keeps working from
   Gmail after Phase 2 ships. Decide after, not before.
5. **`rentals@` team Cc** stays through Phase 1; once the team reads the
   conversation on the job, drop it (`withTeamCc`) so the client's Cc line
   stops carrying a group address.

## What this does not change
- "Email never changes a job on its own" (2026-09-11) holds. The thread is a
  record and a place to write; nothing in it moves an order, hold or date.
- The LINKED privacy rule on wes@ holds; anchors only add proof, never
  widen the filter.
- Partner mail (`sendPartnerMail`, `replyToExact`) is untouched — partners
  are not on job threads.
