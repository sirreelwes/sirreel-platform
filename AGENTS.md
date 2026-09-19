# AGENTS.md — for Codex and any other coding agent

SirReel HQ is the internal operations platform for a working rental company.
It is **in production**, it bills real money, and it has no staging
environment. Read this file before you touch anything.

## Read these three, in this order

| File | What it is |
| --- | --- |
| **`docs/SYSTEM-MAP.md`** | **Start here.** The structural map: the domain spine, where everything lives, the architectural patterns, who can see what. ~10 minutes and the rest of the repo becomes legible. |
| **`CLAUDE.md`** | ~2,900 lines of rulings: why things are the way they are, what was tried and rejected, and what must never be "cleaned up". |
| **`SHIPLOG.md`** (top section, "Hard Rules") | Three standing rules paid for with real incidents. |

`SYSTEM-MAP.md` answers *what and where*. `CLAUDE.md` answers *why*. You need
both, and they are organised for different questions — `CLAUDE.md` is
chronological by ruling, so it is superb for "why is this like this?" and
useless for "where does X live".

**This file repeats neither, on purpose.** A second copy of a safety rule is a
copy that goes stale, and the stale one is the one that wipes a database. That
is the same reasoning `CLAUDE.md` applies to the BIT certificate pointer and
the radio-battery pool: one object, one record.

`CLAUDE.md` is large. You are not expected to hold all of it. Do this instead:

1. **Always read** its "Critical Workflow Rules" and "Things to Avoid"
   sections. They are short and they are the ones that cause damage.
2. **Then `grep CLAUDE.md` for the subsystem you are about to touch** —
   `coi`, `partner`, `annual`, `hold`, `pick list`, `cardpointe`, `planyo`,
   `thread`, `action item`. Nearly every non-obvious line of this codebase
   has a paragraph there explaining who asked for it and what broke without
   it. If you are about to change something and find nothing in `CLAUDE.md`,
   say so — that absence is information too.

---

## What makes this repo different from a normal one

Four facts. Every one of them has already cost somebody something.

1. **There is no test database.** The dev server and every ad-hoc Prisma
   script hit the *same* Neon database as production. A row that looks like
   test data may be a real booking. See SHIPLOG's Hard Rules for the fixture
   and cleanup discipline — it exists because a cleanup once destroyed a real
   rate-change audit row.
2. **`prisma db push` is not safe here.** The live database carries tables and
   columns no schema file knows about (`sr_job_locations`, nine `sub_rentals`
   columns). A push from a clean checkout offers to **drop** them. Schema
   changes go in as additive SQL. `prisma migrate reset` and `prisma migrate
   dev` are never run.
3. **CardPointe is live.** Card capture and payment run against production
   Fiserv. A production credential in `.env.local` charges a real card from a
   laptop. Local stays UAT.
4. **A push to `main` deploys to production** via the Vercel integration.
   There is no separate release step, and no `vercel deploy --prod` (it races
   the auto-deploy).

---

## The pattern that makes this codebase workable

`SYSTEM-MAP.md` §5 has this in full, but it is worth stating here because it
determines where your change belongs: **a decision lives in one pure module, a
thin database half feeds it, and many surfaces read it.** 396 of the 747
`src/lib` modules never import Prisma.

So when you change behaviour, the edit almost always belongs in a pure rule
module (`somethingRules.ts`, or a file named after the decision) that already
has a `test:*` script pinning it — not in the route or the component. If you
find two surfaces answering the same question differently, that is a bug in
this codebase's terms, not a style preference.

## You can verify almost everything without a database

This is the part that makes an agent genuinely useful here, so it is worth
stating precisely.

The test suite is **pure and offline by design** — 78 test files say so in
their own header comments. Measured on `main`, 2026-09-19:

```
175 of 183 `test:*` scripts pass with DATABASE_URL unset and no .env.local
```

So your verification loop needs **no credentials and no database**:

```bash
npm run test:<name>        # the pure test for the rule you touched
npx tsc --noEmit 2>&1 | grep -v node_modules   # fast inner loop
npm run build              # THE GATE — must exit 0
```

`npm run build` is the gate, not `tsc`. `tsc` skips ESLint and Next's route
validation, so a stray `export const FOO` in a route file passes `tsc` and
fails the deploy. A red build blocks every later commit from deploying.
Never disable a lint or build check to get it green.

**Find the test before you change the rule.** `package.json` has 183 `test:*`
scripts and they are named after the behaviour, not the file — `test:card-ask`,
`test:partner-paper`, `test:annual-signing`, `test:tent-sandbags`. If you
change a pure rule, there is almost certainly a test that pins it.

### The 8 that do not run clean offline

Know these so you neither chase them nor claim credit for them.

