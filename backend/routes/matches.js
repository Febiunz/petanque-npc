import express from 'express';
import { listMatches, createMatch, deleteMatch, computeStandings } from '../storage/fileStore.js';
import { getScheduledMatch } from '../storage/schedule.js';
import { requireAuth } from '../middleware/requireAuth.js';
import rateLimit from 'express-rate-limit';

// Use per-user limiting when authenticated, else fall back to IP
const perUserKey = (req) => req.user?.uid || req.ip;

// Rate limit: max 5 POSTs per minute per user/IP to avoid abuse
const matchPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKey,
  message: 'Too many submissions, please try again later.'
});

// Rate limit: max 100 GETs per minute per IP to avoid abuse of listing endpoint
const matchGetLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

const router = express.Router();

router.get('/', matchGetLimiter, async (req, res) => {
  const matches = await listMatches();
  res.json(matches);
});

router.post('/', requireAuth, matchPostLimiter, async (req, res) => {
  // Debug: trace incoming body for troubleshooting
  // Do not log tokens; headers are ignored.
  // Log only non-sensitive fields for debugging
  const { matchId: matchIdRaw, fixtureId: legacyFixtureId, homeScore, awayScore, date } = req.body || {};
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log('POST /api/matches body:', JSON.stringify({ matchId: matchIdRaw, fixtureId: legacyFixtureId, homeScore, awayScore, date }));
    }
  } catch {}
  const matchId = matchIdRaw || legacyFixtureId; // backward compatibility
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });
  const scheduled = await getScheduledMatch(matchId);
  if (!scheduled) return res.status(400).json({ error: 'Unknown match' });
  // prevent duplicate submission (check both fields for older records)
  const existing = (await listMatches()).find(m => m.fixtureId === matchId || m.matchId === matchId);
  if (existing) return res.status(409).json({ error: 'Result already submitted for this match' });

  const payload = {
    date: date || new Date().toISOString(),
    fixtureId: matchId, // keep for backward compat in stored data
    matchId,
    matchNumber: scheduled.matchNumber || null,
    homeTeamId: scheduled.homeTeamId,
    awayTeamId: scheduled.awayTeamId,
    homeScore: Number(homeScore ?? 0),
    awayScore: Number(awayScore ?? 0),
    submittedBy: req.user?.name || req.user?.email || req.user?.uid || 'unknown',
    submittedByUid: req.user?.uid || null,
  };
  const match = await createMatch(payload);
  res.status(201).json(match);
});

export default router;

// Delete a single submitted match by id
// Stricter limit for deletions: max 3 per minute per user/IP
const matchDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKey,
  message: 'Too many deletions, please try again later.'
});

router.delete('/:id', requireAuth, matchDeleteLimiter, async (req, res) => {
  const { id } = req.params;
  const ok = await deleteMatch(id);
  if (!ok) return res.status(404).json({ error: 'Match not found' });
  res.json({ ok: true });
});
