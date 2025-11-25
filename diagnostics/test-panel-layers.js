const fs = require("fs");
const path = require("path");

const { parseWup } = require("../wup-parser.js");

const wupPath = path.resolve(__dirname, "../example8.wup");
const wupText = fs.readFileSync(wupPath, "utf8");
const model = parseWup(wupText);

const secondLayerPanels = model.sheathing.filter(panel => panel.layerCommand === "PLI2");
if (secondLayerPanels.length === 0) {
  throw new Error("Expected at least one PLI2 panel in example8.wup");
}

if (!secondLayerPanels.every(panel => panel.layerIndex === 2 && panel.layer === "pli")) {
  throw new Error("PLI2 panels should retain layer 'pli' and index 2");
}

if (model.unhandled.some(entry => entry.command === "PLI2")) {
  throw new Error("Parser reported unhandled PLI2 commands");
}

const secondLayerRows = model.nailRows.filter(row => row.layerCommand === "PLI2");
if (!secondLayerRows.every(row => row.layer === "pli" && row.layerIndex === 2)) {
  throw new Error("Nail rows derived from PLI2 should inherit layer and index metadata");
}

const secondLayerRoutings = model.pafRoutings.filter(routing => routing.layerCommand === "PLI2");
if (!secondLayerRoutings.every(routing => routing.layer === "pli" && routing.layerIndex === 2)) {
  throw new Error("PAF routings derived from PLI2 should inherit layer and index metadata");
}

console.log("Panel layer parsing test passed.");
