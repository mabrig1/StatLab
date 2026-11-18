// Browser-only PharmaOS handoff. No network requests or unsupported statistical analyses.
import { readXlsxWorkbook, readCsv, sheetAsCsv, summarizeSheet } from "./pharmaos-xlsx.mjs";
const fileInput = document.getElementById("handoff");
const datasetPanel = document.getElementById("dataset-result");
const workbookSummary = document.getElementById("workbook-summary");
const sheetSelector = document.getElementById("sheet-select");
const sheetSummary = document.getElementById("sheet-summary");
const previewHeader = document.getElementById("sheet-preview-header");
const previewBody = document.getElementById("sheet-preview-body");
const exportSheet = document.getElementById("export-sheet");
const status = document.getElementById("message");
const panel = document.getElementById("result");
const numericSection = document.getElementById("numeric-section");
const manuscriptSection = document.getElementById("manuscript-section");
const compoundSection = document.getElementById("compounds-section");
const compoundList = document.getElementById("compound-list");
const tbody = document.getElementById("numeric");
const csvDownload = document.getElementById("download");
const summaryDownload = document.getElementById("download-summary");
const reportDownload = document.getElementById("download-report");
const actionPanel = document.getElementById("action-panel");
const analysisInsight = document.getElementById("analysis-insight");
let current = null;
let columns = [];
let importedSheets = [];
let selectedDataName = "";
// Worksheets may contain different chemical markers, units, plant organs and extraction bases;
// displaying rows is safe, but we deliberately do NOT pool concentrations or run significance tests here.
function renderResearchSheet() {
  const sheet = importedSheets[Number(sheetSelector.value)];
  if (!sheet) return;
  const summary = summarizeSheet(sheet.rows);
  sheetSummary.textContent = summary.rows + " data rows, " + summary.columns + " columns" +
    (summary.distinctStudies === null ? "" : ", " + summary.distinctStudies + " distinct study IDs") +
    ". Columns with numerical entries: " +
    (summary.numericColumns.length ? summary.numericColumns.slice(0, 7).join(", ") : "none detected") + ".";
  previewHeader.replaceChildren();
  previewBody.replaceChildren();
  const header = sheet.rows[0] || [];
  const maxCols = Math.min(8, Math.max(...sheet.rows.map(r => r.length), 0));
  for (let i = 0; i < maxCols; i++) {
    const th = document.createElement("th");
    th.textContent = header[i] == null || header[i] === "" ? "Column " + (i + 1) : String(header[i]);
    previewHeader.appendChild(th);
  }
  for (const row of sheet.rows.slice(1, 11)) {
    const tr = document.createElement("tr");
    for (let i = 0; i < maxCols; i++) {
      const cell = document.createElement("td");
      cell.textContent = String(row[i] ?? "");
      tr.appendChild(cell);
    }
    previewBody.appendChild(tr);
  }
}
function showResearchSheets(sheets, filename) {
  importedSheets = sheets;
  selectedDataName = filename;
  sheetSelector.replaceChildren();
  sheets.forEach((sheet, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = sheet.name;
    sheetSelector.appendChild(opt);
  });
  const preferred = sheets.findIndex(s => /chemical.?observations/i.test(s.name));
  sheetSelector.value = String(preferred >= 0 ? preferred : 0);
  workbookSummary.textContent = "Opened " + filename + " with " + sheets.length +
    " worksheet(s). Choose the sheet you want to inspect below.";
  renderResearchSheet();
  status.textContent = "Excel/CSV research data opened successfully. Choose your worksheet and download it as CSV.";
  datasetPanel.hidden = false;
  datasetPanel.focus({ preventScroll: true });
  datasetPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}
sheetSelector.addEventListener("change", renderResearchSheet);
exportSheet.addEventListener("click", () => {
  const sheet = importedSheets[Number(sheetSelector.value)];
  if (!sheet || !sheet.rows.length) return;
  const safeName = sheet.name.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "research";
  saveAs(sheetAsCsv(sheet.rows), "statlab-" + safeName + ".csv", "text/csv;charset=utf-8");
});

