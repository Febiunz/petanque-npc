# NPC Standen

A results and standings website for Dutch Petanque competition NPC.

This project provides:
- A React (Vite + MUI) frontend to enter match results and view standings.
- A Node/Express backend with file-based storage.
- Firebase Authentication (Google) for gated result submission.

## Features

- Required division selection before entering results.
- Supported division identifiers: `1001` (Topdivisie), `2001` and `2002` (2e divisie).
- Speelronde and Wedstrijd selectors include every scheduled fixture, including completed/past matches.
- The selected weighted result (or "Nog geen uitslag") appears beside the exact "Details" button below Wedstrijd.
- Details opens a dedicated screen: 6 tete-a-tete, 3 doublette and 2 triplette games, with two independent blank scores per new game.
- When a match's official Excel sheet is available, Details shows home-away player pairs on one line; substitutions are listed below the original pairing as `out → in`.
- Each finished game has exactly one side at 13 and the other an integer 0-12. Wins award 2/3/5 weighted match points, distributing 31 points. Calculated 3-28 and 28-3 results are allowed; only 1 and 30 are unreachable.
- Signed-in users can save and revise game results at any time. Partial sheets remain provisional and do not affect standings until all 11 games are complete. Legacy aggregate-only results remain viewable without invented games.
- Standings calculation:
  - Winner = 2 points, loser = 0 points.
  - Ranking by points desc, then points difference (Saldo) desc, then team name.
  - Visual indicators: 1st place (champion) has a light green background; last 2 places (relegation) have a light red background.
- Compact results list: single-line rows with Ronde, played Datum, Thuis, Uit and Uitslag columns.

## Tech stack

- Frontend: React 18, Vite, Material UI
- Backend: Node.js (ESM), Express, CORS, express-rate-limit
- Auth: Firebase Auth (client) + firebase-admin (server) for ID token verification
- Storage: JSON files under `backend/data` with atomic writes

## Repo layout

- `frontend/` — React app
- `backend/` — Express API
- `backend/data/` — JSON data files (teams, schedule, matches)
- `LICENSE` — Code license (MIT)
- `CONTENT_LICENSE` — Website content license (CC BY 4.0)
- `NOTICE` — Licensing summary

## Prerequisites

- Node.js 24+ and npm

## Quick start (development)

Install dependencies for both apps:

```powershell
npm run install:all
```

Start both frontend and backend concurrently:

```powershell
npm run dev
```

Open the app: http://localhost:5173/ (Vite will use the next port if 5173 is busy)

- The Vite dev server proxies `/api` to the backend at http://localhost:5000.

Run each app separately (optional):

- Backend (API):
  ```powershell
  npm --prefix backend run dev
  ```
  API health: http://localhost:5000/api/health

- Frontend (Vite dev):
  ```powershell
  npm --prefix frontend run dev
  ```

## Environment variables

- Backend
  - `PORT` (optional): API port, default `5000` in dev (App Service injects one in prod).
  - `FIREBASE_PROJECT_ID` (required): Firebase project id for token verification.
  - `CHECK_REVOKED` (optional): `'true'` to enable token revocation checks; default is disabled.
  - `AZURE_STORAGE_CONNECTION_STRING` (production): Connection string for Azure Blob Storage. When set, per-division schedule/match files are stored in blob storage instead of local files.
  - `STORAGE_CONTAINER_NAME` (optional): Blob container name, defaults to `data`.
  - `RESULTS_DATA_DIR` / `SCHEDULE_DATA_DIR` (optional): Local data-directory overrides for isolated development and tests. Not used in blob mode.
  - Note: The backend also loads `frontend/.env.local` for convenience in dev if present.
- Frontend
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
  - `VITE_API_BASE` (optional): API base URL for production (e.g., `https://<app-name>.azurewebsites.net`). In dev, the Vite proxy handles `/api` so this can be omitted.
  - `DEV_API_TARGET` (optional, Vite server environment): Override the development proxy target; default `http://localhost:5000`.

## Authentication

- Users must sign in with Google (Firebase) to submit results.
- The frontend attaches a Firebase ID token (Authorization: Bearer) to protected API calls.
- The backend verifies tokens with `firebase-admin`.
- Without local Firebase client configuration, public viewing and unsaved score entry still work, but sign-in and saving are disabled. No development authentication bypass exists.

## Data & storage

