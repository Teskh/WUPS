/**
 * Test script for NR Operations diagnostics
 *
 * Usage: node diagnostics/test-nr-diagnostics.js
 */

import { readFileSync } from 'fs';
import { parseWup } from '../wup-parser.js';
import { runNrDiagnostics, formatNrReport } from './nr-diagnostics.js';

// Test files
const testFiles = [
  'example.wup',
  'example2.wup',
  'example3.wup',
  'example4.wup',
  'example5.wup'
];

console.log('NR Operations Diagnostics Test\n');
console.log('='.repeat(70));

for (const filename of testFiles) {
  try {
    const wupText = readFileSync(filename, 'utf-8');
    const model = parseWup(wupText);

    const nrCount = model.nailRows?.length || 0;

    if (nrCount === 0) {
      console.log(`\n${filename}: No NR operations found, skipping.`);
      continue;
    }

    console.log(`\n${filename}: Found ${nrCount} NR operation(s)`);
    console.log('-'.repeat(70));

    const results = runNrDiagnostics(model);

    if (results.error) {
      console.log(`ERROR: ${results.error}`);
      continue;
    }

    console.log(`Total: ${results.summary.total}, Passed: ${results.summary.passed}, Failed: ${results.summary.failed}`);

    // Show summary of each check
    results.checks.forEach(check => {
      const passed = check.results.filter(r => r.passed).length;
      const failed = check.results.filter(r => !r.passed).length;
      console.log(`  ${check.name}: ${passed} passed, ${failed} failed`);
    });

    // Show first few details
    if (results.summary.failed > 0) {
      console.log('\nFailed NR Operations:');
      let count = 0;
      for (const check of results.checks) {
        for (const result of check.results) {
          if (!result.passed && count < 3) {
            console.log(`  - ${result.id}: ${result.message}`);
            count++;
          }
        }
      }
      if (results.summary.failed > 3) {
        console.log(`  ... and ${results.summary.failed - 3} more`);
      }
    }

  } catch (err) {
    console.log(`\n${filename}: ERROR - ${err.message}`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('Test completed.\n');

// Test with detailed report for one file
console.log('\nDetailed Report for example.wup:');
console.log('='.repeat(70));
try {
  const wupText = readFileSync('example.wup', 'utf-8');
  const model = parseWup(wupText);
  const results = runNrDiagnostics(model);
  const report = formatNrReport(results);
  console.log(report);
} catch (err) {
  console.log(`ERROR: ${err.message}`);
}
