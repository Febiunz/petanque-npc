import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_SLOTS, SCORE_FORMAT, isFinishedGame, validateDetailedScore, summarizeGames, resultSummary } from '../domain/scoring.js';
import { saveResult } from '../storage/resultTransaction.js';

const sheet = (mask = 0) => ({
  scoreFormat: SCORE_FORMAT,
  games: GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: mask & (1 << index) ? 13 : 0, awayScore: mask & (1 << index) ? 0 : 13 })),
});

test('all 2048 winner assignments distribute 31; 3-28 and 28-3 are valid', () => {
  const totals = new Set();
  for (let mask = 0; mask < 2048; mask++) {
    const score = validateDetailedScore(sheet(mask));
    assert.equal(score.homeScore + score.awayScore, 31);
    totals.add(score.homeScore);
  }
  assert.deepEqual([...totals].sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i).filter((i) => i !== 1 && i !== 30));
  assert.equal(validateDetailedScore(sheet(1 << 6)).homeScore, 3);
  assert.equal(validateDetailedScore(sheet(2047 ^ (1 << 6))).homeScore, 28);
});

test('raw inputs require exactly one integer 13 and another integer 0 through 12', () => {
  for (const [homeScore, awayScore] of [[13, 0], [0, 13], [13, 12], [12, 13], [13, 1], [3, 13]]) {
    assert.equal(isFinishedGame({ homeScore, awayScore }), true);
  }
  for (const bad of [null, false, '', '13', -1, 14, 12.5, NaN, undefined]) {
    assert.equal(isFinishedGame({ homeScore: bad, awayScore: 13 }), false);
    assert.equal(isFinishedGame({ homeScore: 13, awayScore: bad }), false);
  }
  assert.equal(isFinishedGame({ homeScore: 13, awayScore: 13 }), false);
  assert.equal(isFinishedGame({ homeScore: 12, awayScore: 11 }), false);
});

test('complete canonical slots, schema and derived totals are mandatory', () => {
  const score = sheet(1);
  assert.throws(() => validateDetailedScore({ ...score, scoreFormat: 'other' }));
  assert.throws(() => validateDetailedScore({ ...score, games: score.games.slice(1) }));
  assert.throws(() => validateDetailedScore({ ...score, games: [...score.games, score.games[0]] }));
  for (const replacement of [
    { ...score.games[0], slotId: 'unknown' },
    { ...score.games[0], slotId: score.games[1].slotId },
    { ...score.games[0], weight: 5 },
    { ...score.games[0], homeScore: '13' },
  ]) assert.throws(() => validateDetailedScore({ ...score, games: [replacement, ...score.games.slice(1)] }));
  assert.throws(() => validateDetailedScore({ ...score, homeScore: 31, awayScore: 0 }));
  assert.throws(() => validateDetailedScore({ ...score, homeScore: '2' }));
  const reversed = validateDetailedScore({ ...score, games: [...score.games].reverse() });
  assert.deepEqual(reversed.games, score.games);
});

test('partial sheets save blank slots and derive provisional totals', () => {
  const score = sheet();
  score.games[1].homeScore = null;
  score.games[1].awayScore = null;
  score.games[2].homeScore = null;
  score.games[2].awayScore = null;
  const partial = validateDetailedScore(score);
  assert.equal(partial.homeScore + partial.awayScore, 27);
  assert.deepEqual(partial.games.slice(1, 3), score.games.slice(1, 3));
  assert.match(resultSummary(partial).label, /voorlopig/);
  const halfEntered = [...score.games];
  halfEntered[1] = { ...halfEntered[1], homeScore: 13 };
  assert.throws(() => validateDetailedScore({ ...score, games: halfEntered }));
  assert.equal(validateDetailedScore({
    ...sheet(),
    games: GAME_SLOTS.map(({ slotId }) => ({ slotId, homeScore: null, awayScore: null })),
  }).homeScore, 0);
});