const format = (v) => typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "N/A";
const count = (v) => Number.isSafeInteger(v) && v >= 0 ? String(v) : "Not recorded";
const td = (value) => { const el = document.createElement("td"); el.textContent = String(value); return el; };

function check(data) {
  if (!data || data.schemaVersion !== "discovery-1.0" ||
      data.researchOnly !== true || data.clinicalUse !== false ||
      !data.source || !/^[a-f0-9]{64}$/i.test(data.source.sha256 || "") ||
      !data.summary || !Array.isArray(data.agents) || data.agents.length > 50 ||
      !Array.isArray(data.compounds) || data.compounds.length > 50) {
    throw new Error("This is not a supported PharmaOS research report. In NcheSent, download the report ending in .json and select it here.");
  }
  if (data.summary.molecularDockingPerformed !== false || data.summary.admetPredictionPerformed !== false) {
    throw new Error("This report contains unsupported docking or ADMET claims. Please use a genuine NcheSent research export.");
  }
  if (data.csv !== null && (typeof data.csv !== "object" ||
      !Array.isArray(data.csv.numericColumns) || data.csv.numericColumns.length > 30)) {
    throw new Error("The numerical part of this report could not be read.");
  }
  const result = data.csv?.numericColumns || [];
  for (const c of result) {
    if (typeof c.name !== "string" || c.name.length > 100 ||
        !Number.isInteger(c.n) || c.n < 1 || c.n > 2000 ||
        !Number.isFinite(c.mean) || !Number.isFinite(c.min) || !Number.isFinite(c.max) ||
        (c.sampleSd !== null && !Number.isFinite(c.sampleSd))) {
      throw new Error("Some numerical findings are invalid. Export the report again from NcheSent.");
    }
  }
  return result;
}

