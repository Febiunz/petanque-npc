# NPC Standen Backend

This folder contains the Node.js/Express backend for the Petanque results and standings website.

Team seed objects contain `id`, `name`, `divisie`, `divisieId`, `locale`, and `createdAt` (no `club` field).

## Official season data

All nine JSON files in `data/` were checked against the official NLpetanque 2026-2027 tables on 16 October 2026:
[1001](https://nlpetanque.nl/topdivisie-2026-2027-1001/),
[2001](https://nlpetanque.nl/2e-divisie-2026-2027-2001/), and
[2002](https://nlpetanque.nl/2e-divisie-2026-2027-2002/).
Each division has 8 teams and 56 fixtures, with 6, 9, and 8 published results respectively.
Schedules preserve official match numbers and published adjusted dates; results are included only when both scores are published.
The latest update schedules match `100107` for 13 December 2026 and aligns match `200111` with the published 17 October 2026 date and 14-17 result.
Unchanged files retain their existing content and timestamps.

## Documentation policy

- When backend behavior, API contracts, data shape, storage, or operational steps change, update:
  - `backend/README.md`
  - `README.md`
