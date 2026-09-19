# Running Codex against SirReel HQ

How to point Codex (or any coding agent) at this repo as an efficiency
reviewer, debugger and optimizer — and how to stop it doing damage.

Audience: Wes. The agent's own instructions are in `AGENTS.md` at the repo
root, which Codex reads automatically every session.

---

## 1. The instructions are already written — the job was wiring them up

`CLAUDE.md` is ~2,900 lines of exactly what an agent needs: not just what the
code does, but who asked for it, what was tried and rejected, and what must
never be tidied away. That is a better agent brief than almost any repo has.

What was missing is that **Codex does not read `CLAUDE.md`.** It reads
`AGENTS.md`. So `AGENTS.md` now exists and points at `CLAUDE.md` and
`SHIPLOG.md` as the law.

**It points rather than copies, deliberately.** Pasting 2,900 lines of safety
rules into a second file gives you two copies that drift — and the stale copy
is the one that runs `db push` against production. It is the same rule the
codebase already applies to the BIT certificate pointer and the radio-battery
pool: one object, one record.

If you ever add another agent that reads a third filename, make that file a
pointer too. Never a copy.

---

## 2. Set the guardrails mechanically, not in prose

An instruction file is guidance. It is **not** a security boundary — an agent
can misread it, and a long file competes for attention with the task. The
things that would really hurt here should be impossible, not discouraged.

**Give Codex no database.** This is the big one, and this repo makes it
cheap: 179 of 184 test scripts pass with `DATABASE_URL` unset. Codex can read
code, run the pure tests and run the production build without ever being able
to reach Neon. Run it in a shell where `DATABASE_URL` and the CardPointe and
Resend keys simply are not set.

**Run it sandboxed.** Codex CLI takes a sandbox mode and an approval mode in
`~/.codex/config.toml`. Use workspace-write (it can edit the checkout, not the
rest of the disk) and keep network access off unless a task genuinely needs
it. Require approval for commands rather than letting it run unattended the
first several times — you want to see what it reaches for.

**Never let it push to `main`.** A push to `main` is a production deploy.
Branch, PR, let the Vercel preview go green, then you merge.

A useful way to think about it: the worst thing Codex can do to a pure
TypeScript rule is write a bug you catch in review. The worst thing it can do
with a live `DATABASE_URL` is unrecoverable. Keep it on the first side of that
line and you can be generous about everything else.

---

## 3. The three jobs, as prompts

Each of these assumes `AGENTS.md` is loaded. Start a fresh session per task —
a long session drifts, and these are different jobs.

### Debugger

Best-fit role, and the one to start with. The pure tests give it a real
feedback loop with no credentials.

> There is a bug in `<area>`: `<what you see>` when `<what you did>`.
> Expected `<what should happen>`.
>
> Find the root cause before proposing a fix. Read `CLAUDE.md` for this
> subsystem first — the behaviour may be deliberate and documented. Find the
> `test:*` script that covers the rule and write a failing case that
> reproduces it, then fix the code until it passes. Run `npm run build` and
> show me it exits 0.
>
> If the root cause is in code that `CLAUDE.md` says is deliberate, stop and
> tell me — do not change it.

That last paragraph matters more than it looks. A lot of "bugs" here are
rulings (`Job.status` not advancing, a client's email never changing a job,
LiteHold sitting at rank 2 with no unit).

### Efficiency reviewer

Read-only. Have it *report*, not edit. This is where the value is highest and
the risk lowest.

**Scope it to a path, always.** This repo is ~463,000 hand-written lines
across ~2,300 files (see `docs/SYSTEM-MAP.md` §2). "Review the codebase" is
not a task anything can do in one pass — it produces a shallow sweep that
reads like insight. One directory or one route at a time.

> Review `<path>` for efficiency: N+1 queries, work repeated per row that
> could be hoisted, `findMany` without a bound, sequential awaits that could
> be one query, payloads selecting columns nobody reads.
>
> Report findings only — do not edit. For each: the file and line, what it
> costs, and the smallest fix. Rank by what would actually be felt at our
> scale (a few hundred jobs, ~80 vehicles, ~550 booking assignments), not by
> theoretical complexity.
>
> Before flagging anything as redundant, `grep CLAUDE.md` for it and quote
> what you find.

The scale line stops it optimizing a 12-row loop.

### Optimizer

The dangerous one. Constrain it hard, and **never** ask it to "remove dead
code" across the repo — read the "If you were told to optimize" section of
`AGENTS.md` to see why. Scope it to one file or one function:

> Simplify `<one specific file>`. Behaviour must not change.
>
> Constraints: do not delete anything without quoting what `CLAUDE.md` says
> about it, or stating that you searched and found nothing. Do not collapse
> duplication across files without checking whether it is one of the
> deliberately-parallel paths named in `AGENTS.md`. Do not touch anything
> outside this file.
>
> Run the `test:*` scripts covering this file, and `npm run build`. Show me
> the output.

---

## 4. Reviewing what comes back

Three questions, in order:

1. **Did it run the build?** Not `tsc` — the build. Ask for the last lines.
   `✓ Compiled successfully` and the route table, exit 0.
2. **Did it delete or collapse anything?** Every removal needs a reason from
   `CLAUDE.md` or an explicit "I searched and found nothing". This is where
   the scars get scraped off.
3. **Did it touch `contractClauses.ts`, a migration, or anything under
   `scripts/`?** Those three want your eyes regardless of how clean the diff
   reads.

Known baseline so nobody chases ghosts: **nothing is genuinely red.** A clean
offline run is **179 of 184 green**, with 5 skipped for wanting a live
database (`test:catalog-match`, `test:scheduling`, `test:quick-reply-items`,
`test:live-paperwork`) or Chrome (`test:counter-pdf`). Two `tsc` errors
remain pre-existing, in `tests/inventory/stock.test.ts` and
`tests/sub-rentals/partner-intro-nudge.ts`. An agent reporting those has found
the baseline, not a regression.

**The lesson from the three that WERE red** (fixed 2026-09-19) is worth
keeping in front of you when reviewing agent work: all three were **stale
tests, not bugs.** `test:supply-estimate` and `test:week-decision` asserted
the exclusive day gap after the billable-days rule flipped to inclusive on
2026-09-12; `test:job-stage` asserted a blind-pickup colour rule that had been
retired, while another test asserted the current rule and passed. An agent
told only "make this pass" would have edited `computeDays` and re-priced every
daily-rate line, quote PDF and invoice in the system. **If Codex proposes a
code change to satisfy a failing test, ask it to quote the function's doc
comment first** — this codebase records dated rulings there.

---

## 5. Where to start

In order, easiest to hardest:

1. **A warm-up with a real answer.** Two stale `.save` backups are committed
   — `src/app/(dashboard)/layout.tsx.save` and `src/lib/autoAssign.ts.save` —
   and `.gitignore` has no `*.save` rule. Small, safe, verifiable, and it
   removes a stale copy sitting beside the real staff-shell layout.
2. **An efficiency read of one hot path**, report-only — `/api/jobs` or the
   portal data route. Zero risk, and it tells you how good its judgement is
   before you let it write anything.
3. **A real bug when one appears.** The pure tests give it a genuine
   reproduction loop with no credentials, which is where it is strongest.
4. **Only then** anything that edits broadly.

Do not start by asking it to "clean up the codebase". This repo's oddities
are mostly decisions, and an agent that has not yet earned your trust should
not be the one deciding which are which.
