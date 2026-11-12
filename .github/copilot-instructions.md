# GitHub Copilot Instructions for petanque-npc Repository

## Overview
This repository contains a petanque match management system with a React frontend and Node.js backend. It allows users to submit and track match results for multiple NPC competition divisions.

## Technology Stack
- **Frontend**: React 18 + Vite + Material UI (MUI)
- **Backend**: Node.js (ESM) + Express + Firebase Authentication
- **Storage**: Azure Blob Storage (production) / Local JSON files (development)
- **Deployment**: Azure App Service (backend) + Azure Static Web Apps (frontend)
- **CI/CD**: GitHub Actions

## Architecture
```
frontend/          # React 18 + Vite + MUI
├── src/
├── package.json
└── vite.config.js

backend/           # Node.js ESM + Express
├── data/          # JSON storage files (development only)
├── routes/        # Express routes
├── storage/       # Storage abstraction (blob/file)
├── index.js       # Main server file
└── package.json

scripts/           # Helper scripts
package.json       # Root convenience scripts
.github/
└── workflows/
    └── azure-deploy.yml
```

## Critical Commands and Timing

### Do not cancel the following commands before completion: `npm run install:all`, `npm run dev`, `npm run build`

### Installation (Timeout: 300 seconds)
```bash
# Install all dependencies - TAKES ~25 seconds, NEVER CANCEL
npm run install:all
```

### Development (Timeout: 120 seconds minimum)
```bash
# Start both frontend and backend - TAKES ~10-15 seconds to start, NEVER CANCEL
npm run dev
# Frontend: http://localhost:5173
# Backend: http://localhost:5000
```

### Building (Timeout: 180 seconds)
```bash
# Build frontend - TAKES ~3-5 seconds, NEVER CANCEL
cd frontend && npm run build

# Backend doesn't require building (Node.js)
```

### Individual Services
```bash
# Backend only (Timeout: 60 seconds)
cd backend && npm run start     # Production mode
cd backend && npm run dev       # Development mode with nodemon

# Frontend only (Timeout: 120 seconds)
cd frontend && npm run dev      # Development server
cd frontend && npm run preview  # Preview built app (port 4173)
```

## API Endpoints

### Public Endpoints
- `GET /api/health` - Service status check
- `GET /api/teams` - Teams list (supports `?divisieId=1001|2001|2002`, optional `?divisie=topdivisie|2e-divisie`)
- `GET /api/matches/schedule` - Full schedule (filters: `?divisieId=...`, optional `?divisie=...`, `?round=NUMBER`)
- `GET /api/matches` - Submitted matches (most recent first; supports `?divisieId=...`)
- `GET /api/standings` - Current standings (supports `?divisieId=...`, optional `?divisie=...`)

### Protected Endpoints (Require Firebase Auth)
- `POST /api/matches` - Submit result
  - Body: `{ matchId, divisieId, scoreFormat: "individual-games-v1", games: [{ slotId, homeScore, awayScore }, ...] }`
  - Exactly 11 canonical slots: tete-1..6 (2 points), doublette-1..3 (3 points), triplette-1..2 (5 points)
  - Raw pairs: exactly one numeric integer 13 and the other integer 0-12; both independently entered
  - Server derives weighted totals summing to 31 and scheduled fixture identity/date; no aggregate-only submissions
  - `divisieId` is required and must match the selected pool in the UI

## Key Business Rules

### Score Validation
- Six tete-a-tete, three doublette and two triplette games award 2/3/5 weighted points per win
- Each raw pair: exactly one 13 and one integer 0-12; raw 1 and 3 are allowed
- Derive weighted totals from all 11 valid games; 3-28 and 28-3 are valid, only 1/30 are unreachable
- Preserve distinct raw sums and weighted totals; standings award 2 league points per match win and use weighted saldo

