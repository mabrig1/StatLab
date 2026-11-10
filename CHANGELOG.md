## Unreleased — local exploratory factor analysis

- Added local FastAPI **principal-axis EFA**: 4–25 variables, 1–6 researcher-selected factors, 50+ complete records and at least five complete cases per item, maximum 10,000 complete records.
- KMO overall and item-level sampling adequacy, Bartlett χ²/df/p, Pearson correlation eigenvalue scree, common-factor loadings, communalities, uniquenesses, cross-loadings, listwise deletion diagnostics and optional orthogonal varimax.
- Rejects missing/unpaired respondent files, invalid numeric/text/nominal coding, low overall KMO (<0.50), singular correlation matrices, constant items and insufficient N. Does not reconstruct frequency-only marginals.
- Updated local Analysis Workbench UI, capability disclosure, reproducible numerical tests and documentation. CFA, polychoric ordinal analysis, oblique rotation and parallel analysis remain unavailable.

## Unreleased — validated a priori power planning (local Python)

- New power/sample-size planner for one-sample/paired/pooled-independent t, balanced ANOVA and approximate independent proportions, using Statsmodels with input limits and verification after rounding.
- Local FastAPI endpoints `POST /api/power/sample-size`, `POST /api/power/report.html`, and updated `GET /api/capabilities`.
- Local UI for planning, per-arm attrition adjustments and printable methodology memo. No data uploads, no invented effects or test results.
- Added independent regression tests. Cloudflare feature registry states **Local Python only**; it is not a Cloudflare web feature or desktop installation.

# 0.9.0 — Unified Output Viewer and Analysis History (9 November 2026)

- Central Output Viewer now tracks case-level statistical analyses, frequency-only survey statistics and generated Chapter Four drafts in one searchable, filterable history.
- Up to 30 results per open tab, with readable result title, method, timestamp, input source and explicit **latest / historical / archived** indicators. Editing case datasets, frequency counts or objective mappings marks affected reports stale; changing projects never presents imported snapshots as new calculations.
- Selected results display HTML in a sandboxed iframe with restrictive CSP and without script, same-origin, form or remote-network permissions. HTML downloads, CSV table downloads, and JSON inputs/recipes are available where applicable. CSV table output neutralizes spreadsheet formula payloads. Imported saved HTML with active markup is rejected.
- An opt-in, unchecked-by-default **Include previous analysis history** checkbox archives up to 20 prior reports inside each saved project or portable JSON backup. Frequency-only work never creates artificial respondent records. Old v0.8 project backups without output history remain compatible.
- Added frontend event adapters, static-file routes and automated asset/contract tests. Local server API and Python statistical methods are unchanged. Browser interactions were exercised against actual Python endpoints through an offline Chromium bridge: frequency calculation, Chapter Four creation, history/search/filter, outdated markers, backup export, archival restoration and dataset analysis. Network-restricted Chromium could not navigate localhost normally; direct production browser testing and IndexedDB persistence E2E remain outstanding.
- Not production-ready: there is no authentication, cloud storage, or secure multiuser isolation; project browser storage is unencrypted. Do not expose to the public Internet.

# 0.8.0 — Research Project Manager (9 November 2026)

- New Projects workspace: explicitly save, reopen, list, copy, rename-on-save, delete, and export/import independent research projects via local-browser IndexedDB.
- Frequency-only input, scale labels, sample/population SD, reversed scoring, research objectives, item assignments, and completed descriptive/Chapter Four HTML+CSV report snapshots can be stored together.
- By default, any imported case-level dataset is NOT backed up with a project. The project's editable variable dictionary is saved, and it can be reapplied to a matching dataset later. A separate explicit opt-in adds up to 10,000 case rows/12 MB of data to the backup.
- Added validated snapshot export and restore endpoints. Restored datasets preserve their actual values, numeric/string/date types, value labels, missing codes, variable roles and order, but get new session IDs and SHA-256 fingerprints. No respondent rows are synthesized.
- Saved reports are historical snapshots. Reopened inputs require explicit recalculation. Changes in counts/objective mappings invalidate retained report drafts.
- Portable `.statlab.json` backups, explicit browser privacy warnings and a read-only iframe/CSP for viewing imported report HTML.
- Fixed static-file allowlist so existing Chapter Four JavaScript actually loads when served through FastAPI; also allowlisted the two new project assets.
- Added snapshot, failure-atomicity, date conversion and static-asset API tests; full test suite now has 139 passing tests. Node.js syntax validation for all browser JavaScript passed. The container's managed Chromium blocks page navigation, so **interactive browser E2E is not verified** for this release.
- **Not production-ready:** Local browser IndexedDB is not encrypted and is not shared across devices; server case datasets remain in memory and unprotected by user authentication. Do not expose FastAPI publicly.

