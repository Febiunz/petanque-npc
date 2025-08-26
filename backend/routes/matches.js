import express from 'express';
import { listMatches, createMatch } from '../storage/fileStore.js';
import { getScheduledMatch, markScheduledMatchCompleted } from '../storage/schedule.js';
import { requireAuth } from '../middleware/requireAuth.js';
import rateLimit from 'express-rate-limit';

// Rate limit: max 5 POSTs per minute per IP to avoid abuse
const matchPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
 max: 5,
 message: { error: 'Too many submissions, please try again later.' }
});

const router = express.Router();

router.get('/', async (req, res) => {
  const matches = await listMatches();
  res.json(matches);
});

router.post('/', matchPostLimiter, requireAuth, async (req, res) => {
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
    status: 'completed',
    submittedBy: req.user?.name || req.user?.email || req.user?.uid || 'unknown',
    submittedByUid: req.user?.uid || null,
  };
  const match = await createMatch(payload);
  await markScheduledMatchCompleted(matchId);
  res.status(201).json(match);
});

export default router;
