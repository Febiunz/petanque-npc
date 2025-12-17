#!/usr/bin/env node

/**
 * Test script to verify the schedule parser logic
 * Run with: node test-parser.mjs
 * 
 * This test verifies that the parser correctly identifies matches
 * with changed dates in the "Aangepaste datum" column.
 */

import { parseChangedDates } from './lib/scheduleParser.js';

// Sample HTML that simulates the official website structure
const sampleHtml = `
<html>
<body>
<h2>1. ZATERDAG 20 SEPTEMBER</h2>
<table>
  <tr>
    <th>Nr.</th>
    <th>Thuis</th>
    <th>Uit</th>
    <th>Datum</th>
    <th>Aangepaste datum</th>
  </tr>
  <tr>
    <td>100101</td>
    <td>Boul'Animo 1</td>
    <td>JBC 't Dupke 1</td>
    <td>20-09-2025</td>
    <td></td>
  </tr>
  <tr>
    <td>100102</td>
    <td>PUK-Haarlem 1</td>
    <td>'t Zwijntje 1</td>
    <td>20-09-2025</td>
    <td>27-09-2025</td>
  </tr>
</table>

<h2>2. ZATERDAG 04 OKTOBER</h2>
<table>
  <tr>
    <th>Nr.</th>
    <th>Thuis</th>
    <th>Uit</th>
    <th>Datum</th>
    <th>Aangepaste datum</th>
  </tr>
  <tr>
    <td>100105</td>
    <td>Jeu de Bommel 1</td>
    <td>Amicale Boule d'Argent 1</td>
    <td>04-10-2025</td>
    <td>11-10-2025</td>
  </tr>
</table>
</body>
</html>
`;

console.log('Testing schedule parser...\n');
console.log('Sample HTML simulates:');
console.log('- Round 1, match 100102: changed from 20-09-2025 to 27-09-2025');
console.log('- Round 2, match 100105: changed from 04-10-2025 to 11-10-2025\n');

const changedDates = parseChangedDates(sampleHtml);

console.log('Parsed changed dates:');
if (changedDates.size === 0) {
  console.log('  No changes detected');
} else {
  for (const [matchNumber, newDate] of changedDates) {
    console.log(`  Match ${matchNumber}: ${newDate}`);
  }
}

console.log('\nExpected results:');
console.log('  Match 100102: 2025-09-27');
console.log('  Match 100105: 2025-10-11');

// Verify results
const expected = new Map([
  ['100102', '2025-09-27'],
  ['100105', '2025-10-11']
]);

let success = true;
for (const [match, date] of expected) {
  if (changedDates.get(match) !== date) {
    console.log(`\n❌ FAILED: Expected ${match} to have date ${date}, got ${changedDates.get(match) || 'undefined'}`);
    success = false;
  }
}

if (success && changedDates.size === expected.size) {
  console.log('\n✅ All tests passed!');
} else {
  console.log('\n❌ Tests failed!');
  process.exit(1);
}
