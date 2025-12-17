import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Storage helper for reading and updating schedule.json
 * 
 * Two modes are supported:
 * 1. Shared File Mount: If SCHEDULE_FILE_PATH is set, read/write directly to that path
 *    (requires Azure Functions to have a file share mounted at the same location as the backend)
 * 2. Local Mode: For local development, uses a local path
 */

const scheduleFilePath = process.env.SCHEDULE_FILE_PATH || `${__dirname}/../../data/schedule.json`;

export async function readSchedule() {
  try {
    const content = await fs.readFile(scheduleFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`schedule.json not found at ${scheduleFilePath}`);
    }
    throw err;
  }
}

export async function updateSchedule(schedule) {
  // Write atomically using a temp file
  const tmpPath = `${scheduleFilePath}.tmp`;
  const content = JSON.stringify(schedule, null, 2);
  
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, scheduleFilePath);
}
