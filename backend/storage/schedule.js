import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTeams } from './fileStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = `${__dirname}/../data`;
const scheduleFile = `${dataDir}/schedule.json`;

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

// --- Official schedule scraping ---
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
  const year = m >= 9 ? 2025 : 2026;
  const dd = String(Number(day)).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function cleanHtmlToLines(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<\/(tr|table|h\d)>/gi, '\n');
  s = s.replace(/<br\s*\/?>(?=.)/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, '|');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  s = s.replace(/\s+/g, ' ').replace(/\|\s*\|/g, '|');
  return s.split(/\n+/).map(l => l.trim()).filter(Boolean);
}

async function tryFetchOfficialHtml() {
  try {
    const res = await fetch(OFFICIAL_URL, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    return null;
  }
}

async function parseOfficialSchedule(html) {
  const teams = await listTeams();
  const teamNames = teams.map(t => t.name);
  const nameToId = new Map(teams.map(t => [t.name, t.id]));
  const lines = cleanHtmlToLines(html);
  const schedule = [];
  let currentRound = null;
  let roundDefaultDate = null;

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
    const hdr = raw.match(/(\d+)\.[^\d]*?(?:ZATERDAG|ZONDAG)\s+(\d{1,2})\s+([A-ZÀ-Ü]+)/i);
    if (hdr) { currentRound = Number(hdr[1]); roundDefaultDate = toIsoDate(hdr[2], hdr[3]); continue; }

    if (!/1001\d{2}/.test(raw)) continue;
    const cells = raw.split('|').map(c => c.trim()).filter(c => c.length > 0);
    const numIdx = cells.findIndex(c => /^1001\d{2}$/.test(c));
    if (numIdx === -1) continue;

    const matchNumber = cells[numIdx];
    const dateCell = cells.slice(numIdx + 1).find(c => /\b\d{2}-\d{2}-\d{4}\b/.test(c));
    let dateIso = null;
    if (dateCell) { const [d, m, y] = dateCell.split('-'); dateIso = `${y}-${m}-${d}`; } else { dateIso = roundDefaultDate; }

    const tnames = findTeamsAfterIndex(cells, numIdx);
    if (!tnames || currentRound == null) continue;
    const [homeName, awayName] = tnames;
    const homeId = nameToId.get(homeName);
    const awayId = nameToId.get(awayName);
    if (!homeId || !awayId) continue;

    schedule.push({
      id: matchNumber,
      matchNumber,
      round: currentRound,
      date: dateIso || null,
      homeTeamId: homeId,
      awayTeamId: awayId,
      status: 'scheduled',
    });
  }

  if (schedule.length >= 40) {
    schedule.sort((a, b) => Number(a.matchNumber) - Number(b.matchNumber));
    return schedule;
  }
  return null;
}

function officialScheduleStatic() {
  // Reuse logic by importing JSON from existing fixtures file if present
  return [
    // Keep empty; we'll fallback to read from fixtures.json if it exists
  ];
}

export async function ensureSchedule() {
  await ensureDir();
  let exists = true;
  try { await fs.access(scheduleFile); } catch { exists = false; }

  if (!exists) {
    const html = await tryFetchOfficialHtml();
    if (html) {
      const schedule = await parseOfficialSchedule(html);
      if (schedule) { await fs.writeFile(scheduleFile, JSON.stringify(schedule, null, 2), 'utf-8'); return; }
    }
    // Fallback: try old fixtures.json if present
    try {
      const fixturesBuf = await fs.readFile(`${dataDir}/fixtures.json`, 'utf-8');
      const fixtures = JSON.parse(fixturesBuf || '[]');
      if (Array.isArray(fixtures) && fixtures.length) {
        await fs.writeFile(scheduleFile, JSON.stringify(fixtures, null, 2), 'utf-8');
        return;
      }
    } catch {}
    // Last resort: algorithmic schedule
    const teamIds = (await listTeams()).map(t => t.id);
    const rounds = roundRobinDouble(teamIds);
    const out = [];
    for (let r = 0; r < rounds.length; r++) {
      const round = r + 1;
      for (const p of rounds[r]) {
        out.push({ id: `r${round}-${p.homeTeamId}-${p.awayTeamId}`, matchNumber: null, round, date: null, homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId, status: 'scheduled' });
      }
    }
    await fs.writeFile(scheduleFile, JSON.stringify(out, null, 2), 'utf-8');
  }
}

export async function listSchedule() {
  await ensureSchedule();
  const buf = await fs.readFile(scheduleFile, 'utf-8');
  return JSON.parse(buf || '[]');
}

export async function getScheduledMatch(matchId) {
  const schedule = await listSchedule();
  return schedule.find(m => m.id === matchId) || null;
}

export async function markScheduledMatchCompleted(matchId) {
  const schedule = await listSchedule();
  const idx = schedule.findIndex(m => m.id === matchId);
  if (idx >= 0) {
    schedule[idx].status = 'completed';
    await fs.writeFile(scheduleFile, JSON.stringify(schedule, null, 2), 'utf-8');
  }
}
