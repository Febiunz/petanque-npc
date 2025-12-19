import { app } from '@azure/functions';
import { fetchOfficialHtml, parseChangedDates, parseMatchResults, teamNameToId } from '../../lib/scheduleParser.js';
import { readSchedule, updateSchedule, readMatches, updateMatches } from '../../lib/storage.js';
import { randomUUID } from 'node:crypto';

/**
 * Azure Function that runs weekly on Monday evenings to:
 * 1. Check for changed match dates on the official website and update the schedule
 * 2. Check for missing or incorrect match results and update them
 * 
 * Timer trigger: Every Monday at 20:00 UTC (0 0 20 * * MON)
 * 
 * Storage: Uses Azure Blob Storage (npcstandenstorageaccount)
 * - Container: data
 * - Files: schedule.json, matches.json
 * - Requires: AZURE_STORAGE_CONNECTION_STRING environment variable
 */
app.timer('schedule-updater', {
  schedule: '0 0 20 * * MON',
  handler: async (myTimer, context) => {
    context.log('Schedule updater function triggered at:', new Date().toISOString());

    try {
      // Fetch the official schedule HTML
      context.log('Fetching official schedule from website...');
      const html = await fetchOfficialHtml();
      
      // ===== Part 1: Update changed dates =====
      context.log('Parsing changed dates...');
      const changedDates = parseChangedDates(html);
      
      let scheduleUpdated = false;
      let schedule = null; // Will be loaded if needed
      if (changedDates.size === 0) {
        context.log('No changed dates found.');
      } else {
        context.log(`Found ${changedDates.size} match(es) with changed dates`);

        // Read current schedule from storage
        context.log('Reading current schedule from storage...');
        schedule = await readSchedule();

        // Update matches with changed dates
        let updatedCount = 0;
        for (const [matchNumber, newDate] of changedDates) {
          const match = schedule.find(m => m.matchNumber === matchNumber);
          if (match) {
            const oldDate = match.date;
            match.date = newDate;
            updatedCount++;
            context.log(`Updated match ${matchNumber}: ${oldDate} -> ${newDate}`);
          } else {
            context.warn(`Match ${matchNumber} not found in schedule`);
          }
        }

        if (updatedCount > 0) {
          // Save updated schedule back to storage
          context.log(`Saving ${updatedCount} updated match date(s) to storage...`);
          await updateSchedule(schedule);
          context.log('Schedule dates updated successfully!');
          scheduleUpdated = true;
        }
      }

      // ===== Part 2: Check and fix match results =====
      context.log('Parsing match results from website...');
      const officialResults = parseMatchResults(html);
      
      if (officialResults.size === 0) {
        context.log('No results found on official website.');
        return;
      }
      
      context.log(`Found ${officialResults.size} match(es) with results on official website`);
      
      // Read current matches from storage
      context.log('Reading current matches from storage...');
      const { matches, etag } = await readMatches();
      
      // Read schedule to get match metadata (reuse if already loaded)
      if (!scheduleUpdated) {
        schedule = await readSchedule();
      }
      
      // Create a map of existing matches by matchNumber for quick lookup
      const existingMatchesMap = new Map();
      for (const match of matches) {
        const matchNum = match.matchNumber || match.fixtureId;
        if (matchNum) {
          existingMatchesMap.set(matchNum, match);
        }
      }
      
      let addedCount = 0;
      let correctedCount = 0;
      const matchesToAdd = [];
      const matchesToCorrect = [];
      
      // Check each official result
      for (const [matchNumber, officialResult] of officialResults) {
        // Convert team names to IDs
        const homeTeamId = teamNameToId(officialResult.homeTeam);
        const awayTeamId = teamNameToId(officialResult.awayTeam);
        
        if (!homeTeamId || !awayTeamId) {
          context.warn(`Could not map team names for match ${matchNumber}: ${officialResult.homeTeam} vs ${officialResult.awayTeam}`);
          continue;
        }
        
        // Find the scheduled match to get the date
        const scheduledMatch = schedule.find(m => m.matchNumber === matchNumber);
        if (!scheduledMatch) {
          context.warn(`Match ${matchNumber} not found in schedule`);
          continue;
        }
        
        // Validate that the team IDs from the schedule match the derived team IDs
        if (scheduledMatch.homeTeamId !== homeTeamId || scheduledMatch.awayTeamId !== awayTeamId) {
          context.warn(
            `Team ID mismatch for match ${matchNumber}: ` +
            `schedule has ${scheduledMatch.homeTeamId} vs ${scheduledMatch.awayTeamId}, ` +
            `derived from official results are ${homeTeamId} vs ${awayTeamId} ` +
            `(${officialResult.homeTeam} vs ${officialResult.awayTeam})`
          );
          continue; // Skip this result due to team mismatch
        }
        
        // Check if we already have this result
        const existingMatch = existingMatchesMap.get(matchNumber);
        
        if (!existingMatch) {
          // Missing result - add it
          const newMatch = {
            id: randomUUID(),
            date: scheduledMatch.date,
            fixtureId: matchNumber,
            matchId: matchNumber,
            matchNumber: matchNumber,
            homeTeamId: homeTeamId,
            awayTeamId: awayTeamId,
            homeScore: officialResult.homeScore,
            awayScore: officialResult.awayScore,
            createdAt: new Date().toISOString(),
            submittedBy: 'system-sync',
            submittedByUid: null
          };
          matchesToAdd.push(newMatch);
          addedCount++;
          context.log(`Adding missing result for match ${matchNumber}: ${officialResult.homeTeam} ${officialResult.homeScore}-${officialResult.awayScore} ${officialResult.awayTeam}`);
        } else {
          // Check if the result is different
          if (existingMatch.homeScore !== officialResult.homeScore || 
              existingMatch.awayScore !== officialResult.awayScore) {
            // Incorrect result - correct it
            context.log(`Correcting result for match ${matchNumber}:`);
            context.log(`  Old: ${existingMatch.homeScore}-${existingMatch.awayScore}`);
            context.log(`  New: ${officialResult.homeScore}-${officialResult.awayScore}`);
            
            existingMatch.homeScore = officialResult.homeScore;
            existingMatch.awayScore = officialResult.awayScore;
            existingMatch.correctedAt = new Date().toISOString();
            existingMatch.correctedBy = 'system-sync';
            
            matchesToCorrect.push(existingMatch);
            correctedCount++;
          }
        }
      }
      
      // Apply changes if any
      if (addedCount > 0 || correctedCount > 0) {
        // Add new matches
        matches.push(...matchesToAdd);
        
        // Save updated matches back to storage with ETag for concurrency control
        context.log(`Saving ${addedCount} new and ${correctedCount} corrected match result(s) to storage...`);
        await updateMatches(matches, etag);
        context.log('Match results updated successfully!');
        context.log('Standings will be recalculated dynamically on the next /api/standings request.');
      } else {
        context.log('All match results are up to date.');
      }
      
      // Summary
      context.log('=== Summary ===');
      context.log(`Schedule dates updated: ${scheduleUpdated ? 'Yes' : 'No'}`);
      context.log(`Results added: ${addedCount}`);
      context.log(`Results corrected: ${correctedCount}`);
      context.log('Function completed successfully!');

    } catch (err) {
      context.error('Error updating schedule and results:', err);
      throw err;
    }
  }
});
