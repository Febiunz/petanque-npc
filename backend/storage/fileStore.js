import { promises as fs } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readBlobFile, writeBlobFile, blobExists, deleteBlobFile } from './blobStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = `${__dirname}/../data`;
const teamsFile = `${dataDir}/teams.json`;

// Use blob storage if AZURE_STORAGE_CONNECTION_STRING is set
const useBlob = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

export const DIVISIES = {
  TOPDIVISIE: 'topdivisie',
  SECOND_DIVISION: '2e-divisie',
};

export const POOLS = {
  TOPDIVISIE: '1001',
  SECOND_DIVISION_A: '2001',
  SECOND_DIVISION_B: '2002',
};

const ALL_DIVISIE_IDS = ['1001', '2001', '2002'];
const matchesFileFor = (divisieId) => `${dataDir}/matches-${divisieId}.json`;
const legacyMatchesFile = `${dataDir}/matches.json`;

// Track if migration has been attempted
let migrationAttempted = false;

// Simple in-process mutex per file to serialize writes
const locks = new Map();
async function withLock(filePath, fn) {
  const prev = locks.get(filePath) || Promise.resolve();
  let release;
  const p = new Promise((res) => (release = res));
  locks.set(filePath, prev.then(() => p));
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(filePath) === p) locks.delete(filePath);
  }
}

const TOPDIVISIE_TEAMS = [
  { id: 'amicale-boule-d-argent-1', name: "Amicale Boule d'Argent 1" },
  { id: 'boul-animo-1', name: "Boul'Animo 1" },
  { id: 'cdp-les-cailloux-1', name: 'CdP Les Cailloux 1' },
  { id: 'jbc-t-dupke-1', name: "JBC 't Dupke 1" },
  { id: 'jeu-de-bommel-1', name: 'Jeu de Bommel 1' },
  { id: 'petangeske-1', name: 'Petangeske 1' },
  { id: 'puk-haarlem-1', name: 'PUK-Haarlem 1' },
  { id: 't-zwijntje-1', name: "'t Zwijntje 1" },
].map((team) => ({ ...team, divisie: DIVISIES.TOPDIVISIE, divisieId: POOLS.TOPDIVISIE }));

const SECOND_DIVISION_POOL_A_TEAMS = [
  'PV Gouda 1',
  'JBV Amicale Cuyk 1',
  'MIDI 1',
  "JBC 't Dupke 2",
  'Va-Tout 1',
  'Amicale de Pétanque 1',
  "L'Esprit 1",
  'JBV De Walnoot 1',
].map((name) => ({ id: slugifyTeam(name), name, divisie: DIVISIES.SECOND_DIVISION, divisieId: POOLS.SECOND_DIVISION_A }));

const SECOND_DIVISION_POOL_B_TEAMS = [
  'Le Biberon 1',
  'De Bouledozers 1',
  'PUK-Haarlem 2',
  'JBC Randenbroek 1',
  'Les Boules Fleuries 1',
  'ELZA-Boules 1',
  'Les Bohémiens de Petanque 1',
  'De Gooiers 1',
].map((name) => ({ id: slugifyTeam(name), name, divisie: DIVISIES.SECOND_DIVISION, divisieId: POOLS.SECOND_DIVISION_B }));

const OFFICIAL_TEAMS = [
  ...TOPDIVISIE_TEAMS,
  ...SECOND_DIVISION_POOL_A_TEAMS,
  ...SECOND_DIVISION_POOL_B_TEAMS,
].map((team) => ({
  ...team,
  club: '',
  locale: 'nl',
  createdAt: '2025-08-01T00:00:00.000Z',
}));

