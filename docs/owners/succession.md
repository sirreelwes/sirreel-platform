# Succession — who steps in for Wes

- Wes Bailey is CEO and owner (wes@sirreel.com).
- Two backup CEOs, named by Wes on 2026-09-11. This is for the three of them; no one else on staff holds this knowledge.
- **Greyson Bailey** — backup CEO.
- **Tamara Talbot** — backup CEO (tt@sirreel.com). Added 2026-09-11.

## What a backup CEO has
- An HQ login at ADMIN role: every HQ permission Wes has.
- AHA at admin level by text from the mobile on their user record, and signed in on /admin/assistant → "Ask AHA as yourself".
- Platform memory: how HQ is built and why (CLAUDE.md), every shipped change with its reasoning (SHIPLOG.md), runbooks and specs.
- Recent activity: what the admins have been doing, from the audit log.
- These owners' notes, because their email is on AHA_OWNER_EMAILS.

## If Wes is unreachable — where to start
- Ask AHA on /admin/assistant: "walk me through what Wes has been working on" then "what is [any page or process]" — it quotes the written record and says plainly when the record does not cover something.
- Cash and cards: CardPointe is LIVE in production; the operating notes are in CLAUDE.md under "CardPointe" and the SHIPLOG entries that mention it.
- Billing source of truth is still RentalWorks; the token-rotation runbook is docs/runbooks/rentalworks-token-rotation.md.
- Scheduling: HQ's native scheduler holds the live book; Planyo remains the team's working surface until the switch is announced (CLAUDE.md "Scheduling").
- Deploys: pushes to `main` go to production on their own through Vercel. Nothing needs to be run by hand.
- People: Dani (operations/co-owner), Hugo (GM), Ana (collections), Jose and Oliver (sales), Julian (dispatch) — CLAUDE.md "People".

## Keeping this current
- Add or remove a backup CEO here AND on AHA_OWNER_EMAILS in Vercel (redeploy after changing env).
- Their HQ user: `npx tsx scripts/add-hq-user.ts --name "Full Name" --email who@sirreel.com --role ADMIN --phone "(xxx) xxx-xxxx"` — no "Backup CEO" display title; on HQ they are simply an admin.
