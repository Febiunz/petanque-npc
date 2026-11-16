import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { api } from './api';
import { GAME_SLOTS, SCORE_FORMAT, TOTAL_SCORE_FORMAT } from '../../backend/domain/scoring.js';

const authState = vi.hoisted(() => ({ user: { uid: 'ordinary-test-user' } }));
vi.mock('./firebase', () => ({
  auth: { onAuthStateChanged: (listener) => { listener(authState.user); return () => {}; } },
  googleProvider: {}, authAvailable: true,
}));
vi.mock('firebase/auth', () => ({ signInWithPopup: vi.fn(), signOut: vi.fn() }));
vi.mock('./api', () => ({ api: {
  getTeams: vi.fn(), getStandings: vi.fn(), getSchedule: vi.fn(), getMatches: vi.fn(), submitResult: vi.fn(),
} }));

const fixtures = [
  { id: '100101', matchNumber: '100101', round: 1, date: '2026-09-19', homeTeamId: 'home', awayTeamId: 'away' },
  { id: '100102', matchNumber: '100102', round: 1, date: '2026-09-19', homeTeamId: 'away', awayTeamId: 'home' },
  { id: '100117', matchNumber: '100117', round: 5, date: '2026-11-14', homeTeamId: 'home', awayTeamId: 'away' },
];
const historical = [
  { id: 'old', matchId: '100101', homeTeamId: 'home', awayTeamId: 'away', homeScore: 0, awayScore: 31 },
  { id: 'old2', matchId: '100102', homeTeamId: 'away', awayTeamId: 'home', homeScore: 31, awayScore: 0 },
];
const choose = async (label, name) => {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(label) }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
};
const selectMatch = async (round, id) => {
  await choose('Speelronde', `Speelronde ${round}`);
  await choose('Wedstrijd', id);
};
const fill = () => {
  screen.getAllByRole('textbox').forEach((input, index) => {
    const home = index % 2 === 0;
    const slot = Math.floor(index / 2);
    fireEvent.change(input, { target: { value: (slot === 6) === home ? '13' : '0' } });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-20T12:00:00.000Z').valueOf());
  authState.user = { uid: 'ordinary-test-user' };
  api.getTeams.mockResolvedValue([{ id: 'home', name: 'Home' }, { id: 'away', name: 'Away' }]);
  api.getStandings.mockResolvedValue([]);
  api.getSchedule.mockResolvedValue(fixtures);
  api.getMatches.mockResolvedValue(historical);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps every fixture selectable and shows totals in two inputs with Opslaan immediately before Details', async () => {
  render(<App />);
  await screen.findByRole('combobox', { name: /Speelronde/ });
  await waitFor(() => expect(screen.getByRole('combobox', { name: /Speelronde/ }).getAttribute('aria-disabled')).not.toBe('true'));
  await selectMatch(1, '100101');
  expect(screen.getByRole('textbox', { name: 'Totaalscore thuis' }).value).toBe('0');
  expect(screen.getByRole('textbox', { name: 'Totaalscore uit' }).value).toBe('31');
  const button = screen.getByRole('button', { name: 'Details' });
  expect(button.textContent).toBe('Details');
  expect(button.previousElementSibling).toBe(screen.getByRole('button', { name: 'Opslaan' }));
  expect(screen.getAllByRole('textbox')).toHaveLength(2);
  await userEvent.click(button);
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.getByText(/Alleen totaaluitslag beschikbaar/)).toBeTruthy();
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(screen.queryByRole('combobox')).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
  expect(screen.getByRole('combobox', { name: /Wedstrijd/ }).textContent).toContain('100101');
  await choose('Wedstrijd', '100102');
  expect(screen.getByRole('textbox', { name: 'Totaalscore thuis' }).value).toBe('31');
  expect(screen.getByRole('textbox', { name: 'Totaalscore uit' }).value).toBe('0');
  await selectMatch(5, '100117');
  expect(screen.queryByText('Nog geen uitslag')).toBeNull();
  screen.getAllByRole('textbox').forEach((input) => expect(input.value).toBe(''));
});

