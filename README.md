# NPC Standen

A results and standings website for Dutch Petanque competition NPC.

This project provides:
- A React (Vite + MUI) frontend to enter match results and view standings.
- A Node/Express backend with file-based storage.
- Firebase Authentication (Google) for gated result submission.

## Features

- Required division selection before entering results.
- Supported division identifiers: `1001` (Topdivisie), `2001` and `2002` (2e divisie).
- Speelronde selector with round date; only rounds with open matches are shown.
- Result entry form with scores that always sum to 31 (clamped 0–31) and start blank.
- Score validation: 1, 3, 28 and 30 are not allowed for either team (client and server enforced).
- Hides matches already submitted; hides a round entirely when all its matches are completed.
- Standings calculation:
  - Winner = 2 points, loser = 0 points.
  - Ranking by points desc, then points difference (Saldo) desc, then team name.
  - Visual indicators: 1st place (champion) has a light green background; last 2 places (relegation) have a light red background.
- Compact results list: single-line rows.

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

- Node.js 18+ and npm

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
  - Note: The backend also loads `frontend/.env.local` for convenience in dev if present.
- Frontend
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
  - `VITE_API_BASE` (optional): API base URL for production (e.g., `https://<app-name>.azurewebsites.net`). In dev, the Vite proxy handles `/api` so this can be omitted.

## Authentication

- Users must sign in with Google (Firebase) to submit results.
- The frontend attaches a Firebase ID token (Authorization: Bearer) to protected API calls.
- The backend verifies tokens with `firebase-admin`.

## Data & storage

- Teams are fixed to official divisions and returned from the backend (not user-editable).
- Schedule is generated locally (round-robin) from division teams; no external official schedule fetch/parsing is used.
- Schedule is stored per division in **Azure Blob Storage** (`npcstandenstorageaccount/data/schedule-1001.json`, `schedule-2001.json`, `schedule-2002.json`) in production. Falls back to local `backend/data/schedule-<divisieId>.json` files in development.
- Results are persisted per division in **Azure Blob Storage** (`npcstandenstorageaccount/data/matches-1001.json`, `matches-2001.json`, `matches-2002.json`) in production, or local `backend/data/matches-<divisieId>.json` in development. Writes are serialized via a simple in-process mutex to avoid corruption.
- Current seeded season data is prepared for **2026–2027**:
  - 3 divisions (`1001`, `2001`, `2002`) with generated team names
  - Round dates mapped to:
    - 2026: `19-sep`, `3-okt`, `17-okt`, `31-okt`, `14-nov`, `28-nov`, `19-dec`
    - 2027: `9-jan`, `23-jan`, `6-feb`, `20-feb`, `6-mrt`, `20-mrt`, `27-mrt`
  - Example results seeded per division: rounds 1–3 complete and 2 matches from round 4
- Legacy single-file data (`schedule.json` and `matches.json`) is migrated one-time to the per-division files on startup.
- Each saved result stores:
  - `fixtureId`/`matchId`, `matchNumber`, `homeTeamId`, `awayTeamId`, `homeScore`, `awayScore`
  - `date` (ISO date of match), `createdAt` (submission timestamp)
  - `submittedBy` (display name or email), `submittedByUid` (Firebase uid)

## API

Base URL in dev: proxied via Vite, so call `/api/...` from the frontend.

- `GET /api/health` — Service status
- `GET /api/teams` — Official teams; supports `?divisieId=1001|2001|2002` and optional `?divisie=topdivisie|2e-divisie`
- `GET /api/matches/schedule` — Full schedule; supports `?divisieId=1001|2001|2002`, optional `?divisie=...`, and `?round=NUMBER`
- `GET /api/matches` — Submitted matches (most recent first); supports `?divisieId=1001|2001|2002`
- `POST /api/matches` — Submit a result (requires Firebase ID token)
  - Body: `{ matchId, divisieId, homeScore, awayScore }`
  - Validation: requires a scheduled match; rejects duplicates; disallows scores 1, 3, 28, or 30 for either team.
- `GET /api/standings` — Current standings; supports `?divisieId=1001|2001|2002` and optional `?divisie=...`

Rate limiting (subject to tuning; current values from code):
- Pre-auth guard: 100 req/min per IP before auth processing.
- `GET /api/matches`: 100 req/min per IP.
- `POST /api/matches`: 100 req/min per user/IP, plus up to 100 submissions per 2 minutes for the same specific match per user, and a daily cap of 100 per user.
- Global per-match throttle (POST): 100 submissions/min across all users for the same match.

## Frontend behavior

- User must select divisie and pool before rounds/matches become selectable.
- Speelronde selector shows only rounds with at least one open (not completed) match and includes a date hint.
- Match dropdown shows only matches not yet completed/submitted for the selected round and selected division.
- Score inputs auto-complement to 31, clamp to 0–31, and start empty; scores 1, 3, 28, and 30 are blocked.
- After submit, standings and results refresh; the saved match disappears from the selection. If a round fully completes, it’s removed from the selector.
- Results list is compact (single-line).

## Production notes (Azure)

GitHub Actions workflow is provided at `.github/workflows/azure-deploy.yml`:
- Backend → Azure App Service via `azure/webapps-deploy` using `AZURE_WEBAPP_PUBLISH_PROFILE`.
- Frontend → Azure Static Web Apps via `Azure/static-web-apps-deploy` using `AZURE_STATIC_WEB_APPS_API_TOKEN`.

Secrets to configure (repository or environment secrets):
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
- Round missing from selector: All matches in that round are completed (hidden by design).
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
