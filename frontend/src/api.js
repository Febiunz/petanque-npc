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

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export const api = {
  getHealth: () => http('/api/health'),
  getTeams: ({ divisieId, divisie } = {}) => http(withQuery('/api/teams', { divisieId, divisie })),
  getMatches: ({ divisieId } = {}) => http(withQuery('/api/matches', { divisieId })),
  // schedule of matches (previously /api/fixtures)
  getSchedule: ({ round, divisieId, divisie } = {}) => http(withQuery('/api/matches/schedule', { round, divisieId, divisie })),
  submitResult: async ({ matchId, homeScore, awayScore, divisieId }) => {
    const token = await auth.currentUser?.getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return http('/api/matches', { method: 'POST', headers, body: JSON.stringify({ matchId, homeScore, awayScore, divisieId }) });
  },
  getStandings: ({ divisieId, divisie } = {}) => http(withQuery('/api/standings', { divisieId, divisie })),
};
