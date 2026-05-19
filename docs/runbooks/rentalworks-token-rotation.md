# RentalWorks Token Rotation

Manual runbook for rotating `RENTALWORKS_TOKEN` in Vercel Production.
RentalWorks does not (as of May 2026) expose a public auth API in our
deployment — tokens are issued from the RW admin UI and must be rotated
by hand. See [Why this is manual](#why-this-is-manual) at the bottom.

## When to rotate

- **Reactive**: `/admin/health` shows RentalWorks **DOWN** with HTTP 401.
  This is what triggers the Slack alert from `/api/cron/health-check`.
- **Proactive**: every ~50 days. Current incident (May 2026) hit at day
  ~57. Rotating at day 50 leaves a 7-day buffer before expiry.

> :calendar: **Set a calendar reminder for 50 days from each rotation.**
> The whole point of this runbook is that we never see another emergency
> rotation. Today's date + 50 days = your next rotation due date.

## Estimated time: 10 minutes

## Procedure

### 1. Get a fresh token from the RW admin UI

> :warning: PLACEHOLDER — the exact navigation hasn't been documented
> from the actual screens yet. Update this section after the next
> rotation with: page path, button label, and screenshot. Until then,
> the rough flow is:

1. Log into RentalWorks at <https://sirreel.rentalworks.cloud/> using
   the admin account credentials (stored in 1Password under
   "RentalWorks Admin").
2. Navigate to: `Admin` → `API` → `Tokens` (or similar — TBD).
3. Click **Generate New Token** (or "Refresh", "Rotate" — TBD).
4. **Copy the token to your clipboard.** Do *not* save it to a file or
   paste it into a chat tool — it's a bearer credential with full
   read/write access to the SirReel RentalWorks tenant.
5. If the UI shows an expiry, note it. (If RW exposes the expiry, add
   it to this runbook so we can shrink the proactive-rotation window.)

### 2. Verify the new token works before pushing to production

The `verify-rw-token.ts` script makes one cheap API call and tells you
whether the token is accepted, without ever logging the token value.

```bash
# Either pass the token via env var (preferred — no shell history):
RENTALWORKS_TOKEN=<paste-token> npx tsx scripts/verify-rw-token.ts

# Or via stdin (if you don't want the token in the env table either):
npx tsx scripts/verify-rw-token.ts < <(echo "<paste-token>")
```

Expected output:
```
✓ Token valid — safe to deploy
```

If you see `✗ Token rejected (401)`, the token was copied wrong or the
RW admin UI generated an inactive token — go back to step 1.

### 3. Update RENTALWORKS_TOKEN in Vercel Production

```bash
# Remove the stale value (Vercel won't overwrite without --force on add):
vercel env rm RENTALWORKS_TOKEN production

# Add the new value. Vercel CLI will prompt you — paste the token; it's
# echoed as asterisks. Choose "Production" only (NOT Preview/Dev) when
# the env-target picker appears.
vercel env add RENTALWORKS_TOKEN production
```

### 4. Redeploy production

Env-var changes do **not** propagate to running serverless functions
until a redeploy. Trigger one:

```bash
vercel --prod
```

…or push an empty commit to `main` (Vercel auto-deploys):

```bash
git commit --allow-empty -m "chore: redeploy after rentalworks token rotation"
git push origin main
```

### 5. Confirm the health dashboard goes green

1. Wait for the deploy to show "Ready" in `vercel ls`.
2. Open <https://hq.sirreel.com/admin/health>.
3. Click **Run check now**.
4. The "RentalWorks API" tile should flip from DOWN/red to HEALTHY/green
   with HTTP 200.
5. Note the rotation date and your calendar reminder for +50 days.

## Why this is manual

RentalWorks runs as an IIS/ASP.NET vendor product. Probing common auth
paths (`/api/v1/login`, `/api/v1/auth/login`, `/api/v1/sessions`,
`/api/v1/token`, `/swagger`, etc.) all returned 404 against
`sirreel.rentalworks.cloud`. The SPA shell at the root presumably has
the auth endpoint embedded in its 3.4MB JS bundle, but we deliberately
chose not to reverse-engineer that:

- Vendor-internal auth flows can change without notice between RW
  versions and we'd be silently broken on every upgrade.
- An auto-rotation cron would need a Vercel API token with prod-env-write
  scope — a powerful credential whose blast radius (any env var swappable)
  exceeds the inconvenience this runbook saves.
- Today's rotation only happens ~7 times a year. A 10-minute manual
  procedure with a calendar reminder is a fine trade.

If RentalWorks documents a stable token-rotation API in the future,
revisit: replace this runbook with a `scripts/rotate-rw-token.ts` that
does it end-to-end, and lift the manual-rotation note from the health
probe error message.

## Related

- Health probe: `src/lib/health/rentalworks.ts`
- Cron alert: `src/app/api/cron/health-check/route.ts`
- Dashboard: <https://hq.sirreel.com/admin/health>
- Verify script: `scripts/verify-rw-token.ts`
