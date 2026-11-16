import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_SLOTS, SCORE_FORMAT } from '../domain/scoring.js';
import { submitMatchResult } from '../matchResult.js';

test('preserves an unset scheduled date when creating a result', async () => {
  let created;
  const input = {
    matchId: '100117',
    divisieId: '1001',
    scoreFormat: SCORE_FORMAT,
    games: GAME_SLOTS.map(({ slotId }, index) => ({
      slotId,
      homeScore: index === 6 ? 13 : 3,
      awayScore: index === 6 ? 1 : 13,
    })),
  };
  await submitMatchResult(input, { uid: 'user' }, {
    getScheduledMatch: async () => ({ id: input.matchId, divisieId: input.divisieId, date: null }),
    createMatch: async (match) => { created = match; return match; },
  });
  assert.equal(created.date, null);
});