it('shows the played date second and the score last in Uitslagen, preferring the official date', async () => {
  api.getMatches.mockResolvedValue([{ ...historical[0], officialDate: '2026-09-12' }, historical[1]]);
  render(<App />);
  const heading = await screen.findByText('Uitslagen');
  const grid = heading.nextElementSibling;
  await waitFor(() => expect(grid.children.length).toBe(15));
  const cells = [...grid.children].map((cell) => cell.textContent);
  expect(cells.slice(0, 5)).toEqual(['Ronde', 'Datum', 'Thuis', 'Uit', 'Uitslag']);
  expect(cells.slice(5, 10)).toEqual(['01', '12-09-2026', 'Home', 'Away', '00 - 31']);
  expect(cells.slice(10, 15)).toEqual(['01', '19-09-2026', 'Away', 'Home', '31 - 00']);
});

it('loads official game players from the result API and updates them on refresh', async () => {
  const withLineup = (home) => [{
    ...historical[0],
    playerLineup: { games: { 'tete-1': { home: [home], away: ['Away player'] } }, substitutions: [] },
  }];
  api.getMatches.mockResolvedValue(withLineup('Original player'));
  render(<App />);
  await selectMatch(1, '100101');
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Original player-Away player')).toBeTruthy();
  api.submitResult.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[0], { target: { value: '13' } });
  fireEvent.change(inputs[1], { target: { value: '1' } });
  await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
  api.getMatches.mockResolvedValue(withLineup('Updated player'));
  await userEvent.click(await screen.findByRole('button', { name: 'Opgeslagen uitslag bekijken' }));
  expect(await screen.findByText('Updated player-Away player')).toBeTruthy();
  expect(screen.queryByText('Original player-Away player')).toBeNull();
});

it('allows editing a result submitted by another user after the scheduled date', async () => {
  api.getSchedule.mockResolvedValue(fixtures.map((fixture) =>
    fixture.id === '100117' ? { ...fixture, date: '2026-09-19' } : fixture));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Details' }).disabled).toBe(true));
  await selectMatch(5, '100117');
  api.getMatches.mockResolvedValue([...historical, {
    matchId: '100117',
    scoreFormat: SCORE_FORMAT,
    games: GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: index === 6 ? 13 : 0, awayScore: index === 6 ? 0 : 13 })),
    homeScore: 3,
    awayScore: 28,
  }]);
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
});

it('saves in details, keeps the result editable during its window, and preserves selection', async () => {
  const saved = {
    id: 'new', matchId: '100117', fixtureId: '100117', homeTeamId: 'home', awayTeamId: 'away',
    scoreFormat: SCORE_FORMAT, homeScore: 3, awayScore: 28,
    games: GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: index === 6 ? 13 : 0, awayScore: index === 6 ? 0 : 13 })),
  };
  api.submitResult.mockImplementation(async () => {
    api.getMatches.mockResolvedValue([...historical, saved]);
    return saved;
  });
  render(<App />);
  await selectMatch(5, '100117');
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  await screen.findByRole('textbox', { name: /Partij 1 Tete-a-tete, thuis score/ });
  fill();
  await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Opslaan' })).toHaveLength(3);
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(await screen.findAllByRole('button', { name: 'Terug', exact: true })).toHaveLength(3);
  await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
  expect(screen.getByRole('textbox', { name: 'Totaalscore thuis' }).value).toBe('3');
  expect(screen.getByRole('textbox', { name: 'Totaalscore uit' }).value).toBe('28');
  expect(screen.getByRole('combobox', { name: /Speelronde/ }).textContent).toContain('Speelronde 5');
  expect(screen.getByRole('combobox', { name: /Wedstrijd/ }).textContent).toContain('100117');
  expect(api.submitResult).toHaveBeenCalledWith({ matchId: '100117', divisieId: '1001', scoreFormat: SCORE_FORMAT, games: saved.games });
  await waitFor(() => expect(api.getStandings).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
});

