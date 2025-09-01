import React from 'react';
import { Container, Typography, Button, Box, Stack, TextField, MenuItem, Paper, Avatar, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { api } from './api';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut } from 'firebase/auth';

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
  const loadTeams = async () => setTeams(await api.getTeams());

  // Match schedule + result submission
  const [round, setRound] = React.useState('');
  const [schedule, setSchedule] = React.useState([]);
  const [scheduleAll, setScheduleAll] = React.useState([]);
  const [completedSet, setCompletedSet] = React.useState(new Set());
  const [availableRounds, setAvailableRounds] = React.useState([]);
  const [matchId, setMatchId] = React.useState('');
  const [scores, setScores] = React.useState({ homeScore: '', awayScore: '' });
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
  const handleDeleteResult = async (match) => {
    if (!user || !match?.id) return;
    // Build a small confirmation message
    const homeName = teams.find(t => t.id === match.homeTeamId)?.name || match.homeTeam?.name || match.homeTeamId || 'Thuis';
    const awayName = teams.find(t => t.id === match.awayTeamId)?.name || match.awayTeam?.name || match.awayTeamId || 'Uit';
    const number = match.matchNumber || match.fixtureId || match.matchId || match.id;
    const msg = `Weet je zeker dat je uitslag #${number} (${homeName} ${match.homeScore}-${match.awayScore} ${awayName}) wilt verwijderen?`;
    const ok = window.confirm(msg);
    if (!ok) return;
    try {
      await api.deleteMatch(match.id);
      // Refresh results and standings
      const submitted = await api.getMatches();
      setResults(submitted);
      setCompletedSet(new Set(submitted.map(m => m.matchId || m.fixtureId).filter(Boolean)));
      await loadStandings();
      // If current round becomes available again, recompute derived schedule state
      setScheduleAll(await api.getSchedule());
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };
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
    if (!matchId || !user) return;
    try {
      await api.submitResult({ matchId, homeScore: scores.homeScore, awayScore: scores.awayScore });
      setMatchId('');
  setScores({ homeScore: '', awayScore: '' });
      await loadStandings();
      // refresh submitted set so the just-saved match disappears
      const submitted = await api.getMatches();
      setCompletedSet(new Set(submitted.map(m => m.matchId || m.fixtureId).filter(Boolean)));
  setResults(submitted);
    } catch (err) {
      setErrorMsg(`Kon uitslag niet opslaan: ${err?.message || err}`);
      setErrorOpen(true);
    }
  };

  // Standings state
  const [standings, setStandings] = React.useState([]);
  const loadStandings = async () => setStandings(await api.getStandings());

  React.useEffect(() => {
    (async () => {
  await loadTeams();
  await loadStandings();
  // prefetch all matches schedule so we can show dates per round
  const all = await api.getSchedule();
  setScheduleAll(all);
  // build a set of submitted match ids to hide from selection
  const submitted = await api.getMatches();
  const ids = new Set(submitted.map(m => m.matchId || m.fixtureId).filter(Boolean));
  setCompletedSet(ids);
  setResults(submitted);
    })();
  }, []);

  return (
    <Container maxWidth="sm">
      <Box sx={{ textAlign: 'left', mt: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h3" sx={{ m: 0 }}>NPC Standen</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {user ? (
              <>
                <Avatar
                  src={user.photoURL || undefined}
                  alt={(user.displayName || user.email || 'Gebruiker')}
                  sx={{ width: 32, height: 32 }}
                />
                <Button variant="outlined" color="secondary" onClick={handleSignOut}>Sign Out</Button>
              </>
            ) : (
              <Button variant="contained" onClick={() => handleSignIn(googleProvider)}>Inloggen met Google</Button>
            )}
          </Box>
        </Box>

  {/* Teams list removed per request; team data is still loaded to show names in match dropdown */}

        <Paper sx={{ p: 2, mb: 3 }} elevation={1}>
          <Typography variant="h6" gutterBottom>Uitslag invoeren Topdivisie</Typography>
          <Stack spacing={1} component="form" onSubmit={submitResult}>
            {/* First row: round + match selectors */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <TextField label="Speelronde" size="small" value={round} onChange={(e) => { const v = e.target.value; setRound(v); setMatchId(''); }} select sx={{ minWidth: 260 }} disabled={!availableRounds.length}>
                {availableRounds.map((r) => {
                  const dateForRound = (() => {
                    const rows = scheduleAll.filter(m => String(m.round) === String(r));
                    const withDate = rows.find(m => m.date);
                    return withDate ? new Date(withDate.date).toLocaleDateString('nl-NL') : '—';
                  })();
                  return <MenuItem key={r} value={String(r)}>{`Speelronde ${r} • ${dateForRound}`}</MenuItem>;
                })}
              </TextField>
        <TextField label="Wedstrijd" size="small" value={matchId} onChange={(e) => setMatchId(e.target.value)} select sx={{ minWidth: 360 }} disabled={!schedule.length}>
                {schedule.map(m => {
                  const home = teams.find(t => t.id === m.homeTeamId)?.name || m.homeTeamId;
                  const away = teams.find(t => t.id === m.awayTeamId)?.name || m.awayTeamId;
                  const label = `${m.matchNumber ? `#${m.matchNumber} ` : ''}${home} vs ${away}`;
                  return <MenuItem key={m.id} value={m.id}>{label}</MenuItem>;
                })}
              </TextField>
            </Box>
            {/* Second row: score inputs below the match selector with submit button on the same line */}
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
                sx={{ width: 140 }}
              />
              <TextField
                label="Uit punten"
                size="small"
                type="number"
                value={scores.awayScore}
                // Disabled: users can only input the home score; away is auto-calculated
                disabled
                inputProps={{ min: 0, max: 31, step: 1 }}
                error={awayShowError}
                helperText={awayShowError ? 'Score 1, 3, 28 of 30 is niet toegestaan' : ''}
                sx={{ width: 120 }}
              />
              <Button type="submit" variant="contained" disabled={!user || !matchId || scores.homeScore === '' || scores.awayScore === '' || invalidScore} sx={{ ml: 'auto' }}>Opslaan</Button>
            </Box>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, mb: 3 }} elevation={1}>
          <Typography variant="h6" gutterBottom>Stand</Typography>
          {standings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Nog geen stand beschikbaar.</Typography>
          ) : (
            <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '36px 1fr repeat(5, auto)', gap: 1, alignItems: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center' }}>Nr</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'left' }}>Team</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>G</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>W</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>V</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Pnt</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Saldo</Typography>
              {standings.map((row, idx) => (
                <React.Fragment key={row.teamId}>
                  <Typography variant="body2" sx={{ textAlign: 'center' }}>{idx + 1}</Typography>
                  <Typography variant="body2" sx={{ textAlign: 'left' }}>{row.name}</Typography>
                  <Typography variant="body2">{row.played}</Typography>
                  <Typography variant="body2">{row.won}</Typography>
                  <Typography variant="body2">{row.lost}</Typography>
                  <Typography variant="body2">{row.points}</Typography>
                  <Typography variant="body2">{row.goalDiff}</Typography>
                </React.Fragment>
              ))}
            </Box>
          )}
        </Paper>

        <Paper sx={{ p: 2, mb: 3 }} elevation={1}>
          <Typography variant="h6" gutterBottom>Ingevoerde uitslagen</Typography>
          {results.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Nog geen uitslagen ingevoerd.</Typography>
          ) : (
            <Box component="div" sx={{
              display: 'grid',
              // When logged in: number, home, score, away, delete (keep last very small)
              // When logged out: number, home, score, away
              gridTemplateColumns: user ? '40px minmax(0,1fr) 44px minmax(0,1fr) 24px' : '40px minmax(0,1fr) 44px minmax(0,1fr)',
              columnGap: 4,
              rowGap: 0,
              alignItems: 'center'
            }}>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Wedstrijd</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Thuis</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Uitslag</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>Uit</Typography>
              {user && <span />}
              {results.map(r => {
                const homeName = teams.find(t => t.id === r.homeTeamId)?.name || r.homeTeam?.name || r.homeTeamId;
                const awayName = teams.find(t => t.id === r.awayTeamId)?.name || r.awayTeam?.name || r.awayTeamId;
                const number = r.matchNumber || r.fixtureId || r.matchId || r.id;
                return (
                  <React.Fragment key={r.id}>
                    <Typography variant="caption" sx={{ fontSize: '0.68rem', whiteSpace: 'nowrap' }}>#{number}</Typography>
                    <Typography variant="caption" title={homeName} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.68rem' }}>{homeName}</Typography>
                    <Typography variant="caption" sx={{ textAlign: 'center', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{r.homeScore} - {r.awayScore}</Typography>
                    <Typography variant="caption" title={awayName} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.68rem' }}>{awayName}</Typography>
        {user && (
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Tooltip title="Verwijder" placement="left" arrow>
                          <IconButton size="small" aria-label="verwijder" onClick={() => handleDeleteResult(r)} sx={{ p: 0.25 }}>
                              <CloseIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </React.Fragment>
                );
              })}
            </Box>
          )}
        </Paper>
      </Box>
    </Container>
  );
}

export default App;
