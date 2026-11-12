# NPC Standen Frontend

This folder contains the React frontend for the Petanque results and standings website.

## Detailed match scoring

All scheduled rounds and fixtures, past/completed or unplayed, remain in Speelronde/Wedstrijd.
Below Wedstrijd, the weighted result (or "Nog geen uitslag") sits beside the exact "Details" button.
Details is a dedicated screen with locked fixture identity and 11 grouped games (6 tete-a-tete, 3 doublette, 2 triplette). Beside each group's navigation/save controls, it shows the left-aligned, single-line cumulative weighted subtotal (tete; tete plus doublette; final "Totaal" including all three groups), without a provisional label. Per-win explanatory labels are omitted. The top "Terug naar wedstrijdselectie" link is not shown; use the group-level Terug buttons.
Signed-in users can save and revise game results at any time. Partial sheets are provisional and do not affect standings until all 11 games are complete. Legacy aggregate-only results explain that game scores are unavailable and can be completed.

New-entry inputs are independently editable and initially blank. Each game requires exactly one 13 and an opposing integer 0-12; raw 1/3 are valid and weighted totals are server-derived (including 3-28/28-3).
The screen shows per-game awards, completion count, overall weighted match points and a separately labeled raw-score sum.
Each game block ends with "Terug" and "Opslaan" (save all 11 slots, including blank unplayed slots, and remain on the details screen). If there are unsaved results, Terug opens a dialog with "Opslaan en sluiten", "Verwijderen en sluiten", and "Verder met invoeren". Saving keeps the details open.
Google sign-in is required to save; blank scores are allowed, but a partially entered or invalid pair must be completed or cleared. Dirty back navigation asks before discard; supported browsers warn on tab close/reload. Failed saves retain input; successful saves preserve selector context and refresh standings/results.

Without `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` and `VITE_FIREBASE_PROJECT_ID`, public viewing and unsaved input work, but authentication/saving are disabled rather than bypassed.
For an isolated local API, set `DEV_API_TARGET` when starting Vite (default `http://localhost:5000`); use `RESULTS_DATA_DIR`/`SCHEDULE_DATA_DIR` on the backend and unset Azure storage. See the root README for environment variables.

Run `npm test` for the focused Vitest/Testing Library UI tests and `npm run build` for the production build.

## Documentation policy

- When frontend behavior, UX flow, setup, or build/run instructions change, update:
  - `frontend/README.md`
  - `README.md`
