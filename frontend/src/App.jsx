import React from 'react';
import { Container, Typography, Button, Box, Stack, TextField, MenuItem, Paper, Avatar, Tooltip } from '@mui/material';
import { api } from './api';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut } from 'firebase/auth';

const POOL_OPTIONS = [
  { divisie: 'topdivisie', divisieId: '1001', label: 'Topdivisie - 1001' },
  { divisie: '2e-divisie', divisieId: '2001', label: '2e divisie - 2001' },
  { divisie: '2e-divisie', divisieId: '2002', label: '2e divisie - 2002' },
];

function App() {

  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => setUser(u));
    return unsubscribe;
  }, []);

  const handleSignIn = (provider) => {
    signInWithPopup(auth, provider);
  };

  const handleSignOut = () => {
    signOut(auth);
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
  const [scores, setScores] = React.useState({ homeScore: '', awayScore: '' });
  const [errorMsg, setErrorMsg] = React.useState('');
  const [errorOpen, setErrorOpen] = React.useState(false);
  const loadRequestRef = React.useRef(0);
  const disallowedScores = new Set([1, 3, 28, 30]);
  const homeScoreNum = parseInt(scores.homeScore, 10);
  const awayScoreNum = parseInt(scores.awayScore, 10);
  const homeInvalid = scores.homeScore === '' || isNaN(homeScoreNum) || disallowedScores.has(homeScoreNum);
  const awayInvalid = scores.awayScore === '' || isNaN(awayScoreNum) || disallowedScores.has(awayScoreNum);
  // Only show error message for disallowed scores when a score has been entered
  const homeShowError = scores.homeScore !== '' && !isNaN(homeScoreNum) && disallowedScores.has(homeScoreNum);
  const awayShowError = scores.awayScore !== '' && !isNaN(awayScoreNum) && disallowedScores.has(awayScoreNum);
  const invalidScore = homeInvalid || awayInvalid;
  const [results, setResults] = React.useState([]);

  // derive round matches from cached full schedule while hiding completed ones
  React.useEffect(() => {
    if (!round) { setSchedule([]); return; }
    const rows = scheduleAll
      .filter(m => String(m.round) === String(round))
  .filter(m => !completedSet.has(m.id));
    setSchedule(rows);
  }, [round, scheduleAll, completedSet]);

  // compute available rounds that still have open matches; if current round closes, clear selection
  React.useEffect(() => {
  const openMatches = scheduleAll.filter(m => !completedSet.has(m.id));
    const rounds = Array.from(new Set(openMatches.map(m => String(m.round)))).sort((a, b) => Number(a) - Number(b));
    setAvailableRounds(rounds);
    if (round && !rounds.includes(String(round))) {
      setRound('');
      setMatchId('');
      setSchedule([]);
    }
  }, [scheduleAll, completedSet]);
  const submitResult = async (e) => {
    e.preventDefault();
    if (!matchId || !user || !selectedDivisieId) return;
    try {
      await api.submitResult({
        matchId,
        homeScore: scores.homeScore,
        awayScore: scores.awayScore,
        divisieId: selectedDivisieId,
      });
      setMatchId('');
      setScores({ homeScore: '', awayScore: '' });
        const pool = POOL_OPTIONS.find((p) => p.divisieId === selectedDivisieId);
        await loadPoolData(selectedDivisieId, pool?.divisie || '');
      setErrorOpen(false);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(`Kon uitslag niet opslaan: ${err?.message || err}`);
      setErrorOpen(true);
    }
  };

  // Standings state
  const [standings, setStandings] = React.useState([]);

  const loadPoolData = React.useCallback(async (divisieId, divisie) => {
    const requestId = ++loadRequestRef.current;
    if (!divisieId) {
      if (requestId !== loadRequestRef.current) return;
      setTeams([]);
      setScheduleAll([]);
      setCompletedSet(new Set());
      setStandings([]);
      setResults([]);
      return;
    }
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
    setCompletedSet(new Set(submittedRows.map((row) => row.matchId || row.fixtureId).filter(Boolean)));
    setResults(submittedRows);
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
              <Button variant="contained" size="small" onClick={() => handleSignIn(googleProvider)}>Inloggen met Google</Button>
            )}
          </Box>
        </Box>

  {/* Teams list removed per request; team data is still loaded to show names in match dropdown */}

        <Paper sx={{ p: 1.5, mb: 2 }} elevation={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Divisie</Typography>
          <TextField
            label="Divisie"
            size="small"
            value={selectedDivisieId}
            onChange={(e) => {
              setSelectedDivisieId(e.target.value);
              setRound('');
              setMatchId('');
              setScores({ homeScore: '', awayScore: '' });
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
          <Stack spacing={1} component="form" onSubmit={submitResult}>
            <TextField label="Speelronde" size="small" value={round} onChange={(e) => { const v = e.target.value; setRound(v); setMatchId(''); }} select fullWidth disabled={!selectedDivisieId || !availableRounds.length}>
              {availableRounds.map((r) => {
                const dateForRound = (() => {
                  const rows = scheduleAll.filter(m => String(m.round) === String(r));
                  const withDate = rows.find(m => m.date);
                  return withDate ? new Date(withDate.date).toLocaleDateString('nl-NL') : '—';
                })();
                return <MenuItem key={r} value={String(r)}>{`Speelronde ${r} • ${dateForRound}`}</MenuItem>;
              })}
            </TextField>
            <TextField label="Wedstrijd" size="small" value={matchId} onChange={(e) => setMatchId(e.target.value)} select fullWidth disabled={!selectedDivisieId || !schedule.length}>
              {schedule.map(m => {
                const home = teams.find(t => t.id === m.homeTeamId)?.name || m.homeTeamId;
                const away = teams.find(t => t.id === m.awayTeamId)?.name || m.awayTeamId;
                const label = `${m.matchNumber ? `${m.matchNumber} ` : ''}${home} - ${away}`;
                return <MenuItem key={m.id} value={m.id}>{label}</MenuItem>;
              })}
            </TextField>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label="Thuis punten"
                size="small"
                type="number"
                value={scores.homeScore}
                onChange={(e) => {
                  const text = e.target.value;
                  if (text === '') {
                    setScores({ homeScore: '', awayScore: '' });
                    return;
                  }
                  const raw = parseInt(text, 10);
                  if (!Number.isFinite(raw)) {
                    setScores({ homeScore: '', awayScore: '' });
                    return;
                  }
                  const home = Math.max(0, Math.min(31, raw));
                  const away = 31 - home;
                  setScores({ homeScore: home, awayScore: away });
                }}
                inputProps={{ min: 0, max: 31, step: 1 }}
                error={homeShowError}
                helperText={homeShowError ? 'Score 1, 3, 28 of 30 is niet toegestaan' : ''}
                sx={{ width: 120 }}
              />
              <TextField
                label="Uit punten"
                size="small"
                type="number"
                value={scores.awayScore}
                disabled
                inputProps={{ min: 0, max: 31, step: 1 }}
                error={awayShowError}
                helperText={awayShowError ? 'Score 1, 3, 28 of 30 is niet toegestaan' : ''}
                sx={{ width: 120 }}
              />
              <Button type="submit" variant="contained" size="small" disabled={!selectedDivisieId || !user || !matchId || scores.homeScore === '' || scores.awayScore === '' || invalidScore} sx={{ ml: 'auto' }}>Opslaan</Button>
            </Box>
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
      </Box>
    </Container>
  );
}

export default App;
