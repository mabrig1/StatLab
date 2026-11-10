# MABRIG StatLab — research statistics studio

An independent, browser-based SPSS-style **prototype**, not IBM SPSS code and not a full SPSS replacement. Built for survey researchers, students, lecturers and data-analysis trainers. Inspired by common statistical workflows and the [REA](https://github.com/morluto/rea) evidence-first investigation philosophy. REA is a reverse-engineering investigation tool, **not** a statistical analysis engine; we do **not** bundle or redistribute REA or any proprietary SPSS code.

![status](https://img.shields.io/badge/status-local%20prototype-0e987f) ![Python](https://img.shields.io/badge/Python-3.12-blue)

## New: exploratory principal-axis factor analysis (local Python only)

**Extended EFA tools:** reproducible Horn-style component-eigenvalue parallel analysis (95th-percentile null thresholds, 50–200 runs, documented seed), and oblique oblimin/quartimin rotation with separate factor pattern/structure/Φ matrices. The researcher still chooses the PAF factor count. This parallel guide is **not** exact principal-axis common-factor parallel analysis, and does not run in Cloudflare. [Complete EFA methods](docs/EXPLORATORY_FACTOR_ANALYSIS.md).


The Python/FastAPI Analysis Workbench now includes **Exploratory Factor Analysis (EFA)** for selected real respondent-level numeric/ordered questionnaire items. It computes KMO (overall and item-level MSA), Bartlett's approximate χ², eigenvalues of the observed Pearson correlation matrix, **principal-axis factor loadings**, communalities and uniquenesses, with optional orthogonal varimax. Users choose the factor count explicitly; low KMO, singular matrices, insufficient complete cases and nominal variables are rejected. Missing cases and model assumptions are disclosed. This is **not** PCA, CFA or polychoric EFA, and does not reconstruct cases from frequency-only tables.

[Guide and methodological limits](docs/EXPLORATORY_FACTOR_ANALYSIS.md). **Cloudflare does not run this Python analysis.**

## New: local a priori Power & Sample Size Planner (November 2026)

The separate Python/FastAPI workstation now includes a **Power & Sample Size** workflow. A researcher chooses the planned test and supplies a *justified assumed effect size*, target power, alpha, allocation ratio/group count and expected attrition. Supported two-sided designs: one-sample t, paired t, pooled independent-group t, balanced one-way ANOVA, and approximate independent two-proportion z tests. Statsmodels performs the calculations and rounded integer sample sizes are checked against target power. The UI provides a printable methodology memo and explicit caveats; no data are uploaded or fabricated. **It is local-FastAPI-only; Cloudflare does not host these methods.** See [power analysis documentation](docs/POWER_ANALYSIS_GUIDE.md).

## Current product direction — v1.0 foundation (November 2026)

StatLab has **two separate apps in one repository**. The local Python 3.12/FastAPI edition includes real respondent-level statistical procedures; the Cloudflare static browser workstation focuses on editable tables, frequency-only and Likert descriptives, business indicators and content coding. **Do not mistake Cloudflare's static interface for the complete FastAPI engine.**

The first v1.0 foundation adds a **calm Academic/Business home screen**, an explicit browser/local-Python/planned capability guide, **CSAT and NPS** from aggregate response frequencies in Business Analytics, and **APA-inspired Likert HTML tables** without changing statistical results. The Python edition now exposes a read-only `GET /api/capabilities` endpoint. These are incremental changes, **not a full v1.0 release** and not an offline desktop package.

Read the [architecture decision](docs/STATLAB_V1_ARCHITECTURE.md) and [prioritized v1.0–v1.5 roadmap](docs/STATLAB_ROADMAP_V1_V15.md). Product pillars: private local analysis, accurate provenance, preservation of original data, transparent method assumptions and explicit feature availability. No AI model invents statistics. Frequency-only mode never fabricates respondent rows.

## What's implemented in v0.9

- Browser UI: import, **editable Data View**, **detailed Variable View**, analysis workbench, output viewer, and **Research Project Manager**.
- **NEW v0.9 — Unified Output Viewer + Research Analysis History:** One search/filter workspace for results from respondent-level datasets, frequency-only summaries, and Chapter Four drafts. Open any of the most recent **30** reports to inspect a sandboxed, script-disabled HTML preview; download HTML, safe CSV tables or JSON analysis inputs; remove an entry or clear the session. A new run leaves past results available but labels them historical/outdated; restored project reports are always marked archival until independently recalculated. **No history is automatically synced or saved.** On Research projects, choose the separate opt-in checkbox to include up to **20** previous result snapshots in a portable backup; this can contain sensitive aggregate tables and source labels even without individual case rows. Existing v0.8 backups without history remain readable. Older automatic latest descriptive/Chapter Four snapshots remain in project backups.
- **Summary-Only Survey Analysis (v0.6):** independent **Frequencies only** tab requiring **no individual responses or dataset upload**. Paste item counts (plain text, inline codes, Markdown or CSV tables, Python/JSON dictionaries); define custom numeric codes and labels, mark reversed items individually or reverse all, optionally include population and sample sizes **as metadata only**, choose sample SD (default) or population SD. Calculate weighted mean, weighted SD, mode (including ties), weighted median, frequency/percent, original-label top response, explanatory interpretation and verifiable formulas. Download CSV summary and printable HTML report. A mismatched declared Total N is rejected rather than silently "fixed." **Never simulates case-level data or computes correlations, regression, t-tests, ANOVA, or Cronbach's alpha from marginals.**
- **v0.7 — Objective-aligned Chapter Four assistant:** After any valid frequency-only analysis, enter a study title, actual source label (optional), and up to 12 research objectives; map each questionnaire item through a dropdown. Build a carefully qualified Chapter Four report with table captions (`Table 4.1`, ...), frequency/percent rows, item mean, SD, median, mode, objective-by-objective descriptions, methodological notes, and an explicit limitations section. Preview in an isolated browser frame, export HTML, CSV, or an **editable Word `.docx`** draft. Sources are never invented: blank source is labelled *user-supplied counts (not independently verified)*. Item assignments and input counts are checked again at export. **No case-level reconstruction, response rates, inferential results, composite scores, fabricated references or causal claims.**
- **NEW v0.8 — Local Research Project Manager:** Explicitly save and reopen multiple projects in the same browser using IndexedDB. Portable `.statlab.json` backups include frequency-only counts, scale labels, SD settings, reversed scoring, research objectives and item assignments, saved descriptive and Chapter Four HTML/CSV report snapshots, and — if Data View is loaded — the variable dictionary. **Individual case rows are excluded by default**. A separate checkbox permits opt-in backup of Data View cases (up to 10,000 rows and 12 MB), with validated restore of variable labels, missing codes and numeric/date/string types. Imported backup files are schema-checked; archived HTML is rendered in a sandbox with a restrictive CSP. Reopen restores original inputs but requires recalculation before outputs are treated as current. Projects are only on the current browser/device; no server database, synchronization, encryption or account login. Browser data deletion removes IndexedDB projects, so download external backups.
- **Data View (v0.3):** create a blank dataset from scratch, start with 1–100 cases, import CSV/TSV/XLSX/SAV, navigate 25/50/100/200 rows per page (up to 100,000 imported cases), search for codes/responses, filter by variable/equals/contains/valid/user-defined missing, sort display by a column without changing original case order, toggle value labels and questionnaire labels, select rows, add/delete cases, edit cells by double-click/Enter/formula bar, paste Excel-style TSV rectangles with up to 2,500 cells, copy selected cells, clear cells, keyboard navigation, undo/redo up to 25 data actions, export edited CSV.
- **Variable View (v0.2):** edit name, type, width, decimals, full variable label, value labels (including Likert presets), discrete and ranged user-missing codes, columns, alignment, measure, role; reorder variables, add/delete, export/import JSON codebooks, and see valid/missing case counts. Validated edits apply to subsequent analyses.
- Read `.csv`, `.tsv`, `.xlsx`, `.sav` (SPSS `.sav` via `pyreadstat`).
- **Guided descriptive statistics (v0.4):** choose up to 30 variables (including text categories); clear first-five default, variable search, Simple or Detailed report, missing/valid counts, response frequencies with valid percentages, mean/median/SD for numeric **Scale** data, median and categories for coded **Ordinal** items, earliest/latest dates, plain-English interpretations, summary cards, optional advanced quartiles/variance/skewness/kurtosis, one-variable charts, and an interactive statistics glossary. No numeric mean of nominal category codes.
- Frequencies, valid/cumulative percentages.
- Pearson and Spearman correlations with two-sided p-values.
- Multiple linear regression with R², coefficients, confidence intervals and model significance.
- Crosstabs, Pearson chi-square and Cramér's V with expected-cell warning.
- Cronbach's alpha (unstandardized).
- Welch independent-samples t-test, paired t-test, one-way ANOVA, Shapiro-Wilk.
- Edited CSV export with spreadsheet formula-injection protection; standalone HTML results report with tables, notes and data-file fingerprint; JSON reproducibility recipe.
- No server database, permanent server uploads, AI-written invented findings, or external API keys. The optional Project Manager uses the **local browser IndexedDB** database.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate          # on Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. Select **Data & variables** then **Blank dataset** to enter responses from scratch, or **Import dataset** to work on CSV, Excel, TSV or SPSS files. For descriptive statistics: go to **Analysis workbench → Descriptive statistics made simple**; choose variables (first five preselected), choose **Simple report** or **Detailed report**, then click **Run analysis**. The **Output Viewer** now lists all analyses performed in this tab. Click an entry to read the full result, review limitations, or export HTML/CSV/JSON. Earlier runs are never misrepresented as fresh outputs. Up to 30 runs are kept in memory; cleared history cannot be recovered unless saved in a research project. Export the HTML report or copy interpretations to a research draft. For cell entry, double-click/press Enter and type; press Enter to save. Click a cell and use the active-cell field to edit its raw value. Use Ctrl+C and Ctrl+V to copy/paste tab-separated rectangles from spreadsheet software; select a rectangle with Shift+Click. Paste across multiple cells only in original case order with filtering/sorting off, to prevent accidental edits to hidden rows. **Variable View** defines data types, missing-value codes, labels and measurement level; edits immediately affect Data View and future tests.

**Saving work:** Data View changes still live in the local server memory for up to one hour until the user explicitly saves a project. Open **Research projects**, enter a project title, and click **Save in this browser**. Optionally download a portable `.statlab.json` file for durable backup. Frequency-only projects need no case records. If Data View is loaded, variable definitions are saved automatically; individual case rows are saved **only when you explicitly tick the opt-in box**. For an opt-in archive of the last 20 analysis outputs (which can include sensitive aggregates), tick **Include previous analysis history**. Reopening restores inputs and archived output previews; you must click **Calculate** again before treating the statistics as current. Browser storage is not encrypted or synchronized. Do not retain respondent-level records on a shared/public computer. Alternatively export edited CSV and the JSON variable dictionary separately. This is not an `.sav` writer and does not automatically save unsaved changes. Launch on `127.0.0.1` only; **the prototype has no login and must not be publicly exposed**.

## Research Project Manager — save, reopen, export, import

1. Work in **Frequencies only**, and optionally generate your Chapter Four draft. All current questionnaire input fields are eligible for saving, even before calculating.
2. Click **Research projects** (or **Save project**) and provide a clear project title. Click **Save in this browser** to create or update a local project. Use **Save as new copy** to duplicate it. The saved project contains all questionnaire frequencies, scale labels, reverse scoring, analysis settings, source attribution, objectives and item-to-objective mappings. Generated report snapshots are archived but clearly marked as historical.
3. To archive the past 20 analysis runs, check **Include previous analysis history** (off by default). The complete HTML, CSV and JSON analysis recipe may disclose aggregate questionnaire findings. For a portable backup, click **Download backup JSON**. Use **Import backup file** later on another browser/device. The backup includes only what was explicitly included when saved.
4. To reopen, select **Open** in the saved-projects list, confirm replacement of any current unsaved workspace, and then choose **Frequencies only → Calculate** before generating an updated report. Saved Chapter Four drafts can be reviewed from the archived preview; regenerate Word exports from restored inputs.
5. **Data View privacy:** the *Include individual Data View cases* checkbox is off by default. If off, variable definitions are kept in the project without the respondent rows. Reimport the original CSV/Excel file later and use **Apply saved codebook** to restore the matching definitions. If on, the project also includes original cases and restores the dataset from the validated snapshot; the browser project and downloaded JSON will contain potentially sensitive research data.

Limits: 60 local projects per browser profile; file import <=20 MB, saved case snapshot <=10,000 rows and <=12 MB. For larger case datasets, export edited CSV and the variable dictionary separately. Browser history/private mode or clearing site data may remove projects. There is no multiuser security or cloud sync.

## Frequency-only workflow — survey counts without Data View

1. Open the application and click **Frequencies only** in the main menu. This page does not require an uploaded dataset, does not use Data View or Variable View, and does not retain item inputs server-side.
2. Paste one or more items, for example:

   ```text
   Item 5 (5-point scale):
   Strongly Disagree = 30
   Disagree = 23
   Neutral = 20
   Agree = 45
   Strongly Agree = 35
   Total N = 153
   ```

   Or paste a CSV/Markdown wide table with columns `Item,Strongly Disagree,Disagree,Neutral,Agree,Strongly Agree,Total N`; a table with `Item,Response,Frequency`; `Item 5: 1=30, 2=23, 3=20, 4=45, 5=35`; or a Python/JSON dictionary of items and category frequencies.
3. Specify codes and their labels under **Set your rating scale**. For negatively worded questions, use an item heading such as `Item 6 [reverse]:`, or tick **Reverse-score every item**. Original category counts stay labelled with original responses; only scored values reverse.
4. Select **Sample SD** (recommended for surveyed respondents, denominator `N−1`) or **Population SD** (denominator `N`, only if the frequency distribution is the full population of inference). Leave population/sample size blank or provide them as metadata only.
5. Click **Calculate descriptive statistics**. Inspect the combined table and each item's frequency table, formulas, median/mode, and cautious interpretation; export CSV or formatted HTML.

**Worked check:** With the Item 5 example, valid `N=153`, `Σfx=491`, mean `491/153 = 3.209150…`, sample SD `1.453913…`, median `4`, mode `4`, top original response **Agree** (`45`, `29.41%`). No respondent-level data can be recovered from this table.

**Python+pandas scripts:** Run `python scripts/frequency_only_example.py` using the app module, or run `python scripts/frequency_only_standalone.py` as a self-contained pandas-only program. Both read a pasted `FREQUENCIES` dictionary, report weighted statistics and working, create `frequency_only_summary.csv`, and explain the limitations. Neither expands frequency counts into invented rows. The module is `app/aggregate_descriptives.py`; endpoints: `POST /api/frequency-only/analyze` and `POST /api/frequency-only/summary.csv` (JSON request bodies).

**Limitations:** Per-item marginal frequency distributions cannot identify who gave which answers across items. They cannot support paired relationships (Pearson/Spearman correlations), regression, t-tests, ANOVA, Cronbach’s alpha, composite item-level respondent scores, or inferential analyses requiring paired observations. Metadata sample/population sizes do not remove this limitation. Likert means/SD use numeric coding as an approximation to an ordinal scale; no causal or hypothesis conclusions are generated.

## Chapter Four workflow — verified descriptive findings only (v0.7)

1. Click **Frequencies only**, paste the response counts and choose the correct scale, reverse-score markers, and sample/population SD method. Click **Calculate descriptive statistics**. Never paste synthetic respondents to fill missing information.
2. Scroll to **Turn your frequencies into Chapter Four** (step 4). Enter a real study title and specific research objectives, each on its own line. The items you calculated appear in a dropdown list: assign each item to the appropriate objective; items left unassigned remain in their own section rather than being attributed arbitrarily. A single objective is offered as the initial selection for all items, and can be changed.
3. **Source label is optional.** Leave it blank for the default caution, or enter `Field Survey, 2026` **only when that attribution is factually true**. It is not verified by the app.
4. Choose **Generate Chapter Four draft**. Inspect the preview and the per-item numeric results. Download Word (`.docx`) for editing, HTML for printing, or CSV of item summaries. The resulting document covers 4.1 Introduction; 4.2 Coverage and Method; 4.3 Data Presentation; 4.4 Discussion by Objective; 4.5 Limitations. The Word file uses Times New Roman, 12-point, 1.5 line spacing and unshaded tables. It is an editable draft, *not* a university-specific approved thesis template.
5. To reproduce the example programmatically, post `samples/chapter_four_example_request.json` as JSON to `/api/frequency-only/chapter-four` (JSON report/HTML/CSV) or `/api/frequency-only/chapter-four.docx` (binary editable Word output). Both endpoints **recalculate and validate** the supplied item frequencies, are stateless, and require no original dataset.

**Offline example:** Run `python scripts/chapter_four_example.py` to generate a demonstration Word file, HTML report, and CSV summary under `examples_generated/`. These illustrative figures are not field observations.

**Academic integrity:** A group of item means is not a respondent-level objective score. If item valid Ns differ, the report says so. Sample/population metadata cannot establish questionnaire response rate; individual-level relationships and significance remain unavailable. Verify category labels and reverse scoring against your questionnaire and do not cite example data as field observations. No external AI model or prompt-based speculation is used in automatic prose.

## Run tests

```bash
pip install -r requirements-dev.txt
pytest -q
```

## Important limitations

1. **Not production-ready.** Datasets reside in a single Python process for up to one hour (or until cleared). Session IDs are random, but authentication, row-level access control, per-user quotas, CSRF/public deployment protections, persistence, and data deletion audits are **not implemented**. Do not place identifiable research data on a publicly reachable server. Use local/private devices for experiments.
2. Analysis is exact for the implemented methods under their stated conventions, not guaranteed identical to every SPSS default. Compare reference calculations and validate assumption checks before publication.
3. Edited data is in server memory only; undo/redo (up to 25 data actions) is cleared when variable structure/metadata changes. Numeric variable identification is heuristic. **Check Variable View → Measure before descriptive analyses**: raw numeric 1–5 coding may be an ordinal Likert item rather than a continuous scale. Scale numeric data get means and SD; nominal/ordinal items get valid-response percentages. Treat mean values for Likert items as a methodological choice, not a software assumption. Prepare reverse-coded items before reliability analysis. No recode/data transformation editor yet.
4. Filtering and sorting in Data View are display-only; they do not reduce the sample used in statistical analyses. Complete-case filtering varies by method; see methods footnotes. No weighting, complex survey design, logistic regression, nonparametrics beyond rank correlations, post-hoc tests, mixed models, factor analysis, SEM, moderation, mediation, or `.spv` output.
5. .sav support requires `pyreadstat`; value labels are displayed in metadata when present but analyses use the underlying numeric codes for quantitative methods.
6. String entry is limited by Variable View Width (maximum 255); update width first for longer text. Excel-style pastes support at most 2,500 cells per operation and may create up to 100 new cases. The inference narratives are constrained summaries only; they do not automatically decide whether hypotheses are substantively supported.
7. This is an original app, not a cloned IBM interface, logo, graphics, or proprietary algorithms.

## Deployment roadmap

**Phase 1 (here):** local-first evidence-based analysis, summary-only frequency calculation, test fixtures and API.

**Phase 2:** user-facing recode wizard and transformation controls; case weighting, stronger persistent auditing and privacy controls; ordinal reliability, one-sample tests, Mann-Whitney/Kruskal-Wallis, ANOVA post-hoc; additional XLSX/PDF exports (Chapter Four DOCX available in v0.7); structured table-of-results output.

**Phase 3:** split into Next.js web UI (Vercel or Cloudflare) and authenticated Python worker/API (container VPS), user/tenant isolation, encrypted R2 storage, expiring upload URLs, privacy consent, background compute jobs, full audit logs, quotas, billing, training assistant, validated reference test corpus.

## Statistical attribution

Core dependencies: **SciPy**, **statsmodels**, **NumPy**, **Pandas**, **FastAPI** and **pyreadstat**. Check their independent licenses and notices when distributing commercially. Reverse engineering/clean-room research notes are documented in `REA_WORKFLOW.md`.

## Try it with a sample

Use `samples/SYNTHETIC_demo_survey.csv` to explore correlations, regression, group comparisons and a 3-item reliability test. **These 110 rows are machine-generated demonstration data, not field-survey responses, and must never be presented as real academic findings.**
