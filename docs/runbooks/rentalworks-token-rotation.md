# RentalWorks Token Rotation

Rotate `RENTALWORKS_TOKEN` in Vercel Production.

## TL;DR — the fast path (added 2026-08-20)

RentalWorks **does** have a login endpoint after all: `POST /api/v1/jwt`.
`scripts/rotate-rw-token.ts` calls it and mints a fresh token from the admin
credentials — no browser, no DevTools. The whole rotation is now three
commands:

```bash
# 1. Mint + verify (credentials from 1Password, nothing touches disk):
op run --env-file=<(printf 'RW_USERNAME=op://Private/RentalWorks Admin/username\nRW_PASSWORD=op://Private/RentalWorks Admin/password') -- \
  npx tsx scripts/rotate-rw-token.ts --verify
```

Copy the `eyJ…` token it prints, then:

```bash
# 2. Replace it in Vercel Production (paste the token at the prompt, no quotes):
vercel env rm RENTALWORKS_TOKEN production && vercel env add RENTALWORKS_TOKEN production
```

```bash
# 3. Redeploy so functions pick up the new value:
git commit --allow-empty -m "chore: redeploy after rentalworks token rotation" && git push origin main
```

Then confirm the health tile (step 5 below). Everything under
"Full procedure" is the old browser-scrape method, kept as a fallback if the
`/jwt` endpoint ever changes.

