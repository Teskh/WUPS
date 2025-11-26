/**
 * Test script for Plate Mislabel diagnostics
 *
 * Usage: node diagnostics/test-plate-mislabel-diagnostics.js
 */

import { readFileSync } from "fs";
import path from "path";
import { parseWup } from "../wup-parser.js";
import { runPlateMislabelDiagnostics, formatPlateMislabelReport } from "./plate-mislabel-diagnostics.js";

const samples = [
  {
    label: "Clean example",
    file: "example.wup"
  },
  {
    label: "Mislabelled plate sample (multiple OG/UG)",
    file: path.join("ejemplos", "viga cajon con doble UG - 1.10_A_LFKPOOR-C-2-02-C-10-VIGAS_CAJON.wup")
  }
];

console.log("Plate Mislabel Diagnostics Test\n");
console.log("=".repeat(70));

for (const sample of samples) {
  const filePath = sample.file;
  try {
    const wupText = readFileSync(filePath, "utf-8");
    const model = parseWup(wupText);
    const results = runPlateMislabelDiagnostics(model);

    console.log(`\n${sample.label} (${filePath})`);
    console.log("-".repeat(70));
    if (results.error) {
      console.log(`ERROR: ${results.error}`);
      continue;
    }

    console.log(
      `Plates: ${results.summary.totalPlates} (top=${results.summary.topPlates}, bottom=${results.summary.bottomPlates})`
    );
    console.log(`Failed checks: ${results.summary.failed}, Passed checks: ${results.summary.passed}`);

    results.checks.forEach(check => {
      const failed = check.results.filter(r => !r.passed);
      console.log(`  ${check.name}: ${failed.length}/${check.results.length} failed`);
      failed.slice(0, 3).forEach(item => {
        console.log(`    - ${item.id}: ${item.message}`);
      });
      if (failed.length > 3) {
        console.log(`    ... and ${failed.length - 3} more`);
      }
    });
  } catch (err) {
    console.log(`\n${sample.label}: ERROR - ${err.message}`);
  }
}

console.log("\n" + "=".repeat(70));
console.log("Detailed report for mislabelled sample:\n");
try {
  const filePath = path.join("ejemplos", "viga cajon con doble UG - 1.10_A_LFKPOOR-C-2-02-C-10-VIGAS_CAJON.wup");
  const wupText = readFileSync(filePath, "utf-8");
  const model = parseWup(wupText);
  const results = runPlateMislabelDiagnostics(model);
  console.log(formatPlateMislabelReport(results));
} catch (err) {
  console.log(`ERROR: ${err.message}`);
}
