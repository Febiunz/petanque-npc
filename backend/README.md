# NPC Standen Backend

This folder contains the Node.js/Express backend for the Petanque results and standings website.

Team seed objects contain `id`, `name`, `divisie`, `divisieId`, `locale`, and `createdAt` (no `club` field).

## Official season data

All nine JSON files in `data/` were checked against the official NLpetanque 2026-2027 tables on 12 November 2026:
[1001](https://nlpetanque.nl/topdivisie-2026-2027-1001/),
[2001](https://nlpetanque.nl/2e-divisie-2026-2027-2001/), and
[2002](https://nlpetanque.nl/2e-divisie-2026-2027-2002/).
Each division has 8 teams and 56 fixtures, with 14, 16, and 16 published results respectively.
Schedules preserve official match numbers and published adjusted dates; results are included only when both scores are published.
All 46 published results now contain 506 validated individual games, preserving original IDs, authorship and weighted aggregates. Match `200111` uses its official workbook date, 10 October, in both schedule and result. Teams and schedules remain unchanged.
Source URLs, workbook hashes, raw totals and metadata/game preservation hashes are in `history/provenance.json`.
All 171 linked Excel URLs were checked: 46 match sheets and 3 shared forms downloaded, while 122 unpublished match sheets returned 404. All 506 games, raw/weighted totals and standings agree with the official data.
Official results also store `playerLineup` (`source`, `games` keyed by slot with `home`/`away` name arrays, and `substitutions`). The result API supplies these pairings to Details; score validation remains unchanged. Four missing-name cells were resolved from matching player identifiers in other official sheets; provenance records their source cells and lineup hashes. Match `200213` retains an incomplete away doublette substitution in `playerLineup.unassignedSubstitutions` because the outgoing player and game are unknown.
Re-running `scripts/enrich-historical-results.mjs` preserves lineup hashes, name-resolution evidence and download/page audits, retaining the original dates for those earlier audits. It refuses to apply an import when an existing lineup or its workbook hash has changed without re-verification, staging omits an already-provenanced match, or a previously verified lineup is removed.

## Detailed scoring and storage

`POST /api/matches` requires Firebase authentication and `{ matchId, divisieId, scoreFormat: "individual-games-v1", games }`.
The 11 canonical slots are `tete-1` through `tete-6` (2 points each), `doublette-1` through `doublette-3` (3 each), and `triplette-1`/`triplette-2` (5 each).
Each unplayed slot uses `null` for both scores; an entered pair must be numeric integers with exactly one 13 and the other 0-12. The server derives weighted totals and fixture identity/date; aggregate-only submissions are rejected. Partial sheets remain provisional and do not affect standings until all 11 games are complete. Calculated 3-28 and 28-3 are valid.
Legacy aggregate-only records remain readable and retain their standings meaning: a match win earns 2 league points and saldo uses weighted totals, not raw-score sums.

Signed-in users may create or revise results at any time. Edits preserve fixture identity, original date, creation metadata and the original submission timestamp.

Duplicate checks occur within serialized atomic local writes or ETag-conditional blob transactions. New results return 201 and revisions return 200. Conditional conflicts retry against fresh data; storage failures never report success.
Deployment uploads every `data/*.json` file with `--overwrite true`, including result blobs. Repository data replaces the corresponding production blobs, so live results and edits not present in the repository are lost on deployment.

`RESULTS_DATA_DIR` and `SCHEDULE_DATA_DIR` isolate local development/test data; `AZURE_STORAGE_CONNECTION_STRING` must be unset for local file mode.
Run `npm test` in this directory for domain, API, concurrent storage and historical preservation checks. Synthetic authentication and blob operations exist only inside tests, not runtime routes.

## Documentation policy

- When backend behavior, API contracts, data shape, storage, or operational steps change, update:
  - `backend/README.md`
  - `README.md`
