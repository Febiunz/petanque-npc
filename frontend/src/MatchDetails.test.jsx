import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchDetails from './MatchDetails';
import officialResults from '../../backend/data/matches-1001.json';
import { GAME_SLOTS, SCORE_FORMAT } from '../../backend/domain/scoring.js';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-20T12:00:00.000Z').valueOf());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const fixture = { id: '100117', matchNumber: '100117', round: 5, date: '2026-11-14T12:00:00.000Z' };
const props = () => ({
  fixture, poolLabel: 'Topdivisie - 1001', homeName: 'Home', awayName: 'Away', user: { uid: 'test' },
  authAvailable: true, onBack: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn(),
});
const complete = () => {
  for (let index = 0; index < 11; index++) {
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[index * 2], { target: { value: index === 6 ? '13' : '3' } });
    fireEvent.change(inputs[index * 2 + 1], { target: { value: index === 6 ? '1' : '13' } });
  }
};
const enabled = (element) => expect(element.disabled).toBe(false);
const disabled = (element) => expect(element.disabled).toBe(true);

describe('dedicated detailed score entry', () => {
  it('starts with 22 blank independent inputs and single-line cumulative subtotals', () => {
    render(<MatchDetails {...props()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(22);
    inputs.forEach((input) => expect(input.value).toBe(''));
    expect(screen.getAllByText('Nr.')).toHaveLength(3);
    expect(screen.queryByText('Partij')).toBeNull();
    screen.getAllByText('Punten').forEach((header) => {
      expect(getComputedStyle(header).textAlign).toBe('right');
    });
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(enabled);
    expect(screen.getByText('Home - Away · 0 - 0 (voorlopig)')).toBeTruthy();
    fireEvent.change(inputs[0], { target: { value: '13' } });
    expect(inputs[1].value).toBe('');
    expect(screen.getByText('Afgeronde partijen: 0 / 11')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByText('Subtotaal: 0-0')).toHaveLength(2);
    expect(screen.getByText('Totaal: 0-0')).toBeTruthy();
    const subtotal = screen.getAllByText('Subtotaal: 0-0')[0];
    expect(getComputedStyle(subtotal).textAlign).toBe('left');
    expect(getComputedStyle(subtotal).whiteSpace).toBe('nowrap');
    expect(screen.queryByText(/wedstrijdpunten per gewonnen partij/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Terug', exact: true })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Opslaan' })).toHaveLength(3);
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(disabled);
    expect(screen.queryByRole('button', { name: 'Terug naar wedstrijdselectie' })).toBeNull();
  });

  it('shows Excel player pairs on one line and substitutions below their original pairing', () => {
    render(<MatchDetails {...props()} playerLineup={officialResults.find((row) => row.matchId === '100116').playerLineup} />);
    const homeSubstitutionPair = screen.getByText('Jeroen Brinks-Daniël Adriaan van Dam');
    const awaySubstitutionPair = screen.getByText('Ferdinand Wiese-Romulo van Stockum');
    const homeSubstitution = screen.getByText('Jeroen Brinks → Chantal Brinks-Kamphuis');
    const awaySubstitution = screen.getByText('Romulo van Stockum → Jakob Huitsing');

    expect(screen.queryByText(/Wissel (thuis|uit):/)).toBeNull();
    expect(getComputedStyle(homeSubstitutionPair).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(awaySubstitutionPair).whiteSpace).toBe('nowrap');
    expect(parseFloat(getComputedStyle(homeSubstitutionPair).fontSize)).toBeLessThan(12);
    expect(parseFloat(getComputedStyle(homeSubstitution).fontSize)).toBeLessThan(12);
    expect(getComputedStyle(homeSubstitution).color).not.toBe(getComputedStyle(homeSubstitutionPair).color);
    expect(getComputedStyle(homeSubstitution).color).not.toBe('');
    expect(homeSubstitutionPair.parentElement.textContent.indexOf(homeSubstitutionPair.textContent))
      .toBeLessThan(homeSubstitutionPair.parentElement.textContent.indexOf(homeSubstitution.textContent));
    expect(awaySubstitutionPair.parentElement.textContent.indexOf(awaySubstitutionPair.textContent))
      .toBeLessThan(awaySubstitutionPair.parentElement.textContent.indexOf(awaySubstitution.textContent));
    expect(screen.getByText('Chantal Brinks-Kamphuis-Loc Le Van')).toBeTruthy();
    expect(screen.getByText('Wim Boluijt-Jakob Huitsing')).toBeTruthy();
    expect(screen.getAllByText('Niels Saurel-Rick van Lier')).toHaveLength(2);
  });

  it('saves partial games with blank slots while keeping one-sided entries invalid', async () => {
    const p = props();
    render(<MatchDetails {...p} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '13' } });
    fireEvent.change(inputs[1], { target: { value: '1' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(p.onSave).toHaveBeenCalledWith({
      scoreFormat: SCORE_FORMAT,
      games: GAME_SLOTS.map(({ slotId }, index) => ({
        slotId,
        homeScore: index === 0 ? 13 : null,
        awayScore: index === 0 ? 1 : null,
      })),
    });
    fireEvent.change(inputs[2], { target: { value: '13' } });
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(disabled);
  });

  it('accepts raw 1/3 and calculates 3-28 for complete results', async () => {
    const p = props();
    render(<MatchDetails {...p} />);
    complete();
    expect(screen.getByText('Home - Away · 3 - 28')).toBeTruthy();
    expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
    expect(screen.getByText('Subtotaal: 0-12')).toBeTruthy();
    expect(screen.getByText('Subtotaal: 3-18')).toBeTruthy();
    expect(screen.getByText('Totaal: 3-28')).toBeTruthy();
    for (const label of ['Subtotaal: 0-12', 'Subtotaal: 3-18', 'Totaal: 3-28']) {
      expect(screen.getByText(label).parentElement.querySelectorAll('button')).toHaveLength(2);
    }
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(enabled);
    fireEvent.change(screen.getAllByRole('textbox')[21], { target: { value: '' } });
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(disabled);
    fireEvent.change(screen.getAllByRole('textbox')[21], { target: { value: '13' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[0]);
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onSave.mock.calls[0][0]).toEqual({
      scoreFormat: SCORE_FORMAT,
      games: GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: index === 6 ? 13 : 3, awayScore: index === 6 ? 1 : 13 })),
    });
  });

  it('keeps malformed text visible and prevents invalid pairs from counting', () => {
    render(<MatchDetails {...props()} />);
    complete();
    const first = screen.getAllByRole('textbox')[0];
    for (const value of ['13.5', '-1', '14', 'not a score', '']) {
      fireEvent.change(first, { target: { value } });
      expect(first.value).toBe(value);
      screen.getAllByRole('button', { name: 'Opslaan' }).forEach(disabled);
      expect(screen.getByText('Afgeronde partijen: 10 / 11')).toBeTruthy();
    }
  });

  it('renders cumulative score pairs without spaces around the hyphen', () => {
    render(<MatchDetails {...props()} />);
    const inputs = screen.getAllByRole('textbox');
    for (let index = 0; index < 11; index++) {
      const homeWins = index < 4 || index === 6 || index === 9;
      fireEvent.change(inputs[index * 2], { target: { value: homeWins ? '13' : '0' } });
      fireEvent.change(inputs[index * 2 + 1], { target: { value: homeWins ? '0' : '13' } });
    }
    expect(screen.getByText('Subtotaal: 11-10')).toBeTruthy();
    expect(screen.getByText('Totaal: 16-15')).toBeTruthy();
  });

  it('guards dirty back, cancellation, confirmed discard and beforeunload', async () => {
    const p = props();
    render(<MatchDetails {...p} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '13' } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[1]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Resultaten opslaan?' })).toBeTruthy();
    expect(screen.getByText('Er zijn nog niet opgeslagen resultaten.')).toBeTruthy();
    const actions = screen.getByRole('button', { name: 'Opslaan en sluiten' }).parentElement;
    expect(getComputedStyle(actions).flexDirection).toBe('column');
    expect(actions.children).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Verder met invoeren' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByRole('textbox')[0].value).toBe('13');
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Verwijderen en sluiten' }));
    expect(p.onBack).toHaveBeenCalledOnce();
  });

  it('saves valid pending scores before closing from the unsaved-results dialog', async () => {
    const p = props();
    render(<MatchDetails {...p} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '13' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
    expect(screen.getByRole('button', { name: 'Opslaan en sluiten' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Verder met invoeren' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    complete();
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Opslaan en sluiten' }));
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(p.onBack).toHaveBeenCalledOnce();
  });

  it('returns directly when empty and unregisters beforeunload on unmount', async () => {
    const p = props();
    const rendered = render(<MatchDetails {...p} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
    expect(p.onBack).toHaveBeenCalledOnce();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '13' } });
    rendered.unmount();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('retains input on save error, blocks repeat save/back in flight, and disables save after sign-out', async () => {
    let reject;
    const p = props();
    p.onSave = vi.fn(() => new Promise((resolve, fail) => { reject = fail; }));
    const rendered = render(<MatchDetails {...p} />);
    complete();
    await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[2]);
    screen.getAllByRole('button', { name: 'Opslaan…' }).forEach(disabled);
    screen.getAllByRole('button', { name: 'Terug', exact: true }).forEach(disabled);
    screen.getAllByRole('textbox').forEach(disabled);
    reject(new Error('Network failure'));
    await screen.findByText(/Network failure/);
    expect(screen.getAllByRole('textbox')[0].value).toBe('3');
    rendered.rerender(<MatchDetails {...p} user={null} />);
    screen.getAllByRole('button', { name: 'Opslaan' }).forEach(disabled);
    expect(screen.getAllByRole('textbox')[0].value).toBe('3');
  });

  it('provides an explicit refresh action on duplicate conflicts without overwriting', async () => {
    const p = props();
    p.onSave.mockRejectedValue(Object.assign(new Error('Result already submitted'), { status: 409 }));
    p.onRefresh.mockResolvedValue(undefined);
    render(<MatchDetails {...p} />);
    complete();
    await userEvent.click(screen.getAllByRole('button', { name: 'Opslaan' })[1]);
    await userEvent.click(await screen.findByRole('button', { name: 'Opgeslagen uitslag bekijken' }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledOnce());
  });

  it('closes the discard dialog after save failure and exposes conflict recovery', async () => {
    const p = props();
    p.onSave.mockRejectedValue(Object.assign(new Error('Result already submitted'), { status: 409 }));
    render(<MatchDetails {...p} />);
    complete();
    await userEvent.click(screen.getAllByRole('button', { name: 'Terug', exact: true })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Opslaan en sluiten' }));
    await screen.findByText(/Result already submitted/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByRole('textbox')[0].value).toBe('3');
    expect(screen.getByRole('button', { name: 'Opgeslagen uitslag bekijken' })).toBeTruthy();
  });
});

describe('completed viewing', () => {
  it('keeps stored scores editable after the scheduled date, with cumulative subtotals', () => {
    const rawPairs = [[5, 13], [11, 13], [13, 6], [9, 13], [6, 13], [5, 13], [13, 10], [13, 7], [3, 13], [5, 13], [6, 13]];
    const games = GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: rawPairs[index][0], awayScore: rawPairs[index][1] }));
    render(<MatchDetails {...props()} fixture={{ ...fixture, date: '2026-09-19' }} result={{ scoreFormat: SCORE_FORMAT, games, homeScore: 8, awayScore: 23 }} />);
    expect(screen.getByText('Uitslag wijzigen')).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(22);
    expect(screen.getAllByRole('button', { name: 'Opslaan' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Terug', exact: true })).toHaveLength(3);
    const header = screen.getByText(/Wedstrijd 100117/).parentElement.parentElement;
    expect(header.textContent).toContain('Afgeronde partijen: 11 / 11');
    expect(header.textContent).toContain('Home - Away · 8 - 23');
    expect(header.textContent).toContain('Som partijpunten: 89 - 127');
    expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
    expect(screen.getAllByText('Som partijpunten: 89 - 127')).toHaveLength(1);
    expect(screen.getByText('Subtotaal: 2-10')).toBeTruthy();
    expect(screen.getByText('Subtotaal: 8-13')).toBeTruthy();
    expect(screen.getByText('Totaal: 8-23')).toBeTruthy();
    for (const label of ['Subtotaal: 2-10', 'Subtotaal: 8-13', 'Totaal: 8-23']) {
      expect(screen.getByText(label).parentElement.querySelectorAll('button')).toHaveLength(2);
    }
    expect(screen.queryByRole('button', { name: 'Terug naar wedstrijdselectie' })).toBeNull();
  });

  it('allows incomplete legacy and inconsistent results to be completed without fabricated scores', () => {
    const rendered = render(<MatchDetails {...props()} fixture={{ ...fixture, date: '2026-09-19' }} result={{ homeScore: 12, awayScore: 19 }} />);
    expect(screen.getByText(/Alleen totaaluitslag beschikbaar/)).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(22);
    expect(screen.getAllByRole('textbox').every((input) => input.value === '')).toBe(true);
    complete();
    expect(screen.getByText('Afgeronde partijen: 11 / 11')).toBeTruthy();
    expect(screen.getByText('Home - Away · 3 - 28')).toBeTruthy();
    expect(screen.getByText('Som partijpunten: 43 - 131')).toBeTruthy();
    expect(screen.queryByText(/Wedstrijdpunten:/)).toBeNull();
    rendered.rerender(<MatchDetails {...props()} fixture={{ ...fixture, date: '2026-09-19' }} result={{ scoreFormat: SCORE_FORMAT, games: [] }} />);
    expect(screen.getByText(/voer de 11 partijen opnieuw in/)).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(22);
    complete();
    expect(screen.getByText('Afgeronde partijen: 11 / 11')).toBeTruthy();
    expect(screen.getByText('Home - Away · 3 - 28')).toBeTruthy();
  });

  it('prefills an existing result for editing', () => {
    const games = GAME_SLOTS.map(({ slotId }, index) => ({ slotId, homeScore: index === 6 ? 13 : 3, awayScore: index === 6 ? 1 : 13 }));
    render(<MatchDetails {...props()} result={{ scoreFormat: SCORE_FORMAT, games, homeScore: 3, awayScore: 28 }} />);
    expect(screen.getByText('Uitslag wijzigen')).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(22);
    expect(screen.getAllByRole('textbox')[12].value).toBe('13');
    expect(screen.getAllByRole('textbox')[13].value).toBe('1');
    expect(screen.getAllByRole('button', { name: 'Opslaan' })).toHaveLength(3);
  });
});
