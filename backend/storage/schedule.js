import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIVISIES, listTeams, POOLS } from './fileStore.js';
import { readBlobFile, writeBlobFile, deleteBlobFile } from './blobStorage.js';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Use blob storage if AZURE_STORAGE_CONNECTION_STRING is set, otherwise use local file
const useBlob = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const dataDir = process.env.SCHEDULE_DATA_DIR || `${__dirname}/../data`;
const scheduleFileFor = (divisieId) => `${dataDir}/schedule-${divisieId}.json`;
const legacyScheduleFile = `${dataDir}/schedule.json`;
const ALLOWED_DIVISIE_IDS = new Set(Object.values(POOLS).map(String));
let legacyScheduleMigrationAttempted = false;

function normalizeDivisieIdOrThrow(divisieId) {
  const normalized = String(divisieId || '');
  if (!ALLOWED_DIVISIE_IDS.has(normalized)) {
    throw new Error('Invalid divisieId');
  }
  return normalized;
}

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function roundRobinDouble(teamIds) {
  const n = teamIds.length;
  const teams = [...teamIds];
  const fixed = teams[0];
  let rotating = teams.slice(1);
  const rounds = [];
  const half = n - 1;
  for (let r = 0; r < half; r++) {
    const pairings = [];
    const left = [fixed, ...rotating.slice(0, (n/2) - 1)];
    const right = [...rotating.slice((n/2) - 1)].reverse();
    for (let i = 0; i < left.length; i++) {
      const a = left[i];
      const b = right[i];
      const home = (r % 2 === 0) ? a : b;
      const away = (r % 2 === 0) ? b : a;
      pairings.push({ homeTeamId: home, awayTeamId: away });
    }
    rounds.push(pairings);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }
  const second = rounds.map(pairs => pairs.map(p => ({ homeTeamId: p.awayTeamId, awayTeamId: p.homeTeamId })));
  return rounds.concat(second);
}

const POOL_CONFIGS = [
  {
    divisieId: POOLS.TOPDIVISIE,
    divisie: DIVISIES.TOPDIVISIE,
    matchPrefix: '1001',
  },
  {
    divisieId: POOLS.SECOND_DIVISION_A,
    divisie: DIVISIES.SECOND_DIVISION,
    matchPrefix: '2001',
  },
  {
    divisieId: POOLS.SECOND_DIVISION_B,
    divisie: DIVISIES.SECOND_DIVISION,
    matchPrefix: '2002',
  },
];

export async function ensureSchedule() {
  await migrateLegacySchedule();
  if (useBlob) {
    // Ensure each divisie's schedule exists in blob storage
    for (const config of POOL_CONFIGS) {
      const blobName = `schedule-${config.divisieId}.json`;
      try {
        const existing = await readBlobFile(blobName);
        const normalized = normalizeScheduleRows(existing);
        if (normalized.length) continue; // already has data
      } catch {
        // doesn't exist yet
      }
      const rows = await buildAlgorithmicSchedule(config);
      await writeBlobFile(blobName, rows);
    }
    return;
  }

  // Local file storage
  await ensureDir();
  for (const config of POOL_CONFIGS) {
    const file = scheduleFileFor(config.divisieId);
    let exists = true;
    try { await fs.access(file); } catch { exists = false; }

    if (!exists) {
      const rows = await buildAlgorithmicSchedule(config);
      await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf-8');
    } else {
      const existing = JSON.parse(await fs.readFile(file, 'utf-8') || '[]');
      const normalized = normalizeScheduleRows(existing);
      if (!normalized.length) {
        const rows = await buildAlgorithmicSchedule(config);
        await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf-8');
      }
    }
  }
}

