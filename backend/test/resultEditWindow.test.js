import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_SLOTS, SCORE_FORMAT } from '../domain/scoring.js';
import { RESULT_EDIT_WINDOW_MS, canEditResult, getResultEditDeadline } from '../domain/resultEditWindow.js';

const completedResult = (overrides = {}) => ({
  scoreFormat: SCORE_FORMAT,
  games: GAME_SLOTS.map(({ slotId }) => ({ slotId, homeScore: 13, awayScore: 0 })),
  ...overrides,
});

test('complete results use the original play date for the first 14-day window', () => {
  const fixtureDate = '2026-09-19';
  const deadline = Date.parse(fixtureDate) + RESULT_EDIT_WINDOW_MS;
  assert.equal(getResultEditDeadline(fixtureDate, completedResult()), deadline);
  assert.equal(canEditResult(fixtureDate, completedResult(), deadline - 1), true);
  assert.equal(canEditResult(fixtureDate, completedResult(), deadline), false);
});

test('a late complete result starts a fresh 14-day window from its first submission', () => {
  const fixtureDate = '2026-09-19';
  const submittedAt = '2026-10-10T12:00:00.000Z';
  const result = completedResult({ submittedAt });
  const deadline = Date.parse(submittedAt) + RESULT_EDIT_WINDOW_MS;
  assert.equal(getResultEditDeadline(fixtureDate, result), deadline);
  assert.equal(canEditResult(fixtureDate, result, deadline - 1), true);
  assert.equal(canEditResult(fixtureDate, result, deadline), false);
});

test('unreported and incomplete results remain editable after the scheduled window', () => {
  const now = Date.parse('2026-11-11T12:00:00.000Z');
  assert.equal(canEditResult('2026-09-19', null, now), true);
  assert.equal(canEditResult('2026-09-19', { homeScore: 8, awayScore: 23 }, now), true);
  assert.equal(canEditResult('2026-09-19', { scoreFormat: SCORE_FORMAT, games: [] }, now), true);
});

test('a complete result with no valid original date is locked conservatively', () => {
  assert.equal(canEditResult(null, completedResult(), Date.now()), false);
});
