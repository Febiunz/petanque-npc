import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageHealth } from './storage/fileStore.js';
import teamsRouter from './routes/teams.js';
import matchesRouter from './routes/matches.js';
import standingsRouter from './routes/standings.js';
import scheduleRouter from './routes/schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load backend .env first (optional)
dotenv.config();
// Always also load shared frontend .env.local so backend can use VITE_* and CHECK_REVOKED
dotenv.config({ path: resolve(__dirname, '../frontend/.env.local') });

const app = express();
// Disable etag to prevent 304 on tiny JSON responses during dev
app.set('etag', false);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get('/health', async (req, res) => {
  const storage = await storageHealth();
  res.json({ ok: true, storage });
});

// Alias under /api to work with dev proxy reliably
app.get('/api/health', async (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  const storage = await storageHealth();
  res.json({ ok: true, storage });
});

// Apply no-store headers for all /api responses (dev convenience)
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  next();
});

app.use('/api/teams', teamsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/standings', standingsRouter);
// New: match schedule endpoint; keep old alias for backward compatibility
app.use('/api/matches/schedule', scheduleRouter);
app.use('/api/fixtures', scheduleRouter);

async function start() {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
