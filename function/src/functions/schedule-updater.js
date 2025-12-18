import { app } from '@azure/functions';
import { fetchOfficialHtml, parseChangedDates } from '../lib/scheduleParser.js';
import { readSchedule, updateSchedule } from '../lib/storage.js';

/**
 * Azure Function that runs weekly on Monday evenings to check for changed match dates
 * on the official website and updates the schedule accordingly.
 * 
 * Timer trigger: Every Monday at 20:00 UTC (0 0 20 * * MON)
 * 
 * Storage: Uses Azure Blob Storage (npcstandenstorageaccount)
 * - Container: data
 * - File: schedule.json
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
      
      // Parse changed dates from the HTML
      context.log('Parsing changed dates...');
      const changedDates = parseChangedDates(html);
      
      if (changedDates.size === 0) {
        context.log('No changed dates found. Schedule is up to date.');
        return;
      }

      context.log(`Found ${changedDates.size} match(es) with changed dates`);

      // Read current schedule from storage
      context.log('Reading current schedule from storage...');
      const schedule = await readSchedule();

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
        context.log(`Saving ${updatedCount} updated match(es) to storage...`);
        await updateSchedule(schedule);
        context.log('Schedule updated successfully!');
      } else {
        context.log('No matches were updated in the schedule.');
      }

    } catch (err) {
      context.error('Error updating schedule:', err);
      throw err;
    }
  }
});