it('reports failed refresh after confirmed save without a second POST or loss of the saved result', async () => {
  api.submitResult.mockImplementation(async (score) => {
    api.getStandings.mockRejectedValue(new Error('Refresh failed'));
    return { ...score, id: 'saved', homeScore: 3, awayScore: 28 };
  });
  render(<App />);
  await selectMatch(5, '100117');
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  await screen.findByRole('textbox', { name: /Partij 1 Tete-a-tete, thuis score/ });
  fill();
  await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[2]);
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(await screen.findByText(/Uitslag opgeslagen. Vernieuwen/)).toBeTruthy();
  expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
  expect(api.submitResult).toHaveBeenCalledOnce();
});

it('failed initial load is explicit and retry recovers rather than showing a guessed result', async () => {
  api.getMatches.mockRejectedValueOnce(new Error('Load failed'));
  render(<App />);
  expect(await screen.findByText(/Kon divisiegegevens niet laden/)).toBeTruthy();
  expect(screen.getByText('Uitslag niet beschikbaar')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Details' }).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Opnieuw laden' }));
  await selectMatch(1, '100101');
  expect(screen.getByRole('textbox', { name: 'Totaalscore thuis' }).value).toBe('0');
  expect(screen.getByRole('textbox', { name: 'Totaalscore uit' }).value).toBe('31');
});

it('computes a read-only away total from home, validates it, and preserves selection after saving', async () => {
  api.submitResult.mockImplementation(async (score) => {
    const { scoreFormat, ...result } = score;
    const saved = { ...result, id: 'quick-saved' };
    api.getMatches.mockResolvedValue([...historical, saved]);
    return saved;
  });
  render(<App />);
  await selectMatch(5, '100117');
  const home = screen.getByRole('textbox', { name: 'Totaalscore thuis' });
  const away = screen.getByRole('textbox', { name: 'Totaalscore uit' });
  const save = screen.getByRole('button', { name: 'Opslaan' });
  expect(save.disabled).toBe(true);
  expect(away.readOnly).toBe(true);
  for (const homeScore of ['', '19.5', '-1', '32', '1', '30', 'invalid']) {
    fireEvent.change(home, { target: { value: homeScore } });
    expect(save.disabled).toBe(true);
  }
  for (const [homeScore, awayScore] of [[19, 12], [3, 28], [28, 3]]) {
    fireEvent.change(home, { target: { value: String(homeScore) } });
    expect(away.value).toBe(String(awayScore));
    await userEvent.type(away, '99');
    expect(away.value).toBe(String(awayScore));
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(api.submitResult).toHaveBeenLastCalledWith({
      matchId: '100117', divisieId: '1001', scoreFormat: TOTAL_SCORE_FORMAT, homeScore, awayScore,
    });
    expect(home.value).toBe(String(homeScore));
    expect(away.value).toBe(String(awayScore));
    expect(screen.getByRole('combobox', { name: 'Wedstrijd' }).textContent).toContain('100117');
  }
  expect(api.getStandings).toHaveBeenCalledTimes(4);
  fireEvent.change(home, { target: { value: '' } });
  expect(away.value).toBe('');
  expect(save.disabled).toBe(true);
});

it('clears malformed saved totals and retains input on failed quick save without bypassing sign-in', async () => {
  api.getMatches.mockResolvedValue([{ ...historical[0], homeScore: '', awayScore: null }]);
  api.submitResult.mockRejectedValue(new Error('Storage unavailable'));
  const view = render(<App />);
  await selectMatch(1, '100101');
  const inputs = screen.getAllByRole('textbox');
  inputs.forEach((input) => expect(input.value).toBe(''));
  fireEvent.change(inputs[0], { target: { value: '19' } });
  await userEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
  expect(await screen.findByText(/Kon uitslag niet opslaan: Storage unavailable/)).toBeTruthy();
  expect(inputs.map((input) => input.value)).toEqual(['19', '12']);
  view.unmount();
  authState.user = null;
  render(<App />);
  await selectMatch(5, '100117');
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '19' } });
  expect(screen.getByRole('button', { name: 'Opslaan' }).disabled).toBe(true);
  expect(api.submitResult).toHaveBeenCalledOnce();
});

