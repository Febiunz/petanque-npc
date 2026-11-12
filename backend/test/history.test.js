import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDetailedScore, summarizeGames } from '../domain/scoring.js';
import { enrichResults, metadataHash, buildProvenance } from '../../scripts/enrich-historical-results.mjs';

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

test('all official game lineups have complete names, mapped substitutions and source hashes', async () => {
  const provenance = await json('../history/provenance.json');
  let count = 0;
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    for (const record of records) {
      const lineup = record.playerLineup;
      const source = provenance.pools[pool].matches.find((row) => row.matchId === record.matchId);
      assert.equal(lineup.source, source.workbookUrl);
      assert.equal(createHash('sha256').update(JSON.stringify(lineup)).digest('hex'), source.playerLineupSha256);
      assert.deepEqual(Object.keys(lineup.games), record.games.map((game) => game.slotId));
      for (const { slotId } of record.games) {
        const size = slotId.startsWith('tete-') ? 1 : slotId.startsWith('doublette-') ? 2 : 3;
        for (const side of ['home', 'away']) {
          const names = lineup.games[slotId][side];
          assert.equal(names.length, size, `${record.matchId} ${slotId} ${side}`);
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
  assert.equal(count, 506);
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

test('rerunning enrichment preserves lineup evidence and dates earlier download and page audits', async () => {
  const previous = await json('../history/provenance.json');
  const source = { season: previous.season, generatedAt: '2026-11-13T12:00:00Z', pools: {} };
  const imports = {};
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const prior = previous.pools[pool];
    const staged = {
      artifactKind: 'staged-individual-games-import-v1', liveDeployable: false, divisieId: pool,
      coverage: prior.coverage, matches: records,
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
  assert.deepEqual(rebuilt.excelDownloadAudit, { ...previous.excelDownloadAudit, retrievedAt: previous.retrievedAt });
  for (const pool of ['1001', '2001', '2002']) {
    assert.deepEqual(rebuilt.pools[pool].matches, previous.pools[pool].matches);
    assert.deepEqual(rebuilt.pools[pool].unavailableWorkbookMatchIds, previous.pools[pool].unavailableWorkbookMatchIds);
    assert.equal(rebuilt.pools[pool].standingsVerifiedAt, previous.retrievedAt);
    assert.equal(rebuilt.pools[pool].workbookAvailabilityCheckedAt, previous.retrievedAt);
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
