import sanitizeHtml from 'sanitize-html';

const OFFICIAL_URL = 'https://nlpetanque.nl/topdivisie-2025-2026-1001/';

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

function toIsoDate(day, monthName) {
  const m = MONTHS_NL[monthName?.toUpperCase()?.trim()] || null;
  if (!m) return null;
  const year = m >= 9 ? 2025 : 2026;
  const dd = String(Number(day)).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function cleanHtmlToLines(html) {
  // First, we need to ensure each table row becomes a single line
  // Replace newlines within rows with spaces
  let s = html;
  
  // Process each <tr>...</tr> block
  s = s.replace(/<tr[^>]*>(.*?)<\/tr>/gis, (match, content) => {
    // Within this row, replace </td> and </th> with pipes
    let row = content.replace(/<\/(td|th)>/gi, '|');
    // Remove all remaining tags
    row = row.replace(/<[^>]+>/g, '');
    // Collapse whitespace
    row = row.replace(/\s+/g, ' ').trim();
    return `\n${row}\n`;
  });
  
  // Replace other block element closings with newlines
  s = s.replace(/<\/(table|h\d)>/gi, '\n');
  s = s.replace(/<br\s*\/?>(?=.)/gi, '\n');
  
  // Remove any remaining tags (like opening tags, html, body, etc.)
  s = s.replace(/<[^>]+>/g, '');
  
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
      // Match dd-mm-yyyy format
      const dateMatch = changedDateCell.match(/\b(\d{2})-(\d{2})-(\d{4})\b/);
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        changedDateIso = `${y}-${m}-${d}`;
      }
    }

    // If no specific column index, search all cells after match number for a date
    if (!changedDateIso) {
      const dateCell = cells.slice(numIdx + 1).find(c => /\b\d{2}-\d{2}-\d{4}\b/.test(c));
      if (dateCell) {
        const [d, m, y] = dateCell.split('-');
        const parsedDate = `${y}-${m}-${d}`;
        // Only consider it a changed date if it differs from the round default
        if (parsedDate !== roundDefaultDate) {
          changedDateIso = parsedDate;
        }
      }
    }

    if (changedDateIso) {
      changedDates.set(matchNumber, changedDateIso);
    }
  }

  return changedDates;
}
