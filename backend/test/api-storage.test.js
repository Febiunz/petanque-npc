import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GAME_SLOTS, SCORE_FORMAT } from '../domain/scoring.js';

let dir;
let server;
let base;
let store;
let admin;
const valid = (matchId, homeWinsDoublette = true) => ({
  matchId,
  divisieId: '1001',
  scoreFormat: SCORE_FORMAT,
  games: GAME_SLOTS.map(({ slotId }, index) => {
    const homeWins = homeWinsDoublette ? index === 6 : index !== 6;
    return { slotId, homeScore: homeWins ? 13 : 3, awayScore: homeWins ? 1 : 13 };
  }),
});
const post = (payload, token = 'valid-test-token') => fetch(`${base}/api/matches`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(payload),
});

before(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'npc-score-test-'));
  process.env.AZURE_STORAGE_CONNECTION_STRING = '';
  process.env.RESULTS_DATA_DIR = dir;
  process.env.SCHEDULE_DATA_DIR = dir;
  process.env.FIREBASE_PROJECT_ID = 'test-scoring-project';
  for (const pool of ['1001', '2001', '2002']) {
    for (const kind of ['teams', 'schedule']) {
      await fs.copyFile(new URL(`../data/${kind}-${pool}.json`, import.meta.url), join(dir, `${kind}-${pool}.json`));
    }
    await fs.writeFile(join(dir, `matches-${pool}.json`), '[]');
  }
  admin = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  mock.method(getAuth(), 'verifyIdToken', async (token) => {
    if (token !== 'valid-test-token') throw new Error('Invalid synthetic test token');
    return { uid: 'ordinary-test-user', name: 'Test user' };
  });
  store = await import('../storage/fileStore.js');
  const { default: matchesRouter } = await import('../routes/matches.js');
  const app = express();
  app.use(express.json());
  app.use('/api/matches', matchesRouter);
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (admin) await deleteApp(admin);
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test('HTTP authentication remains required for ordinary users', async () => {
  assert.equal((await post(valid('100117'), null)).status, 401);
  assert.equal((await post(valid('100117'), 'expired-test-token')).status, 401);
});

test('HTTP rejects aggregate-only input, incomplete/malformed games and wrong pools', async () => {
  const body = valid('100117');
  for (const invalid of [
    { matchId: body.matchId, divisieId: '1001', homeScore: 3, awayScore: 28 },
    { ...body, games: body.games.slice(0, 10) },
    { ...body, games: [{ ...body.games[0], homeScore: '13' }, ...body.games.slice(1)] },
    { ...body, homeScore: 31, awayScore: 0 },
    { ...body, divisieId: '9999' },
    { ...body, divisieId: '2001' },
    { ...body, divisieId: undefined },
    { ...body, matchId: 'unknown' },
  ]) {
    const response = await post(invalid);
    assert.equal(response.status, 400, await response.text());
  }
});

test('HTTP persists and returns server-derived 3-28/28-3 with locked fixture identity', async () => {
  for (const [id, expected, homeWins] of [['100117', [3, 28], true], ['100118', [28, 3], false]]) {
    const response = await post({ ...valid(id, homeWins), homeTeamId: 'spoofed', date: '2099-01-01' });
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.deepEqual([saved.homeScore, saved.awayScore], expected);
    assert.equal(saved.fixtureId, id);
    assert.equal(saved.matchId, id);
    assert.equal(saved.matchNumber, id);
    assert.notEqual(saved.homeTeamId, 'spoofed');
    assert.notEqual(saved.date, '2099-01-01');
    assert.equal(saved.submittedByUid, 'ordinary-test-user');
    assert.deepEqual(saved.games, valid(id, homeWins).games);
    const list = await (await fetch(`${base}/api/matches?divisieId=1001`)).json();
    assert.deepEqual(list.find((row) => row.matchId === id).games, saved.games);
  }
});

test('local write serialization retains different fixtures and updates the same fixture once', async () => {
  const responses = await Promise.all([post(valid('100119')), post(valid('100120')), post(valid('100121')), post(valid('100121'))]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201, 201, 201]);
  const records = JSON.parse(await fs.readFile(join(dir, 'matches-1001.json'), 'utf8'));
  assert.equal(records.length, 5);
  for (const id of ['100119', '100120', '100121']) assert.equal(records.filter((row) => row.matchId === id).length, 1);
});

test('late submissions can be revised for 14 days, then the server rejects further edits', async () => {
  const first = await post(valid('100101'));
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.equal(typeof created.submittedAt, 'string');

  const edited = await post(valid('100101', false));
  assert.equal(edited.status, 200);
  const updated = await edited.json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.submittedAt, created.submittedAt);
  assert.deepEqual(updated.games, valid('100101', false).games);
  assert.equal(updated.updatedByUid, 'ordinary-test-user');

  const file = join(dir, 'matches-1001.json');
  const rows = JSON.parse(await fs.readFile(file, 'utf8'));
  const index = rows.findIndex((row) => row.matchId === '100101');
  rows[index].submittedAt = '2026-10-10T12:00:00.000Z';
  await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
  const before = JSON.parse(await fs.readFile(file, 'utf8'));
  const locked = await post(valid('100101'));
  assert.equal(locked.status, 409);
  assert.match((await locked.json()).error, /niet meer worden aangepast/);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), before);
});

test('weighted standings retain 2 league points per win, not raw-score or per-game awards', async () => {
  const standings = await store.computeStandings({ divisieId: '1001' });
  const teams = await store.listTeams({ divisieId: '1001' });
  const records = await store.listMatches({ divisieId: '1001' });
  for (const team of teams) {
    const matches = records.filter((row) => row.homeTeamId === team.id || row.awayTeamId === team.id);
    if (!matches.length) continue;
    const points = matches.reduce((sum, row) => sum + ((row.homeTeamId === team.id ? row.homeScore > row.awayScore : row.awayScore > row.homeScore) ? 2 : 0), 0);
    const saldo = matches.reduce((sum, row) => sum + (row.homeTeamId === team.id ? row.homeScore - row.awayScore : row.awayScore - row.homeScore), 0);
    const actual = standings.find((row) => row.teamId === team.id);
    assert.equal(actual.points, points);
    assert.equal(actual.goalDiff, saldo);
  }
});

test('failed local writes return errors, retain prior records and release the mutex', async () => {
  const previous = await fs.readFile(join(dir, 'matches-1001.json'), 'utf8');
  const rename = mock.method(fs, 'rename', async () => { throw new Error('Simulated disk failure'); });
  const failed = await post(valid('100122'));
  assert.equal(failed.status, 500);
  assert.equal(await fs.readFile(join(dir, 'matches-1001.json'), 'utf8'), previous);
  rename.mock.restore();
  assert.equal((await post(valid('100122'))).status, 201);
  assert.equal((await post(valid('100122'))).status, 200);
});