test('unknown, legacy and inconsistent results are distinct; raw totals are secondary', () => {
  assert.equal(resultSummary(null).label, 'Nog geen uitslag');
  assert.equal(resultSummary({ homeScore: 12, awayScore: 19 }).legacy, true);
  assert.ok(resultSummary({ ...sheet(), homeScore: 31, awayScore: 0 }).error);
  const totals = summarizeGames(sheet(1).games);
  assert.equal(totals.homeScore, 2);
  assert.equal(totals.rawHomeScore, 13);
  assert.equal(summarizeGames([]).completed, 0);
});

function mockBlob(initial = []) {
  let data = initial;
  let version = 0;
  return {
    read: async () => ({ data: structuredClone(data), etag: String(version) }),
    write: async (next, etag) => {
      if (etag !== String(version)) throw Object.assign(new Error('Changed'), { statusCode: 412 });
      data = structuredClone(next);
      version++;
    },
    get: () => data,
  };
}

test('conditional blob retries retain concurrent different fixtures and edit same-fixture results', async () => {
  const blob = mockBlob();
  const fixtureDate = '2026-09-19';
  const now = '2026-10-01T12:00:00.000Z';
  const first = { matchId: '1', date: fixtureDate, createdAt: now, submittedAt: now, ...validateDetailedScore(sheet(64)) };
  const second = { matchId: '2', date: fixtureDate, createdAt: now, submittedAt: now, ...validateDetailedScore(sheet(1983)) };
  await Promise.all([
    saveResult(blob.read, blob.write, first, now),
    saveResult(blob.read, blob.write, second, now),
  ]);
  assert.deepEqual(blob.get().map((row) => row.matchId), ['1', '2']);

  const update = { ...first, ...validateDetailedScore(sheet(128)) };
  const saved = await saveResult(blob.read, blob.write, update, now);
  assert.equal(saved.created, false);
  assert.deepEqual(saved.match.games, update.games);
  assert.equal(blob.get().length, 2);
});

test('results can be revised indefinitely while preserving creation metadata', async () => {
  const blob = mockBlob();
  const fixtureDate = '2026-09-19';
  const now = '2026-11-11T12:00:00.000Z';
  const legacy = { id: 'legacy-id', fixtureId: '1', matchId: '1', date: fixtureDate, createdAt: '2026-10-01T12:00:00.000Z', homeScore: 8, awayScore: 23 };
  legacy.playerLineup = { source: 'official.xlsx', games: { 'tete-1': { home: ['Home player'], away: ['Away player'] } }, substitutions: [] };
  const late = mockBlob([legacy]);
  const match = { matchId: '1', fixtureId: '1', date: fixtureDate, createdAt: now, submittedAt: now, ...validateDetailedScore(sheet(64)) };
  const saved = await saveResult(late.read, late.write, match, now);
  assert.equal(saved.created, false);
  assert.equal(saved.match.id, 'legacy-id');
  assert.equal(saved.match.createdAt, legacy.createdAt);
  assert.equal(saved.match.submittedAt, now);
  assert.equal(saved.match.updatedAt, now);
  assert.deepEqual(saved.match.playerLineup, legacy.playerLineup);

  const expiredResult = { ...saved.match, submittedAt: '2026-10-10T12:00:00.000Z' };
  const expired = mockBlob([expiredResult]);
  const replacement = { ...match, ...validateDetailedScore(sheet(1983)) };
  const revised = await saveResult(expired.read, expired.write, replacement, now);
  assert.equal(revised.created, false);
  assert.deepEqual(revised.match.games, replacement.games);
  assert.equal(revised.match.submittedAt, expiredResult.submittedAt);
  assert.deepEqual(revised.match.playerLineup, legacy.playerLineup);
  assert.deepEqual(expired.get(), [revised.match]);
});

test('blob failures never masquerade as successful saves', async () => {
  const read = async () => ({ data: [], etag: '0' });
  const now = '2026-10-01T12:00:00.000Z';
  const match = { matchId: '1', submittedAt: now, ...validateDetailedScore(sheet()) };
  await assert.rejects(saveResult(read, async () => { throw new Error('Storage unavailable'); }, match, now), /Storage unavailable/);
  await assert.rejects(saveResult(read, async () => { throw Object.assign(new Error('Changed'), { statusCode: 412 }); }, match, now), { status: 503 });
});
