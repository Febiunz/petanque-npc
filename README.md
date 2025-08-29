# NPC Standen

A simple results and standings website for the Dutch Petanque Topdivisie (2025–2026).

This project provides:
- A React (Vite + MUI) frontend to enter match results and view standings.
- A Node/Express backend with file-based storage.
- Firebase Authentication (Google) for gated result submission.

## Features

- Speelronde selector with round date, showing only rounds that still have open matches.
- Result entry form with auto-balanced scores: home + away = 31 (clamped 0–31).
- Hides matches already submitted; hides a round entirely when all its matches are completed.
- Standings calculation:
  - Winner = 2 points, loser = 0 points.
  - Ranking by points desc, then points difference (Saldo) desc, then team name.
- Submitted results table showing match no./id, teams, score, submitter, and timestamp.

## Tech stack

- Frontend: React 18, Vite, Material UI
- Backend: Node.js (ESM), Express, CORS
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

Open the app: http://localhost:5173/

- The Vite dev server proxies `/api` to the backend at http://localhost:5000

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
  - `PORT` (optional): API port, default `5000`.
  - `FIREBASE_PROJECT_ID` (optional): Firebase project id for token verification; defaults to `npc-standen-new`.
- Frontend
  - `VITE_API_BASE` (optional): API base URL. In dev, the Vite proxy handles `/api`; leave this unset.

## Authentication

- Users must sign in with Google (Firebase) to submit results.
- The frontend attaches a Firebase ID token (Authorization: Bearer) to `POST /api/matches`.
- The backend verifies tokens with `firebase-admin`.

## Data & storage

- Teams are fixed to the official Topdivisie lineup and returned from the backend (not user-editable).
- Schedule is parsed from the official page when possible, with a round-robin fallback. Stored at `backend/data/schedule.json`.
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
  - Validates against schedule, rejects duplicates; completion is inferred from presence in `matches.json`.
- `GET /api/standings` — Current standings, sorted as described above

## Frontend behavior

- Speelronde selector shows only rounds with at least one open (not completed) match and includes a date hint.
- Match dropdown shows only matches not yet completed/submitted for the selected round.
- Score inputs auto-complement to 31 and clamp to 0–31.
- After submit, standings and results refresh; the saved match disappears from the selection. If a round fully completes, it’s removed from the selector.
- Results table shows who submitted the result and when.

## Production notes

Build frontend:

```powershell
npm --prefix frontend run build
```

Start backend (no nodemon):

```powershell
npm --prefix backend run start
```

A simple Docker Compose file is included as a starting point (adjust as needed).

## Troubleshooting

- 401 on submit: Log in again; token may be expired. Ensure the backend recognizes the Firebase project id.
- Unknown match: Ensure you selected a match from the current schedule; verify `backend/data/schedule.json` IDs match.
- Round missing from selector: All matches in that round are completed (hidden by design).
- CORS in dev: Handled by Vite proxy. If you run FE/BE separately across hosts, set `VITE_API_BASE` accordingly.

## Contributing

- Issues and PRs are welcome. Please avoid committing secrets. Do not include real personal data.
- For significant changes, discuss via an issue first.

## License

- Code: MIT — see `LICENSE`.
- Website content (text/media): CC BY 4.0 — see `CONTENT_LICENSE`.

---

Questions? Open an issue in this repository.
