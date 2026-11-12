import React from 'react';
import { Container, Typography, Button, Box, Stack, TextField, MenuItem, Paper, Avatar, Tooltip } from '@mui/material';
import { api } from './api';
import { auth, googleProvider, authAvailable } from './firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import MatchDetails from './MatchDetails';
import { GAME_SLOTS, isFinishedGame, resultSummary } from '../../backend/domain/scoring.js';

const POOL_OPTIONS = [
  { divisie: 'topdivisie', divisieId: '1001', label: 'Topdivisie - 1001' },
  { divisie: '2e-divisie', divisieId: '2001', label: '2e divisie - 2001' },
  { divisie: '2e-divisie', divisieId: '2002', label: '2e divisie - 2002' },
];

function App() {
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    const unsubscribe = auth?.onAuthStateChanged((u) => setUser(u));
    return unsubscribe;
  }, []);

  const handleSignIn = async (provider) => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      setErrorMsg(`Kon niet inloggen: ${error.message}`);
      setErrorOpen(true);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      setErrorMsg(`Kon niet uitloggen: ${error.message}`);
      setErrorOpen(true);
    }
  };

  // Teams state
  const [teams, setTeams] = React.useState([]);
  const [selectedDivisieId, setSelectedDivisieId] = React.useState('1001');

  // Match schedule + result submission
  const [round, setRound] = React.useState('');
  const [schedule, setSchedule] = React.useState([]);
  const [scheduleAll, setScheduleAll] = React.useState([]);
  const [completedSet, setCompletedSet] = React.useState(new Set());
  const [availableRounds, setAvailableRounds] = React.useState([]);
  const [matchId, setMatchId] = React.useState('');
  const [details, setDetails] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const detailsButtonRef = React.useRef(null);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [errorOpen, setErrorOpen] = React.useState(false);
  const loadRequestRef = React.useRef(0);
  const [results, setResults] = React.useState([]);

  // Selection includes completed fixtures; only the upcoming list filters them out.
  React.useEffect(() => {
    if (!round) { setSchedule([]); return; }
    const rows = scheduleAll
      .filter(m => String(m.round) === String(round));
    setSchedule(rows);
  }, [round, scheduleAll]);

  React.useEffect(() => {
    const rounds = Array.from(new Set(scheduleAll.map(m => String(m.round)))).sort((a, b) => Number(a) - Number(b));
    setAvailableRounds(rounds);
    if (round && !rounds.includes(String(round))) {
      setRound('');
      setMatchId('');
      setSchedule([]);
    }
  }, [scheduleAll, round]);
  // Standings state
  const [standings, setStandings] = React.useState([]);

  const loadPoolData = React.useCallback(async (divisieId, divisie) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    if (!divisieId) {
      if (requestId !== loadRequestRef.current) return;
      setTeams([]);
      setScheduleAll([]);
      setCompletedSet(new Set());
      setStandings([]);
      setResults([]);
      setLoading(false);
      setLoaded(false);
      return;
    }
    try {
      const [teamRows, standingsRows, scheduleRows, submittedRows] = await Promise.all([
        api.getTeams({ divisieId, divisie }),
        api.getStandings({ divisieId, divisie }),
        api.getSchedule({ divisieId, divisie }),
        api.getMatches({ divisieId }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setTeams(teamRows);
      setStandings(standingsRows);
      setScheduleAll(scheduleRows);
      setCompletedSet(new Set(submittedRows
        .filter((row) => !Array.isArray(row.games) || row.games.length === GAME_SLOTS.length && row.games.every(isFinishedGame))
        .map((row) => row.matchId || row.fixtureId)
        .filter(Boolean)));
      setResults(submittedRows);
      setLoaded(true);
      setErrorOpen(false);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!selectedDivisieId) {
      loadPoolData('', '');
      return;
    }
    const pool = POOL_OPTIONS.find((p) => p.divisieId === selectedDivisieId);
    let active = true;
    loadPoolData(selectedDivisieId, pool?.divisie || '').catch((err) => {
      if (!active) return;
      setErrorMsg(`Kon divisiegegevens niet laden: ${err?.message || err}`);
      setErrorOpen(true);
    });
    return () => {
      active = false;
    };
  }, [selectedDivisieId, loadPoolData]);

  React.useEffect(() => {
    if (loaded && !loading && matchId && !scheduleAll.some((row) => row.id === matchId)) {
      setMatchId('');
      setErrorMsg('De geselecteerde wedstrijd staat niet meer in het schema.');
      setErrorOpen(true);
    }
  }, [loaded, loading, matchId, scheduleAll]);

  const selectedFixture = scheduleAll.find((fixture) => fixture.id === matchId);
  const selectedResult = results.find((result) => (result.matchId || result.fixtureId) === matchId);
  const summary = resultSummary(selectedResult);
  const back = () => {
    setDetails(null);
    requestAnimationFrame(() => detailsButtonRef.current?.focus());
  };
  const openDetails = async () => {
    if (!selectedFixture || !loaded || loading || opening) return;
    setOpening(true);
    try {
      const rows = await api.getMatches({ divisieId: selectedDivisieId });
      setResults(rows);
      setCompletedSet(new Set(rows.map((row) => row.matchId || row.fixtureId)));
      setDetails({
        fixture: selectedFixture,
        divisieId: selectedDivisieId,
        poolLabel: POOL_OPTIONS.find((pool) => pool.divisieId === selectedDivisieId)?.label,
        homeName: teams.find((team) => team.id === selectedFixture.homeTeamId)?.name || selectedFixture.homeTeamId,
        awayName: teams.find((team) => team.id === selectedFixture.awayTeamId)?.name || selectedFixture.awayTeamId,
        result: rows.find((row) => (row.matchId || row.fixtureId) === matchId),
      });
      setErrorOpen(false);
    } catch (error) {
      setErrorMsg(`Kon wedstrijddetails niet laden: ${error.message}`);
      setErrorOpen(true);
    } finally {
      setOpening(false);
    }
  };
  const saveDetails = async (score) => {
    const saved = await api.submitResult({ ...score, matchId: details.fixture.id, divisieId: details.divisieId });
    setResults((rows) => [saved, ...rows.filter((row) => (row.matchId || row.fixtureId) !== saved.matchId)]);
    setCompletedSet((ids) => new Set([...ids, saved.matchId]));
    setDetails((current) => ({ ...current, result: saved }));
    const pool = POOL_OPTIONS.find((row) => row.divisieId === details.divisieId);
    try {
      await loadPoolData(details.divisieId, pool.divisie);
    } catch (error) {
      setErrorMsg(`Uitslag opgeslagen. Vernieuwen van stand en uitslagen mislukt: ${error.message}`);
      setErrorOpen(true);
    }
  };
  const refreshDetails = async () => {
    const rows = await api.getMatches({ divisieId: details.divisieId });
    setResults(rows);
    setCompletedSet(new Set(rows.map((row) => row.matchId || row.fixtureId)));
    setDetails((current) => ({ ...current, result: rows.find((row) => (row.matchId || row.fixtureId) === current.fixture.id) }));
  };

  return (
    <Container maxWidth="xs">
      <Box sx={{ textAlign: 'left', mt: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h5" sx={{ m: 0 }}>NPC Standen</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {user ? (
              <>
                <Avatar
                  src={user.photoURL || undefined}
                  alt={(user.displayName || user.email || 'Gebruiker')}
                  sx={{ width: 28, height: 28 }}
                />
                <Button variant="outlined" color="secondary" size="small" onClick={handleSignOut}>Sign Out</Button>
              </>
            ) : (
              <Button variant="contained" size="small" disabled={!authAvailable} onClick={() => handleSignIn(googleProvider)}>Inloggen met Google</Button>
            )}
          </Box>
        </Box>
        {details && errorOpen && <Typography color="error">{errorMsg}</Typography>}
        {details ? <MatchDetails key={`${details.divisieId}:${details.fixture.id}`} {...details} user={user} authAvailable={authAvailable} onBack={back} onSave={saveDetails} onRefresh={refreshDetails} /> : <>
        {!authAvailable && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Lokale preview: Firebase niet geconfigureerd. Opslaan vereist aanmelding.</Typography>}

  {/* Teams list removed per request; team data is still loaded to show names in match dropdown */}

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Divisie</Typography>
          <TextField
            label="Divisie"
            size="small"
            disabled={opening || loading}
            value={selectedDivisieId}
            onChange={(e) => {
              setStandings([]);
              setResults([]);
              setTeams([]);
              setSchedule([]);
              setScheduleAll([]);
              setCompletedSet(new Set());
              setAvailableRounds([]);
              setSelectedDivisieId(e.target.value);
              setRound('');
              setMatchId('');
              setLoaded(false);
              setErrorOpen(false);
              setErrorMsg('');
            }}
            select
            fullWidth
          >
            {POOL_OPTIONS.map((option) => (
              <MenuItem key={option.divisieId} value={option.divisieId}>{option.label}</MenuItem>
            ))}
          </TextField>
        </Paper>

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Stand</Typography>
          {standings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Nog geen stand beschikbaar.</Typography>
          ) : (
            <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '30px 1fr repeat(5, auto)', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'left', py: 0.5, px: 0.75 }}>Nr</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'left', py: 0.5, px: 0.75 }}>Team</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', py: 0.5, px: 0.75 }}>G</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', py: 0.5, px: 0.75 }}>W</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', py: 0.5, px: 0.75 }}>V</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', py: 0.5, px: 0.75 }}>Pnt</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', py: 0.5, px: 0.75 }}>Saldo</Typography>
              {standings.map((row, idx) => {
                // Determine background color based on position
                let bgColor = 'transparent';
                if (idx === 0) {
                  // 1st place - champion (light green)
                  bgColor = '#d4edda';
                } else if (idx >= standings.length - 2) {
                  // Last 2 places - relegation (light red)
                  bgColor = '#f8d7da';
                }
                
                return (
                  <React.Fragment key={row.teamId}>
                    <Typography variant="body2" sx={{ textAlign: 'left', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{idx + 1}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'left', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.name}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'center', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.played}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'center', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.won}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'center', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.lost}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'center', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.points}</Typography>
                    <Typography variant="body2" sx={{ textAlign: 'right', backgroundColor: bgColor, py: 0.5, px: 0.75 }}>{row.goalDiff}</Typography>
                  </React.Fragment>
                );
              })}
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Uitslag invoeren</Typography>
          {errorOpen && (
            <Typography variant="body2" color="error" sx={{ mb: 1 }}>{errorMsg}</Typography>
          )}
          {errorOpen && <Button onClick={() => loadPoolData(selectedDivisieId, POOL_OPTIONS.find((pool) => pool.divisieId === selectedDivisieId).divisie).catch((error) => { setErrorMsg(`Kon gegevens niet vernieuwen: ${error.message}`); setErrorOpen(true); })}>Opnieuw laden</Button>}
          <Stack spacing={1}>
            <TextField label="Speelronde" size="small" value={round} onChange={(e) => { const v = e.target.value; setRound(v); setMatchId(''); }} select fullWidth disabled={opening || loading || !selectedDivisieId || !availableRounds.length}>
              {availableRounds.map((r) => {
                const dateForRound = (() => {
                  const rows = scheduleAll.filter(m => String(m.round) === String(r));
                  const withDate = rows.find(m => m.date);
                  return withDate ? new Date(withDate.date).toLocaleDateString('nl-NL') : '—';
                })();
                return <MenuItem key={r} value={String(r)}>{`Speelronde ${r} • ${dateForRound}`}</MenuItem>;
              })}
            </TextField>
            <TextField label="Wedstrijd" size="small" value={matchId} onChange={(e) => setMatchId(e.target.value)} select fullWidth disabled={opening || loading || !selectedDivisieId || !schedule.length}>
              {schedule.map(m => {
                const home = teams.find(t => t.id === m.homeTeamId)?.name || m.homeTeamId;
                const away = teams.find(t => t.id === m.awayTeamId)?.name || m.awayTeamId;
                const label = `${m.matchNumber ? `${m.matchNumber} ` : ''}${home} - ${away}`;
                return <MenuItem key={m.id} value={m.id}>{label}</MenuItem>;
              })}
            </TextField>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography variant="body2" aria-live="polite">{loading || opening ? 'Uitslag laden…' : !loaded ? 'Uitslag niet beschikbaar' : !matchId ? 'Selecteer een wedstrijd' : summary.label}</Typography>
              <Button ref={detailsButtonRef} variant="contained" size="small" disabled={!selectedFixture || !loaded || loading || opening} onClick={openDetails} sx={{ ml: 'auto', textTransform: 'none' }}>Details</Button>
            </Box>
            {selectedFixture && summary.error && <Typography color="error" variant="body2">{summary.error}</Typography>}
          </Stack>
        </Paper>

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Uitslagen</Typography>
          {results.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Nog geen uitslagen ingevoerd.</Typography>
          ) : (
            <Box component="div" sx={{
              display: 'grid',
              gridTemplateColumns: '28px minmax(0,1fr) 42px minmax(0,1fr)',
              columnGap: 1,
              rowGap: 0,
              alignItems: 'center'
            }}>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Ronde</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Thuis</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Uitslag</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Uit</Typography>
              {results.map(r => {
                const homeName = teams.find(t => t.id === r.homeTeamId)?.name || r.homeTeam?.name || r.homeTeamId;
                const awayName = teams.find(t => t.id === r.awayTeamId)?.name || r.awayTeam?.name || r.awayTeamId;
                const rawRound = r.round || scheduleAll.find(m => m.id === (r.matchId || r.fixtureId))?.round;
                const roundNumber = (() => {
                  if (rawRound === undefined || rawRound === null) return '?';
                  const n = Number(rawRound);
                  if (Number.isNaN(n)) return String(rawRound);
                  return String(n).padStart(2, '0');
                })();
                const homeScore = String(r.homeScore).padStart(2, '0');
                const awayScore = String(r.awayScore).padStart(2, '0');
                const submitterTooltip = r.submittedBy ? `Ingevoerd door: ${r.submittedBy}` : '';
                const hoverCursor = submitterTooltip ? 'default' : undefined;
                const wrapWithTooltip = (content) =>
                  submitterTooltip ? (
                    <Tooltip title={submitterTooltip} placement="top" arrow enterDelay={300}>{content}</Tooltip>
                  ) : content;
                return (
                  <React.Fragment key={r.id}>
                    {wrapWithTooltip(<Typography variant="caption" sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap', cursor: hoverCursor }}>{roundNumber}</Typography>)}
                    {wrapWithTooltip(<Typography variant="caption" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', minWidth: 0, cursor: hoverCursor }}>{homeName}</Typography>)}
                    {wrapWithTooltip(<Typography variant="caption" sx={{ textAlign: 'center', fontSize: '0.65rem', whiteSpace: 'nowrap', cursor: hoverCursor }}>{homeScore} - {awayScore}</Typography>)}
                    {wrapWithTooltip(<Typography variant="caption" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', minWidth: 0, cursor: hoverCursor }}>{awayName}</Typography>)}
                  </React.Fragment>
                );
              })}
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Komende wedstrijden</Typography>
          {(() => {
            // Filter upcoming matches (not in completedSet), sort by date (older to newer)
            const upcomingMatches = scheduleAll
              .filter(m => !completedSet.has(m.id))
              .sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date(0);
                const dateB = b.date ? new Date(b.date) : new Date(0);
                return dateA - dateB;
              });
            
            if (upcomingMatches.length === 0) {
              return <Typography variant="body2" color="text.secondary">Alle wedstrijden zijn gespeeld.</Typography>;
            }
            
            return (
              <Box component="div" sx={{
                display: 'grid',
                gridTemplateColumns: '28px 72px minmax(0,1fr) minmax(0,1fr)',
                columnGap: 1,
                rowGap: 0,
                alignItems: 'center'
              }}>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Ronde</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Datum</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Thuis</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', whiteSpace: 'nowrap' }}>Uit</Typography>
                {upcomingMatches.map(m => {
                  const homeName = teams.find(t => t.id === m.homeTeamId)?.name || m.homeTeam?.name || m.homeTeamId;
                  const awayName = teams.find(t => t.id === m.awayTeamId)?.name || m.awayTeam?.name || m.awayTeamId;
                  const roundNumber = (() => {
                    if (m.round === undefined || m.round === null) return '?';
                    const n = Number(m.round);
                    if (Number.isNaN(n)) return String(m.round);
                    return String(n).padStart(2, '0');
                  })();
                  const dateStr = m.date
                    ? new Date(m.date).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : '—';
                  return (
                    <React.Fragment key={m.id}>
                      <Typography variant="caption" sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}>{roundNumber}</Typography>
                      <Typography variant="caption" sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}>{dateStr}</Typography>
                      <Typography variant="caption" title={homeName} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', minWidth: 0 }}>{homeName}</Typography>
                      <Typography variant="caption" title={awayName} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', minWidth: 0 }}>{awayName}</Typography>
                    </React.Fragment>
                  );
                })}
              </Box>
            );
          })()}
        </Paper>
        </>}
      </Box>
    </Container>
  );
}

export default App;
