import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateDetailedScore, summarizeGames } from '../backend/domain/scoring.js';
import { metadataHash } from './enrich-historical-results.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pools = ['1001', '2001', '2002'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = isDeepStrictEqual;
const matchId = (row) => row.matchId || row.fixtureId;

export function reconcilePool(pool, fixtures, records, teams, prior, source, generatedAt) {
  const rows = source.fixtures;
  if (!Array.isArray(rows) || rows.length !== fixtures.length
    || new Set(rows.map((row) => row.matchId)).size !== rows.length
    || new Set(records.map(matchId)).size !== records.length) {
    throw new Error(`Incomplete or duplicate source/result coverage: ${pool}`);
  }
  const schedules = structuredClone(fixtures);
  const matches = structuredClone(records);
  const evidence = structuredClone(prior);
  const validated = [];
  const dateChanges = [];
  for (const row of rows) {
    const id = row.matchId;
    const fixture = schedules.find((item) => item.id === id);
    if (!fixture || fixture.divisieId !== pool || fixture.round !== row.round
      || teams.find((team) => team.id === fixture.homeTeamId)?.name !== row.home
      || teams.find((team) => team.id === fixture.awayTeamId)?.name !== row.away) {
      throw new Error(`Official fixture identity drift: ${id}`);
    }
    const previousSource = prior.matches.find((item) => item.matchId === id);
    let record = matches.find((item) => matchId(item) === id);
    if (!row.published) {
      if (row.workbookStatus !== 404 || row.workbook || previousSource || record?.officialSource === 'nlpetanque') {
        throw new Error(`Previously official result missing or source incomplete: ${id}`);
      }
    } else {
      const workbook = row.workbook;
      if (row.workbookStatus !== 200 || !workbook || !/^[a-f0-9]{64}$/.test(workbook.sha256)) {
        throw new Error(`Published result lacks verified workbook: ${id}`);
      }
      const score = validateDetailedScore({ scoreFormat: 'individual-games-v1', games: workbook.games });
      const totals = summarizeGames(score.games);
      if (totals.completed !== 11 || !same([score.homeScore, score.awayScore, totals.rawHomeScore, totals.rawAwayScore], row.totals)) {
        throw new Error(`Incomplete or inconsistent official score: ${id}`);
      }
      if (previousSource && (!record || previousSource.workbookSha256 !== workbook.sha256
        || previousSource.metadataSha256 !== metadataHash(record)
        || previousSource.gamesSha256 !== hash(record.games)
        || previousSource.playerLineupSha256 !== hash(record.playerLineup))) {
        throw new Error(`Existing workbook/result evidence requires re-verification: ${id}`);
      }
      if (record && (record.divisieId !== pool || record.homeTeamId !== fixture.homeTeamId
        || record.awayTeamId !== fixture.awayTeamId || record.homeScore !== score.homeScore
        || record.awayScore !== score.awayScore || (record.games && !same(record.games, score.games)))) {
        throw new Error(`Existing result conflicts with official workbook: ${id}`);
      }
      if (!record) {
        record = {
          id: `official-${id}`, date: `${workbook.date}T12:00:00.000Z`, fixtureId: id, matchId: id, matchNumber: id,
          homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
          homeScore: score.homeScore, awayScore: score.awayScore,
          createdAt: generatedAt, submittedBy: 'NLpetanque official results', submittedByUid: null,
          officialDate: workbook.date, divisieId: pool, divisie: fixture.divisie,
        };
        matches.push(record);
      }
      record.scoreFormat = score.scoreFormat;
      record.games = score.games;
      record.playerLineup ??= workbook.playerLineup;
      if (!previousSource) record.officialSource = 'nlpetanque';
      if (!record.playerLineup || !same(Object.keys(record.playerLineup.games), score.games.map((game) => game.slotId))) {
        throw new Error(`Missing official player lineup: ${id}`);
      }
      if (!previousSource && !same(record.playerLineup, workbook.playerLineup)) {
        throw new Error(`Unverified existing player lineup: ${id}`);
      }
      const playedDate = `${workbook.date}T12:00:00.000Z`;
      if (record.date.slice(0, 10) !== workbook.date || record.officialDate !== workbook.date) {
        dateChanges.push({ matchId: id, previousDate: record.date, previousOfficialDate: record.officialDate,
          date: playedDate, workbookUrl: row.workbookUrl });
        record.date = playedDate;
        record.officialDate = workbook.date;
      }
      const entry = {
        ...previousSource, matchId: id, workbookUrl: row.workbookUrl, workbookSha256: workbook.sha256,
        workbookDate: workbook.date, preservedResultDate: record.date, rawTotals: row.totals.slice(2),
        metadataSha256: metadataHash(record), gamesSha256: hash(record.games), playerLineupSha256: hash(record.playerLineup),
      };
      if (!previousSource && workbook.missingPlayerNames) entry.missingPlayerNames = workbook.missingPlayerNames;
      validated.push(entry);
    }
    const date = row.published ? row.workbook.date : row.adjustedDate || row.roundDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
      throw new Error(`Invalid official date: ${id}`);
    }
    if (fixture.date !== date) {
      dateChanges.push({ matchId: id, previousScheduleDate: fixture.date, date,
        sourceUrl: row.published ? row.workbookUrl : source.pageUrl });
      fixture.date = date;
    }
  }
  if (prior.matches.some((entry) => !validated.some((item) => item.matchId === entry.matchId))) {
    throw new Error(`Source would discard verified provenance: ${pool}`);
  }
  const changed = !same(matches, records) || !same(schedules, fixtures);
  if (changed) {
    evidence.pageUrl = source.pageUrl;
    evidence.pageSha256 = source.pageSha256;
    evidence.matches = validated;
    evidence.coverage = {
      publishedCompletedCount: validated.length, validatedCount: validated.length, excludedCount: 0, coverageComplete: true,
    };
    evidence.unavailableWorkbookMatchIds = rows.filter((row) => row.workbookStatus === 404).map((row) => row.matchId);
    evidence.workbookAvailabilityCheckedAt = generatedAt;
    if (dateChanges.length) evidence.dateCorrections = [...(evidence.dateCorrections || []), { verifiedAt: generatedAt, changes: dateChanges }];
  }
  return { matches, schedules, evidence, changed };
}

