import { parseWup, normalizeModel } from "../wup-parser.js";
import { runAllDiagnostics } from "./diagnostic-runner.js";

const directoryInput = document.getElementById("directoryInput");
const selectionInfo = document.getElementById("selectionInfo");
const runButton = document.getElementById("runButton");
const resetButton = document.getElementById("resetButton");
const resultsContainer = document.getElementById("results");
const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const overallSummary = document.getElementById("overallSummary");

const state = {
  files: [],
  results: []
};

directoryInput.addEventListener("change", handleSelection);
runButton.addEventListener("click", handleRun);
resetButton.addEventListener("click", handleReset);

function handleSelection(event) {
  const allFiles = Array.from(event.target.files || []);
  const wupFiles = allFiles.filter(file => file.name.toLowerCase().endsWith(".wup"));

  state.files = wupFiles;
  state.results = [];

  if (allFiles.length === 0) {
    selectionInfo.textContent = "No folder selected yet.";
    runButton.disabled = true;
    resetButton.disabled = true;
    setEmptyResults();
    return;
  }

  const total = allFiles.length;
  const wupCount = wupFiles.length;
  const label = total === 1 ? "file" : "files";
  const wupLabel = wupCount === 1 ? "file" : "files";

  if (wupCount === 0) {
    selectionInfo.textContent = `Selected ${total} ${label}, but none are .wup files.`;
    runButton.disabled = true;
  } else if (wupCount < total) {
    selectionInfo.textContent = `Using ${wupCount} .wup ${wupLabel} from ${total} selected ${label}.`;
    runButton.disabled = false;
  } else {
    selectionInfo.textContent = `Ready to run ${wupCount} .wup ${wupLabel}.`;
    runButton.disabled = false;
  }

  resetButton.disabled = false;
  setEmptyResults();
}

async function handleRun() {
  if (!state.files.length) return;

  lockUi();
  state.results = [];
  updateProgress(0, state.files.length, "Starting...");

  for (let index = 0; index < state.files.length; index += 1) {
    const file = state.files[index];
    const label = file.webkitRelativePath || file.name;
    updateProgress(index, state.files.length, `Reading ${label}`);

    try {
      const text = await file.text();
      const model = normalizeModel(parseWup(text));
      const diagnostics = runAllDiagnostics(model);
      const summary = summarizeDiagnostics(diagnostics);
      state.results.push({
        status: "ok",
        label,
        diagnostics,
        summary,
        modelSummary: diagnostics.model
      });
    } catch (err) {
      state.results.push({
        status: "error",
        label,
        error: err
      });
    }

    updateProgress(index + 1, state.files.length, `Processed ${label}`);
  }

  unlockUi();
  renderResults();
}

function handleReset() {
  directoryInput.value = "";
  state.files = [];
  state.results = [];
  selectionInfo.textContent = "No folder selected yet.";
  runButton.disabled = true;
  resetButton.disabled = true;
  setEmptyResults();
  hideProgress();
}

function summarizeDiagnostics(allResults) {
  const diagnostics = Object.values(allResults.diagnostics || {});
  const summary = {
    diagnosticsRun: diagnostics.length,
    checksTotal: 0,
    checksFailed: 0
  };

  diagnostics.forEach(diag => {
    if (diag.success && diag.results?.summary) {
      summary.checksTotal += diag.results.summary.total || 0;
      summary.checksFailed += diag.results.summary.failed || 0;
    } else {
      summary.checksFailed += 1;
    }
  });

  summary.checksPassed = Math.max(summary.checksTotal - summary.checksFailed, 0);
  return summary;
}

function lockUi() {
  runButton.disabled = true;
  resetButton.disabled = true;
  directoryInput.disabled = true;
  progressContainer.classList.remove("hidden");
}

function unlockUi() {
  runButton.disabled = state.files.length === 0;
  resetButton.disabled = false;
  directoryInput.disabled = false;
  progressText.textContent = "Done.";
}

