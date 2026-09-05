# journals/ — reversal journals for bulk writes to the live DB

Every one-off script that writes to production (backfills, merges, purges,
archives, seeds) records what it touched here **by captured id** so the run
can be reversed. Before 2026-09-05 these landed in `tmp/`, which is untracked,
so a lost laptop would have made every one of those runs irreversible. They
are committed now; the scripts under `scripts/` write new journals straight
into this directory.

Rules:
- A journal is the ONLY safe way to undo a run. Reverse by the ids inside it,
  never by pattern, shape, or name match (see CLAUDE.md "Verification
  fixtures & cleanup").
- Keep the dry-run and write pairs together (`company-merge-*` has both); the
  dry-run shows what was proposed, the write shows what happened.
- Do not put fixtures, previews, reports, or pull caches here. Those stay in
  `tmp/` (still untracked): `*-fixture-*.json`, `zz-*`, `unnamed-*.json`,
  `short-hold-sweep-*`, `rw-items-raw-*`, preflight markdown, the
  `annual-agreements.tsv` input.
- Journals name real clients, jobs, and contacts. The repo is private; keep it
  that way and never copy this directory into an export.
