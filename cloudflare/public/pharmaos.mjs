// Browser-only PharmaOS handoff. No network requests and no independent statistical analysis.
const fileInput = document.getElementById("handoff");
const status = document.getElementById("message");
const panel = document.getElementById("result");
const numericSection = document.getElementById("numeric-section");
const manuscriptSection = document.getElementById("manuscript-section");
const tbody = document.getElementById("numeric");
const csvDownload = document.getElementById("download");
const summaryDownload = document.getElementById("download-summary");
let current = null;
let columns = [];

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
    "MABRIG PHARMAOS — RESEARCH REPORT SUMMARY",
    "Source: " + sourceName,
    "Source fingerprint (SHA-256): " + data.source.sha256,
    "",
    "RESEARCH EVIDENCE",
    "Named compounds: " + count(data.summary.candidatesMentioned),
    "PubChem-verified compounds: " + count(data.summary.pubchemVerified),
    "Completed bounded research tasks: " + count(data.summary.executedAgentTasks),
    "Defined research roles: " + count(data.summary.totalPlannedRoles),
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
  panel.hidden = true;
  csvDownload.disabled = true;
  const file = fileInput.files?.[0];
  if (!file) {
    status.textContent = "No file selected. Your report stays on this device.";
    return;
  }
  status.textContent = "Opening your report on this device…";
  try {
    if (file.size > 300000) throw new Error("This report is too large. Select a PharmaOS JSON report under 300 KB.");
    const parsed = JSON.parse(await file.text());
    const cols = check(parsed);
    current = parsed;
    columns = cols;
    const name = typeof parsed.source.name === "string" ? parsed.source.name.slice(0, 100) : "your research";
    status.textContent = "Report opened successfully. Your findings are displayed below.";
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
    panel.hidden = false;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not read this file. Choose a PharmaOS report ending in .json.";
    panel.hidden = true;
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
    "pharmaos-readable-research-summary.txt", "text/plain;charset=utf-8");
});
