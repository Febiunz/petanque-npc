import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAggregateScore, validateDetailedScore, summarizeGames } from '../domain/scoring.js';
import { isOfficialResult } from '../history/officialResults.js';
import { enrichResults, metadataHash, buildProvenance } from '../../scripts/enrich-historical-results.mjs';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('all 58 official results and 638 games retain metadata and independently verified totals', async () => {
  const provenance = await json('../history/provenance.json');
  let count = 0;
  let games = 0;
  for (const [pool, expected] of [['1001', 18], ['2001', 20], ['2002', 20]]) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const sources = provenance.pools[pool].matches;
    assert.equal(records.length, expected);
    assert.equal(sources.length, expected);
    assert.equal(new Set(records.map((record) => record.matchId || record.fixtureId)).size, expected);
    for (const record of records) {
      const fixture = fixtures.find((row) => row.id === record.matchId);
      assert.equal(fixture.homeTeamId, record.homeTeamId);
      assert.equal(fixture.awayTeamId, record.awayTeamId);
      assert.equal(isOfficialResult(record), true);
      count++;
      validateAggregateScore(record);
      const score = validateDetailedScore(record);
      const source = sources.find((row) => row.matchId === record.matchId);
      assert.equal(metadataHash(record), source.metadataSha256);
      assert.equal(createHash('sha256').update(JSON.stringify(score.games)).digest('hex'), source.gamesSha256);
      const totals = summarizeGames(score.games);
      assert.deepEqual([totals.rawHomeScore, totals.rawAwayScore], source.rawTotals);
      assert.equal(record.date, source.preservedResultDate);
      games += score.games.length;
    }
  }
  assert.equal(count, 58);
  assert.equal(games, 638);
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
  assert.equal(enriched[0].officialSource, 'nlpetanque');
  assert.equal(metadataHash(enriched[0]), metadataHash(aggregate));
  assert.deepEqual(enriched[1], extra);
  assert.deepEqual(enrichResults(enriched, staged, fixtures, '1001'), enriched);
  assert.throws(() => enrichResults([aggregate], { ...staged, matches: [{ ...detailed, homeScore: 30 }] }, fixtures, '1001'));
  assert.throws(() => enrichResults([aggregate], { ...staged, matches: [detailed, detailed] }, fixtures, '1001'));
  assert.throws(() => enrichResults([aggregate], staged, [], '1001'));
  const differentGames = games.map((game) => ({ ...game, homeScore: game.homeScore === 13 ? 13 : 0, awayScore: game.awayScore === 13 ? 13 : 0 }));
  assert.throws(() => enrichResults([{ ...detailed, games: differentGames }], staged, fixtures, '1001'), /Detailed conflict/);
});

test('official game lineups preserve all available names, audited gaps, substitutions and source hashes', async () => {
  const provenance = await json('../history/provenance.json');
  let count = 0;
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    for (const record of records) {
      if (record.games === undefined) continue;
      const lineup = record.playerLineup;
      const source = provenance.pools[pool].matches.find((row) => row.matchId === record.matchId);
      assert.equal(lineup.source, source.workbookUrl);
      assert.equal(createHash('sha256').update(JSON.stringify(lineup)).digest('hex'), source.playerLineupSha256);
      assert.deepEqual(Object.keys(lineup.games), record.games.map((game) => game.slotId));
      for (const { slotId } of record.games) {
        const size = slotId.startsWith('tete-') ? 1 : slotId.startsWith('doublette-') ? 2 : 3;
        for (const side of ['home', 'away']) {
          const names = lineup.games[slotId][side];
          const missing = (source.missingPlayerNames || []).filter((row) => row.slotId === slotId && row.side === side);
          assert.equal(names.length, size - missing.length, `${record.matchId} ${slotId} ${side}`);
          assert.ok(names.every((name) => typeof name === 'string' && name.trim() && !name.startsWith('#')));
        }
        count++;
      }
      for (const substitution of lineup.substitutions) {
        assert.ok(lineup.games[substitution.slotId][substitution.side].includes(substitution.out));
        assert.ok(substitution.in);
      }
    }
  }
  assert.equal(count, 638);
  const top = await json('../data/matches-1001.json');
  assert.deepEqual(top.find((row) => row.matchId === '100101').playerLineup.games['doublette-3'].away, ['Ad Wagenaars', 'Dennis Bakker']);
  const second = await json('../data/matches-2001.json');
  const corrected = second.find((row) => row.matchId === '200103').playerLineup;
  assert.deepEqual(corrected.games['tete-2'].home, ['Osman Jibril']);
  assert.ok(corrected.games['doublette-2'].home.includes('Osman Jibril'));
  assert.ok(corrected.games['triplette-2'].home.includes('Osman Jibril'));
  const other = await json('../data/matches-2002.json');
  assert.deepEqual(other.find((row) => row.matchId === '200213').playerLineup.unassignedSubstitutions, [
    { type: 'doublette', side: 'away', out: null, in: 'Elout Visser' },
  ]);
});

