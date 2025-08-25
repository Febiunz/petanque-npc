import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = `${__dirname}/../data`;
const teamsFile = `${dataDir}/teams.json`;
const matchesFile = `${dataDir}/matches.json`;

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

const OFFICIAL_TEAMS = [
  { id: 'amicale-boule-d-argent-1', name: "Amicale Boule d'Argent 1" },
  { id: 'boul-animo-1', name: "Boul'Animo 1" },
  { id: 'cdp-les-cailloux-1', name: 'CdP Les Cailloux 1' },
  { id: 'jbc-t-dupke-1', name: "JBC 't Dupke 1" },
  { id: 'jeu-de-bommel-1', name: 'Jeu de Bommel 1' },
  { id: 'petangeske-1', name: 'Petangeske 1' },
  { id: 'puk-haarlem-1', name: 'PUK-Haarlem 1' },
  { id: 't-zwijntje-1', name: "'t Zwijntje 1" },
].map(t => ({ ...t, club: '', locale: 'nl', createdAt: '2025-08-01T00:00:00.000Z' }));

function buildInitialTeams() {
  return OFFICIAL_TEAMS;
}

async function ensureFiles() {
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
  // Ensure matches file exists
  try {
    await fs.access(matchesFile);
  } catch {
    await fs.writeFile(matchesFile, JSON.stringify([], null, 2), 'utf-8');
  }
}

async function readJson(file) {
  await ensureFiles();
  const buf = await fs.readFile(file, 'utf-8');
  return JSON.parse(buf || '[]');
}

async function writeJson(file, data) {
  await ensureFiles();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

// Teams
export async function listTeams() {
  // Always return the official teams; do not allow runtime changes
  return [...OFFICIAL_TEAMS];
}

// Team creation is intentionally disabled; teams are seeded from the official list on first run.

// Matches
export async function listMatches() {
  const matches = await readJson(matchesFile);
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  const teams = await listTeams();
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
    status: input.status || 'scheduled',
    createdAt: new Date().toISOString(),
    submittedBy: input.submittedBy || null,
    submittedByUid: input.submittedByUid || null,
  };
  return withLock(matchesFile, async () => {
    const matches = await readJson(matchesFile);
    matches.push(match);
    await writeJson(matchesFile, matches);
    return match;
  });
}

export async function computeStandings() {
  const teams = await listTeams();
  const matches = await readJson(matchesFile);
  const completed = matches.filter((m) => m.status === 'completed');
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
