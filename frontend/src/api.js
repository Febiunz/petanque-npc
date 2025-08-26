import { auth } from './firebase';
const apiBase = import.meta.env.VITE_API_BASE || '';

async function http(url, options = {}) {
  const res = await fetch(`${apiBase}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg += `: ${j.error || JSON.stringify(j)}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  getHealth: () => http('/api/health'),
  getTeams: () => http('/api/teams'),
  getMatches: () => http('/api/matches'),
  // schedule of matches (previously /api/fixtures)
  getSchedule: (round) => http(`/api/matches/schedule${round ? `?round=${round}` : ''}`),
  submitResult: async ({ matchId, homeScore, awayScore }) => {
    const token = await auth.currentUser?.getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return http('/api/matches', { method: 'POST', headers, body: JSON.stringify({ matchId, homeScore, awayScore }) });
  },
  getStandings: () => http('/api/standings'),
};