test('new round-five workbooks fill missing game and player details without changing totals', async () => {
  const provenance = await json('../history/provenance.json');
  const records = await json('../data/matches-2001.json');
  const restored = records.find((row) => row.matchId === '200119');
  assert.deepEqual([restored.homeScore, restored.awayScore], [17, 14]);
  assert.deepEqual(restored.games.map(({ homeScore, awayScore }) => [homeScore, awayScore]), [
    [13, 6], [7, 13], [4, 13], [13, 2], [13, 11], [8, 13],
    [13, 1], [13, 12], [8, 13], [13, 2], [8, 13],
  ]);
  assert.deepEqual(restored.playerLineup.games['doublette-2'], {
    home: ['Frits Bijsterveld', 'Willie Lieshout'],
    away: ['Joey Dijkstra', 'Simon Vogelaar'],
  });
  assert.deepEqual(restored.playerLineup.substitutions, [
    { slotId: 'triplette-1', side: 'away', out: 'Celine Stritzko', in: 'Roby van Rooijen' },
  ]);
  const pool = provenance.pools['2001'];
  assert.ok(!pool.unavailableWorkbookMatchIds.includes(restored.matchId));
  assert.deepEqual(pool.matches.find((row) => row.matchId === restored.matchId).rawTotals, [113, 99]);
  assert.equal(pool.coverage.coverageComplete, true);
  const corrected = records.find((row) => row.matchId === '200117');
  assert.deepEqual(corrected.games.find((row) => row.slotId === 'tete-5'), {
    slotId: 'tete-5', homeScore: 13, awayScore: 10,
  });
  assert.deepEqual(corrected.playerLineup.games['tete-5'], {
    home: ['Patrick Lautenslager'], away: ['Rob Torremans'],
  });
  assert.equal(pool.matches.find((row) => row.matchId === corrected.matchId).missingPlayerNames, undefined);
});

test('rerunning enrichment preserves lineup evidence and dates earlier download and page audits', async () => {
  const previous = await json('../history/provenance.json');
  const source = { season: previous.season, generatedAt: '2026-11-17T12:00:00Z', pools: {} };
  const imports = {};
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const prior = previous.pools[pool];
    const staged = {
      artifactKind: 'staged-individual-games-import-v1', liveDeployable: false, divisieId: pool,
      coverage: prior.coverage, matches: records.filter((row) => row.games !== undefined),
    };
    source.pools[pool] = {
      pageUrl: prior.pageUrl, pageSha256: prior.pageSha256,
      workbooks: prior.matches.map((row) => ({
        ...row, status: 'validated', resolvedWorkbookUrl: row.workbookUrl, officialRawTotals: row.rawTotals,
      })),
    };
    imports[pool] = { staged, merged: enrichResults(records, staged, fixtures, pool) };
  }
  const rebuilt = buildProvenance(source, imports, previous);
  assert.equal(rebuilt.retrievedAt, source.generatedAt);
  assert.deepEqual(rebuilt.excelDownloadAudit, {
    ...previous.excelDownloadAudit,
    retrievedAt: previous.excelDownloadAudit.retrievedAt || previous.retrievedAt,
  });
  assert.deepEqual(rebuilt.latestExcelDownloadAudit, previous.latestExcelDownloadAudit);
  for (const pool of ['1001', '2001', '2002']) {
    assert.deepEqual(rebuilt.pools[pool].matches, previous.pools[pool].matches);
    assert.deepEqual(rebuilt.pools[pool].aggregateOnlyMatches, previous.pools[pool].aggregateOnlyMatches);
    assert.deepEqual(rebuilt.pools[pool].unavailableWorkbookMatchIds, previous.pools[pool].unavailableWorkbookMatchIds);
    assert.equal(rebuilt.pools[pool].standingsVerifiedAt, previous.pools[pool].standingsVerifiedAt || previous.retrievedAt);
    assert.equal(rebuilt.pools[pool].workbookAvailabilityCheckedAt, previous.pools[pool].workbookAvailabilityCheckedAt || previous.retrievedAt);
  }
  assert.deepEqual(buildProvenance(source, imports, rebuilt), rebuilt);
  const changedLineup = structuredClone(imports);
  changedLineup['1001'].merged[0].playerLineup.games['tete-1'].home = ['Unverified player'];
  assert.throws(() => buildProvenance(source, changedLineup, previous), /Player lineup provenance must be reverified/);
  const changedWorkbook = structuredClone(source);
  changedWorkbook.pools['1001'].workbooks[0].workbookSha256 = 'changed';
  assert.throws(() => buildProvenance(changedWorkbook, imports, previous), /Player lineup provenance must be reverified/);
  const withoutLineups = Object.fromEntries(Object.entries(imports).map(([pool, entry]) => [
    pool, { ...entry, merged: entry.merged.map(({ playerLineup, ...record }) => record) },
  ]));
  assert.throws(() => buildProvenance(source, withoutLineups, previous), /Previously verified player lineup is missing/);
  const nullLineup = structuredClone(imports);
  nullLineup['1001'].merged[0].playerLineup = null;
  assert.throws(() => buildProvenance(source, nullLineup, previous), /Previously verified player lineup is missing/);
  const partial = structuredClone(imports);
  partial['1001'].staged.matches = partial['1001'].staged.matches.slice(1);
  assert.throws(() => buildProvenance(source, partial, previous), /Incomplete staging would discard provenance/);
  assert.ok(buildProvenance(source, withoutLineups).pools['1001'].matches.every((row) => !row.playerLineupSha256));
});
