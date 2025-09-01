# GitHub Copilot Instructions for petanque-npc Repository

## Overview
This repository contains a petanque match management system with a React frontend and Node.js backend. It allows users to submit and track match results for the Topdivisie petanque league.

## Technology Stack
- **Frontend**: React 18 + Vite + Material UI (MUI)
- **Backend**: Node.js (ESM) + Express + Firebase Authentication
- **Storage**: JSON files (file-based storage)
- **Deployment**: Azure App Service (backend) + Azure Static Web Apps (frontend)
- **CI/CD**: GitHub Actions

## Architecture
```
frontend/          # React 18 + Vite + MUI
├── src/
├── package.json
└── vite.config.js

backend/           # Node.js ESM + Express
├── data/          # JSON storage files
├── routes/        # Express routes
├── index.js       # Main server file
└── package.json

scripts/           # Helper scripts
package.json       # Root convenience scripts
.github/
└── workflows/
    └── azure-deploy.yml
```

## Critical Commands and Timing

### ⚠️ NEVER CANCEL THESE COMMANDS - They require full execution time ⚠️

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

## API Endpoints and Validation

### Public Endpoints
- `GET /api/health` - Service status check
- `GET /api/teams` - Fixed Topdivisie teams list
- `GET /api/matches/schedule` - Full schedule (filter: `?round=NUMBER`)
- `GET /api/matches` - Submitted matches (most recent first)
- `GET /api/standings` - Current standings

### Protected Endpoints (Require Firebase Auth)
- `POST /api/matches` - Submit result
  - Body: `{ matchId, homeScore, awayScore }`
  - Scores: integers [0, 31], must sum to 31
  - **FORBIDDEN**: scores of 1 or 3 for either team
- `DELETE /api/matches/:id` - Delete submitted result

## Key Business Rules

### Score Validation
- Valid scores: 0, 2, 4-31 (integers only)
- Total must equal 31 (homeScore + awayScore = 31)
- Values 1 and 3 are FORBIDDEN for either team
- Example valid scores: (13, 18), (0, 31), (15, 16)
- Example invalid scores: (1, 30), (14, 3), (10, 20)

### Data Integrity
- Match completion derived from `matches.json` - NEVER use `schedule.status`
- All file writes are serialized with in-process mutex
- Deleting results triggers automatic standings refresh
- No duplicate submissions for same match allowed

### Authentication
- Firebase ID tokens required for protected endpoints
- Header: `Authorization: Bearer <ID_TOKEN>`
- Optional revocation checking: `CHECK_REVOKED=true`

## Rate Limiting
- Pre-auth guard: 100 requests/min per IP
- GET /api/matches: 100 requests/min per IP
- POST /api/matches: 100 requests/min per user/IP
  - Per user+match: 100 submissions per 2 minutes
  - Per user daily cap: 100/day
  - Global per match: 100/min across all users
- DELETE /api/matches: 100 deletions/min per user/IP

**⚠️ If rate limits change in `backend/routes/matches.js`, update README.md and COPILOT.md together!**

## Environment Variables

### Backend Runtime
- `FIREBASE_PROJECT_ID` (required)
- `CHECK_REVOKED` (optional, default: false)
- `PORT` (optional, default: 5000)

### Frontend Build-time
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_API_BASE` (production only)

## UI/UX Requirements

### Form Behavior
- Form title: "Uitslag invoeren Topdivisie"
- Score inputs start empty
- Auto-complement second score to reach 31
- Block scores of 1 and 3
- Disable submit until valid scores entered

### Results Display
- Single-line rows only
- Tiny delete icon in last column (logged-in users only)
- Confirmation dialog before deletion
- Refresh standings after deletion

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
8. Attempt invalid score (e.g., 1-30) - should be rejected
9. Delete result (requires confirmation)
10. Verify standings update

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

### File Structure Rules
- Keep schedule scraping logic in backend (no fixtures layer)
- JSON storage files in `backend/data/`
- Express routes in `backend/routes/`
- React components in `frontend/src/`

### Deployment
- Backend deploys to Azure App Service
- Frontend deploys to Azure Static Web Apps
- GitHub Actions workflow: `.github/workflows/azure-deploy.yml`
- Deployment triggered on push to `main` branch

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
cat backend/data/teams.json | head -20
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
3. Test score validation (reject 1 and 3)
4. Test authentication flow if modified
5. Update README.md if behavior changed
6. Update COPILOT.md if rate limits changed

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
- Scores 1 and 3 are FORBIDDEN
- Total scores must equal 31
- All user input must be validated on both client and server
- File writes are atomic and serialized

### Documentation Updates
When changing:
- Rate limits → Update README.md + COPILOT.md
- API endpoints → Update this file + COPILOT.md
- Environment variables → Update README.md + this file
- UI behavior → Update this file