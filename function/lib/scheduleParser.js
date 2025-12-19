import sanitizeHtml from 'sanitize-html';

const OFFICIAL_URL = 'https://nlpetanque.nl/topdivisie-2025-2026-1001/';

// Valid petanque match score total
const PETANQUE_MATCH_TOTAL_SCORE = 31;

// Forbidden scores (same as backend validation in routes/matches.js)
const FORBIDDEN_SCORES = [1, 3, 28, 30];

const MONTHS_NL = {
  'JANUARI': 1,
  'FEBRUARI': 2,
  'MAART': 3,
  'APRIL': 4,
  'MEI': 5,
  'JUNI': 6,
  'JULI': 7,
  'AUGUSTUS': 8,
  'SEPTEMBER': 9,
  'OKTOBER': 10,
  'NOVEMBER': 11,
  'DECEMBER': 12,
};

// Map team names from the website to team IDs used in our database
const TEAM_NAME_TO_ID = {
  "Amicale Boule d'Argent 1": 'amicale-boule-d-argent-1',
  "Boul'Animo 1": 'boul-animo-1',
  'CdP Les Cailloux 1': 'cdp-les-cailloux-1',
  "JBC 't Dupke 1": 'jbc-t-dupke-1',
  'Jeu de Bommel 1': 'jeu-de-bommel-1',
  'Petangeske 1': 'petangeske-1',
  'PUK-Haarlem 1': 'puk-haarlem-1',
  "'t Zwijntje 1": 't-zwijntje-1',
};

/**
 * Convert a team name from the website to a team ID.
 * Returns null if the team name is not recognized.
 */
export function teamNameToId(teamName) {
  return TEAM_NAME_TO_ID[teamName] || null;
}

function toIsoDate(day, monthName) {
  const m = MONTHS_NL[monthName?.toUpperCase()?.trim()] || null;
  if (!m) return null;
  // Use current year for September-December, next year for January-August
  // This handles the season spanning two calendar years
  const currentYear = new Date().getFullYear();
  const year = m >= 9 ? currentYear : currentYear + 1;
  const dd = String(Number(day)).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function cleanHtmlToLines(html) {
  // Use sanitize-html to safely remove scripts and styles first
  // This prevents any XSS vulnerabilities before we do regex-based processing
  let s = sanitizeHtml(html, {
    allowedTags: ['table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'],
    allowedAttributes: {},
    exclusiveFilter: function(frame) {
      return frame.tag === 'script' || frame.tag === 'style';
    }
  });
  
  // Process each <tr>...</tr> block
  s = s.replace(/<tr[^>]*>(.*?)<\/tr>/gis, (match, content) => {
    // Within this row, replace </td> and </th> with pipes
    let row = content.replace(/<\/(td|th)>/gi, '|');
    // Remove all remaining tags (safe after sanitize-html filtering)
    // CodeQL Warning: This regex-based tag removal is safe here because:
    // 1. sanitize-html has already removed script/style tags
    // 2. Only allowedTags remain (table, tr, td, th, h1-h6, br)
    // 3. Output is used only for data extraction, never rendered as HTML
    // Apply repeated replacement to ensure all tag-like patterns are removed (defense-in-depth)
    let prevRow;
    do {
      prevRow = row;
      row = row.replace(/<[^>]+>/g, '');
    } while (row !== prevRow);
    // Collapse whitespace
    row = row.replace(/\s+/g, ' ').trim();
    return `\n${row}\n`;
  });
  
  // Replace other block element closings with newlines
  s = s.replace(/<\/(table|h\d)>/gi, '\n');
  s = s.replace(/<br\s*\/?>(?=.)/gi, '\n');
  
  // Remove any remaining tags (safe after sanitize-html filtering above)
  // CodeQL Warning: This regex-based tag removal is safe here because:
  // 1. sanitize-html has already removed script/style tags  
  // 2. Only harmless structural tags remain
  // 3. Output is parsed for match numbers/dates, never rendered as HTML
  // Apply repeated replacement to ensure all tag-like patterns are removed (defense-in-depth)
  let prevS;
  do {
    prevS = s;
    s = s.replace(/<[^>]+>/g, '');
  } while (s !== prevS);
  
  // Clean up entities
  s = s.replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  
  // Split into lines and clean up
  const lines = s.split(/\n/).map(l => {
    return l.trim().replace(/\s*\|\s*/g, '|').replace(/\|+/g, '|');
  }).filter(l => l.length > 0);
  
  return lines;
}

export async function fetchOfficialHtml() {
  try {
    const res = await fetch(OFFICIAL_URL, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    throw new Error(`Failed to fetch official schedule: ${err.message}`);
  }
}

/**
 * Parse the official schedule HTML and extract match date updates.
 * Returns a map of matchNumber -> newDate for matches with changed dates.
 */
export function parseChangedDates(html) {
  const lines = cleanHtmlToLines(html);
  const changedDates = new Map();
  let currentRound = null;
  let roundDefaultDate = null;
  let aangepasteDatumColumnIndex = -1;

  for (const raw of lines) {
    // Check for round headers
    const hdr = raw.match(/(\d+)\.[^\d]*?(?:ZATERDAG|ZONDAG)\s+(\d{1,2})\s+([A-ZÀ-Ü]+)/i);
    if (hdr) {
      currentRound = Number(hdr[1]);
      roundDefaultDate = toIsoDate(hdr[2], hdr[3]);
      aangepasteDatumColumnIndex = -1; // Reset for each round
      continue;
    }

    // Check if this is a header row with "Aangepaste datum" column
    if (raw.includes('Aangepaste datum') || raw.includes('Aangepaste Datum')) {
      const cells = raw.split('|').map(c => c.trim()).filter(c => c.length > 0);
      aangepasteDatumColumnIndex = cells.findIndex(c => 
        c.toLowerCase().includes('aangepaste') && c.toLowerCase().includes('datum')
      );
      continue;
    }

    // Skip lines without match numbers
    if (!/1001\d{2}/.test(raw)) continue;

    const cells = raw.split('|').map(c => c.trim()).filter(c => c.length > 0);
    const numIdx = cells.findIndex(c => /^1001\d{2}$/.test(c));
    if (numIdx === -1) continue;

    const matchNumber = cells[numIdx];

    // Look for changed date in the "Aangepaste datum" column if we know its position
    let changedDateIso = null;
    if (aangepasteDatumColumnIndex >= 0 && aangepasteDatumColumnIndex < cells.length) {
      const changedDateCell = cells[aangepasteDatumColumnIndex];
      // Match d-m-yyyy or dd-mm-yyyy format (supports single or double digit day/month)
      const dateMatch = changedDateCell.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        // Basic validation: day 01-31, month 01-12
        const dayNum = parseInt(d, 10);
        const monthNum = parseInt(m, 10);
        if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
          // Pad day and month to 2 digits for ISO format
          const dayPadded = String(dayNum).padStart(2, '0');
          const monthPadded = String(monthNum).padStart(2, '0');
          changedDateIso = `${y}-${monthPadded}-${dayPadded}`;
        }
      }
    }

    // If no specific column index, search all cells after match number for a date
    if (!changedDateIso) {
      const dateCell = cells.slice(numIdx + 1).find(c => /\b\d{1,2}-\d{1,2}-\d{4}\b/.test(c));
      if (dateCell) {
        const parts = dateCell.split('-');
        if (parts.length === 3) {
          const [d, m, y] = parts;
          // Basic validation: day 01-31, month 01-12
          const dayNum = parseInt(d, 10);
          const monthNum = parseInt(m, 10);
          if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
            // Pad day and month to 2 digits for ISO format
            const dayPadded = String(dayNum).padStart(2, '0');
            const monthPadded = String(monthNum).padStart(2, '0');
            const parsedDate = `${y}-${monthPadded}-${dayPadded}`;
            // Only consider it a changed date if it differs from the round default
            if (parsedDate !== roundDefaultDate) {
              changedDateIso = parsedDate;
            }
          }
        }
      }
    }

    if (changedDateIso) {
      changedDates.set(matchNumber, changedDateIso);
    }
  }

  return changedDates;
}

