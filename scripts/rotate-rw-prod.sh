#!/bin/bash
# One-shot RW token rotation for production. NO SECRETS IN THIS FILE.
# Prompts for the password itself; aborts loudly at the first failed step.
# Committed (gitignore-allowlisted): this IS the rotation procedure.
# Origin 2026-08-20: long pasted one-liners were being line-wrapped into
# fragments by the terminal and partially executed — a chained echo even
# printed success while the env var and redeploy silently never happened.
# A short `bash scripts/rotate-rw-prod.sh` cannot be wrapped apart, and
# each step aborts loudly, so "complete" means every step truly ran.
set -euo pipefail
# Any checkout of the repo works — steps use git plumbing against origin,
# never a working tree (2026-08-22 fix: the old version committed from a
# pinned worktree whose branch had gone stale behind main, so the redeploy
# push failed as a non-fast-forward).
REPO="/Users/wesbailey/Downloads/sirreel-platform"
cd "$REPO"

printf 'RW username [Dani]: '
read -r RWU
RWU="${RWU:-Dani}"
printf 'RW password (hidden): '
read -rs RWP
echo

echo "── [1/6] minting token from RentalWorks…"
TOK=$(printf '%s\n%s\n' "$RWU" "$RWP" | npx tsx scripts/rotate-rw-token.ts --verify --stdin --quiet)
unset RWP
if [ -z "$TOK" ]; then echo "✗ mint failed — stopping (nothing changed)"; exit 1; fi
case "$TOK" in eyJ*) ;; *) echo "✗ minted value doesn't look like a token — stopping"; exit 1;; esac
echo "✓ token minted and verified (length ${#TOK})"

echo "── [2/6] removing old production value…"
vercel env rm RENTALWORKS_TOKEN production -y >/dev/null
echo "✓ removed"

echo "── [3/6] storing new value (piped — no paste)…"
printf '%s' "$TOK" | vercel env add RENTALWORKS_TOKEN production >/dev/null
echo "✓ stored"

echo "── [4/6] updating local .env.local (dev + scripts read it)…"
python3 - "$TOK" << 'PYEOF'
import sys, re
tok = sys.argv[1]
path = "/Users/wesbailey/Downloads/sirreel-platform/.env.local"
src = open(path).read()
out, n = re.subn(r'^RENTALWORKS_TOKEN=.*$', f'RENTALWORKS_TOKEN="{tok}"', src, count=1, flags=re.M)
if n != 1:
    out = src.rstrip("\n") + f'\nRENTALWORKS_TOKEN="{tok}"\n'
open(path, "w").write(out)
PYEOF
echo "✓ .env.local updated"

echo "── [5/6] pushing redeploy commit (plumbing — no working tree involved)…"
git fetch -q origin main
NEWC=$(git commit-tree 'origin/main^{tree}' -p origin/main -m "chore: redeploy after rentalworks token rotation")
git push -q origin "$NEWC":main
echo "✓ pushed — Vercel deploying"

echo "── [6/6] done. Tell Claude — he verifies the quote sync from his side."
echo "ROTATION SCRIPT COMPLETE"