| Script | Why |
| --- | --- |
| `test:catalog-match`, `test:scheduling`, `test:quick-reply-items` | want `.env.local` |
| `test:live-paperwork` | genuinely needs `DATABASE_URL` |
| `test:counter-pdf` | renders a PDF; wants Chrome |
| **`test:supply-estimate`** | **red on `main`** — a 6-day window bills as 7 (`$294` where the test wants `$252`) |
| **`test:week-decision`**, **`test:job-stage`** | **red on `main`** |

The last three are **pre-existing failures on `main`**, confirmed at
`0757e4d`, not caused by any current branch, and not date-dependent. Treat
them as the baseline. `test:supply-estimate` is about money and is worth a
human's attention before anyone "fixes" it blind.

Two `tsc` errors are also pre-existing, in `tests/inventory/stock.test.ts` and
`tests/sub-rentals/partner-intro-nudge.test.ts`.

---

## If you were told to optimize, simplify, or remove dead code — read this first

This is where an agent does the most damage here, because **this codebase is
full of code that looks like a mistake and is not.** Nearly every example
below was a deliberate decision, and several are load-bearing safety.

**Code that has no callers and must keep having none:**

- `promoteHoldsOnApproval` (`holdOnQuoteSend.ts`) — dead on purpose. It
  `updateMany`s every rank-2 REQUESTED item to rank 1, which would silently
  promote **every LiteHold** in the system.
- `startThreadForJob` (`recordOutboundOnThread.ts`) — superseded by
  `jobThreadContext()`.
- The white-label code behind `PARTNER_HQ_OFFER = false` — parked, not dead.
  Flipping the flag restores it.
- `classifyChangeSignal()` and the `sr_job_email_signals` table — kept for one
  manual script after the AI email suggestions were deliberately removed.
- The `planyo-sync` entry in `vercel.json` — a no-op tick, kept so reviving it
  needs no deploy. `src/lib/sync/planyo/` stays until it has been dark a month.

**Code that looks over-engineered and is not:**

- `scripts/archive-dormant-jobs.ts` — `CLAUDE.md` says in as many words: *do
  not "simplify" this to `createdAt < 30d`*. A naive age cut buries live
  upcoming rentals. It was measured: 52 jobs looked stale, 4 were live.
- `SANDBAGS_BY_SIZE` (`tentSandbags.ts`) — a lookup table, not arithmetic. No
  formula over width × length gives all four real counts. An unlisted size
  offers **nothing** rather than a guess.
- `BIT_CLASS_PATTERNS` (`vehicleDocs.ts`) — same posture. Only classes a human
  has ruled on are named; everything else gets the umbrella label.
- `syncHoldOnLineDelete` — at zero it **deletes** the BookingItem and the FK
  cascade takes every unit on it. It is correct for stages and wrong for
  vehicle lines.

**Duplication that must stay duplicated — but must change together:**

- **Three** independent paths rank the catalog: `/api/catalog/search`,
  `publicSupplySections.rankSearchResults`, and
  `publicSearch.searchPublicSite`. Change how ranking works and you change all
  three, or one box on sirreel.com disagrees with the others.
- `KEYWORD_REPLIES` (`sms/threads.ts`) must match
  `docs/sms/twilio-a2p-campaign.md` — that text is filed with the carrier.
- `contractClauses.ts` must stay in lockstep with
  `public/contracts/sirreel-rental-agreement.pdf`. Editing a canonical clause
  renegotiates that clause **for every client at once**. One client's redline
  goes in their own `appendedClauses` override, never here.

**The general rule:** in this repo, surprising code is usually a scar. Before
removing or collapsing anything, `grep CLAUDE.md` for it. If it is named
there, the paragraph will tell you what breaks. If you still think it should
go, **say so and leave it** — propose the removal, do not perform it.

---

## Git

`SHIPLOG.md`'s Hard Rules cover this; two of them bite agents specifically.

- **Never `git add -A` or `git add -u`.** More than one session works in the
  same checkout. Run `git status --short` and stage only paths you touched. A
  `git add -A` once swept a peer's unstaged work into an unrelated commit.
- **`scripts/*` is gitignored behind an allowlist** (~96 `!scripts/...` lines).
  A new script there never appears in `git status`, so it can look committed
  while existing in one working tree only. Add the `!scripts/<name>.ts` line
  the moment it is meant to ship.
- Work on a branch. Never commit straight to `main` — that is a production
  deploy. Open a PR and let the Vercel preview go green first.

---

## How to report what you did

Say what you ran and what it said. `npm run build` exits 0 or it does not.
If a test fails, quote it. If you skipped part of the task, say which part
and why. Do not describe work as verified that you did not run — in a repo
with no staging environment, an unverified claim is the expensive kind of
wrong.