Whether this can be made **fully hands-off** (a cron that re-mints on 401)
is discussed under [Automation](#automation) — the blocker was never minting,
it was safely storing a Vercel-write credential.

---

## Full procedure (fallback — browser scrape)

The token is the **bearer the RentalWorks web app mints for itself at login**.
Until 2026-08-20 we read it out of the browser because the 2026-08-16
`Administrator`-menu walk found no token UI (`Custom Field, Custom Form,
Report Styling/CSS, Custom Report Layout, Data Health, Email History, Email
Template, Event Log, Group, Plugins, QuikScan Setup, Security Settings,
System Update, User`), and no per-user key. That walk simply missed the
`/api/v1/jwt` API endpoint the SPA posts to — see the TL;DR above.

## When to rotate

- **Reactive**: `/admin/health` shows RentalWorks **DOWN** with HTTP 401.
  This is what triggers the Slack alert from `/api/cron/health-check`.
- **Proactive**: every ~50 days. Observed lifetimes: the May 2026 incident
  hit at day ~57; the token rotated 2026-08-16 had been in place since
  2026-03-23 (~146 days) — so the real ceiling is not well characterised.
  Rotating at day 50 keeps a buffer either way.

> :calendar: **Set a calendar reminder for 50 days from each rotation.**
> Today's date + 50 days = your next rotation due date.

**Ignore the `exp` claim.** The JWT stamps a 300-second expiry, but RW
honours these for weeks or months — the server tracks its own session. A
token whose `exp` passed minutes ago still works, so `exp` is useless for
predicting rotation and must not be wired into the health probe.

## Estimated time: 10 minutes

## Procedure

### 1. Read the bearer out of the browser

1. Log into <https://sirreel.rentalworks.cloud/> with the admin account
   (1Password → "RentalWorks Admin"). Land on any data-bearing module —
   `#/module/quote` works.
2. Open DevTools (`Cmd+Opt+I`) → **Network** tab.
3. **Clear the filter box** if anything is typed in it (the ⊗ at its right
   end) — it filters by request *name*, so stray text hides everything.
4. Click **Fetch/XHR**, then reload the page so requests are captured.
5. Click any `browse` request → **Headers** → **Request Headers**.
6. Copy the value of `authorization`, dropping the leading `Bearer ` — you
   want only the `eyJ…` string.

Do not save it to a file or paste it into a chat tool: it is a bearer
credential with full read/write access to the SirReel RW tenant.

**Stay logged in until step 5 passes.** The token is tied to that web
session; logging out immediately after copying may invalidate what you just
deployed.

### 2. Verify the new token works before pushing to production

```bash
RENTALWORKS_TOKEN='<paste-token>' npx tsx scripts/verify-rw-token.ts
```

Quote the value and **delete the angle brackets** — an unquoted `<` is read
by the shell as input redirection and fails with "File name too long".

Expected output:
```
✓ Token valid — safe to deploy (HTTP 200, OK)
```

To keep the token out of shell history, use stdin instead — the `--stdin`
flag is required, or the script looks for the env var and reports no token:

```bash
echo '<paste-token>' | npx tsx scripts/verify-rw-token.ts --stdin
```

If you see `✗ Token rejected (401)`, the copy is wrong far more often than
the token is — check for an included `Bearer ` prefix, a truncated string, or
a trailing newline. Confirm it starts `eyJ` and contains exactly two dots.

### 3. Update RENTALWORKS_TOKEN in Vercel Production

```bash
vercel env rm RENTALWORKS_TOKEN production
```

```bash
vercel env add RENTALWORKS_TOKEN production
```

At the value prompt: paste the raw token. **No quotes** (this is a prompt,
not a shell line — quotes get stored as part of the value), no `Bearer `
prefix, no trailing whitespace. Choose **Production** only if asked.

### 4. Redeploy production

Env-var changes do **not** reach running serverless functions until a
redeploy. Push an empty commit — Vercel auto-deploys `main`:

```bash
git commit --allow-empty -m "chore: redeploy after rentalworks token rotation" && git push origin main
```

Do **not** run `vercel --prod`. CLAUDE.md forbids the CLI deploy because it
races the GitHub integration's auto-deploy.

### 5. Confirm the health dashboard goes green

1. Wait for the deploy to finish (~2 min).
2. Open <https://hq.sirreel.com/admin/health>.
3. Click **Run check now** — the hourly cron is too slow to confirm with,
   and a check that ran *before* your deploy landed proves nothing.
4. The "RentalWorks API" tile should read HEALTHY with HTTP 200.
5. Note the rotation date and set the +50 day reminder.

## Known noise

RentalWorks intermittently exceeds the probe's 8-second timeout — three of
five checks on 2026-08-16 failed that way while the token was independently
broken. A timeout is logged as `down`, same as a 401, so not every red tile
means a credential problem. Only `HTTP 401` means rotate.

## Automation

The login endpoint (`POST /api/v1/jwt`) means minting is now scriptable, so
a cron that re-mints on a 401 is technically possible. It is **not built**,
because minting was never the hard part — safely holding the credentials to
do it unattended is:

- A cron that rewrites the prod env needs a **Vercel API token with
  prod-env-write scope** — a credential whose blast radius (rewrite any
  production secret) exceeds the ~10-minute chore it saves.
- Storing `RW_USERNAME` / `RW_PASSWORD` in the app env to self-heal on 401
  is smaller, but it parks a full read/write RW login in the same env as
  everything else, and the password does not rotate the way the token does.
- Rotation is ~7×/year. The scripted three-command path above already cuts
  it to about two minutes with no browser.

Recommended stopping point: **keep it human-run via `rotate-rw-token.ts`,
on the 50-day reminder.** Revisit auto-rotation only if RentalWorks confirms
a purpose-issued, long-lived API key (still worth asking support) — that
would be safe to park in the app env and self-heal against, at which point
`rotate-rw-token.ts` becomes the core of a `/api/cron/rw-token` handler.

### Historical note

`/api/v1/jwt` was found 2026-08-20 by probing the endpoint directly. The
2026-08-16 investigation had concluded auth was un-scriptable after probing
`/api/v1/login`, `/auth/login`, `/sessions`, `/token`,
`/authentication/logon`, `/swagger` (all 404) and `/api/v1/user/logon`
(session-record resource, not a login) — but never tried `/jwt`, the FW
platform's actual login route. Lesson banked: probe the vendor platform's
documented convention (Database Works "FW" → `/api/v1/jwt`) before
concluding an endpoint doesn't exist.

## Related

- Health probe: `src/lib/health/rentalworks.ts`
- Cron alert: `src/app/api/cron/health-check/route.ts`
- Dashboard: <https://hq.sirreel.com/admin/health>
- Verify script: `scripts/verify-rw-token.ts` (gitignored — local only)