# 0.7.0 — Research-objective Chapter Four drafts (9 November 2026)

- New Step 4 in frequency-only mode for study title, 1–12 research objectives, explicit assignment of questionnaire items to objectives, and optional verified-by-user source labels.
- Generate academically structured Chapter Four with properly sequential table numbering after grouping, raw frequency/percent tables, item-specific N/mean/SD/median/mode, plain-language descriptive discussions, and explicit limitations.
- Preview escaped script-free HTML in a sandboxed iframe; export HTML, formula-injection-safe CSV, and editable DOCX (Times New Roman 12, 1.5 line spacing, plain black-and-white tables).
- Stateless report endpoints revalidate input counts and metadata on every request; no case-level data or inference performed. Disagreeing item Ns are noted, never treated as response rate evidence. HTML output escapes user text.
- Added 17 automated tests (134 in the full suite), including API, CSV safety, HTML escaping, Word content, multiple objectives and validation edge cases. Offline browser test verified the generation flow and export controls; end-to-end hosted deployment testing is still pending.

# 0.6.0 — Summary-only frequency analysis (9 November 2026)

- New isolated **Frequencies only** page; needs no dataset upload or respondent-level data.
- Flexible text, Markdown, CSV and dictionary frequency inputs; defined scale labels, reversible scoring, metadata sizes.
- Weighted frequency/percentage, mean, optional sample/population SD, cumulative-frequency median, mode with ties, plain-language interpretation.
- Sample SD (N−1) by default with transparent f·x and f(x−mean)² working; single-response sample SD undefined.
- CSV/HTML export and strict fail-closed validation of totals, codes and nonnegative integer counts.
- API `/api/frequency-only/analyze` and `/api/frequency-only/summary.csv`; independent pandas demo script and test coverage.
- Clear prohibition on reconstructing individual cases or performing correlations, regression, t-tests, ANOVA or reliability from marginals.

# Release notes

## v0.4 — Beginner-friendly descriptive statistics (9 November 2026)

- Rebuilt descriptive statistics as a three-step guide: choose questions, choose Simple/Detailed, run and interpret.
- First five variables preselected, searchable list, selection count, and up-to-30-variable summaries; supports numeric, text categories, ordinal codes, and dates.
- Uses measurement levels defined in Variable View: numeric Scale → valid/missing N, mean, sample SD, median, min/max; Ordinal/Nominal → response counts and valid percentages; date → first/last date.
- Supports SPSS value labels and user-missing codes, without altering stored raw responses.
- Reports key figures, per-variable plain-English summaries, warnings for suspect coding and high missingness, response charts/histograms for single variables, and a help glossary.
- Detailed reports add sample variance, quartiles, IQR, sample-adjusted skewness and excess kurtosis for numerical Scale variables; Simple report hides them.
- HTML report exports new findings, while JSON recipes record the report detail choice.
- Added 12 automated regression tests covering mixed data, missing-value rules, percent denominators, advanced statistics, and backward-compatible API.

## v0.3 — Data View and Variable View editor (9 November 2026)

### Data View
- Start from a blank dataset, or import CSV, TSV, XLSX, SAV.
- Editable observations table: direct cell editing, active-cell editing, Tab/Enter/arrow navigation, blank/system missing handling.
- Multi-cell copy/paste from spreadsheet-style tab-separated clipboard, atomic input checks, up to 2,500 cells; safe append of up to 100 cases.
- Display value labels and full variable labels while preserving stored raw values.
- Search, column-level filter (contains, equals, missing, valid), and stable display-only sorting.
- Navigate 25/50/100/200 cases per page, select and delete cases, insert cases, clear highlighted cells.
- Undo/redo up to 25 small edits. Optimistic revision checks avoid stale write surprises.
- Export edited CSV with spreadsheet formula-injection safeguards.

### Variable View
- Editable properties: Name, Type (numeric/string/date), Width, Decimals, Label, Values, Missing, Columns, Align, Measure, Role.
- Edit value labels, apply Likert and Yes/No presets, define discrete missing codes and a numeric missing range.
- Create/delete/reorder variables and export/import a variable dictionary JSON.
- Identify case counts, distinct responses, valid/system-missing/user-missing observations.
- Validate dictionary edits before applying them; numeric analyses exclude declared user-missing codes without altering exported raw observations.

### Quality and constraints
- 62 pytest checks currently cover the statistical engine, API, Variable View and Data View.
- Local use only. No user authentication, automatic persistence, production hosting or .sav export; sessions expire after one hour or server restart. Export data and dictionary separately before closing.
- This application is an independent SPSS-style prototype; it is not IBM SPSS and does not contain IBM proprietary code.
