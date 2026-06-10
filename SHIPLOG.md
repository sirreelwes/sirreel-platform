# SirReel HQ — Shiplog

Append-only record of shipped changes. Newest at top. Each entry: SHA, commit subject, why-it-matters one-liner.

## 2026-06-10

- `<step1>` — feat(hr): employee + HR item schema with inbox isolation — Employee model (8 staff seeded; 7/8 linked to existing Users). HrEmail / HrMail / HrAttachment tables structurally isolated from EmailMessage — the 12+ existing email-read surfaces (sales, claims, exec, inbox) all query EmailMessage so HR rows are unreachable through them by design, not by procedure. `src/lib/hr/allowlist.ts` exports `requireHrAccess()` — hardcoded constant (`wes@`, `dani@`) + `HR_ALLOWLIST` env override for emergency expansion; code-reviewed-deploy only, no DB toggle.
- `9151375` — chore(email): lift Gmail-attachment helper for HR reuse — behavior-neutral lift of the per-attachment download+upload+iterate loop out of `src/lib/claims/onboardFromEmail.ts` into the shared `src/lib/email/persistGmailAttachments.ts`. Claims path re-verified against the NEEDS_REVIEW fixture (msg `54584809-1d14-...beae4c`): same `needs_review` disposition, same parse (`Crazy Maple Studio`, `NEGOTIATING`), same reasoning. HR pipeline (next commits) builds on the same helper without duplicating Gmail+Blob plumbing.
