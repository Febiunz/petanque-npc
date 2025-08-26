import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTeams } from './fileStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = `${__dirname}/../data`;
const fixturesFile = `${dataDir}/fixtures.json`;

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function slugId(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function roundRobinDouble(teamIds) {
  // Berger tables; if odd, add bye (not needed for even 8)
  const n = teamIds.length;
  const teams = [...teamIds];
  const fixed = teams[0];
  let rotating = teams.slice(1);
  const rounds = [];
  const half = n - 1; // 7 rounds per half
  for (let r = 0; r < half; r++) {
    const pairings = [];
    const left = [fixed, ...rotating.slice(0, (n/2) - 1)];
    const right = [...rotating.slice((n/2) - 1)].reverse();
    for (let i = 0; i < left.length; i++) {
      const a = left[i];
      const b = right[i];
      // Alternate home/away to spread fairly
      const home = (r % 2 === 0) ? a : b;
      const away = (r % 2 === 0) ? b : a;
      pairings.push({ homeTeamId: home, awayTeamId: away });
    }
    rounds.push(pairings);
    // rotate
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }
  // second half swaps home/away
  const second = rounds.map(pairs => pairs.map(p => ({ homeTeamId: p.awayTeamId, awayTeamId: p.homeTeamId })));
  return rounds.concat(second); // total 14 rounds
}

function makeFixtureId(round, homeTeamId, awayTeamId) {
  return `r${round}-${homeTeamId}-${awayTeamId}`;
}

// --- Official fixtures scraping ---
const OFFICIAL_URL = 'https://nlpetanque.nl/topdivisie-2025-2026-1001/';

const MONTHS_NL = {
  'JANUARI': 1,
  'FEBRUARI': 2,
  'MAART': 3,
  'APRIL': 4,
  'MEI': 5,
  'JUNI': 6,
  'JULI': 7,
  'AUGUSTUS': 8,
  'SEPTEMBER': 9,
  'OKTOBER': 10,
  'NOVEMBER': 11,
  'DECEMBER': 12,
};

function toIsoDate(day, monthName) {
  const m = MONTHS_NL[monthName?.toUpperCase()?.trim()] || null;
  if (!m) return null;
  // Season 2025-2026: Sep-Dec -> 2025, Jan-Mar -> 2026
  const year = m >= 9 ? 2025 : 2026;
  const dd = String(Number(day)).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function cleanHtmlToLines(html) {
  // Remove scripts/styles (repeat removal to fully sanitize)
  let s = html;
  let prev;
  do {
    prev = s;
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  } while (s !== prev);
  // Normalize table boundaries to new lines
  s = s.replace(/<\/(tr|table|h\d)>/gi, '\n');
  // Turn tags into separators
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, '|');
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities minimally
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  // Collapse spaces
  s = s.replace(/\s+/g, ' ').replace(/\|\s*\|/g, '|');
  // Split to lines; also keep separators between rows
  return s.split(/\n+/).map(l => l.trim()).filter(Boolean);
}

async function tryFetchOfficialHtml() {
  try {
    const res = await fetch(OFFICIAL_URL, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error("Error fetching official fixtures HTML:", e);
    return null;
  }
}

async function parseOfficialFixtures(html) {
  const teams = await listTeams();
  const teamNames = teams.map(t => t.name);
  const nameToId = new Map(teams.map(t => [t.name, t.id]));
  const lines = cleanHtmlToLines(html);
  const fixtures = [];
  let currentRound = null;
  let roundDefaultDate = null; // ISO

  // Helper: find first two team names from a list of cells
  function findTeamsAfterIndex(cells, startIdx) {
    const found = [];
    for (let i = startIdx + 1; i < cells.length; i++) {
      const c = cells[i].trim();
      if (teamNames.includes(c)) {
        found.push(c);
        if (found.length === 2) break;
      }
    }
    return found.length === 2 ? found : null;
  }

  for (const raw of lines) {
    // Round header example: "1. ZATERDAG 20 SEPTEMBER" (may include other words)
    const hdr = raw.match(/(\d+)\.[^\d]*?(?:ZATERDAG|ZONDAG)\s+(\d{1,2})\s+([A-ZÀ-Ü]+)/i);
    if (hdr) {
      currentRound = Number(hdr[1]);
      roundDefaultDate = toIsoDate(hdr[2], hdr[3]);
      continue;
    }

    // Match row detection; we expect a pipe-delimited line with match number 1001xx
    if (!/1001\d{2}/.test(raw)) continue;
    const cells = raw.split('|').map(c => c.trim()).filter(c => c.length > 0);
    const numIdx = cells.findIndex(c => /^1001\d{2}$/.test(c));
    if (numIdx === -1) continue;

    const matchNumber = cells[numIdx];
    // Optional adapted date cell (dd-mm-yyyy) located after number; find any date in the row
    const dateCell = cells.slice(numIdx + 1).find(c => /\b\d{2}-\d{2}-\d{4}\b/.test(c));
    let dateIso = null;
    if (dateCell) {
      const [d, m, y] = dateCell.split('-');
      dateIso = `${y}-${m}-${d}`;
    } else {
      dateIso = roundDefaultDate;
    }

    const tnames = findTeamsAfterIndex(cells, numIdx);
    if (!tnames || currentRound == null) continue;
    const [homeName, awayName] = tnames;
    const homeId = nameToId.get(homeName);
    const awayId = nameToId.get(awayName);
    if (!homeId || !awayId) continue;

    fixtures.push({
      id: matchNumber,
      matchNumber,
      round: currentRound,
      date: dateIso || null,
      homeTeamId: homeId,
      awayTeamId: awayId,
      status: 'scheduled',
    });
  }

  // Expect 56 matches (14 rounds * 4)
  if (fixtures.length >= 40) {
    // Sort by matchNumber for consistency
    fixtures.sort((a, b) => Number(a.matchNumber) - Number(b.matchNumber));
    return fixtures;
  }
  return null;
}

// Fallback: embedded official fixtures (matchNumber, round, home/away) with round default dates
function officialFixturesStatic() {
  const byName = new Map();
  const mapName = (n) => n;
  const rounds = [
    { round: 1, date: toIsoDate(20, 'SEPTEMBER'), matches: [
      ['100101', "Boul'Animo 1", "JBC 't Dupke 1"],
      ['100102', 'PUK-Haarlem 1', "'t Zwijntje 1"],
      ['100103', "Amicale Boule d'Argent 1", 'Petangeske 1'],
      ['100104', 'Jeu de Bommel 1', 'CdP Les Cailloux 1'],
    ]},
    { round: 2, date: toIsoDate(4, 'OKTOBER'), matches: [
      ['100105', 'Jeu de Bommel 1', "Amicale Boule d'Argent 1"],
      ['100106', 'Petangeske 1', 'PUK-Haarlem 1'],
      ['100107', "'t Zwijntje 1", "Boul'Animo 1"],
      ['100108', "JBC 't Dupke 1", 'CdP Les Cailloux 1'],
    ]},
    { round: 3, date: toIsoDate(18, 'OKTOBER'), matches: [
      ['100109', 'CdP Les Cailloux 1', "Amicale Boule d'Argent 1"],
      ['100110', 'PUK-Haarlem 1', 'Jeu de Bommel 1'],
      ['100111', 'Petangeske 1', "Boul'Animo 1"],
      ['100112', "JBC 't Dupke 1", "'t Zwijntje 1"],
    ]},
    { round: 4, date: toIsoDate(1, 'NOVEMBER'), matches: [
      ['100113', "Boul'Animo 1", 'Jeu de Bommel 1'],
      ['100114', 'PUK-Haarlem 1', 'CdP Les Cailloux 1'],
      ['100115', "Amicale Boule d'Argent 1", "JBC 't Dupke 1"],
      ['100116', "'t Zwijntje 1", 'Petangeske 1'],
    ]},
    { round: 5, date: toIsoDate(15, 'NOVEMBER'), matches: [
      ['100117', "Amicale Boule d'Argent 1", 'PUK-Haarlem 1'],
      ['100118', 'CdP Les Cailloux 1', "Boul'Animo 1"],
      ['100119', 'Jeu de Bommel 1', "'t Zwijntje 1"],
      ['100120', 'Petangeske 1', "JBC 't Dupke 1"],
    ]},
    { round: 6, date: toIsoDate(29, 'NOVEMBER'), matches: [
      ['100121', "Boul'Animo 1", "Amicale Boule d'Argent 1"],
      ['100122', 'Petangeske 1', 'Jeu de Bommel 1'],
      ['100123', "'t Zwijntje 1", 'CdP Les Cailloux 1'],
      ['100124', "JBC 't Dupke 1", 'PUK-Haarlem 1'],
    ]},
    { round: 7, date: toIsoDate(6, 'DECEMBER'), matches: [
      ['100125', "Boul'Animo 1", 'PUK-Haarlem 1'],
      ['100126', "Amicale Boule d'Argent 1", "'t Zwijntje 1"],
      ['100127', 'CdP Les Cailloux 1', 'Petangeske 1'],
      ['100128', 'Jeu de Bommel 1', "JBC 't Dupke 1"],
    ]},
    { round: 8, date: toIsoDate(10, 'JANUARI'), matches: [
      ['100129', 'CdP Les Cailloux 1', 'Jeu de Bommel 1'],
      ['100130', 'Petangeske 1', "Amicale Boule d'Argent 1"],
      ['100131', "'t Zwijntje 1", 'PUK-Haarlem 1'],
      ['100132', "JBC 't Dupke 1", "Boul'Animo 1"],
    ]},
    { round: 9, date: toIsoDate(24, 'JANUARI'), matches: [
      ['100133', "Boul'Animo 1", "'t Zwijntje 1"],
      ['100134', 'PUK-Haarlem 1', 'Petangeske 1'],
      ['100135', "Amicale Boule d'Argent 1", 'Jeu de Bommel 1'],
      ['100136', 'CdP Les Cailloux 1', "JBC 't Dupke 1"],
    ]},
    { round: 10, date: toIsoDate(7, 'FEBRUARI'), matches: [
      ['100137', "Boul'Animo 1", 'Petangeske 1'],
      ['100138', 'Jeu de Bommel 1', 'PUK-Haarlem 1'],
      ['100139', "Amicale Boule d'Argent 1", 'CdP Les Cailloux 1'],
      ['100140', "'t Zwijntje 1", "JBC 't Dupke 1"],
    ]},
    { round: 11, date: toIsoDate(21, 'FEBRUARI'), matches: [
      ['100141', 'CdP Les Cailloux 1', 'PUK-Haarlem 1'],
      ['100142', 'Jeu de Bommel 1', "Boul'Animo 1"],
      ['100143', 'Petangeske 1', "'t Zwijntje 1"],
      ['100144', "JBC 't Dupke 1", "Amicale Boule d'Argent 1"],
    ]},
    { round: 12, date: toIsoDate(7, 'MAART'), matches: [
      ['100145', "Boul'Animo 1", 'CdP Les Cailloux 1'],
      ['100146', 'PUK-Haarlem 1', "Amicale Boule d'Argent 1"],
      ['100147', "'t Zwijntje 1", 'Jeu de Bommel 1'],
      ['100148', "JBC 't Dupke 1", 'Petangeske 1'],
    ]},
    { round: 13, date: toIsoDate(21, 'MAART'), matches: [
      ['100149', 'PUK-Haarlem 1', "JBC 't Dupke 1"],
      ['100150', "Amicale Boule d'Argent 1", "Boul'Animo 1"],
      ['100151', 'CdP Les Cailloux 1', "'t Zwijntje 1"],
      ['100152', 'Jeu de Bommel 1', 'Petangeske 1'],
    ]},
    { round: 14, date: toIsoDate(28, 'MAART'), matches: [
      ['100153', 'PUK-Haarlem 1', "Boul'Animo 1"],
      ['100154', 'Petangeske 1', 'CdP Les Cailloux 1'],
      ['100155', "'t Zwijntje 1", "Amicale Boule d'Argent 1"],
      ['100156', "JBC 't Dupke 1", 'Jeu de Bommel 1'],
    ]},
  ];
  const nameToId = new Map([
    ["Amicale Boule d'Argent 1", 'amicale-boule-d-argent-1'],
    ["Boul'Animo 1", 'boul-animo-1'],
    ['CdP Les Cailloux 1', 'cdp-les-cailloux-1'],
    ["JBC 't Dupke 1", 'jbc-t-dupke-1'],
    ['Jeu de Bommel 1', 'jeu-de-bommel-1'],
    ['Petangeske 1', 'petangeske-1'],
    ['PUK-Haarlem 1', 'puk-haarlem-1'],
    ["'t Zwijntje 1", 't-zwijntje-1'],
  ]);
  const out = [];
  for (const r of rounds) {
    for (const [num, homeName, awayName] of r.matches) {
      out.push({
        id: num,
        matchNumber: num,
        round: r.round,
        date: r.date,
        homeTeamId: nameToId.get(homeName),
        awayTeamId: nameToId.get(awayName),
        status: 'scheduled',
      });
    }
  }
  return out;
}

export async function ensureFixtures() {
  await ensureDir();
  // If we already have fixtures cached, keep them, otherwise try fetch
  let exists = true;
  try { await fs.access(fixturesFile); } catch { exists = false; }

  if (!exists) {
    // Try to fetch and parse official fixtures
    const html = await tryFetchOfficialHtml();
    if (html) {
      const fixtures = await parseOfficialFixtures(html);
      if (fixtures) {
        await fs.writeFile(fixturesFile, JSON.stringify(fixtures, null, 2), 'utf-8');
        return;
      }
    }
    // Fallback: embedded official fixtures; if that ever fails, fallback to algorithmic
    let fixtures = officialFixturesStatic();
    if (!fixtures || fixtures.length === 0) {
      const teams = await listTeams();
      const teamIds = teams.map(t => t.id);
      const rounds = roundRobinDouble(teamIds);
      fixtures = [];
      for (let r = 0; r < rounds.length; r++) {
        const round = r + 1;
        for (const p of rounds[r]) {
          fixtures.push({
            id: makeFixtureId(round, p.homeTeamId, p.awayTeamId),
            matchNumber: null,
            round,
            date: null,
            homeTeamId: p.homeTeamId,
            awayTeamId: p.awayTeamId,
            status: 'scheduled',
          });
        }
      }
    }
    await fs.writeFile(fixturesFile, JSON.stringify(fixtures, null, 2), 'utf-8');
  }

  // Try to migrate existing fixtures to official format if needed
  if (exists) {
    try {
      const buf = await fs.readFile(fixturesFile, 'utf-8');
      const current = JSON.parse(buf || '[]');
      const needsUpgrade = Array.isArray(current) && current.length > 0 && (
        current.every(f => !('matchNumber' in f)) ||
        current.every(f => typeof f.id === 'string' && /^r\d-/.test(f.id))
      );
      if (needsUpgrade) {
        let fixtures = null;
        const html = await tryFetchOfficialHtml();
        if (html) {
          fixtures = await parseOfficialFixtures(html);
        }
        if (!fixtures) {
          fixtures = officialFixturesStatic();
        }
        if (fixtures && fixtures.length) {
          await fs.writeFile(fixturesFile, JSON.stringify(fixtures, null, 2), 'utf-8');
        }
      }
    } catch {}
  }
}

export async function listFixtures() {
  await ensureFixtures();
  const buf = await fs.readFile(fixturesFile, 'utf-8');
  return JSON.parse(buf || '[]');
}

export async function getFixture(fixtureId) {
  const fixtures = await listFixtures();
  return fixtures.find(f => f.id === fixtureId) || null;
}

export async function markFixtureCompleted(fixtureId) {
  const fixtures = await listFixtures();
  const idx = fixtures.findIndex(f => f.id === fixtureId);
  if (idx >= 0) {
    fixtures[idx].status = 'completed';
    await fs.writeFile(fixturesFile, JSON.stringify(fixtures, null, 2), 'utf-8');
  }
}
