import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDetailedScore, summarizeGames } from '../domain/scoring.js';
import { enrichResults, metadataHash } from '../../scripts/enrich-historical-results.mjs';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('all 46 historical records and 506 games retain metadata and independently verified totals', async () => {
  const provenance = await json('../history/provenance.json');
  let count = 0;
  let games = 0;
  for (const [pool, expected] of [['1001', 14], ['2001', 16], ['2002', 16]]) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const sources = provenance.pools[pool].matches;
    assert.equal(records.length, expected);
    assert.equal(sources.length, expected);
    assert.equal(new Set(records.map((record) => record.matchId || record.fixtureId)).size, expected);
    for (const record of records) {
      const score = validateDetailedScore(record);
      const source = sources.find((row) => row.matchId === record.matchId);
      const fixture = fixtures.find((row) => row.id === record.matchId);
      assert.equal(fixture.homeTeamId, record.homeTeamId);
      assert.equal(fixture.awayTeamId, record.awayTeamId);
      assert.equal(metadataHash(record), source.metadataSha256);
      assert.equal(createHash('sha256').update(JSON.stringify(score.games)).digest('hex'), source.gamesSha256);
      const totals = summarizeGames(score.games);
      assert.deepEqual([totals.rawHomeScore, totals.rawAwayScore], source.rawTotals);
      assert.equal(record.date, source.preservedResultDate);
      count++;
      games += score.games.length;
    }
  }
  assert.equal(count, 46);
  assert.equal(games, 506);
  const second = await json('../data/matches-2001.json');
  assert.equal(second.find((row) => row.matchId === '200111').date, '2026-10-10T12:00:00.000Z');
  const top = await json('../data/matches-1001.json');
  for (const [id, home, away] of [['100101', 8, 23], ['100105', 29, 2], ['100109', 12, 19], ['100116', 24, 7]]) {
    const score = validateDetailedScore(top.find((row) => row.matchId === id));
    assert.deepEqual([score.homeScore, score.awayScore], [home, away]);
  }
  const paradox = summarizeGames(top.find((row) => row.matchId === '100109').games);
  assert.deepEqual([paradox.rawHomeScore, paradox.rawAwayScore], [104, 101]);
  assert.ok(paradox.homeScore < paradox.awayScore);
});

test('safe enrichment retains extra records, metadata, dates and already-detailed sheets', async () => {
  const records = await json('../data/matches-1001.json');
  const fixtures = await json('../data/schedule-1001.json');
  const detailed = records[0];
  const { games, scoreFormat, ...aggregate } = detailed;
  const extra = { id: 'other-user-result', fixtureId: 'unrelated', custom: 'retained' };
  const staged = { artifactKind: 'staged-individual-games-import-v1', liveDeployable: false, divisieId: '1001', matches: [detailed] };
  const enriched = enrichResults([aggregate, extra], staged, fixtures, '1001');
  assert.equal(metadataHash(enriched[0]), metadataHash(aggregate));
  assert.deepEqual(enriched[1], extra);
  assert.deepEqual(enrichResults(enriched, staged, fixtures, '1001'), enriched);
  assert.throws(() => enrichResults([aggregate], { ...staged, matches: [{ ...detailed, homeScore: 30 }] }, fixtures, '1001'));
  assert.throws(() => enrichResults([aggregate], { ...staged, matches: [detailed, detailed] }, fixtures, '1001'));
  assert.throws(() => enrichResults([aggregate], staged, [], '1001'));
  const differentGames = games.map((game) => ({ ...game, homeScore: game.homeScore === 13 ? 13 : 0, awayScore: game.awayScore === 13 ? 13 : 0 }));
  assert.throws(() => enrichResults([{ ...detailed, games: differentGames }], staged, fixtures, '1001'), /Detailed conflict/);
});