### Data Integrity
- Match completion derived from per-division `matches-<divisieId>.json` storage - NEVER use `schedule.status`
- Schedule is generated locally (round-robin) from pool teams; do not add external official schedule fetch/parsing.
- All file writes are serialized with in-process mutex
- No duplicate submissions for same match allowed
- Duplicate detection is inside the write transaction; blob writes use ETag conditions with bounded retry
- Historical enrichment preserves every original record field in repository data; provenance is in backend/history/provenance.json. Deployment replaces live blobs with repository data.

### Authentication
- Firebase ID tokens required for protected endpoints
- Header: `Authorization: Bearer <ID_TOKEN>`
- Optional revocation checking: `CHECK_REVOKED=true`
- Missing local Firebase client configuration allows public viewing/unsaved entry only; never bypass auth for saves

## Rate Limiting
- Pre-auth guard: 100 requests/min per IP
- GET /api/matches: 100 requests/min per IP
- POST /api/matches: 100 requests/min per user/IP
  - Per user+match: 100 submissions per 2 minutes
  - Per user daily cap: 100/day
  - Global per match: 100/min across all users

When a rate limit is exceeded, the server responds with HTTP 429 Too Many Requests.

**⚠️ If rate limits change in `backend/routes/matches.js`, update README.md and COPILOT.md together!**

## Environment Variables

### Backend Runtime
- `FIREBASE_PROJECT_ID` (required)
- `CHECK_REVOKED` (optional, default: false)
- `PORT` (optional, default: 5000)
- `AZURE_STORAGE_CONNECTION_STRING` (production, for blob storage)
- `STORAGE_CONTAINER_NAME` (optional, default: "data")
- `RESULTS_DATA_DIR` / `SCHEDULE_DATA_DIR` (optional local data overrides; ignored in blob mode)

### Frontend Build-time
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_API_BASE` (production only)
- `DEV_API_TARGET` (Vite server environment, optional proxy target, default http://localhost:5000)

## UI/UX Requirements

### Form Behavior
- Form title: "Uitslag invoeren"
- Users must select divisie and pool first
- Pool identifiers: `1001` (Topdivisie), `2001` (2e divisie), `2002` (2e divisie)
- Score inputs start empty
- All scheduled past/completed/unplayed rounds and fixtures remain selectable
- Show selected weighted result or explicit unplayed/loading/error status below Wedstrijd beside exact "Details"
- Dedicated Details screen locks fixture identity; complete results are editable for 14 days after the scheduled date. If still incomplete at that cutoff, the first complete submission starts a fresh 14-day edit window. Expired results are read-only; legacy totals never invent games.
- Two independent raw inputs per game; no auto-complement, clamping or truncation
- Show left-aligned, single-line cumulative weighted subtotals beside each group's navigation/save controls: tete; tete+doublette; final "Totaal" for all three groups. Do not append a provisional label; omit per-win explanatory labels.
- Below each game block, Terug opens an unsaved-results dialog with save-and-close, discard-and-close, and continue-editing actions. Opslaan saves all games and stays on the details screen; completed results remain editable through their applicable deadline, and expired read-only sheets have only Terug.
- Disable submit until signed in and all 11 pairs valid; guard dirty back/close and in-flight navigation
- Preserve selection after save, refresh results/standings, and retain input on save failure
- Keep upcoming-only filtering separate in Komende wedstrijden

### Results Display
- Single-line rows only

### Development Proxy
- Vite proxies `/api` requests to `http://localhost:5000`

## Testing and Validation

### Manual Testing Checklist
1. Start applications: `npm run dev`
2. Verify health endpoint: `curl http://localhost:5000/api/health`
3. Test teams endpoint: `curl http://localhost:5000/api/teams`
4. Test schedule endpoint: `curl http://localhost:5000/api/matches/schedule`
5. Frontend loads at: http://localhost:5173
6. Test Firebase authentication flow
7. Submit valid score (e.g., 13-18)
8. Reject invalid raw pairs (13-13, 12-11, decimals); accept 13-1 and 3-13

Run `npm --prefix backend test` and `npm --prefix frontend test` for scoring/API/persistence/history and UI checks; use isolated local files and mocked auth/blob operations, never live mutation tests.

