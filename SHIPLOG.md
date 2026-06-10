# SirReel HQ — Shiplog

Append-only record of shipped changes. Newest at top. Each entry: SHA, commit subject, why-it-matters one-liner.

## 2026-06-10

- `<refactor>` — chore(email): lift Gmail-attachment helper for HR reuse — behavior-neutral lift of the per-attachment download+upload+iterate loop out of `src/lib/claims/onboardFromEmail.ts` into the shared `src/lib/email/persistGmailAttachments.ts`. Claims path re-verified against the NEEDS_REVIEW fixture (msg `54584809-1d14-...beae4c`): same `needs_review` disposition, same parse (`Crazy Maple Studio`, `NEGOTIATING`), same reasoning. HR pipeline (next commits) builds on the same helper without duplicating Gmail+Blob plumbing.