function slugifyTeam(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildInitialTeams() {
  return OFFICIAL_TEAMS;
}

async function migrateLocalFilesToBlob() {
  if (!useBlob || migrationAttempted) {
    return;
  }
  
  migrationAttempted = true;
  console.log('Checking for local data files to migrate to blob storage...');
  
  const filesToMigrate = [
    { local: teamsFile, blob: 'teams.json' },
    { local: legacyMatchesFile, blob: 'matches.json' },
    ...ALL_DIVISIE_IDS.map(id => ({ local: matchesFileFor(id), blob: `matches-${id}.json` })),
  ];
  
  let migratedCount = 0;
  const deletedFiles = [];
  
  for (const { local, blob } of filesToMigrate) {
    try {
      // Check if blob already exists
      const exists = await blobExists(blob);
      if (exists) {
        console.log(`  ${blob} already exists in blob storage, skipping migration`);
        continue;
      }
      
      // Check if local file exists
      try {
        await fs.access(local);
      } catch {
        console.log(`  ${blob} - no local file to migrate`);
        continue;
      }
      
      // Read local file and upload to blob
      console.log(`  Migrating ${blob} to blob storage...`);
      const content = await fs.readFile(local, 'utf-8');
      const data = JSON.parse(content);
      await writeBlobFile(blob, data);
      console.log(`  ✅ Successfully migrated ${blob}`);
      
      // Delete local file after successful migration
      await fs.unlink(local);
      console.log(`  🗑️  Deleted local ${blob}`);
      deletedFiles.push(local);
      migratedCount++;
      
    } catch (err) {
      console.error(`  ❌ Error migrating ${blob}:`, err.message);
    }
  }
  
  // If all files were migrated and deleted, try to remove the data directory
  if (migratedCount > 0 && deletedFiles.length === filesToMigrate.length) {
    try {
      // Check if directory is empty (only .gitkeep or similar might remain)
      const remaining = await fs.readdir(dataDir);
      const nonHiddenFiles = remaining.filter(f => !f.startsWith('.'));
      if (nonHiddenFiles.length === 0) {
        // Directory is empty or only contains hidden files, safe to remove
        console.log('  All data files migrated. Note: backend/data directory kept for compatibility.');
      }
    } catch (err) {
      // Directory operations are not critical
    }
  }
  
  if (migratedCount > 0) {
    console.log(`✅ Migration complete: ${migratedCount} file(s) moved to blob storage`);
  } else {
    console.log('ℹ️  No files needed migration');
  }
}

function normalizeDivisieId(input) {
  const normalized = String(input || '');
  return ALL_DIVISIE_IDS.includes(normalized) ? normalized : POOLS.TOPDIVISIE;
}

function normalizeLegacyMatch(match) {
  const divisieId = normalizeDivisieId(match?.divisieId);
  const divisie =
    match?.divisie || (divisieId === POOLS.TOPDIVISIE ? DIVISIES.TOPDIVISIE : DIVISIES.SECOND_DIVISION);
  return {
    ...match,
    divisieId,
    divisie,
  };
}

function splitLegacyMatchesByDivisie(rawMatches) {
  const byDivisie = new Map(ALL_DIVISIE_IDS.map((id) => [id, []]));
  if (!Array.isArray(rawMatches)) return byDivisie;
  for (const match of rawMatches) {
    const normalized = normalizeLegacyMatch(match);
    byDivisie.get(normalized.divisieId).push(normalized);
  }
  return byDivisie;
}

function mergeUniqueById(existing, additions) {
  const result = Array.isArray(existing) ? [...existing] : [];
  const existingIds = new Set(result.map((m) => m?.id).filter(Boolean));
  let added = 0;
  for (const match of additions) {
    if (match?.id && existingIds.has(match.id)) continue;
    result.push(match);
    if (match?.id) existingIds.add(match.id);
    added++;
  }
  return { merged: result, added };
}

async function migrateLegacyMatches() {
  try {
    if (useBlob) {
      if (!(await blobExists('matches.json'))) return;
      const legacy = await readBlobFile('matches.json');
      const split = splitLegacyMatchesByDivisie(legacy);
      let migrated = 0;
      for (const divisieId of ALL_DIVISIE_IDS) {
        const blobName = `matches-${divisieId}.json`;
        const blobAlreadyExists = await blobExists(blobName);
        const existing = blobAlreadyExists ? await readBlobFile(blobName) : [];
        const { merged, added } = mergeUniqueById(existing, split.get(divisieId) || []);
        if (added > 0 || !blobAlreadyExists) {
          await writeBlobFile(blobName, merged);
        }
        migrated += added;
      }
      try {
        await deleteBlobFile('matches.json');
      } catch (err) {
        console.warn('Could not delete legacy matches.json blob:', err?.message || err);
      }
      if (migrated > 0) {
        console.log(`✅ Migrated ${migrated} legacy match row(s) from matches.json`);
      }
      return;
    }

    try {
      await fs.access(legacyMatchesFile);
    } catch {
      return;
    }

    const legacy = JSON.parse((await fs.readFile(legacyMatchesFile, 'utf-8')) || '[]');
    const split = splitLegacyMatchesByDivisie(legacy);
    let migrated = 0;
    for (const divisieId of ALL_DIVISIE_IDS) {
      const targetFile = matchesFileFor(divisieId);
      let existing = [];
      try {
        existing = JSON.parse((await fs.readFile(targetFile, 'utf-8')) || '[]');
      } catch {}
      const { merged, added } = mergeUniqueById(existing, split.get(divisieId) || []);
      if (added > 0) {
        await fs.writeFile(targetFile, JSON.stringify(merged, null, 2), 'utf-8');
      }
      migrated += added;
    }
    try {
      await fs.unlink(legacyMatchesFile);
    } catch (err) {
      console.warn('Could not delete legacy local matches.json:', err?.message || err);
    }
    if (migrated > 0) {
      console.log(`✅ Migrated ${migrated} legacy match row(s) from local matches.json`);
    }
  } catch (err) {
    console.warn('Legacy matches migration skipped due to error:', err?.message || err);
  }
}

async function ensureFiles() {
  if (useBlob) {
    // In blob mode, ensure files exist in blob storage
    await migrateLocalFilesToBlob();
    await migrateLegacyMatches();
    
    // Ensure teams.json exists in blob
    try {
      await readBlobFile('teams.json');
    } catch {
      console.log('Creating teams.json in blob storage...');
      await writeBlobFile('teams.json', buildInitialTeams());
    }
    
    // Ensure per-divisie match files exist in blob
    for (const divisieId of ALL_DIVISIE_IDS) {
      const blobName = `matches-${divisieId}.json`;
      try {
        await readBlobFile(blobName);
      } catch {
        console.log(`Creating ${blobName} in blob storage...`);
        await writeBlobFile(blobName, []);
      }
    }

    return;
  }
  
  // Local file mode (development)
  await fs.mkdir(dataDir, { recursive: true });
  // Ensure teams file exists; and keep it synced to the official list for visibility
  try {
    await fs.access(teamsFile);
    try {
      const current = JSON.parse(await fs.readFile(teamsFile, 'utf-8') || '[]');
      const names = (arr) => Array.isArray(arr) ? arr.map(t => t.name) : [];
      const a = names(current);
      const b = names(buildInitialTeams());
      const same = a.length === b.length && a.every((name, i) => name === b[i]);
      if (!same) {
        await fs.writeFile(teamsFile, JSON.stringify(buildInitialTeams(), null, 2), 'utf-8');
      }
    } catch {}
  } catch {
    await fs.writeFile(teamsFile, JSON.stringify(buildInitialTeams(), null, 2), 'utf-8');
  }
  await migrateLegacyMatches();
  // Ensure per-divisie match files exist
  for (const divisieId of ALL_DIVISIE_IDS) {
    const f = matchesFileFor(divisieId);
    try {
      await fs.access(f);
    } catch {
      await fs.writeFile(f, JSON.stringify([], null, 2), 'utf-8');
    }
  }
}

async function readJson(file) {
  await ensureFiles();
  
  if (useBlob) {
    return await readBlobFile(basename(file));
  }
  
  // Local file mode
  const buf = await fs.readFile(file, 'utf-8');
  return JSON.parse(buf || '[]');
}

async function writeJson(file, data) {
  await ensureFiles();
  
  if (useBlob) {
    await writeBlobFile(basename(file), data);
    return;
  }
  
  // Local file mode
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

// Teams
export async function listTeams(options = {}) {
  const { divisieId, divisie } = options;
  const normalizedDivisieId = divisieId ? String(divisieId) : null;
  // Always return the official teams; do not allow runtime changes
  return OFFICIAL_TEAMS
    .filter((team) => !normalizedDivisieId || String(team.divisieId) === normalizedDivisieId)
    .filter((team) => !divisie || team.divisie === divisie)
    .map((team) => ({ ...team }));
}

// Team creation is intentionally disabled; teams are seeded from the official list on first run.

// Matches
export async function listMatches(options = {}) {
  const { divisieId } = options;
  const normalizedDivisieId = divisieId ? String(divisieId) : null;
  let raw;
  if (normalizedDivisieId) {
    raw = await readJson(matchesFileFor(normalizedDivisieId));
  } else {
    const parts = await Promise.all(ALL_DIVISIE_IDS.map(id => readJson(matchesFileFor(id))));
    raw = parts.flat();
  }
  const matches = normalizeMatches(raw);
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  const teams = await listTeams({ divisieId: normalizedDivisieId });
  const byId = new Map(teams.map((t) => [t.id, t]));
  // Enrich with names for convenience
  return matches.map((m) => ({
    ...m,
    homeTeam: byId.get(m.homeTeamId) || null,
    awayTeam: byId.get(m.awayTeamId) || null,
  }));
}

export async function createMatch(input) {
  const match = {
    id: randomUUID(),
    date: input.date || new Date().toISOString(),
    fixtureId: input.fixtureId || null,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeScore: Number(input.homeScore ?? 0),
    awayScore: Number(input.awayScore ?? 0),
    divisieId: String(input.divisieId || POOLS.TOPDIVISIE),
    divisie: input.divisie || (String(input.divisieId || POOLS.TOPDIVISIE) === POOLS.TOPDIVISIE ? DIVISIES.TOPDIVISIE : DIVISIES.SECOND_DIVISION),
    createdAt: new Date().toISOString(),
    submittedBy: input.submittedBy || null,
    submittedByUid: input.submittedByUid || null,
  };
  const file = matchesFileFor(match.divisieId);
  return withLock(file, async () => {
    const matches = await readJson(file);
    matches.push(match);
    await writeJson(file, matches);
    return match;
  });
}

export async function computeStandings(options = {}) {
  const { divisieId, divisie } = options;
  const normalizedDivisieId = divisieId ? String(divisieId) : null;
  const teams = await listTeams({ divisieId: normalizedDivisieId, divisie });
  let rawMatches;
  if (normalizedDivisieId) {
    rawMatches = await readJson(matchesFileFor(normalizedDivisieId));
  } else {
    const parts = await Promise.all(ALL_DIVISIE_IDS.map(id => readJson(matchesFileFor(id))));
    rawMatches = parts.flat();
  }
  // All stored matches are considered completed
  const completed = normalizeMatches(rawMatches);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const table = new Map();

  const ensure = (teamId) => {
    if (!table.has(teamId)) {
      const t = byId.get(teamId) || { id: teamId, name: 'Unknown' };
      table.set(teamId, {
        teamId: t.id,
        name: t.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        points: 0,
        goalFor: 0,
        goalAgainst: 0,
        goalDiff: 0,
      });
    }
    return table.get(teamId);
  };

  for (const m of completed) {
    const home = ensure(m.homeTeamId);
    const away = ensure(m.awayTeamId);
    home.played++; away.played++;
    home.goalFor += m.homeScore; home.goalAgainst += m.awayScore;
    away.goalFor += m.awayScore; away.goalAgainst += m.homeScore;
    home.goalDiff = home.goalFor - home.goalAgainst;
    away.goalDiff = away.goalFor - away.goalAgainst;
    // Standings points: Winner gets 2 points, loser gets 0 points
    if (m.homeScore > m.awayScore) { home.won++; home.points += 2; away.lost++; }
    else if (m.homeScore < m.awayScore) { away.won++; away.points += 2; home.lost++; }
    else {
      // Draws are not expected (scores sum to 31 with integer inputs), but handle defensively.
      home.drawn++; away.drawn++;
      // If a draw somehow occurs, award 1 point each as a neutral fallback.
      home.points += 1; away.points += 1;
    }
  }

  // Prepare rows, rank by: 1) points (desc), 2) points difference (goalDiff) (desc), then name.
  const rows = Array.from(table.values()).sort((a, b) =>
    b.points - a.points || b.goalDiff - a.goalDiff || a.name.localeCompare(b.name)
  );
  // Remove fields that should not be exposed: drawn, goalFor (+P), goalAgainst (-P)
  return rows.map(({ drawn, goalFor, goalAgainst, ...out }) => out);
}

function normalizeMatches(matches) {
  return Array.isArray(matches)
    ? matches.map((match) => {
      if (match && match.divisieId) {
        return match;
      }
      return {
        ...match,
        divisieId: POOLS.TOPDIVISIE,
        divisie: DIVISIES.TOPDIVISIE,
      };
    })
    : [];
}

export async function storageHealth() {
  try {
    await ensureFiles();
    await withLock(teamsFile, async () => {
      const t = await readJson(teamsFile);
      await writeJson(teamsFile, t);
    });
    return { ok: true, readable: true, writable: true, type: 'file' };
  } catch (e) {
    return { ok: false, error: e.message, type: 'file' };
  }
}

// Delete a single match result by id; returns true if deleted, false if not found
export async function deleteMatch(id) {
  if (!id) return false;
  for (const divisieId of ALL_DIVISIE_IDS) {
    const file = matchesFileFor(divisieId);
    const found = await withLock(file, async () => {
      const matches = await readJson(file);
      const idx = matches.findIndex((m) => m.id === id);
      if (idx === -1) return false;
      matches.splice(idx, 1);
      await writeJson(file, matches);
      return true;
    });
    if (found) return true;
  }
  return false;
}
