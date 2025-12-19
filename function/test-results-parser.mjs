#!/usr/bin/env node

/**
 * Test script to verify the results parser logic
 * Run with: node test-results-parser.mjs
 * 
 * This test verifies that the parser correctly extracts match results
 * from the official website HTML.
 */

import { parseMatchResults, teamNameToId } from './lib/scheduleParser.js';

// Sample HTML that simulates the official website structure with results
const sampleHtml = `
<html>
<body>
<h2>1. ZATERDAG 20 SEPTEMBER</h2>
<table>
  <tr>
    <th>Wednr:</th>
    <th>Aangepaste datum:</th>
    <th>Thuis:</th>
    <th>Uit:</th>
    <th colspan="2">Uitslag:</th>
    <th colspan="2">Partijpunten:</th>
  </tr>
  <tr>
    <td>100101</td>
    <td></td>
    <td>Boul'Animo 1</td>
    <td>JBC 't Dupke 1</td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td>100102</td>
    <td></td>
    <td>PUK-Haarlem 1</td>
    <td>'t Zwijntje 1</td>
    <td>24</td>
    <td>7</td>
    <td>128</td>
    <td>83</td>
  </tr>
  <tr>
    <td>100103</td>
    <td></td>
    <td>Amicale Boule d'Argent 1</td>
    <td>Petangeske 1</td>
    <td>12</td>
    <td>19</td>
    <td>92</td>
    <td>125</td>
  </tr>
</table>
</body>
</html>
`;

console.log('Testing results parser...\n');
console.log('Sample HTML simulates:');
console.log('- Match 100101: No result yet');
console.log('- Match 100102: PUK-Haarlem 1 24-7 \'t Zwijntje 1');
console.log('- Match 100103: Amicale Boule d\'Argent 1 12-19 Petangeske 1\n');

const results = parseMatchResults(sampleHtml);

console.log('Parsed results:');
if (results.size === 0) {
  console.log('  No results detected');
} else {
  for (const [matchNumber, result] of results) {
    const homeId = teamNameToId(result.homeTeam);
    const awayId = teamNameToId(result.awayTeam);
    console.log(`  Match ${matchNumber}: ${result.homeTeam} ${result.homeScore}-${result.awayScore} ${result.awayTeam}`);
    console.log(`    Home ID: ${homeId || 'NOT FOUND'}`);
    console.log(`    Away ID: ${awayId || 'NOT FOUND'}`);
  }
}

console.log('\nExpected results:');
console.log('  Match 100102: PUK-Haarlem 1 24-7 \'t Zwijntje 1');
console.log('  Match 100103: Amicale Boule d\'Argent 1 12-19 Petangeske 1');

// Verify results
const expectedResults = new Map([
  ['100102', { homeTeam: 'PUK-Haarlem 1', awayTeam: "'t Zwijntje 1", homeScore: 24, awayScore: 7 }],
  ['100103', { homeTeam: "Amicale Boule d'Argent 1", awayTeam: 'Petangeske 1', homeScore: 12, awayScore: 19 }]
]);

let success = true;
for (const [match, expectedData] of expectedResults) {
  const actual = results.get(match);
  if (!actual) {
    console.log(`\n❌ FAILED: Expected result for match ${match}, got nothing`);
    success = false;
    continue;
  }
  
  if (actual.homeScore !== expectedData.homeScore || actual.awayScore !== expectedData.awayScore) {
    console.log(`\n❌ FAILED: Match ${match} score mismatch`);
    console.log(`  Expected: ${expectedData.homeScore}-${expectedData.awayScore}`);
    console.log(`  Got: ${actual.homeScore}-${actual.awayScore}`);
    success = false;
  }
  
  if (actual.homeTeam !== expectedData.homeTeam || actual.awayTeam !== expectedData.awayTeam) {
    console.log(`\n❌ FAILED: Match ${match} team name mismatch`);
    console.log(`  Expected: ${expectedData.homeTeam} vs ${expectedData.awayTeam}`);
    console.log(`  Got: ${actual.homeTeam} vs ${actual.awayTeam}`);
    success = false;
  }
}

// Verify team ID mapping works
console.log('\nTesting team ID mapping:');
const testTeams = [
  "Amicale Boule d'Argent 1",
  "Boul'Animo 1",
  'CdP Les Cailloux 1',
  "JBC 't Dupke 1",
  'Jeu de Bommel 1',
  'Petangeske 1',
  'PUK-Haarlem 1',
  "'t Zwijntje 1"
];

for (const teamName of testTeams) {
  const teamId = teamNameToId(teamName);
  if (!teamId) {
    console.log(`  ❌ ${teamName} -> NOT FOUND`);
    success = false;
  } else {
    console.log(`  ✅ ${teamName} -> ${teamId}`);
  }
}

if (success) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Tests failed!');
  process.exit(1);
}
