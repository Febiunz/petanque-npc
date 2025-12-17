# NPC Standen

A simple results and standings website for the Dutch Petanque Topdivisie.

This project provides:
- A React (Vite + MUI) frontend to enter match results and view standings.
- A Node/Express backend with file-based storage.
- Firebase Authentication (Google) for gated result submission.

## Features

- Speelronde selector with round date; only rounds with open matches are shown.
- Result entry form with scores that always sum to 31 (clamped 0–31) and start blank.
- Score validation: 1 and 3 are not allowed for either team (client and server enforced).
- Hides matches already submitted; hides a round entirely when all its matches are completed.
- Delete a submitted result (auth required) with a small confirm prompt; standings refresh automatically.
- Standings calculation:
  - Winner = 2 points, loser = 0 points.
  - Ranking by points desc, then points difference (Saldo) desc, then team name.
  - Visual indicators: 1st place (champion) has a light green background; last 2 places (relegation) have a light red background.
- Compact results list: single-line rows with a minimal delete icon shown only when logged in.

## Tech stack

- Frontend: React 18, Vite, Material UI
- Backend: Node.js (ESM), Express, CORS, express-rate-limit
- Auth: Firebase Auth (client) + firebase-admin (server) for ID token verification
- Storage: JSON files under `backend/data` with atomic writes

## Repo layout

- `frontend/` — React app
- `backend/` — Express API
- `backend/data/` — JSON data files (teams, schedule, matches)
- `function/` — Azure Function for weekly schedule updates
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
  - `SCHEDULE_DATA_DIR` (optional): Directory containing schedule.json. Defaults to `backend/data`. Set to `/mnt/data` when using Azure File Share mount.
  - Note: The backend also loads `frontend/.env.local` for convenience in dev if present.
- Frontend
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
  - `VITE_API_BASE` (optional): API base URL for production (e.g., `https://<app-name>.azurewebsites.net`). In dev, the Vite proxy handles `/api` so this can be omitted.

## Authentication

- Users must sign in with Google (Firebase) to submit or delete results.
- The frontend attaches a Firebase ID token (Authorization: Bearer) to protected API calls.
- The backend verifies tokens with `firebase-admin`.

## Data & storage

- Teams are fixed to the official Topdivisie lineup and returned from the backend (not user-editable).
- Schedule is scraped from the official page when available, with a round-robin fallback. Stored at `backend/data/schedule.json`.
- **Schedule Updates**: An Azure Function (`function/schedule-updater`) runs every Monday at 20:00 UTC to check the official website for changed match dates ("Aangepaste datum" column) and automatically updates the schedule.
- Results are persisted in `backend/data/matches.json`. Writes are serialized via a simple in-process mutex to avoid corruption.
- Each saved result stores:
  - `fixtureId`/`matchId`, `matchNumber`, `homeTeamId`, `awayTeamId`, `homeScore`, `awayScore`
  - `date` (ISO date of match), `createdAt` (submission timestamp)
  - `submittedBy` (display name or email), `submittedByUid` (Firebase uid)

## API

Base URL in dev: proxied via Vite, so call `/api/...` from the frontend.

- `GET /api/health` — Service status
- `GET /api/teams` — Official teams
- `GET /api/matches/schedule` — Full schedule; `?round=NUMBER` to filter by round
- `GET /api/matches` — Submitted matches (most recent first)
- `POST /api/matches` — Submit a result (requires Firebase ID token)
  - Body: `{ matchId, homeScore, awayScore }`
  - Validation: requires a scheduled match; rejects duplicates; disallows scores 1 or 3 for either team.
- `DELETE /api/matches/:id` — Delete a submitted result by its id (requires Firebase ID token)
- `GET /api/standings` — Current standings, sorted as described above

Rate limiting (subject to tuning; current values from code):
- Pre-auth guard: 100 req/min per IP before auth processing.
- `GET /api/matches`: 100 req/min per IP.
- `POST /api/matches`: 100 req/min per user/IP, plus up to 100 submissions per 2 minutes for the same specific match per user, and a daily cap of 100 per user.
- Global per-match throttle (POST): 100 submissions/min across all users for the same match.
- `DELETE /api/matches/:id`: 100 deletions/min per user/IP.

## Frontend behavior

- Speelronde selector shows only rounds with at least one open (not completed) match and includes a date hint.
- Match dropdown shows only matches not yet completed/submitted for the selected round.
- Score inputs auto-complement to 31, clamp to 0–31, and start empty; scores 1 and 3 are blocked.
- After submit, standings and results refresh; the saved match disappears from the selection. If a round fully completes, it’s removed from the selector.
- Results list is compact (single-line). A tiny delete icon is shown as the last column only when logged in. Clicking prompts a confirmation and then refreshes data.

## Production notes (Azure)

GitHub Actions workflow is provided at `.github/workflows/azure-deploy.yml`:
- Backend → Azure App Service via `azure/webapps-deploy` using `AZURE_WEBAPP_PUBLISH_PROFILE`.
- Frontend → Azure Static Web Apps via `Azure/static-web-apps-deploy` using `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- Schedule Updater Function → Azure Functions via `Azure/functions-action` using `AZURE_FUNCTION_PUBLISH_PROFILE`.

Secrets to configure (repository or environment secrets):
- Frontend build-time: all `VITE_FIREBASE_*` vars listed above, plus `VITE_API_BASE` pointing to your backend URL.
- Backend runtime (App Service Application settings): `FIREBASE_PROJECT_ID` (required), `CHECK_REVOKED` (optional).
- Function runtime (Function App Application settings): 
  - Recommended: `SCHEDULE_FILE_PATH` (path to mounted schedule.json, e.g., `/mnt/data/schedule.json`)
  - Alternative: `AZURE_STORAGE_CONNECTION_STRING` and `STORAGE_CONTAINER_NAME` for blob storage

Firebase configuration:
- Add your SWA production domain to Firebase Authorized domains.
- If sign-in popups are blocked, enable redirects in your Firebase Auth settings (and allow the domain).

Azure Function notes:
- The schedule updater function runs automatically every Monday at 20:00 UTC (21:00/22:00 CET).
- It checks for changed match dates ("Aangepaste datum") on the official website and updates the schedule.
- Recommended: Mount an Azure File Share to both the backend App Service and Function App for shared access to `schedule.json`.
- See `function/README.md` for detailed setup and configuration instructions.

Manual build/run (optional):

```powershell
npm --prefix frontend run build
npm --prefix backend run start
```

## Troubleshooting

- 401 on submit/delete: Log in again; token may be expired. Ensure `FIREBASE_PROJECT_ID` matches your Firebase project.
- Unknown match: Ensure you selected a match from the current schedule; verify `backend/data/schedule.json` IDs.
- Round missing from selector: All matches in that round are completed (hidden by design).
- CORS in dev: Handled by Vite proxy. If running FE/BE on different hosts, set `VITE_API_BASE` in the frontend env.

## Contributing

- Issues and PRs are welcome. Please avoid committing secrets. Do not include real personal data.
- For significant changes, discuss via an issue first.

## License

- Code: MIT — see `LICENSE`.
- Website content (text/media): CC BY 4.0 — see `CONTENT_LICENSE`.

---

Questions? Open an issue in this repository.
