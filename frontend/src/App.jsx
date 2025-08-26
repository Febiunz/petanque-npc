import React from 'react';
import { Container, Typography, Button, Box, Stack, TextField, MenuItem, Paper } from '@mui/material';
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
  const [scores, setScores] = React.useState({ homeScore: 0, awayScore: 0 });
  const [results, setResults] = React.useState([]);
  // derive round matches from cached full schedule while hiding completed ones
  React.useEffect(() => {
    if (!round) { setSchedule([]); return; }
    const rows = scheduleAll
      .filter(m => String(m.round) === String(round))
      .filter(m => {
        // hide if explicitly completed in schedule or found in submitted matches
        if (m.status && String(m.status).toLowerCase() === 'completed') return false;
        return !completedSet.has(m.id);
      });
    setSchedule(rows);
  }, [round, scheduleAll, completedSet]);

  // compute available rounds that still have open matches; if current round closes, clear selection
  React.useEffect(() => {
    const openMatches = scheduleAll.filter(m => {
      if (m.status && String(m.status).toLowerCase() === 'completed') return false;
      return !completedSet.has(m.id);
    });
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
      setScores({ homeScore: 0, awayScore: 0 });
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
      <Box sx={{ textAlign: 'center', mt: 4 }}>
  <Typography variant="h3" gutterBottom>NPC Standen</Typography>
        <Stack spacing={2} sx={{ mt: 2, mb: 4 }}>
          {user ? (
            <>
              <Typography variant="body2">{user.displayName} ({user.email})</Typography>
              <Button variant="outlined" color="secondary" onClick={handleSignOut}>Sign Out</Button>
            </>
          ) : (
            <>
              <Button variant="contained" onClick={() => handleSignIn(googleProvider)}>Inloggen met Google</Button>
            </>
          )}
        </Stack>

  {/* Teams list removed per request; team data is still loaded to show names in match dropdown */}

        <Paper sx={{ p: 2, mb: 3 }} elevation={1}>
          <Typography variant="h6" gutterBottom>Uitslag invoeren</Typography>
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
            {/* Second row: score inputs below the match selector */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                label="Thuis punten"
                size="small"
                type="number"
                value={scores.homeScore}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  const home = Number.isFinite(raw) ? Math.max(0, Math.min(31, raw)) : 0;
                  const away = 31 - home;
                  setScores({ homeScore: home, awayScore: away });
                }}
                inputProps={{ min: 0, max: 31, step: 1 }}
                sx={{ width: 140 }}
              />
              <TextField
                label="Uit punten"
                size="small"
                type="number"
                value={scores.awayScore}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  const away = Number.isFinite(raw) ? Math.max(0, Math.min(31, raw)) : 0;
                  const home = 31 - away;
                  setScores({ homeScore: home, awayScore: away });
                }}
                inputProps={{ min: 0, max: 31, step: 1 }}
                sx={{ width: 120 }}
              />
            </Box>
            <Box>
              <Button type="submit" variant="contained" disabled={!user || !matchId}>Opslaan</Button>
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
              // Four columns: number, home, score, away
              gridTemplateColumns: '72px minmax(0,1fr) 64px minmax(0,1fr)',
              columnGap: 8,
              rowGap: 0,
              alignItems: 'center'
            }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Wedstrijd</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Thuis</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center' }}>Uitslag</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Uit</Typography>
              {results.map(r => {
                const homeName = teams.find(t => t.id === r.homeTeamId)?.name || r.homeTeam?.name || r.homeTeamId;
                const awayName = teams.find(t => t.id === r.awayTeamId)?.name || r.awayTeam?.name || r.awayTeamId;
                const number = r.matchNumber || r.fixtureId || r.matchId || r.id;
                return (
                  <React.Fragment key={r.id}>
                    <Typography variant="caption">#{number}</Typography>
                    <Typography variant="caption" title={homeName} sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{homeName}</Typography>
                    <Typography variant="caption" sx={{ textAlign: 'center' }}>{r.homeScore} - {r.awayScore}</Typography>
                    <Typography variant="caption" title={awayName} sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{awayName}</Typography>
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