### Build Validation
```bash
# Frontend build test (Timeout: 180 seconds)
cd frontend && npm run build
# Should complete in ~3 seconds

# Frontend preview test (Timeout: 60 seconds)
cd frontend && npm run preview
# Access http://localhost:4173
```

## Development Guidelines

### Making Changes
- **Minimal diffs only** - don't reformat unrelated code
- Preserve public APIs and UI unless explicitly requested
- Mirror client-side validation on server for all user input
- Never commit secrets - use environment variables
- Update documentation when behavior changes
- **README sync**: After updating any README file (`README.md`, `backend/README.md`, `frontend/README.md`), review this file and update any sections that reflect the same information. Conversely, when updating this file, propagate relevant changes to the appropriate README files.

### File Structure Rules
- Storage abstraction in `backend/storage/`
- JSON storage files in `backend/data/` (development) or Azure Blob Storage (production)
- Express routes in `backend/routes/`
- React components in `frontend/src/`

### Deployment
- Backend deploys to Azure App Service
- Frontend deploys to Azure Static Web Apps
- GitHub Actions workflow: `.github/workflows/azure-deploy.yml`
- Deployment triggered on push to `main` branch
- Workflow uploads every `backend/data/*.json` file to container `data` with `--overwrite true`, including results, teams and schedules. Live results and edits not present in the repository are replaced on deployment.

## Common Tasks and Commands

### Debugging Connection Issues
```bash
# Check if backend is running
ps aux | grep node
curl http://localhost:5000/api/health

# Check frontend proxy
# Vite automatically proxies /api to localhost:5000
```

### Working with Data
```bash
# Check storage files
ls -la backend/data/
cat backend/data/matches.json | head -20
cat backend/data/teams-1001.json | head -20
```

### Environment Setup
```bash
# Set required backend environment
export FIREBASE_PROJECT_ID="your-project-id"

# Optional backend settings
export CHECK_REVOKED="true"
export PORT="5000"
```

## Safety and Quality Checks

### Before Committing
1. Start both applications: `npm run dev` (NEVER CANCEL)
2. Verify API endpoints respond correctly
3. Test raw game validation and derived 3-28/28-3 totals
4. Test authentication flow if modified
5. Update README.md if behavior changed

### Performance Notes
- Frontend build warnings about chunk size (>500KB) are expected
- Backend startup time: ~2-3 seconds
- Frontend development server startup: ~5-10 seconds
- Installation time: ~25 seconds for all dependencies

## Troubleshooting

### Common Issues
1. **Port conflicts**: Frontend will auto-select next available port
2. **Firebase auth**: Verify authorized domains include localhost:5173
3. **CORS issues**: Ensure VITE_API_BASE is set correctly in production
4. **Rate limiting**: Check backend logs for rate limit rejections

### Emergency Commands
```bash
# Kill stuck processes
pkill -f "node index.js"    # Backend
pkill -f "vite"             # Frontend

# Reset dependencies
rm -rf node_modules package-lock.json
npm run install:all
```

## Important Reminders

### Timeouts for Long-Running Commands
- `npm run install:all`: 300 seconds minimum
- `npm run dev`: 120 seconds minimum  
- `npm run build`: 180 seconds minimum
- **NEVER CANCEL** these commands before completion

### Critical Validations
- Raw 1 and 3 are valid; finished games require exactly one 13 and another integer 0-12
- All 11 games derive weighted totals summing to 31, including valid 3-28/28-3
- All user input must be validated on both client and server
- File writes are atomic and serialized

### Documentation Updates
When changing:
- Rate limits → Update README.md + this file
- API endpoints → Update README.md + this file
- Environment variables → Update README.md + this file
- UI behavior → Update README.md + this file
- Auth flow → Update README.md + this file
- Storage/data model → Update README.md + this file
- Deployment steps → Update README.md + this file

**⚠️ Any time a README is edited, scan this file for stale sections and keep them in sync. Any time this file is edited, propagate the relevant changes back to the appropriate README files.**
