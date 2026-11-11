export const SCORE_FORMAT = 'individual-games-v1';

export const GAME_GROUPS = Object.freeze([
  { type: 'tete', label: 'Tete-a-tete', count: 6, weight: 2 },
  { type: 'doublette', label: 'Doublette', count: 3, weight: 3 },
  { type: 'triplette', label: 'Triplette', count: 2, weight: 5 },
].map(Object.freeze));

export const GAME_SLOTS = Object.freeze(GAME_GROUPS.flatMap((group) =>
  Array.from({ length: group.count }, (_, index) => Object.freeze({
    slotId: `${group.type}-${index + 1}`,
    type: group.type,
    label: group.label,
    weight: group.weight,
  }))
));

export function isFinishedGame(game) {
  return !!game && Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore)
    && game.homeScore >= 0 && game.homeScore <= 13
    && game.awayScore >= 0 && game.awayScore <= 13
    && ((game.homeScore === 13) !== (game.awayScore === 13));
}

export function summarizeGames(games) {
  const summary = { homeScore: 0, awayScore: 0, rawHomeScore: 0, rawAwayScore: 0, completed: 0 };
  for (const slot of GAME_SLOTS) {
    const game = games.find((row) => row.slotId === slot.slotId);
    if (!isFinishedGame(game)) continue;
    summary.completed++;
    summary.homeScore += game.homeScore === 13 ? slot.weight : 0;
    summary.awayScore += game.awayScore === 13 ? slot.weight : 0;
    summary.rawHomeScore += game.homeScore;
    summary.rawAwayScore += game.awayScore;
  }
  return summary;
}

export function validateDetailedScore(input) {
  if (input?.scoreFormat !== SCORE_FORMAT) throw new Error('Ongeldig scoreFormat');
  if (!Array.isArray(input.games) || input.games.length !== GAME_SLOTS.length) {
    throw new Error('Vul precies 11 partijen in');
  }
  const ids = new Set();
  for (const game of input.games) {
    if (!game || Object.keys(game).some((key) => !['slotId', 'homeScore', 'awayScore'].includes(key))
      || !GAME_SLOTS.some((slot) => slot.slotId === game.slotId) || ids.has(game.slotId)) {
      throw new Error('Ongeldige of dubbele partij');
    }
    if (!isFinishedGame(game)) throw new Error(`${game.slotId}: een team 13, het andere een geheel getal van 0 t/m 12`);
    ids.add(game.slotId);
  }
  const games = GAME_SLOTS.map(({ slotId }) => {
    const game = input.games.find((row) => row.slotId === slotId);
    return { slotId, homeScore: game.homeScore, awayScore: game.awayScore };
  });
  const totals = summarizeGames(games);
  for (const key of ['homeScore', 'awayScore']) {
    if (input[key] !== undefined && input[key] !== totals[key]) {
      throw new Error('Totaaluitslag komt niet overeen met de partijen');
    }
  }
  return { scoreFormat: SCORE_FORMAT, games, homeScore: totals.homeScore, awayScore: totals.awayScore };
}

export function resultSummary(result) {
  if (!result) return { label: 'Nog geen uitslag' };
  if (result.games !== undefined || result.scoreFormat !== undefined) {
    try {
      const score = validateDetailedScore(result);
      return { label: `Uitslag: ${score.homeScore} - ${score.awayScore}`, score };
    } catch (error) {
      return { label: 'Inconsistente uitslag', error: error.message };
    }
  }
  return { label: `Uitslag: ${result.homeScore} - ${result.awayScore}`, legacy: true };
}