export async function reconcile(directory, snapshot, apply = false) {
  if (snapshot.kind !== 'official-npc-snapshot-v1' || !same(Object.keys(snapshot.pools).sort(), pools)
    || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new Error('Invalid or incomplete official source snapshot');
  }
  const read = async (path) => {
    const file = resolve(directory, path);
    const original = await readFile(file, 'utf8');
    return { file, original, data: JSON.parse(original) };
  };
  const history = await read('backend/history/provenance.json');
  const provenance = structuredClone(history.data);
  const writes = [];
  const counts = {};
  for (const pool of pools) {
    const results = await read(`backend/data/matches-${pool}.json`);
    const schedules = await read(`backend/data/schedule-${pool}.json`);
    const teams = await read(`backend/data/teams-${pool}.json`);
    const plan = reconcilePool(pool, schedules.data, results.data, teams.data, history.data.pools[pool],
      snapshot.pools[pool], snapshot.generatedAt);
    counts[pool] = plan.evidence.matches.length;
    if (!plan.changed) continue;
    provenance.pools[pool] = plan.evidence;
    for (const [file, data] of [[results, plan.matches], [schedules, plan.schedules]]) {
      if (!same(file.data, data)) writes.push({ ...file, data });
    }
  }
  if (writes.length) {
    if (provenance.excelDownloadAudit) {
      provenance.excelDownloadAudit.retrievedAt ??= history.data.retrievedAt;
    }
    if (provenance.latestExcelDownloadAudit?.retrievedAt !== snapshot.generatedAt) {
      provenance.excelDownloadAudits = [
        ...(provenance.excelDownloadAudits || []),
        ...(provenance.latestExcelDownloadAudit ? [provenance.latestExcelDownloadAudit] : []),
      ];
    }
    provenance.retrievedAt = snapshot.generatedAt;
    provenance.latestExcelDownloadAudit = {
      retrievedAt: snapshot.generatedAt, scope: 'all linked fixture workbooks',
      linkedCount: Object.values(snapshot.pools).reduce((sum, pool) => sum + pool.fixtures.length, 0),
      downloadedCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
      notFoundCount: Object.values(snapshot.pools).reduce((sum, pool) =>
        sum + pool.fixtures.filter((row) => row.workbookStatus === 404).length, 0),
    };
    writes.push({ ...history, data: provenance });
  }
  if (apply) {
    for (const { file, original } of writes) {
      if (await readFile(file, 'utf8') !== original) throw new Error(`Concurrent file change: ${file}`);
    }
    for (const { file, data } of writes) await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return { changedFiles: writes.map(({ file }) => file), counts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error('Usage: node scripts/reconcile-official-npc.mjs <snapshot.json> [--apply|--check]');
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    const repositoryRoot = process.env.NPC_RECONCILE_ROOT
      ? resolve(process.env.NPC_RECONCILE_ROOT)
      : root;
    const result = await reconcile(repositoryRoot, snapshot, process.argv.includes('--apply'));
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--check') && result.changedFiles.length) {
      throw new Error('Official results/dates remain unreconciled; no-change output is forbidden');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
