import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDetailedScore, summarizeGames } from '../backend/domain/scoring.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const metadataHash = (record) => {
  const { games, scoreFormat, playerLineup, ...metadata } = record;
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
};

export function enrichResults(existing, staged, fixtures, pool) {
  if (!Array.isArray(existing) || !Array.isArray(fixtures)
    || staged.artifactKind !== 'staged-individual-games-import-v1' || staged.liveDeployable !== false
    || staged.divisieId !== pool || !Array.isArray(staged.matches)) throw new Error('Invalid staged envelope');
  const additions = new Map();
  for (const source of staged.matches) {
    const id = source.matchId || source.fixtureId;
    if (additions.has(id)) throw new Error(`Duplicate staged match ${id}`);
    const fixture = fixtures.find((row) => row.id === id);
    const targets = existing.filter((row) => (row.matchId || row.fixtureId) === id);
    if (!fixture || targets.length !== 1) throw new Error(`Unmapped or duplicate result ${id}`);
    const target = targets[0];
    for (const field of ['homeTeamId', 'awayTeamId', 'divisieId']) {
      if (target[field] !== source[field] || String(fixture[field]) !== String(source[field])) {
        throw new Error(`Identity mismatch ${id}: ${field}`);
      }
    }
    if (source.divisieId !== pool || source.homeScore !== target.homeScore || source.awayScore !== target.awayScore) {
      throw new Error(`Aggregate mismatch ${id}`);
    }
    const score = validateDetailedScore(source);
    if (target.games !== undefined || target.scoreFormat !== undefined) {
      const current = validateDetailedScore(target);
      if (JSON.stringify(current.games) !== JSON.stringify(score.games)) throw new Error(`Detailed conflict ${id}`);
    }
    additions.set(id, score);
  }
  return existing.map((record) => {
    const score = additions.get(record.matchId || record.fixtureId);
    return score ? { ...record, scoreFormat: score.scoreFormat, games: score.games } : record;
  });
}

export function buildProvenance(sourceProvenance, imports, previous = {}) {
  const provenance = { ...previous, season: sourceProvenance.season, retrievedAt: sourceProvenance.generatedAt, pools: {} };
  if (previous.excelDownloadAudit) {
    provenance.excelDownloadAudit = {
      ...previous.excelDownloadAudit,
      retrievedAt: previous.excelDownloadAudit.retrievedAt || previous.retrievedAt,
    };
  }
  for (const [pool, { staged, merged }] of Object.entries(imports)) {
    const source = sourceProvenance.pools[pool];
    const priorPool = previous.pools?.[pool];
    const stagedIds = new Set(staged.matches.map((record) => record.matchId));
    if (priorPool?.matches.some((record) => !stagedIds.has(record.matchId))) {
      throw new Error(`Incomplete staging would discard provenance ${pool}`);
    }
    provenance.pools[pool] = {
      ...priorPool,
      pageUrl: source.pageUrl,
      pageSha256: source.pageSha256,
      coverage: staged.coverage,
      matches: staged.matches.map((record) => {
        const workbook = source.workbooks.find((row) => row.matchId === record.matchId);
        const target = merged.find((row) => (row.matchId || row.fixtureId) === record.matchId);
        const priorMatch = priorPool?.matches.find((row) => row.matchId === record.matchId);
        if (priorMatch?.playerLineupSha256 && !target.playerLineup) {
          throw new Error(`Previously verified player lineup is missing ${record.matchId}`);
        }
        const totals = summarizeGames(target.games);
        if (!workbook || workbook.status !== 'validated'
          || JSON.stringify([totals.rawHomeScore, totals.rawAwayScore]) !== JSON.stringify(workbook.officialRawTotals)) {
          throw new Error(`Provenance mismatch ${record.matchId}`);
        }
        const evidence = {
          matchId: record.matchId,
          workbookUrl: workbook.resolvedWorkbookUrl,
          workbookSha256: workbook.workbookSha256,
          workbookDate: workbook.workbookDate,
          preservedResultDate: target.date,
          rawTotals: workbook.officialRawTotals,
          metadataSha256: metadataHash(target),
          gamesSha256: createHash('sha256').update(JSON.stringify(target.games)).digest('hex'),
        };
        if (target.playerLineup) {
          const lineupHash = createHash('sha256').update(JSON.stringify(target.playerLineup)).digest('hex');
          if (priorMatch?.workbookSha256 !== workbook.workbookSha256 || priorMatch?.playerLineupSha256 !== lineupHash) {
            throw new Error(`Player lineup provenance must be reverified ${record.matchId}`);
          }
          evidence.playerLineupSha256 = lineupHash;
          if (priorMatch.playerNameResolutions) evidence.playerNameResolutions = priorMatch.playerNameResolutions;
          if (priorMatch.notes) evidence.notes = priorMatch.notes;
        }
        return evidence;
      }),
    };
    if (priorPool?.standingsVerified) {
      provenance.pools[pool].standingsVerifiedAt = priorPool.standingsVerifiedAt || previous.retrievedAt;
    }
    if (priorPool?.unavailableWorkbookMatchIds) {
      provenance.pools[pool].workbookAvailabilityCheckedAt = priorPool.workbookAvailabilityCheckedAt || previous.retrievedAt;
    }
  }
  return provenance;
}

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error('Usage: node scripts/enrich-historical-results.mjs <staged-artifact-directory> [--apply]');
  const sourceProvenance = JSON.parse(await readFile(resolve(sourceDir, 'historical-results-provenance.json'), 'utf8'));
  const historyFile = resolve(root, 'backend', 'history', 'provenance.json');
  const previous = await readFile(historyFile, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return {};
  });
  const writes = [];
  const imports = {};
  for (const pool of ['1001', '2001', '2002']) {
    const file = resolve(root, 'backend', 'data', `matches-${pool}.json`);
    const original = await readFile(file, 'utf8');
    const existing = JSON.parse(original);
    const fixtures = JSON.parse(await readFile(resolve(root, 'backend', 'data', `schedule-${pool}.json`), 'utf8'));
    const staged = JSON.parse(await readFile(resolve(sourceDir, `historical-detailed-matches-${pool}.json`), 'utf8'));
    const merged = enrichResults(existing, staged, fixtures, pool);
    imports[pool] = { staged, merged };
    writes.push({ file, original, merged });
    console.log(`${pool}: ${staged.matches.length} detailed results, ${existing.length} original records retained`);
  }
  const provenance = buildProvenance(sourceProvenance, imports, previous);
  if (!process.argv.includes('--apply')) return;
  // Validate every pool first and refuse a concurrent workspace change before writing.
  for (const { file, original } of writes) {
    if (await readFile(file, 'utf8') !== original) throw new Error(`File changed while preparing import: ${file}`);
  }
  for (const { file, merged } of writes) await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  const historyDir = resolve(root, 'backend', 'history');
  await mkdir(historyDir, { recursive: true });
  await writeFile(historyFile, `${JSON.stringify(provenance, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