function makePlainSummary(data, cols) {
  const isNumeric = cols.length > 0;
  const sourceName = typeof data.source.name === "string" ? data.source.name.slice(0, 100) : "Research document";
  return [
    "MABRIG PHARMAOS — EVIDENCE FINDINGS & JOURNAL PREPARATION CHECKLIST",
    "Source: " + sourceName,
    "Source fingerprint (SHA-256): " + data.source.sha256,
    "",
    "RESEARCH EVIDENCE",
    "Named compounds: " + count(data.summary.candidatesMentioned),
    "PubChem-verified compounds: " + count(data.summary.pubchemVerified),
    "Completed bounded research tasks: " + count(data.summary.executedAgentTasks),
    "Defined research roles: " + count(data.summary.totalPlannedRoles),
    "",
    "COMPOUNDS NAMED IN THE PAPER",
    ...data.compounds.slice(0, 50).flatMap((c) => {
      const name = typeof c.name === "string" ? c.name.slice(0, 120) : "Unnamed compound";
      const p = c.pubchem && Number.isSafeInteger(c.pubchem.cid) ? c.pubchem : null;
      const details = [
        name + " — " + (p ? "PubChem reference found (CID " + p.cid + ")" : "PubChem reference not verified"),
        p ? "Molecular formula: " + (p.formula ?? "not available") +
          "; Molecular weight: " + (p.molecularWeight ?? "not available") +
          "; XLogP: " + (p.xlogp ?? "not available") +
          "; TPSA: " + (p.tpsa ?? "not available") : "",
        typeof c.sourceExcerpt === "string" ? "Source excerpt (not independently fact-checked): " + c.sourceExcerpt.slice(0, 450) : "",
        typeof c.safety === "string" ? "Caution: " + c.safety.slice(0, 350) : "",
      ].filter(Boolean);
      return [...details, ""];
    }),
    "",
    "STATISTICAL DATA",
    isNumeric
      ? "This NcheSent report contains " + cols.length + " precomputed numerical summary column(s)."
      : "No numeric dataset or statistical computation was included in this research report.",
    ...(isNumeric ? cols.map((c) =>
      c.name + ": n=" + c.n + ", mean=" + format(c.mean) +
      ", sample SD=" + format(c.sampleSd) + ", min=" + format(c.min) + ", max=" + format(c.max)
    ) : []),
    "",
    "RESEARCH TASK AUDIT (reported by NcheSent)",
    ...data.agents.slice(0, 50).map((step) =>
      (typeof step.role === "string" ? step.role.slice(0, 100) : "Research role") +
      ": " + (typeof step.status === "string" ? step.status.slice(0, 40) : "status unavailable") +
      (typeof step.evidence === "string" ? " — " + step.evidence.slice(0, 250) : "")
    ),
    "",
    "JOURNAL SUBMISSION READINESS — MANUAL REVIEW REQUIRED",
    "Status: NOT YET ASSESSED. A list of compounds and PubChem reference records is not a complete manuscript integrity review.",
    "1. Original contribution: demonstrate a novel, important research question and explain the gap in current literature.",
    "2. Evidence and citations: verify every citation against the actual source and check whether it supports the cited claim; do not invent references.",
    "3. Methods and reproducibility: document research design, samples, materials, protocols, statistical assumptions, software and appropriate controls.",
    "4. Results: use the original measurements or dataset where needed; disclose uncertainty, adverse findings and limitations. Do not reconstruct data from summary tables.",
    "5. Ethics and integrity: verify ethics approvals, consent if applicable, conflicts, funding, authorship and AI-use disclosure.",
    "6. Journal fit: read the target journal's scope, article type, reporting standards and author instructions; independently confirm indexing, Journal Impact Factor (if claimed), and fees.",
    "7. Final check: revise the full article and submit only after human scientific review. Acceptance can never be guaranteed.",
    "",
    "NEXT ACTION",
    "Open https://scholar.mabrigkorie.org/publishing-agent and enter the full paper title and abstract for a journal-matching and revision plan.",
    "The publishing agent is a planning aid, not peer-review approval. This JSON import did not transfer the manuscript to Scholar.",
    "",
    "LIMITATIONS",
    "This is a readable copy of NcheSent findings viewed in StatLab.",
    "StatLab did not independently recalculate these results or reconstruct respondent-level data.",
    "PubChem molecular properties do not prove drug efficacy, safety or clinical benefit.",
    "No molecular docking, ADMET, clinical prediction or inferential test was performed by this importer.",
  ].join("\n");
}

