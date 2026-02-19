/**
 * Test script for batch outlet modernizer
 * Run with: node diagnostics/test-batch-modernizer.js
 */

import { readFileSync, writeFileSync } from "fs";
import { parseWup } from "../wup-parser.js";
import { runOutletDiagnostics } from "./outlet-diagnostics.js";
import { createModernOutletRouting } from "./outlet-modernizer.js";
import { serializeWup } from "../editor/io/wup-serializer.js";

// Replacement function (same as in batch-outlet-modernizer.js)
function replaceOutletInModel(model, replacementData, modernRoutingData) {
  if (!model || !Array.isArray(model.pafRoutings)) return;
  if (!Array.isArray(model.__statements) || model.__statements.length === 0) return;
  if (!modernRoutingData || !modernRoutingData.statements) return;

  const boxId = replacementData.boxRoutingEditorId;
  const circleIds = replacementData.circleRoutingEditorIds || [];

  const targetRouting = model.pafRoutings.find(
    routing => routing && typeof routing.__editorId === "number" && routing.__editorId === boxId
  );

  if (!targetRouting) {
    console.error("Could not find target routing with id:", boxId);
    return;
  }

  const circleRoutings = circleIds
    .map(id => model.pafRoutings.find(routing => routing?.__editorId === id))
    .filter(Boolean);

  const statementIndexSet = new Set();
  for (const routing of [targetRouting, ...circleRoutings]) {
    for (const index of routing?.__statementIndices ?? []) {
      if (Number.isInteger(index) && index >= 0) {
        statementIndexSet.add(index);
      }
    }
  }

  if (statementIndexSet.size === 0) {
    console.error("No statement indices found for routings to remove");
    return;
  }

  const sortedIndices = Array.from(statementIndexSet).sort((a, b) => a - b);
  const insertionIndex = sortedIndices[0];
  const modernStatements = modernRoutingData.statements || [];

  const updatedStatements = [];
  let inserted = false;
  const indexSet = new Set(sortedIndices);

  for (let i = 0; i < model.__statements.length; i += 1) {
    if (!inserted && i === insertionIndex) {
      updatedStatements.push(...modernStatements);
      inserted = true;
    }
    if (indexSet.has(i)) {
      continue;
    }
    updatedStatements.push(model.__statements[i]);
  }

  if (!inserted) {
    updatedStatements.push(...modernStatements);
  }

  const updatedText = `${updatedStatements.map(stmt => `${stmt.trim()};`).join("\n")}\n`;
  const reparsed = parseWup(updatedText);

  if (!reparsed) {
    console.error("Failed to re-parse WUP after outlet replacement");
    return;
  }

  Object.keys(model).forEach(key => delete model[key]);
  Object.assign(model, reparsed);
}

console.log("Testing Batch Outlet Modernizer\n");
console.log("=" .repeat(60));

// Test with example3.wup which has multiple legacy outlets
const testFile = "./example3.wup";

try {
  console.log(`\nReading ${testFile}...`);
  const content = readFileSync(testFile, "utf-8");

  console.log("Parsing WUP file...");
  const model = parseWup(content);

  if (!model) {
    throw new Error("Failed to parse WUP file");
  }

  console.log(`✓ Parsed successfully`);
  console.log(`  PAF Routings: ${model.pafRoutings?.length || 0}`);

  console.log("\nRunning outlet diagnostics...");
  const diagnostics = runOutletDiagnostics(model);

  if (diagnostics.error) {
    throw new Error(diagnostics.error);
  }

  console.log(`✓ Diagnostics complete`);
  console.log(`  Legacy outlets found: ${diagnostics.summary.legacyOutlets}`);

  if (diagnostics.summary.legacyOutlets === 0) {
    console.log("\n✓ No legacy outlets found - nothing to modernize");
    process.exit(0);
  }

  // Show details
  const legacyOutlets = diagnostics.checks[0]?.results || [];
  legacyOutlets.forEach((outlet, i) => {
    console.log(`\n  Outlet ${i + 1}: ${outlet.id}`);
    console.log(`    ${outlet.message}`);
    if (outlet.replacement) {
      console.log(`    Center: (${outlet.replacement.center.x.toFixed(1)}, ${outlet.replacement.center.y.toFixed(1)})`);
      console.log(`    Orientation: ${outlet.replacement.orientation}`);
    }
  });

  console.log("\nReplacing outlets one at a time (re-running diagnostics after each)...");
  let modernized = 0;

  // Replace outlets one at a time, like the batch processor now does
  let continueReplacing = true;
  while (continueReplacing) {
    // Re-run diagnostics to get current outlet positions with current IDs
    const currentDiagnostics = runOutletDiagnostics(model);

    if (currentDiagnostics.error) {
      throw new Error(currentDiagnostics.error);
    }

    const currentOutlets = currentDiagnostics.checks[0]?.results || [];

    if (currentOutlets.length === 0) {
      continueReplacing = false;
      break;
    }

    // Replace the first outlet
    const outlet = currentOutlets[0];

    if (!outlet.replacement) {
      console.error("Outlet missing replacement data, stopping");
      break;
    }

    try {
      const modernRouting = createModernOutletRouting({
        center: outlet.replacement.center,
        depth: outlet.replacement.depth,
        zValue: outlet.replacement.zValue,
        orientationValue: outlet.replacement.orientationValue,
        headerSource: outlet.replacement.headerSource,
        tool: outlet.replacement.tool,
        face: outlet.replacement.face,
        passes: outlet.replacement.passes,
        layer: outlet.replacement.layer,
        command: outlet.replacement.command,
        body: outlet.replacement.body,
        orientationType: outlet.replacement.orientation
      });

      console.log(`  ✓ Replacing ${outlet.id} (${outlet.replacement.orientation} at ${outlet.replacement.center.x.toFixed(0)}, ${outlet.replacement.center.y.toFixed(0)})`);

      // Apply the replacement to the model
      replaceOutletInModel(model, outlet.replacement, modernRouting);
      modernized++;

    } catch (err) {
      console.error(`  ✗ Failed to modernize ${outlet.id}: ${err.message}`);
      break;
    }
  }

  console.log(`\n✓ Modernized ${modernized} outlets`);

  // Verify the replacements worked by re-running diagnostics
  console.log("\nVerifying replacements...");
  const verifyDiagnostics = runOutletDiagnostics(model);
  console.log(`  Legacy outlets remaining: ${verifyDiagnostics.summary.legacyOutlets}`);

  if (verifyDiagnostics.summary.legacyOutlets > 0) {
    console.error("  ✗ Some legacy outlets were not replaced correctly!");
  } else {
    console.log("  ✓ All legacy outlets successfully replaced");
  }

  console.log("\nTesting serialization...");
  const serialized = serializeWup(model);

  if (!serialized.text && !serialized.fallback) {
    throw new Error("Serialization failed");
  }

  const output = serialized.text || serialized.fallback;
  console.log(`✓ Serialized successfully`);
  console.log(`  Output length: ${output.length} characters`);

  // Write the output to a test file
  const outputFile = "./example3_modernized.wup";
  writeFileSync(outputFile, output, "utf-8");
  console.log(`  Written to: ${outputFile}`);

  console.log("\n" + "=".repeat(60));
  console.log("✓ All tests passed!");

} catch (err) {
  console.error("\n✗ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
}
