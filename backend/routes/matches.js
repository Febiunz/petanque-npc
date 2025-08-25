import express from 'express';
import { listMatches, createMatch } from '../storage/fileStore.js';
import { getScheduledMatch, markScheduledMatchCompleted } from '../storage/schedule.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const matches = await listMatches();
  res.json(matches);
});

router.post('/', requireAuth, async (req, res) => {
  // Debug: trace incoming body for troubleshooting
  // Do not log tokens; headers are ignored.
  if (process.env.NODE_ENV !== 'production') {
    try { console.log('POST /api/matches body:', JSON.stringify(req.body)); } catch {}
  }
  const { matchId: matchIdRaw, fixtureId: legacyFixtureId, homeScore, awayScore, date } = req.body || {};
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
