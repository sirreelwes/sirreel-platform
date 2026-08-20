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
WT="/Users/wesbailey/Downloads/sirreel-platform/.claude/worktrees/friendly-tereshkova-251d2f"
cd "$WT"

printf 'RW username [Dani]: '
read -r RWU
RWU="${RWU:-Dani}"
printf 'RW password (hidden): '
read -rs RWP
echo

echo "── [1/5] minting token from RentalWorks…"
TOK=$(printf '%s\n%s\n' "$RWU" "$RWP" | npx tsx scripts/rotate-rw-token.ts --verify --stdin --quiet)
unset RWP
if [ -z "$TOK" ]; then echo "✗ mint failed — stopping (nothing changed)"; exit 1; fi
case "$TOK" in eyJ*) ;; *) echo "✗ minted value doesn't look like a token — stopping"; exit 1;; esac
echo "✓ token minted and verified (length ${#TOK})"

echo "── [2/5] removing old production value…"
vercel env rm RENTALWORKS_TOKEN production -y >/dev/null
echo "✓ removed"

echo "── [3/5] storing new value (piped — no paste)…"
printf '%s' "$TOK" | vercel env add RENTALWORKS_TOKEN production >/dev/null
echo "✓ stored"

echo "── [4/5] pushing redeploy commit from the worktree…"
git -C "$WT" commit --allow-empty -q -m "chore: redeploy after rentalworks token rotation"
git -C "$WT" push -q origin HEAD:main
echo "✓ pushed — Vercel deploying"

echo "── [5/5] done. Claude is watching the health endpoint from his side."
echo "ROTATION SCRIPT COMPLETE"
