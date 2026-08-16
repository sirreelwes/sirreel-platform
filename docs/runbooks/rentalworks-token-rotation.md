# RentalWorks Token Rotation

Manual runbook for rotating `RENTALWORKS_TOKEN` in Vercel Production.

There is **no token-issuance UI in RentalWorks** — verified 2026-08-16, the
entire `Administrator` menu was walked and contains no API or Token entry
(`Custom Field, Custom Form, Report Styling/CSS, Custom Report Layout, Data
Health, Email History, Email Template, Event Log, Group, Plugins, QuikScan
Setup, Security Settings, System Update, User`), and `User` is a staff list
with no per-user key. The working token is the **bearer the RentalWorks web
app mints for itself at login**, read out of the browser. See
[Why this is manual](#why-this-is-manual).

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

## Why this is manual

RentalWorks runs as an IIS/ASP.NET vendor product with no token-issuance UI
and no documented auth endpoint. Probing (`/api/v1/login`, `/api/v1/auth/login`,
`/api/v1/sessions`, `/api/v1/token`, `/api/v1/authentication/logon`,
`/swagger`) returns 404; `/api/v1/user/logon` exists but allows only
`DELETE, GET, PUT` and 401s unauthenticated — it is a session-record
resource, not a login. The SPA's own auth call is buried in a 3.4MB JS
bundle, and we deliberately chose not to reverse-engineer it:

- Vendor-internal auth flows change without notice between RW versions and
  we would be silently broken on every upgrade.
- An auto-rotation cron would need a Vercel API token with prod-env-write
  scope — a credential whose blast radius exceeds the inconvenience saved.
- Rotation happens ~7 times a year. A 10-minute manual procedure with a
  calendar reminder is a fine trade.

The open question worth asking RentalWorks support: **is a long-lived API
key available on this tenant?** A purpose-issued key would beat a scraped
session bearer, which is tied to someone's login staying alive. If they
document one, replace this runbook with `scripts/rotate-rw-token.ts`.

## Related

- Health probe: `src/lib/health/rentalworks.ts`
- Cron alert: `src/app/api/cron/health-check/route.ts`
- Dashboard: <https://hq.sirreel.com/admin/health>
- Verify script: `scripts/verify-rw-token.ts` (gitignored — local only)
