const fileInput = document.getElementById("handoff");
const status = document.getElementById("message");
const panel = document.getElementById("result");
const tbody = document.getElementById("numeric");
const noNumeric = document.getElementById("no-numeric");
const download = document.getElementById("download");
let current = null;
const format = (v) => typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "N/A";
const td = (value) => { const el = document.createElement("td"); el.textContent = String(value); return el; };
function check(data) {
  if (!data || data.schemaVersion !== "discovery-1.0" ||
      data.researchOnly !== true || data.clinicalUse !== false ||
      !data.source || !/^[a-f0-9]{64}$/i.test(data.source.sha256 || "") ||
      !data.summary || !Array.isArray(data.agents) || data.agents.length > 50 ||
      !Array.isArray(data.compounds) || data.compounds.length > 50) {
    throw new Error("Not a supported, research-only PharmaOS report.");
  }
  if (data.summary.molecularDockingPerformed !== false || data.summary.admetPredictionPerformed !== false) {
    throw new Error("Unsupported claims of molecular docking or ADMET.");
  }
  if (data.csv !== null && (typeof data.csv !== "object" || !Array.isArray(data.csv.numericColumns) || data.csv.numericColumns.length > 30)) {
    throw new Error("The numeric summary is not valid.");
  }
  const cols = data.csv?.numericColumns || [];
  for (const c of cols) {
    if (typeof c.name !== "string" || c.name.length > 100 ||
      !Number.isInteger(c.n) || c.n < 1 || c.n > 2000 ||
      !Number.isFinite(c.mean) || !Number.isFinite(c.min) || !Number.isFinite(c.max) ||
      (c.sampleSd !== null && !Number.isFinite(c.sampleSd))) {
      throw new Error("A numeric column failed validation.");
    }
  }
  return cols;
}
function cell(row, value) { row.appendChild(td(value)); }
fileInput.addEventListener("change", async () => {
  current = null; panel.hidden = true; download.disabled = true;
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 300000) throw new Error("Maximum report size is 300 KB.");
    const parsed = JSON.parse(await file.text());
    const cols = check(parsed);
    current = parsed;
    status.textContent = "Validated portable PharmaOS research report imported locally.";
    document.getElementById("digest").textContent = "SHA-256 of original source: " + parsed.source.sha256;
    const stats = document.getElementById("stats");
    stats.replaceChildren();
    for (const [label, value] of [
      ["Compounds mentioned", parsed.summary.candidatesMentioned],
      ["PubChem references", parsed.summary.pubchemVerified],
      ["Executed agent tasks", parsed.summary.executedAgentTasks],
      ["CSV dataset rows", parsed.csv?.rows ?? "Not included"]
    ]) {
      const el = document.createElement("div");
      el.textContent = label + ": " + String(value);
      stats.appendChild(el);
    }
    tbody.replaceChildren();
    cols.forEach((c) => {
      const tr = document.createElement("tr");
      [c.name, c.n, format(c.mean), format(c.sampleSd), format(c.min), format(c.max)].forEach((v) => cell(tr, v));
      tbody.appendChild(tr);
    });
    document.getElementById("method").textContent = parsed.csv?.warning ?? "No numerical secondary-data analysis in this report.";
    noNumeric.hidden = cols.length > 0;
    download.disabled = cols.length === 0;
    panel.hidden = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Invalid JSON.";
  }
});
function csvCell(value) {
  const valueAsText = String(value).replace(/^[=+\-@]/, (x) => "'" + x);
  return '"' + valueAsText.replaceAll('"', '""') + '"';
}
download.addEventListener("click", () => {
  if (!current?.csv?.numericColumns?.length) return;
  const rows = [["variable", "valid_n", "mean", "sample_sd", "min", "max"],
    ...current.csv.numericColumns.map((c) => [c.name, c.n, c.mean, c.sampleSd ?? "", c.min, c.max])];
  const content = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "pharmaos-statlab-descriptive-summary.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 300);
});
