import { validateDetailedScore } from './domain/scoring.js';
import { createMatch, POOLS } from './storage/fileStore.js';
import { getScheduledMatch } from './storage/schedule.js';

export async function submitMatchResult(input, user, storage = { createMatch, getScheduledMatch }) {
  const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
  if (typeof input?.matchId !== 'string' || !input.matchId) fail('matchId is required');
  if (typeof input.divisieId !== 'string' || !Object.values(POOLS).includes(input.divisieId)) fail('Invalid divisieId');
  let score;
  try {
    score = validateDetailedScore(input);
  } catch (error) {
    fail(error.message);
  }
  const scheduled = await storage.getScheduledMatch(input.matchId, { divisieId: input.divisieId });
  if (!scheduled || String(scheduled.divisieId) !== input.divisieId) fail('Unknown match in selected pool');
  return storage.createMatch({
    ...score,
    date: scheduled.date,
    fixtureId: input.matchId,
    matchId: input.matchId,
    matchNumber: scheduled.matchNumber || input.matchId,
    homeTeamId: scheduled.homeTeamId,
    awayTeamId: scheduled.awayTeamId,
    divisieId: scheduled.divisieId,
    divisie: scheduled.divisie,
    submittedBy: user.name || user.email || user.uid,
    submittedByUid: user.uid,
  });
}