/**
 * Parse the official schedule HTML and extract match results.
 * Returns a map of matchNumber -> { homeTeam, awayTeam, homeScore, awayScore }
 * Only includes matches that have results filled in.
 */
export function parseMatchResults(html) {
  const lines = cleanHtmlToLines(html);
  const results = new Map();

  for (const raw of lines) {
    // Skip lines without match numbers
    if (!/1001\d{2}/.test(raw)) continue;

    // Split by pipe - empty cells between pipes will be empty strings
    const allCells = raw.split('|').map(c => c.trim());
    const numIdx = allCells.findIndex(c => /^1001\d{2}$/.test(c));
    if (numIdx === -1) continue;

    const matchNumber = allCells[numIdx];
    
    // After cleanHtmlToLines, empty <td></td> elements are removed entirely from the output
    // So we need to look at the actual cells present, not assume fixed positions
    // The structure is: matchNumber | [aangepaste datum if present] | homeTeam | awayTeam | homeScore | awayScore | [match points...]
    
    // We'll use a heuristic: find the first two cells after match number that look like team names,
    // then the next two cells that look like scores
    
    // For now, let's use a simpler approach: check if there's a date-like cell after match number
    // If cell after match number looks like a date (d-m-yyyy), skip it
    let offset = 1; // Start looking after match number
    const cellAfterMatch = allCells[numIdx + offset] || '';
    
    // Check if it's a date in dd-mm-yyyy format
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(cellAfterMatch)) {
      offset++; // Skip the aangepaste datum column
    }
    
    // Now get teams and scores
    const homeTeam = allCells[numIdx + offset] || '';
    const awayTeam = allCells[numIdx + offset + 1] || '';
    const homeScoreStr = allCells[numIdx + offset + 2] || '';
    const awayScoreStr = allCells[numIdx + offset + 3] || '';
    
    // Check if scores are numeric and valid
    const homeScore = parseInt(homeScoreStr, 10);
    const awayScore = parseInt(awayScoreStr, 10);
    
    // Only include if both scores are valid numbers and team names are present
    if (!isNaN(homeScore) && !isNaN(awayScore) && homeScore >= 0 && awayScore >= 0 &&
        homeTeam && awayTeam) {
      // Validate scores: disallow forbidden scores (1, 3, 28, 30)
      if (FORBIDDEN_SCORES.includes(homeScore) || FORBIDDEN_SCORES.includes(awayScore)) {
        continue; // Skip this result as it has forbidden scores
      }
      
      // Basic validation: scores should sum to PETANQUE_MATCH_TOTAL_SCORE for a completed match
      if (homeScore + awayScore === PETANQUE_MATCH_TOTAL_SCORE) {
        results.set(matchNumber, {
          homeTeam: homeTeam.trim(),
          awayTeam: awayTeam.trim(),
          homeScore,
          awayScore
        });
      }
    }
  }

  return results;
}