it('shows a completely blank detailed sheet as empty quick-score boxes', async () => {
  api.getMatches.mockResolvedValue([{
    ...historical[0], scoreFormat: SCORE_FORMAT, homeScore: 0, awayScore: 0,
    games: GAME_SLOTS.map(({ slotId }) => ({ slotId, homeScore: null, awayScore: null })),
  }]);
  render(<App />);
  await selectMatch(1, '100101');
  screen.getAllByRole('textbox').forEach((input) => expect(input.value).toBe(''));
  expect(screen.getByRole('button', { name: 'Opslaan' }).disabled).toBe(true);
});

it('blocks navigation during quick save and reports a failed post-save refresh without retrying the write', async () => {
  let finishSave;
  api.submitResult.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
  render(<App />);
  await selectMatch(5, '100117');
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[0], { target: { value: '19' } });
  await userEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
  expect(screen.getByRole('button', { name: 'Opslaan…' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Details' }).disabled).toBe(true);
  inputs.forEach((input) => expect(input.disabled).toBe(true));
  screen.getAllByRole('combobox').forEach((input) => expect(input.getAttribute('aria-disabled')).toBe('true'));
  api.getStandings.mockRejectedValue(new Error('Refresh failed'));
  finishSave({ id: 'quick-saved', matchId: '100117', homeScore: 19, awayScore: 12 });
  expect(await screen.findByText(/Uitslag opgeslagen. Vernieuwen/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Opslaan' }).disabled).toBe(false));
  expect(inputs.map((input) => input.value)).toEqual(['19', '12']);
  expect(api.submitResult).toHaveBeenCalledOnce();
});

it('disables official scores and saves in both surfaces but keeps Details and games viewable', async () => {
  api.getMatches.mockResolvedValue([{ ...historical[0], official: true }]);
  render(<App />);
  await selectMatch(1, '100101');
  screen.getAllByRole('textbox').forEach((input) => expect(input.disabled).toBe(true));
  expect(screen.getByRole('button', { name: 'Opslaan' }).disabled).toBe(true);
  expect(screen.getByText(/Officiële uitslag opgehaald/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Uitslag bekijken')).toBeTruthy();
  expect(screen.getByText(/Officiële uitslag opgehaald/)).toBeTruthy();
  screen.getAllByRole('textbox').forEach((input) => expect(input.disabled).toBe(true));
  screen.getAllByRole('button', { name: 'Opslaan' }).forEach((button) => expect(button.disabled).toBe(true));
  expect(api.submitResult).not.toHaveBeenCalled();
});

it('locks quick entry when an official import wins a save race', async () => {
  api.submitResult.mockImplementation(async () => {
    api.getMatches.mockResolvedValue([{ ...historical[0], official: true }]);
    throw Object.assign(new Error('Officiële uitslag'), { status: 409 });
  });
  render(<App />);
  await selectMatch(1, '100101');
  await userEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
  expect(await screen.findByText(/Officiële uitslag opgehaald/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Opslaan' }).disabled).toBe(true);
  screen.getAllByRole('textbox').forEach((input) => expect(input.disabled).toBe(true));
});

it('locks detailed entry when an official import wins a save race', async () => {
  api.submitResult.mockImplementation(async () => {
    api.getMatches.mockResolvedValue([{ ...historical[0], official: true }]);
    throw Object.assign(new Error('Officiële uitslag'), { status: 409 });
  });
  render(<App />);
  await selectMatch(1, '100101');
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  await screen.findByText('Uitslag wijzigen');
  await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
  expect(await screen.findByText('Uitslag bekijken')).toBeTruthy();
  screen.getAllByRole('button', { name: 'Opslaan' }).forEach((button) => expect(button.disabled).toBe(true));
  screen.getAllByRole('textbox').forEach((input) => expect(input.disabled).toBe(true));
});
