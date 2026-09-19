---
description: Pull the bug reports Wes handed over on /admin/bugs and start fixing them
---

Wes has ticked issues on the Reported Issues board at `/admin/bugs` and pressed
"Hand to Claude". Collect that batch and work it.

## 1. Pull the work order

```bash
export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
npx tsx scripts/fix-queue.ts
```

That prints the newest batch: each issue with the reporter's own words, the
requests that failed, the records the URLs resolved to, and the triage agent's
read. If it says nothing has been handed over, tell Wes and stop — do not go
hunting for work with `--open` unless he asks.

$ARGUMENTS

## 2. Work them

- **Diagnose before you change anything.** Each item carries a suggested fix
  written by the triage agent from one sentence and a few URLs. It is a lead,
  not a spec, and it is confidently wrong often enough to matter. Read the real
  code path first.
- Worst-first; the brief is already in that order.
- A failed request in the envelope is the strongest evidence you have — start
  at that route.
- If an item turns out not to be a bug, **say so and leave it**. Do not invent a
  change to justify the ticket.
- One commit per issue where they are unrelated, so a bad one can be reverted
  on its own.

## 3. The rules that apply to this repo

Read `CLAUDE.md` first if it is not already in context. In particular:

- `npm run build` must exit 0 before any push — `tsc --noEmit` is NOT the gate.
  Build in a git worktree with its own Prisma client; the shared checkout is
  usually many commits behind and its `.next` is contended.
- There is no ESLint here, so `react-hooks/rules-of-hooks` never runs. Put every
  hook above every early return by hand.
- Schema changes go through additive SQL scripts, never `prisma db push`.
- Stage explicit paths. Never `git add -A` — the working tree is shared.

## 4. Close the loop

When an issue is genuinely fixed and the build is green:

```bash
npx tsx scripts/fix-queue.ts --done <report id> --note "what you actually changed"
```

That marks it FIXED on the board, which is what the reporter sees on HQ Help
and what the "Fixed" tile counts. Only mark what you actually fixed — report
honestly on anything you left, and say why.