- Teams are fixed to official divisions and returned from the backend (not user-editable).
- Team rows use: `id`, `name`, `divisie`, `divisieId`, `locale`, `createdAt` (no `club` field).
- Committed teams, schedules, and results are synchronized with the official NLpetanque pages listed below. A generated round-robin schedule is only a fallback when stored schedule data is unavailable.
- Schedule is stored per division in **Azure Blob Storage** (`npcstandenstorageaccount/data/schedule-1001.json`, `schedule-2001.json`, `schedule-2002.json`) in production. Falls back to local `backend/data/schedule-<divisieId>.json` files in development.
- Results are persisted per division in **Azure Blob Storage** (`npcstandenstorageaccount/data/matches-1001.json`, `matches-2001.json`, `matches-2002.json`) in production, or local `backend/data/matches-<divisieId>.json` in development. Local writes are atomic and serialized; duplicate detection occurs inside the transaction. Blob result writes use ETag conditions and bounded retries so concurrent writers cannot replace one another's submissions.
- Current official season data is prepared for **2026–2027**, last checked on **12 November 2026**:
  - 3 divisions (`1001`, `2001`, `2002`) with 8 official teams and 56 fixtures each
  - Sources: [Topdivisie 1001](https://nlpetanque.nl/topdivisie-2026-2027-1001/), [2e divisie 2001](https://nlpetanque.nl/2e-divisie-2026-2027-2001/), [2e divisie 2002](https://nlpetanque.nl/2e-divisie-2026-2027-2002/)
  - Round dates mapped to:
    - 2026: `19-sep`, `3-okt`, `17-okt`, `31-okt`, `14-nov`, `28-nov`, `19-dec`
    - 2027: `9-jan`, `23-jan`, `6-feb`, `20-feb`, `6-mrt`, `20-mrt`, `3-apr`
  - Individual fixtures use adjusted dates when published by NLpetanque; match `100107` is scheduled for `2026-12-13`.
  - Published results: 14 in `1001`, 16 in `2001`, and 16 in `2002`, including all published round-four results (31 October 2026). Fixtures without published scores remain without a result entry.
  - These 46 results now include 506 validated individual games from official score sheets. Every original ID, author field and aggregate is preserved; match `200111` uses its official workbook date, 10 October, in both schedule and result.
  - All 171 linked Excel URLs were checked: 46 match sheets and 3 shared forms downloaded; 122 unpublished match sheets returned 404. All individual scores, weighted/raw totals, teams and standings agree with the official data.
  - Each official result stores `playerLineup` with source URL, home/away names keyed by game slot, and substitutions. Details reads these names from the result API rather than a separate frontend list. Four `#N/A` name cells were resolved by matching the same player identifiers in other official match sheets, with source cells recorded in provenance.
  - Match `200213` has an incomplete away doublette substitution: Elout Visser is listed as incoming but the outgoing player is blank. It is retained under `playerLineup.unassignedSubstitutions`, without guessing a game or replacing an original pairing.
  - Source URLs, workbook hashes, raw totals and preservation checks are in `backend/history/provenance.json` (not an uploaded result blob).
- Legacy single-file data (`schedule.json` and `matches.json`) is migrated one-time to the per-division files on startup.
- Each saved result stores:
  - `fixtureId`/`matchId`, `matchNumber`, `homeTeamId`, `awayTeamId`, `homeScore`, `awayScore`
  - `date` (ISO date of match), `createdAt` (submission timestamp)
  - `submittedBy` (display name or email), `submittedByUid` (Firebase uid)
  - Detailed records add `scoreFormat: "individual-games-v1"` and `games: [{ slotId, homeScore, awayScore }]`.
  - Canonical slots: `tete-1` through `tete-6`, `doublette-1` through `doublette-3`, `triplette-1` and `triplette-2`. Raw game scores and weighted `homeScore`/`awayScore` have distinct meanings; standings use only weighted scores.

The local-only enrichment helper `node scripts/enrich-historical-results.mjs <staged-artifact-directory>` validates all pools without writing. Add `--apply` to enrich repository-managed result arrays, preserving unrelated records and refusing identity, aggregate or detail conflicts. It never connects to Azure. Staged envelopes are not result arrays; never upload them as pool blobs. Existing live blobs are not automatically enriched by deployment; a separately reviewed live merge requires its own approval.

## API

Base URL in dev: proxied via Vite, so call `/api/...` from the frontend.

- `GET /api/health` — Service status
- `GET /api/teams` — Official teams; supports `?divisieId=1001|2001|2002` and optional `?divisie=topdivisie|2e-divisie`
- `GET /api/matches/schedule` — Full schedule; supports `?divisieId=1001|2001|2002`, optional `?divisie=...`, and `?round=NUMBER`
- `GET /api/matches` — Submitted matches (most recent first); supports `?divisieId=1001|2001|2002`
- `POST /api/matches` — Submit a result (requires Firebase ID token)
  - Body: `{ matchId, divisieId, scoreFormat: "individual-games-v1", games: [{ slotId, homeScore, awayScore }, ...] }`
  - Validation: requires a fixture in the selected pool and exactly 11 unique canonical slots. Each unplayed game uses `null` for both scores; each entered pair must have numeric integer scores (exactly one 13, the other 0-12). Aggregate-only submissions are no longer accepted.
  - Server derives weighted totals and scheduled identity/date; client totals cannot override them. Conflicting supplied totals return 400, duplicate submissions return 409, and storage failures are explicit errors.
- `GET /api/standings` — Current standings; supports `?divisieId=1001|2001|2002` and optional `?divisie=...`

Rate limiting (subject to tuning; current values from code):
- Pre-auth guard: 100 req/min per IP before auth processing.
- `GET /api/matches`: 100 req/min per IP.
- `POST /api/matches`: 100 req/min per user/IP, plus up to 100 submissions per 2 minutes for the same specific match per user, and a daily cap of 100 per user.
- Global per-match throttle (POST): 100 submissions/min across all users for the same match.

## Frontend behavior

- User must select divisie and pool before rounds/matches become selectable.
- Every scheduled round and match stays selectable, with a date hint. Upcoming-only filtering remains separate in "Komende wedstrijden".
- Below Wedstrijd, "Details" shares a row with the selected weighted result or explicit unavailable/loading/unplayed status.
- Details locks the fixture identity and displays all 11 games. Signed-in users can save partial games and revise results without a timing restriction.
- New raw inputs start empty and are independently editable: no auto-complement, clamping or truncation. Each valid game contributes its weighted points; incomplete totals are labeled provisional.
- Each game section shows a left-aligned, single-line cumulative weighted subtotal beside its navigation/save controls: tete-a-tete after six games, doublette including tete-a-tete, then "Totaal" including all three sections. Per-win explanatory labels are omitted. The header's separately labeled raw sum remains.
- Below each of the three game blocks, "Terug" opens an unsaved-results dialog with save-and-close, discard-and-close, and continue-editing choices. "Opslaan" saves all 11 slots, including blank unplayed slots, while keeping the details open.
- Google sign-in is required to save; blank scores are allowed, but a partially entered or invalid score pair must be completed or cleared. In-flight saves block navigation and repeat submission; errors retain input. Dirty back navigation asks before discarding and tab close/reload warns where supported.
- Successful save preserves pool/round/match selection and refreshes standings/results. A failed refresh after confirmed save does not cause another POST.
- Results list is compact (single-line); its second column shows the played date and its last column shows the score (official result date, otherwise the fixture date), like "Komende wedstrijden".

## Continuous integration

GitHub Actions workflow at `.github/workflows/ci.yml` runs on every pull request to `main` (and on pushes to `main`):
- **Backend job**: `npm ci` and `npm test` in `backend/`, then API health/teams/schedule/standings smoke checks. Tests use isolated files and mocked token verification/blob operations, never production writes.
- **Frontend job**: `npm ci`, `npm test` and `npm run build` with placeholder `VITE_FIREBASE_*` values (no real secrets required).

This validates Dependabot dependency updates before anything is deployed to Azure. Dependabot is configured (`.github/dependabot.yml`) to update npm packages in `/`, `/backend`, and `/frontend`, plus GitHub Actions and Docker, weekly.

## Production notes (Azure)

GitHub Actions workflow is provided at `.github/workflows/azure-deploy.yml`:
- Backend → Azure App Service via `azure/webapps-deploy` using `AZURE_WEBAPP_PUBLISH_PROFILE`.
- Backend data → Every `backend/data/*.json` file is uploaded to container `data` using `AZURE_STORAGE_CONNECTION_STRING` and `--overwrite true`, including results, teams and schedules. Repository data is authoritative during deployment: live results and edits not present in the repository are replaced.
- Frontend → Azure Static Web Apps via `Azure/static-web-apps-deploy` using `AZURE_STATIC_WEB_APPS_API_TOKEN`.

Secrets to configure (repository or environment secrets):
- `AZURE_STORAGE_CONNECTION_STRING` (used by the workflow to upload `backend/data/*.json`).
- Frontend build-time: all `VITE_FIREBASE_*` vars listed above, plus `VITE_API_BASE` pointing to your backend URL.
- Backend runtime (App Service Application settings): 
  - `FIREBASE_PROJECT_ID` (required)
  - `CHECK_REVOKED` (optional)
  - `AZURE_STORAGE_CONNECTION_STRING` (required for production)
  - `STORAGE_CONTAINER_NAME` (optional, defaults to "data")

Firebase configuration:
- Add your SWA production domain to Firebase Authorized domains.
- If sign-in popups are blocked, enable redirects in your Firebase Auth settings (and allow the domain).

Manual build/run (optional):

```powershell
npm --prefix frontend run build
npm --prefix backend run start
```

## Troubleshooting

- 401 on submit: Log in again; token may be expired. Ensure `FIREBASE_PROJECT_ID` matches your Firebase project.
- Unknown match: Ensure you selected a match from the current schedule; verify `backend/data/schedule-<divisieId>.json` IDs.
- Round missing from selector: Retry loading and check the pool schedule; completion must never hide a scheduled round.
- CORS in dev: Handled by Vite proxy. If running FE/BE on different hosts, set `VITE_API_BASE` in the frontend env.

## Contributing

- Issues and PRs are welcome. Please avoid committing secrets. Do not include real personal data.
- For significant changes, discuss via an issue first.
- Keep documentation in sync with every change/PR/issue: update this README and the relevant `backend/README.md` and `frontend/README.md` when behavior, data, API, or operations change.

## License

- Code: MIT — see `LICENSE`.
- Website content (text/media): CC BY 4.0 — see `CONTENT_LICENSE`.

---

Questions? Open an issue in this repository.
