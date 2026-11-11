import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { api } from './api';
import { GAME_SLOTS, SCORE_FORMAT } from '../../backend/domain/scoring.js';

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

it('keeps fully completed rounds and every fixture selectable with exact Details and honest result line', async () => {
  render(<App />);
  await screen.findByRole('combobox', { name: /Speelronde/ });
  await waitFor(() => expect(screen.getByRole('combobox', { name: /Speelronde/ }).getAttribute('aria-disabled')).not.toBe('true'));
  await selectMatch(1, '100101');
  expect(screen.getByText('Uitslag: 0 - 31')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Details' });
  expect(button.textContent).toBe('Details');
  expect(button.parentElement.textContent).toContain('Uitslag: 0 - 31');
  expect(screen.queryByRole('textbox')).toBeNull();
  await userEvent.click(button);
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.getByText(/Alleen totaaluitslag beschikbaar/)).toBeTruthy();
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(screen.queryByRole('combobox')).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
  expect(screen.getByRole('combobox', { name: /Wedstrijd/ }).textContent).toContain('100101');
  await choose('Wedstrijd', '100102');
  expect(screen.getByText('Uitslag: 31 - 0')).toBeTruthy();
  await selectMatch(5, '100117');
  expect(screen.getByText('Nog geen uitslag')).toBeTruthy();
});

it('opens fresh completion read-only if another user submits before Details is opened', async () => {
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
  expect(await screen.findByText('Wedstrijddetails')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
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
  expect(screen.getByText('Wedstrijdpunten: 3 - 28')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Opslaan' })).toHaveLength(3);
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(await screen.findAllByRole('button', { name: 'Terug', exact: true })).toHaveLength(3);
  await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
  expect(screen.getByText('Uitslag: 3 - 28')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: /Speelronde/ }).textContent).toContain('Speelronde 5');
  expect(screen.getByRole('combobox', { name: /Wedstrijd/ }).textContent).toContain('100117');
  expect(api.submitResult).toHaveBeenCalledWith({ matchId: '100117', divisieId: '1001', scoreFormat: SCORE_FORMAT, games: saved.games });
  await waitFor(() => expect(api.getStandings).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(await screen.findByText('Uitslag wijzigen')).toBeTruthy();
  expect(screen.getAllByRole('textbox')).toHaveLength(22);
  expect(screen.getByText('Wedstrijdpunten: 3 - 28')).toBeTruthy();
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
  expect(screen.getByText('Wedstrijdpunten: 3 - 28')).toBeTruthy();
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
  expect(screen.getByText('Uitslag: 0 - 31')).toBeTruthy();
});
