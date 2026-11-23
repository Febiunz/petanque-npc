import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAggregateScore, validateDetailedScore, summarizeGames } from '../domain/scoring.js';
import { isOfficialResult } from '../history/officialResults.js';
import { enrichResults, metadataHash, buildProvenance } from '../../scripts/enrich-historical-results.mjs';
import { reconcilePool } from '../../scripts/reconcile-official-npc.mjs';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

async function officialSnapshotCase() {
  const [records, fixtures, teams, provenance] = await Promise.all([
    json('../data/matches-1001.json'), json('../data/schedule-1001.json'),
    json('../data/teams-1001.json'), json('../history/provenance.json'),
  ]);
  const record = records[0];
  const fixture = fixtures.find((row) => row.id === record.matchId);
  const evidence = provenance.pools['1001'].matches.find((row) => row.matchId === record.matchId);
  const row = {
    matchId: record.matchId, round: fixture.round,
    home: teams.find((team) => team.id === fixture.homeTeamId).name,
    away: teams.find((team) => team.id === fixture.awayTeamId).name,
    roundDate: fixture.date, adjustedDate: null, published: true,
    totals: [record.homeScore, record.awayScore, ...evidence.rawTotals],
    workbookStatus: 200, workbookUrl: evidence.workbookUrl,
    workbook: { date: evidence.workbookDate, games: record.games, playerLineup: record.playerLineup, sha256: evidence.workbookSha256 },
  };
  const prior = { ...provenance.pools['1001'], matches: [evidence] };
  const source = { pageUrl: prior.pageUrl, pageSha256: prior.pageSha256, fixtures: [row] };
  const run = (overrides = {}) => reconcilePool('1001', overrides.fixtures || [fixture],
    overrides.records || [record], teams, overrides.prior || prior,
    overrides.source || source, '2026-11-23T12:00:00Z');
  return { run, record, fixture, source, prior };
}

test('refresh cannot call missing published results, incomplete inventories or workbook gaps unchanged', async () => {
  const { run, record, source, prior } = await officialSnapshotCase();
  assert.equal(run().changed, false);
  const added = run({ records: [], prior: { ...prior, matches: [] } });
  assert.equal(added.changed, true);
  assert.equal(added.matches[0].matchId, record.matchId);
  assert.deepEqual(added.matches[0].games, record.games);
  assert.throws(() => run({ source: { ...source, fixtures: [] } }), /Incomplete/);
  assert.throws(() => run({ source: { ...source, fixtures: [source.fixtures[0], source.fixtures[0]] } }), /Incomplete/);
  const unavailable = structuredClone(source);
  unavailable.fixtures[0].workbookStatus = 404;
  delete unavailable.fixtures[0].workbook;
  assert.throws(() => run({ source: unavailable }), /lacks verified workbook/);
  const disappeared = structuredClone(source);
  disappeared.fixtures[0].published = false;
  disappeared.fixtures[0].workbookStatus = 404;
  delete disappeared.fixtures[0].workbook;
  assert.throws(() => run({ source: disappeared }), /Previously official/);
});

test('refresh updates dates only on existing fixtures and preserves played-date workbook exceptions', async () => {
  const { run, fixture, record, source } = await officialSnapshotCase();
  const rescheduled = structuredClone(source);
  rescheduled.fixtures[0].workbook.date = '2026-11-21';
  const updated = run({ source: rescheduled });
  assert.deepEqual(updated.schedules, [{ ...fixture, date: '2026-11-21' }]);
  assert.equal(updated.matches[0].date, '2026-11-21T12:00:00.000Z');
  assert.equal(updated.matches[0].createdAt, record.createdAt);
  assert.equal(updated.matches[0].officialDate, '2026-11-21');
  assert.equal(updated.evidence.dateCorrections[0].changes[0].previousDate, record.date);
  assert.equal(updated.evidence.matches[0].metadataSha256, metadataHash(updated.matches[0]));
  const adjusted = structuredClone(source);
  adjusted.fixtures[0] = { ...adjusted.fixtures[0], published: false, workbookStatus: 404, adjustedDate: '2026-12-13' };
  delete adjusted.fixtures[0].workbook;
  const upcoming = run({ source: adjusted, records: [], prior: { matches: [] } });
  assert.equal(upcoming.schedules[0].date, '2026-12-13');
  assert.deepEqual(upcoming.matches, []);
  const identityDrift = structuredClone(source);
  identityDrift.fixtures[0].home = 'Different team';
  assert.throws(() => run({ source: identityDrift }), /identity drift/);
  const changedWorkbook = structuredClone(source);
  changedWorkbook.fixtures[0].workbook.sha256 = 'f'.repeat(64);
  assert.throws(() => run({ source: changedWorkbook }), /requires re-verification/);
});

test('official results retain metadata and independently verified totals as the season grows', async () => {
  const provenance = await json('../history/provenance.json');
  for (const [pool, historicalMinimum] of [['1001', 18], ['2001', 20], ['2002', 20]]) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const { matches: sources, coverage } = provenance.pools[pool];
    const official = records.filter(isOfficialResult);
    assert.ok(official.length >= historicalMinimum);
    assert.equal(official.length, sources.length);
    assert.deepEqual(coverage, {
      publishedCompletedCount: official.length,
      validatedCount: official.length,
      excludedCount: 0,
      coverageComplete: true,
    });
    assert.equal(new Set(records.map((record) => record.matchId || record.fixtureId)).size, records.length);
    assert.deepEqual(sources.map((source) => source.matchId).sort(), official.map((record) => record.matchId).sort());
    for (const record of official) {
      const fixture = fixtures.find((row) => row.id === record.matchId);
      assert.equal(fixture.homeTeamId, record.homeTeamId);
      assert.equal(fixture.awayTeamId, record.awayTeamId);
      validateAggregateScore(record);
      const score = validateDetailedScore(record);
      const source = sources.find((row) => row.matchId === record.matchId);
      assert.equal(metadataHash(record), source.metadataSha256);
      assert.equal(createHash('sha256').update(JSON.stringify(score.games)).digest('hex'), source.gamesSha256);
      const totals = summarizeGames(score.games);
      assert.deepEqual([totals.rawHomeScore, totals.rawAwayScore], source.rawTotals);
      assert.equal(record.date, source.preservedResultDate);
    }
  }
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
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    for (const record of records.filter(isOfficialResult)) {
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
      }
      for (const substitution of lineup.substitutions) {
        assert.ok(lineup.games[substitution.slotId][substitution.side].includes(substitution.out));
        assert.ok(substitution.in);
      }
    }
  }
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
  const source = { season: previous.season, generatedAt: '2027-04-04T12:00:00Z', pools: {} };
  const imports = {};
  for (const pool of ['1001', '2001', '2002']) {
    const records = await json(`../data/matches-${pool}.json`);
    const fixtures = await json(`../data/schedule-${pool}.json`);
    const prior = previous.pools[pool];
    const staged = {
      artifactKind: 'staged-individual-games-import-v1', liveDeployable: false, divisieId: pool,
      coverage: prior.coverage, matches: records.filter(isOfficialResult),
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
    const byId = (a, b) => a.matchId.localeCompare(b.matchId);
    assert.deepEqual(rebuilt.pools[pool].matches.toSorted(byId), previous.pools[pool].matches.toSorted(byId));
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
