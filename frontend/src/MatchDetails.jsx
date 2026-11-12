import React from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from '@mui/material';
import { GAME_GROUPS, GAME_SLOTS, SCORE_FORMAT, isFinishedGame, isUnplayedGame, resultSummary, summarizeGames } from '../../backend/domain/scoring.js';

function draftFromResult(result) {
  const resultGames = Array.isArray(result?.games) ? result.games : [];
  return GAME_SLOTS.map(({ slotId }) => {
    const game = resultGames.find((row) => row?.slotId === slotId);
    return {
      slotId,
      homeScore: Number.isInteger(game?.homeScore) ? String(game.homeScore) : '',
      awayScore: Number.isInteger(game?.awayScore) ? String(game.awayScore) : '',
    };
  });
}

function GamePlayers({ slotId, playerLineup }) {
  const game = playerLineup?.games?.[slotId];
  const homePlayers = Array.isArray(game?.home) ? game.home : [];
  const awayPlayers = Array.isArray(game?.away) ? game.away : [];
  const rowCount = Math.max(homePlayers.length, awayPlayers.length);
  const substitutions = (playerLineup?.substitutions || []).filter((row) => row.slotId === slotId);

  if (!rowCount && !substitutions.length) return null;

  return (
    <Box sx={{ minWidth: 0 }}>
      {Array.from({ length: rowCount }, (_, index) => {
        const home = homePlayers[index] || '';
        const away = awayPlayers[index] || '';
        const label = `${home}-${away}`;
        return (
          <Typography key={index} component="div" variant="caption" title={label}
            aria-label={label}
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
            {label}
          </Typography>
        );
      })}
      {substitutions.map(({ side, out, in: incoming }) => {
        const label = `Wissel ${side === 'home' ? 'thuis' : 'uit'}: ${out} → ${incoming}`;
        return (
          <Typography key={`${side}-${out}`} component="div" variant="caption" title={label}
            aria-label={label}
            sx={{ color: 'text.secondary', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
            {label}
          </Typography>
        );
      })}
    </Box>
  );
}

export default function MatchDetails({ fixture, poolLabel, homeName, awayName, result, playerLineup, user, authAvailable, onBack, onSave, onRefresh }) {
  const [draft, setDraft] = React.useState(() => draftFromResult(result));
  const initialDraft = React.useRef(draftFromResult(result));
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [conflict, setConflict] = React.useState(false);
  const headingRef = React.useRef(null);
  const stored = resultSummary(result);
  const dirty = draft.some((game, index) =>
    game.homeScore !== initialDraft.current[index].homeScore || game.awayScore !== initialDraft.current[index].awayScore);
  const games = draft.map((game) => ({
    slotId: game.slotId,
    homeScore: game.homeScore === '' ? null : /^\d+$/.test(game.homeScore) ? Number(game.homeScore) : NaN,
    awayScore: game.awayScore === '' ? null : /^\d+$/.test(game.awayScore) ? Number(game.awayScore) : NaN,
  }));
  const totals = summarizeGames(games);
  const canSave = games.every((game) => isUnplayedGame(game) || isFinishedGame(game));

  React.useEffect(() => {
    const nextDraft = draftFromResult(result);
    initialDraft.current = nextDraft;
    setDraft(nextDraft);
  }, [result]);
  React.useEffect(() => { headingRef.current?.focus(); }, []);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveResult = async (closeAfterSave = false) => {
    if (saving || !user || !canSave) return;
    setSaving(true);
    setError('');
    let saved = false;
    try {
      await onSave({ scoreFormat: SCORE_FORMAT, games });
      saved = true;
    } catch (err) {
      setError(`Kon uitslag niet opslaan: ${err.message}`);
      setConflict(err.status === 409);
      if (closeAfterSave) setDiscardOpen(false);
    } finally {
      setSaving(false);
    }
    if (saved && closeAfterSave) onBack();
  };
  const save = async (event) => {
    event.preventDefault();
    await saveResult();
  };
  const refresh = async () => {
    setSaving(true);
    try {
      await onRefresh();
      setError('');
      setConflict(false);
    } catch (err) {
      setError(`Kon uitslag niet vernieuwen: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  const changeScore = (slotId, side, value) => setDraft((rows) =>
    rows.map((game) => game.slotId === slotId ? { ...game, [side]: value } : game));
  const goBack = () => dirty ? setDiscardOpen(true) : onBack();

  return (
    <Box component="form" onSubmit={save} sx={{ pb: 3 }}>
      <Typography ref={headingRef} tabIndex={-1} variant="h5" sx={{ mb: 1 }}>
        {result ? 'Uitslag wijzigen' : 'Uitslag invoeren'}
      </Typography>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography fontWeight={600}>
          {homeName} - {awayName} · {totals.homeScore} - {totals.awayScore}{totals.completed !== 11 ? ' (voorlopig)' : ''}
        </Typography>
        <Typography variant="body2">{poolLabel} · Speelronde {fixture.round}</Typography>
        <Typography variant="body2">Wedstrijd {fixture.matchNumber || fixture.id} · {new Date(result?.date || fixture.date).toLocaleDateString('nl-NL')}</Typography>
        <Typography variant="body2">Afgeronde partijen: {totals.completed} / 11</Typography>
        <Typography variant="body2" color="text.secondary">Som partijpunten: {totals.rawHomeScore} - {totals.rawAwayScore}{totals.completed !== 11 ? ' (voorlopig)' : ''}</Typography>
      </Paper>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}{conflict && <Button disabled={saving} onClick={refresh}>Opgeslagen uitslag bekijken</Button>}</Alert>}
      {stored.error && <Alert severity="warning" sx={{ mb: 2 }}>{stored.error}. De opgeslagen partijgegevens zijn inconsistent; voer de 11 partijen opnieuw in om de uitslag te herstellen.</Alert>}
      {stored.legacy && <Alert severity="info" sx={{ mb: 2 }}>{stored.label}. Alleen totaaluitslag beschikbaar; partijpunten zijn niet bekend. Vul de 11 partijen in om de uitslag compleet te maken.</Alert>}
      <>
        <Alert severity="info" sx={{ mb: 2 }}>Per partij: een team 13, het andere 0 t/m 12. Beide scores invoeren; wedstrijdpunten worden berekend.</Alert>
        {GAME_GROUPS.map((group) => {
          const slots = GAME_SLOTS.filter((slot) => slot.type === group.type);
          const lastSlotIndex = GAME_SLOTS.findIndex((slot) => slot.slotId === slots[slots.length - 1].slotId);
          const isFinalGroup = group.type === GAME_GROUPS[GAME_GROUPS.length - 1].type;
          const subtotal = summarizeGames(games.filter((game) =>
            GAME_SLOTS.findIndex((slot) => slot.slotId === game.slotId) <= lastSlotIndex));
          return (
            <Paper key={group.type} sx={{ p: 1.5, mb: 2 }}>
              <Typography variant="h6">{group.label}</Typography>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '24px minmax(0, 1fr) 50px 50px 40px', sm: '32px minmax(0, 1fr) 64px 64px 52px' },
                gap: { xs: 0.5, sm: 1 },
                alignItems: 'start',
                mt: 1,
              }}>
                {['Partij', 'Spelers', 'Thuis', 'Uit', 'Punten'].map((label) => <Typography key={label} variant="caption" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>{label}</Typography>)}
                {slots.map((slot) => {
                  const game = games.find((row) => row.slotId === slot.slotId);
                  const entered = draft.find((row) => row.slotId === slot.slotId);
                  const valid = isFinishedGame(game);
                  const number = GAME_SLOTS.indexOf(slot) + 1;
                  const invalid = !valid && (entered.homeScore !== '' || entered.awayScore !== '');
                  return (
                    <React.Fragment key={slot.slotId}>
                      <Typography variant="body2" sx={{ pt: 1 }}>{number}</Typography>
                      <Box sx={{ minWidth: 0, pt: 0.75 }}>
                        <GamePlayers slotId={slot.slotId} playerLineup={playerLineup} />
                      </Box>
                      {['homeScore', 'awayScore'].map((side) => (
                        <TextField key={side} size="small" value={entered[side]} disabled={saving}
                          sx={{ minWidth: 0, '& .MuiInputBase-input': { px: 0.75 } }}
                          onChange={(event) => changeScore(slot.slotId, side, event.target.value)}
                          inputProps={{ inputMode: 'numeric', 'aria-label': `Partij ${number} ${group.label}, ${side === 'homeScore' ? 'thuis' : 'uit'} score` }}
                          error={invalid}
                          helperText={invalid ? '13 tegen 0-12' : ''} />
                      ))}
                      <Typography variant="body2" sx={{ pt: 1 }}>{valid ? `${game.homeScore === 13 ? slot.weight : 0} - ${game.awayScore === 13 ? slot.weight : 0}` : '—'}</Typography>
                    </React.Fragment>
                  );
                })}
              </Box>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(max-content, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(120px, 1fr) minmax(140px, 1fr)' },
                gap: { xs: 0.5, sm: 1 },
                alignItems: 'center',
                mt: 2,
              }}>
                <Typography variant="body2" sx={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {isFinalGroup ? 'Totaal' : 'Subtotaal'}: {subtotal.homeScore}-{subtotal.awayScore}
                </Typography>
                <Button size="small" variant="outlined" fullWidth disabled={saving} onClick={goBack} sx={{ textTransform: 'none', minWidth: 0, px: { xs: 0.25, sm: 1.5 }, fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Terug</Button>
                <Button size="small" type="submit" variant="contained" fullWidth disabled={saving || !user || !canSave} sx={{ textTransform: 'none', minWidth: 0, px: { xs: 0.25, sm: 1.5 }, fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>{saving ? 'Opslaan…' : 'Opslaan'}</Button>
              </Box>
            </Paper>
          );
        })}
        <Stack spacing={1} aria-live="polite">
          {!user && <Alert severity="info">{authAvailable ? 'Log in met Google om deze uitslag op te slaan.' : 'Firebase is lokaal niet geconfigureerd. Bekijken en invoeren kan; opslaan vereist een geldige Google-aanmelding.'}</Alert>}
        </Stack>
      </>
      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} aria-labelledby="discard-title">
        <DialogTitle id="discard-title">Resultaten opslaan?</DialogTitle>
        <DialogContent>Er zijn nog niet opgeslagen resultaten.</DialogContent>
        <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, px: 3, pb: 2, '& > :not(style) ~ :not(style)': { ml: 0 } }}>
          <Button fullWidth variant="contained" onClick={() => saveResult(true)} disabled={saving || !user || !canSave}>Opslaan en sluiten</Button>
          <Button fullWidth variant="outlined" color="error" onClick={onBack} disabled={saving}>Verwijderen en sluiten</Button>
          <Button fullWidth variant="outlined" onClick={() => setDiscardOpen(false)} autoFocus disabled={saving}>Verder met invoeren</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
