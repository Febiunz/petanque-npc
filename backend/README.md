# NPC Standen Backend

This folder contains the Node.js/Express backend for the Petanque results and standings website.

Team seed objects contain `id`, `name`, `divisie`, `divisieId`, `locale`, and `createdAt` (no `club` field).

## Official season data

All nine JSON files in `data/` were checked against the official NLpetanque 2026-2027 tables on 18 November 2026:
[1001](https://nlpetanque.nl/topdivisie-2026-2027-1001/),
[2001](https://nlpetanque.nl/2e-divisie-2026-2027-2001/), and
[2002](https://nlpetanque.nl/2e-divisie-2026-2027-2002/).
Each division has 8 teams and 56 fixtures, with 18, 20, and 20 published results respectively, including round five (14 November).
Schedules preserve official match numbers and published adjusted dates; results are included only when both scores are published.
The 58 published results contain 638 individual games with official player lineups. Match `200111` retains its official workbook date, 10 October, in both schedule and result. Teams and schedules remain unchanged.
Source URLs, workbook hashes, raw totals and metadata/game preservation hashes are in `history/provenance.json`.
All 171 linked Excel URLs were checked: 58 match sheets and 3 shared forms downloaded, while 110 match sheets for fixtures without published scores returned 404. All individual scores, raw/weighted totals and standings agree with the official data. The newly available `200119` workbook adds all 11 games and lineups without changing the 17-14 result (raw 113-99).
Official results also store `playerLineup` (`source`, `games` keyed by slot with `home`/`away` name arrays, and `substitutions`). The result API supplies these pairings to Details; score validation remains unchanged. Four missing-name cells were resolved from matching player identifiers in other official sheets; provenance records their source cells and lineup hashes. Match `200213` retains an incomplete away doublette substitution in `playerLineup.unassignedSubstitutions` because the outgoing player and game are unknown.
The revised `200117` workbook names Patrick Lautenslager as the home player for `tete-5`; its 13-10 game score is unchanged.
Re-running `scripts/enrich-historical-results.mjs` preserves lineup hashes, name-resolution and missing-name evidence, and download/page audits, retaining the original dates for those earlier audits. `latestExcelDownloadAudit` separately records the current download audit. The helper refuses to apply an import when an existing lineup or its workbook hash has changed without re-verification, staging omits an already-provenanced match, or a previously verified lineup is removed.

Subsequent refreshes use `scripts/audit-official-npc.py` (temporary Python environment with `scripts/requirements-official-npc.txt`) to capture all official fixture cells and linked match workbooks. `scripts/reconcile-official-npc.mjs <snapshot.json> --apply` adds verified new detailed results and updates dates only on existing fixtures; `--check` fails until all source results and dates are reconciled. Empty/adjusted-date columns cannot hide matches. Missing published workbooks, incomplete coverage, changing pages and unverified changes to audited workbooks fail explicitly rather than producing a no-change success. Completed results/fixtures use the workbook played date; upcoming fixtures use adjusted or round dates. Identity, pairings, creation metadata and existing lineup evidence stay intact, with date corrections recorded in provenance. Mandatory workflow checks gate publication, and the auto-merge workflow independently enforces date-only schedule edits. A snapshot does not cover later website updates.

The 23 November audit verifies 59 results (19/20/20) and adds match `100106`: Le Biberon 1 - CdP Les Cailloux 1, 9-22 (raw 93-116), played on 21 November. All 168 fixture dates already match the verified sources. Earlier download audits retain their original dates; superseded latest audits are retained in `excelDownloadAudits`.

## Detailed scoring and storage

`POST /api/matches` requires Firebase authentication and `{ matchId, divisieId, scoreFormat: "individual-games-v1", games }`.
The 11 canonical slots are `tete-1` through `tete-6` (2 points each), `doublette-1` through `doublette-3` (3 each), and `triplette-1`/`triplette-2` (5 each).
Each unplayed slot uses `null` for both scores; an entered pair must be numeric integers with exactly one 13 and the other 0-12. The server derives weighted totals and fixture identity/date. Partial sheets remain provisional and do not affect standings until all 11 games are complete. Calculated 3-28 and 28-3 are valid.
Quick entry uses `{ matchId, divisieId, scoreFormat: "aggregate-v1", homeScore, awayScore }`: numeric integers 0-31 summing to 31, excluding unreachable 1/30. Totals such as 19-12, 3-28 and 28-3 are accepted without creating games. Matching detailed scores preserve all games; conflicting/inconsistent entered games return 409 directing users to Details. Entirely blank sheets can become aggregate-only results.
Legacy aggregate-only records remain readable and retain their standings meaning: a match win earns 2 league points and saldo uses weighted totals, not raw-score sums.

Signed-in users may create or revise nonofficial results at any time. Edits preserve fixture identity, original date, creation metadata and the original submission timestamp.
Official results are locked by audited `history/provenance.json` or persisted `officialSource: "nlpetanque"` set at historical enrichment. Request-supplied official flags are ignored. GET adds computed `official`; both write modes reject official results with 409 within the transaction, rechecking on conditional blob retries if an import wins a race. Both frontend entry screens remain viewable but disable saving with a Dutch explanation.

Duplicate checks occur within serialized atomic local writes or ETag-conditional blob transactions. New results return 201 and revisions return 200. Conditional conflicts retry against fresh data; storage failures never report success.
Deployment uploads every `data/*.json` file with `--overwrite true`, including result blobs. Repository data replaces the corresponding production blobs, so live results and edits not present in the repository are lost on deployment.

`RESULTS_DATA_DIR` and `SCHEDULE_DATA_DIR` isolate local development/test data; `AZURE_STORAGE_CONNECTION_STRING` must be unset for local file mode.
Run `npm test` in this directory for domain, API, concurrent storage and historical preservation checks. Synthetic authentication and blob operations exist only inside tests, not runtime routes.

## Documentation policy

- When backend behavior, API contracts, data shape, storage, or operational steps change, update:
  - `backend/README.md`
  - `README.md`