async function migrateLegacySchedule() {
  if (legacyScheduleMigrationAttempted) return;
  legacyScheduleMigrationAttempted = true;
  const targetDivisieId = POOLS.TOPDIVISIE;
  const targetName = `schedule-${targetDivisieId}.json`;

  if (useBlob) {
    let legacy = null;
    try {
      legacy = await readBlobFile('schedule.json');
    } catch {
      return;
    }
    const normalizedLegacy = normalizeScheduleRows(legacy);
    if (!normalizedLegacy.length) return;

    let current = [];
    try {
      current = normalizeScheduleRows(await readBlobFile(targetName));
    } catch {}
    if (!current.length) {
      await writeBlobFile(targetName, normalizedLegacy);
    }
    try {
      await deleteBlobFile('schedule.json');
    } catch {}
    return;
  }

  try {
    await fs.access(legacyScheduleFile);
  } catch {
    return;
  }

  const normalizedLegacy = normalizeScheduleRows(
    JSON.parse((await fs.readFile(legacyScheduleFile, 'utf-8')) || '[]')
  );
  if (!normalizedLegacy.length) return;
  const targetFile = scheduleFileFor(targetDivisieId);
  let current = [];
  try {
    current = normalizeScheduleRows(JSON.parse((await fs.readFile(targetFile, 'utf-8')) || '[]'));
  } catch {}
  if (!current.length) {
    await fs.writeFile(targetFile, JSON.stringify(normalizedLegacy, null, 2), 'utf-8');
  }
  try {
    await fs.unlink(legacyScheduleFile);
  } catch {}
}

async function buildAlgorithmicSchedule(poolConfig) {
  const teams = await listTeams({ divisieId: poolConfig.divisieId });
  const teamIds = teams.map((team) => team.id);
  const rounds = roundRobinDouble(teamIds);
  const out = [];
  let sequence = 1;
  for (let r = 0; r < rounds.length; r++) {
    const round = r + 1;
    for (const pairing of rounds[r]) {
      const matchNumber = `${poolConfig.matchPrefix}${String(sequence).padStart(2, '0')}`;
      out.push({
        id: matchNumber,
        matchNumber,
        round,
        date: null,
        homeTeamId: pairing.homeTeamId,
        awayTeamId: pairing.awayTeamId,
        divisieId: poolConfig.divisieId,
        divisie: poolConfig.divisie,
      });
      sequence += 1;
    }
  }
  return out;
}

export async function listSchedule(options = {}) {
  const { divisieId, divisie } = options;
  await ensureSchedule();

  const safeDivisieId = divisieId ? normalizeDivisieIdOrThrow(divisieId) : null;
  let raw;
  if (safeDivisieId) {
    if (useBlob) {
      raw = await readBlobFile(`schedule-${safeDivisieId}.json`);
    } else {
      const buf = await fs.readFile(scheduleFileFor(safeDivisieId), 'utf-8');
      raw = JSON.parse(buf || '[]');
    }
  } else {
    const allRaw = await Promise.all(POOL_CONFIGS.map(async (config) => {
      if (useBlob) {
        try { return await readBlobFile(`schedule-${config.divisieId}.json`); } catch { return []; }
      } else {
        const buf = await fs.readFile(scheduleFileFor(config.divisieId), 'utf-8').catch(() => '[]');
        return JSON.parse(buf || '[]');
      }
    }));
    raw = allRaw.flat();
  }

  // Sanitize: drop any legacy 'status' fields and persist cleaned file
  let changed = false;
  const cleaned = Array.isArray(raw) ? raw.map((m) => {
    if (m && Object.prototype.hasOwnProperty.call(m, 'status')) { const { status, ...rest } = m; changed = true; return rest; }
    return m;
  }) : [];

  if (changed && safeDivisieId) {
    if (useBlob) {
      await writeBlobFile(`schedule-${safeDivisieId}.json`, cleaned);
    } else {
      await fs.writeFile(scheduleFileFor(safeDivisieId), JSON.stringify(cleaned, null, 2), 'utf-8');
    }
  }

  const normalized = normalizeScheduleRows(cleaned);
  return normalized
    .filter((match) => !safeDivisieId || String(match.divisieId) === String(safeDivisieId))
    .filter((match) => !divisie || match.divisie === divisie);
}

function normalizeScheduleRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  return source.map((match) => ({
    ...match,
    divisieId: String(match.divisieId || inferDivisieId(match.id)),
    divisie: match.divisie || inferDivisie(match.divisieId || inferDivisieId(match.id)),
  }));
}

function inferDivisieId(matchId) {
  const value = String(matchId || '');
  if (value.startsWith('2002')) return POOLS.SECOND_DIVISION_B;
  if (value.startsWith('2001')) return POOLS.SECOND_DIVISION_A;
  return POOLS.TOPDIVISIE;
}

function inferDivisie(divisieId) {
  return String(divisieId) === POOLS.TOPDIVISIE ? DIVISIES.TOPDIVISIE : DIVISIES.SECOND_DIVISION;
}

export async function getScheduledMatch(matchId, options = {}) {
  const schedule = await listSchedule({ divisieId: options.divisieId });
  return schedule.find(m => m.id === matchId) || null;
}