function updateProgress(completed, total, label) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}% - ${label}`;
}

function hideProgress() {
  progressFill.style.width = "0%";
  progressText.textContent = "Waiting to start";
  progressContainer.classList.add("hidden");
}

function setEmptyResults() {
  resultsContainer.classList.add("empty-state");
  resultsContainer.innerHTML = "<p>Load a folder to see file-by-file diagnostics.</p>";
  overallSummary.textContent = "";
}

function renderResults() {
  if (state.results.length === 0) {
    setEmptyResults();
    return;
  }

  resultsContainer.classList.remove("empty-state");
  resultsContainer.innerHTML = "";

  const aggregate = summarizeAllFiles(state.results);
  renderOverallSummary(aggregate);

  state.results.forEach(result => {
    const card = createFileCard(result);
    resultsContainer.appendChild(card);
  });
}

function summarizeAllFiles(results) {
  const aggregate = {
    files: results.length,
    parsed: 0,
    failedToParse: 0,
    filesWithIssues: 0,
    totalChecks: 0,
    failedChecks: 0
  };

  results.forEach(result => {
    if (result.status === "ok") {
      aggregate.parsed += 1;
      aggregate.totalChecks += result.summary.checksTotal;
      aggregate.failedChecks += result.summary.checksFailed;
      if (result.summary.checksFailed > 0) {
        aggregate.filesWithIssues += 1;
      }
    } else {
      aggregate.failedToParse += 1;
      aggregate.filesWithIssues += 1;
    }
  });

  return aggregate;
}

function renderOverallSummary(aggregate) {
  const passed = Math.max(aggregate.totalChecks - aggregate.failedChecks, 0);
  overallSummary.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Files inspected</div>
        <div class="value">${aggregate.files}</div>
      </div>
      <div class="stat-card">
        <div class="label">Parsed successfully</div>
        <div class="value">${aggregate.parsed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Files with issues</div>
        <div class="value">${aggregate.filesWithIssues}</div>
      </div>
      <div class="stat-card">
        <div class="label">Checks passed</div>
        <div class="value">${passed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Checks failed</div>
        <div class="value">${aggregate.failedChecks}</div>
      </div>
    </div>
  `;
}

function createFileCard(result) {
  const details = document.createElement("details");
  const statusClass = result.status === "ok"
    ? result.summary.checksFailed > 0 ? "status-warn" : "status-ok"
    : "status-error";
  details.className = `file-card ${statusClass}`;
  details.open = result.summary?.checksFailed > 0 || result.status === "error";

  const summary = document.createElement("summary");

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = result.label;

  const statline = document.createElement("span");
  statline.className = "statline";
  if (result.status === "ok") {
    const total = result.summary.checksTotal;
    const passed = result.summary.checksPassed;
    statline.textContent = total === passed ? `${passed}/${total}` : `${passed}/${total}`;
  } else {
    statline.textContent = "parse error";
  }

  summary.appendChild(name);
  summary.appendChild(statline);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "file-body";

  if (result.status === "ok") {
    const model = document.createElement("div");
    model.className = "model-summary";
    const meta = result.modelSummary || {};
    model.textContent = `Studs ${meta.studs || 0}, blocking ${meta.blocking || 0}, plates ${meta.plates || 0}, sheathing ${meta.sheathing || 0}, BOY ${meta.boyOperations || 0}, PAF ${meta.pafRoutings || 0}, nail rows ${meta.nailRows || 0}`;
    body.appendChild(model);

    Object.values(result.diagnostics?.diagnostics || {}).forEach(diag => {
      body.appendChild(createDiagnosticGroup(diag));
    });
  } else {
    const error = document.createElement("div");
    error.className = "error-text";
    error.textContent = result.error?.message || "Unable to parse file.";
    body.appendChild(error);
  }

  details.appendChild(body);
  return details;
}

function createDiagnosticGroup(diag) {
  const group = document.createElement("div");
  group.className = "diag-group";

  const header = document.createElement("div");
  header.className = "diag-header";

  const title = document.createElement("span");
  title.textContent = diag.name || diag.diagnosticKey || "Diagnostic";

  const stat = document.createElement("span");
  stat.className = "diag-stat";

  if (diag.success && diag.results?.summary) {
    const { passed, total } = diag.results.summary;
    stat.textContent = `${passed}/${total}`;
    stat.classList.add(passed === total ? "all-pass" : "has-fail");
  } else {
    stat.textContent = "error";
    stat.classList.add("is-error");
  }

  header.appendChild(title);
  header.appendChild(stat);
  group.appendChild(header);

  if (diag.success && diag.results?.checks) {
    const checkList = document.createElement("div");
    checkList.className = "check-list";
    diag.results.checks.forEach(check => {
      checkList.appendChild(createCheckRow(check));
    });
    group.appendChild(checkList);
  } else if (!diag.success) {
    const error = document.createElement("div");
    error.className = "error-text";
    error.textContent = diag.error || "Diagnostic failed.";
    group.appendChild(error);
  }

  return group;
}

function createCheckRow(check) {
  const container = document.createElement("div");

  const row = document.createElement("div");
  row.className = "check-row";

  const failed = check.results.filter(r => !r.passed).length;
  const passed = check.results.length - failed;
  const total = check.results.length;

  const name = document.createElement("span");
  name.className = "check-name";
  name.textContent = check.name;

  const stat = document.createElement("span");
  stat.className = "check-stat";
  stat.textContent = `${passed}/${total}`;
  stat.classList.add(failed === 0 ? "all-pass" : "has-fail");

  row.appendChild(name);
  row.appendChild(stat);
  container.appendChild(row);

  if (failed > 0) {
    row.classList.add("has-failures");
    const failures = document.createElement("ul");
    failures.className = "check-failures";
    check.results.filter(r => !r.passed).forEach(entry => {
      const li = document.createElement("li");
      li.textContent = `${entry.id}: ${entry.message}`;
      failures.appendChild(li);
    });
    container.appendChild(failures);
  }

  return container;
}
