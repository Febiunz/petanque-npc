import { isOfficialResult } from '../history/officialResults.js';
import { OFFICIAL_RESULT_MESSAGE, isUnplayedGame, resultSummary } from '../domain/scoring.js';

export async function updateResultFile(read, write, update) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await read();
    if (!Array.isArray(data)) throw new Error('Result storage must contain an array');
    const next = update(data);
    try {
      await write(next, etag);
      return next;
    } catch (error) {
      if (error.statusCode !== 412) throw error;
      if (attempt === 4) {
        const busy = new Error('Result storage changed repeatedly; please retry');
        busy.status = 503;
        throw busy;
      }

    }
  }
}

export async function saveResult(read, write, match, now = match.submittedAt || new Date().toISOString()) {
  let savedMatch;
  let created;
  await updateResultFile(read, write, (data) => {
    const index = data.findIndex((row) => row && (
      (row.matchId || row.fixtureId) === match.matchId || row.fixtureId === match.matchId
    ));
    const existing = data[index];
    if (isOfficialResult(match) || isOfficialResult({ ...existing, divisieId: match.divisieId })) {
      const error = new Error(OFFICIAL_RESULT_MESSAGE);
      error.status = 409;
      throw error;
    }
    if (index < 0) {
      created = true;
      savedMatch = { ...match, submittedAt: match.submittedAt || now };
      return [...data, savedMatch];
    }

    created = false;
    let score = {};
    if (!Array.isArray(match.games) && Array.isArray(existing.games) && existing.games.some((game) => !isUnplayedGame(game))) {
      const { score: detailed } = resultSummary(existing);
      const consistent = detailed && detailed.homeScore === match.homeScore && detailed.awayScore === match.awayScore;
      if (!consistent) {
        const error = new Error('Er zijn al partijgegevens. Wijzig de uitslag via Details om deze te behouden.');
        error.status = 409;
        throw error;
      }
      score = { games: existing.games, scoreFormat: existing.scoreFormat };
    }
    savedMatch = {
      ...existing,
      ...match,
      ...score,
      id: existing.id || match.id,
      date: existing.date || match.date,
      createdAt: existing.createdAt || match.createdAt,
      submittedAt: existing.submittedAt || match.submittedAt || now,
      updatedAt: now,
      submittedBy: existing.submittedBy || match.submittedBy || null,
      submittedByUid: existing.submittedByUid || match.submittedByUid || null,
      updatedBy: match.submittedBy || null,
      updatedByUid: match.submittedByUid || null,
    };
    if (!Array.isArray(match.games) && !score.games) {
      delete savedMatch.games;
      delete savedMatch.scoreFormat;
    }
    const next = [...data];
    next[index] = savedMatch;
    return next;
  });
  return { match: savedMatch, created };
}