function saveAs(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

fileInput.addEventListener("change", async () => {
  current = null;
  columns = [];
  importedSheets = [];
  panel.hidden = true;
  datasetPanel.hidden = true;
  csvDownload.disabled = true;
  const file = fileInput.files?.[0];
  if (!file) {
    status.textContent = "No file selected. Files stay on this device.";
    return;
  }
  const name = file.name.toLowerCase();
  status.textContent = "Opening your file on this device…";
  try {
    if (name.endsWith(".xlsx")) {
      const sheets = await readXlsxWorkbook(file);
      showResearchSheets(sheets, file.name);
      return;
    }
    if (name.endsWith(".csv")) {
      const sheets = readCsv(await file.text());
      showResearchSheets(sheets, file.name);
      return;
    }
    if (!name.endsWith(".json")) {
      throw new Error("Choose an Excel workbook (.xlsx), research CSV (.csv), or PharmaOS report (.json). Word/PDF manuscripts should be uploaded to NcheSent.");
    }
    if (file.size > 300000) throw new Error("This JSON report exceeds 300 KB. Choose a smaller PharmaOS report.");
    const jsonText = await file.text();
    if (jsonText.startsWith("PK")) throw new Error("This file contains an Excel workbook, not JSON. Rename it .xlsx and select it again.");
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch { throw new Error("This JSON report could not be opened. Download the .json report from NcheSent, or choose your Excel .xlsx file."); }
    const cols = check(parsed);
    current = parsed;
    columns = cols;
    const name = typeof parsed.source.name === "string" ? parsed.source.name.slice(0, 100) : "your research";
    status.textContent = "Report opened. Your research findings and download buttons are ready below.";
    document.getElementById("plain-summary").textContent =
      "Report: " + name + ". These are the evidence checks already performed by NcheSent; no second analysis is needed to review them.";
    document.getElementById("digest").textContent = "Original source SHA-256: " + parsed.source.sha256;
    const stats = document.getElementById("stats");
    stats.replaceChildren();
    for (const [label, value] of [
      ["Compounds named in the report", count(parsed.summary.candidatesMentioned)],
      ["Compounds checked with PubChem", count(parsed.summary.pubchemVerified)],
      ["Research tasks completed", count(parsed.summary.executedAgentTasks)],
      ["Numerical variables", String(cols.length)],
    ]) {
      const card = document.createElement("div");
      const title = document.createElement("small");
      title.textContent = label;
      const number = document.createElement("strong");
      number.textContent = value;
      card.append(title, number);
      stats.appendChild(card);
    }
    compoundList.replaceChildren();
    for (const c of parsed.compounds.slice(0, 20)) {
      const item = document.createElement("li");
      const name = typeof c.name === "string" ? c.name.slice(0, 120) : "Unnamed compound";
      const verified = c.pubchem && Number.isSafeInteger(c.pubchem.cid);
      item.textContent = name + " — " +
        (verified ? "PubChem molecular reference found" : "PubChem reference not verified");
      compoundList.appendChild(item);
    }
    compoundSection.hidden = parsed.compounds.length === 0;
    tbody.replaceChildren();
    for (const c of cols) {
      const row = document.createElement("tr");
      [c.name, c.n, format(c.mean), format(c.sampleSd), format(c.min), format(c.max)]
        .forEach((value) => row.appendChild(td(value)));
      tbody.appendChild(row);
    }
    const hasNumbers = cols.length > 0;
    numericSection.hidden = !hasNumbers;
    manuscriptSection.hidden = hasNumbers;
    csvDownload.disabled = !hasNumbers;
    document.getElementById("method").textContent =
      parsed.csv?.warning || "Descriptive numeric values from the imported NcheSent report.";
    analysisInsight.textContent = hasNumbers
      ? "This report includes " + cols.length + " numerical variable(s) summarized in NcheSent. Their existing descriptive values are shown below. StatLab has not independently recalculated or performed hypothesis tests."
      : "NcheSent identified " + count(parsed.summary.candidatesMentioned) +
        " named compounds, linked " + count(parsed.summary.pubchemVerified) +
        " to PubChem references and reported " + count(parsed.summary.executedAgentTasks) +
        " completed bounded tasks. These are source and descriptor checks, not drug-efficacy findings. There are 0 numerical variables, so no statistical tests can be performed on this report.";
    compoundSection.open = false;
    panel.hidden = false;
    actionPanel.focus({ preventScroll: true });
    actionPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not read this file. Choose Excel (.xlsx), CSV (.csv) or PharmaOS (.json).";
    panel.hidden = true;
    datasetPanel.hidden = true;
  }
});

function csvCell(value) {
  const valueAsText = String(value).replace(/^[=+\-@]/, (x) => "'" + x);
  return '"' + valueAsText.replaceAll('"', '""') + '"';
}

csvDownload.addEventListener("click", () => {
  if (!current || columns.length === 0) return;
  const rows = [["variable", "valid_n", "mean", "sample_sd", "min", "max"],
    ...columns.map((c) => [c.name, c.n, c.mean, c.sampleSd ?? "", c.min, c.max])];
  saveAs(rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "pharmaos-statlab-descriptive-summary.csv", "text/csv;charset=utf-8");
});

summaryDownload.addEventListener("click", () => {
  if (!current) return;
  saveAs(makePlainSummary(current, columns),
    "pharmaos-readable-research-findings.txt", "text/plain;charset=utf-8");
});

reportDownload.addEventListener("click", () => {
  if (!current) return;
  saveAs(JSON.stringify(current, null, 2),
    "pharmaos-original-research-report.json", "application/json;charset=utf-8");
});
