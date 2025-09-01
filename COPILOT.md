# Copilot Instructions for this Repository

This guide helps GitHub Copilot and contributors work effectively in this codebase.

## Quick facts
- Frontend: React 18 + Vite + MUI (`frontend/`)
- Backend: Node.js (ESM) + Express + `firebase-admin` (`backend/`)
- Auth: Firebase (client) + ID token verification on the server
- Storage: JSON files under `backend/data` (teams, schedule, matches)
- Deploy: GitHub Actions → Azure App Service (backend) + Azure Static Web Apps (frontend)

## Golden rules
- Prefer minimal diffs; don’t reformat unrelated code.
- Preserve public APIs and UI unless asked to change them.
- Mirror client-side validation on the server for any user input.
- Never commit secrets. Use env vars and repo/CI secrets.
- Update docs when behavior, validations, or rate limits change (README, this file).

## Architecture and contracts
- Completion is derived from `matches.json`. Do NOT use `schedule.status`.
- Scores: integers in [0, 31], must sum to 31. Values 1 and 3 are disallowed for either team.
- Auth: Protected endpoints require `Authorization: Bearer <ID_TOKEN>`.
- Deleting a result must trigger standings refresh; UI asks for confirmation before delete.

### API (under `/api`)
- `GET /api/health` — service status
- `GET /api/teams` — fixed Topdivisie teams
- `GET /api/matches/schedule` — full schedule; `?round=NUMBER` filter
- `GET /api/matches` — submitted matches (most recent first)
- `POST /api/matches` — submit result (auth required)
  - Body: `{ matchId, homeScore, awayScore }`
  - Validates against schedule; rejects duplicates; rejects scores 1 or 3
- `DELETE /api/matches/:id` — delete submitted result (auth required)
- `GET /api/standings` — standings (win=2, loss=0; tie not expected but handled)

### Rate limiting (current from code)
- Pre-auth guard: 100 req/min per IP
- `GET /api/matches`: 100 req/min per IP
- `POST /api/matches`: 100 req/min per user/IP
  - Per user+match: 100 submissions per 2 minutes
  - Per user daily cap: 100/day
  - Global per match: 100/min across all users
- `DELETE /api/matches/:id`: 100 deletions/min per user/IP

If these values change in `backend/routes/matches.js`, update README and this file together.

## Frontend rules (UI/UX)
- Form title: “Uitslag invoeren Topdivisie”.
- Score inputs start empty; auto-complement to 31; block 1 and 3; disable submit until valid.
- Results list: single-line rows; tiny delete icon as last column only when logged in; confirm before delete.
- In dev, Vite proxies `/api` → `http://localhost:5000`.

## Backend rules
- `requireAuth` uses `FIREBASE_PROJECT_ID`; optional `CHECK_REVOKED='true'` to verify revoked tokens.
- File writes are serialized via a simple in-process mutex; keep writes atomic.
- Schedule scrapes the official page if possible; otherwise uses round-robin. Do not reintroduce a fixtures layer.

## Environment & secrets
- Backend runtime: `FIREBASE_PROJECT_ID` (required), `CHECK_REVOKED` (optional), `PORT` (dev default 5000).
- Frontend build-time: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_API_BASE` (prod).
- Firebase authorized domains must include the production SWA domain.

## Local development (Windows PowerShell)
- Install both apps: `npm run install:all`
- Run both apps: `npm run dev`
  - Frontend: http://localhost:5173 (will pick next port if busy)
  - Backend: http://localhost:5000
- Run separately:
  - Backend: `npm --prefix backend run dev`
  - Frontend: `npm --prefix frontend run dev`

## Change patterns
- Small, focused patches with clear intent; avoid touching unrelated code.
- For new features, outline a tiny contract (inputs/outputs, error cases) first.
- Keep client and server validation consistent.
- When public behavior changes (endpoints, limits, validations), update documentation.

## PR and commit guidance
- One logical change per PR with a clear title and concise description.
- Call out user-facing changes, updated docs, and any new env vars.
- If you change rate limits or validation, add an explicit note in the PR body.

## Prompt templates for Copilot Chat
- “Implement server-side validation to reject scores of 1 or 3 in POST /api/matches and update docs.”
- “Add a confirmation dialog before deleting a result in `frontend/src/App.jsx` and refresh standings.”
- “Update README/COPILOT.md to reflect new rate limits from `backend/routes/matches.js`.”
- “Harden DELETE /api/matches/:id with per-user limits and document it.”
- “Troubleshoot Firebase login on SWA; verify authorized domains and VITE_* secrets.”
- “Keep results rows single-line and place delete icon in the last column.”

## Safety & quality checks
- Start the app(s) or do a quick smoke test after changes.
- Re-run impacted flows (submit, delete) locally.
- Update README and COPILOT.md if behavior changed.
