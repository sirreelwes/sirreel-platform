# Owners' notes — read this before adding anything here

- This folder is the one place in the repo for notes that only the owners may know.
- AHA's `platform_memory` reads it ONLY for a caller who is an HQ ADMIN and whose email is on `AHA_OWNER_EMAILS` (Vercel env, comma-separated; unset = Wes alone). Every other admin's search skips the folder entirely.
- The allowlist is an environment variable on purpose: the names are never in git.
- Nothing in here is shown on any HQ page, in any email, or to any staff level of AHA. It reaches an owner by text from their mobile on file, or signed in on /admin/assistant → "Ask AHA as yourself".
- Do not copy anything from this folder into CLAUDE.md, SHIPLOG.md, code comments or the rest of docs/ — those are indexed for every admin.
