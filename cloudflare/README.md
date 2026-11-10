# MABRIG StatLab — Cloudflare deployment repair

This directory supports the existing Cloudflare Worker named **statlab**. The repository also contains a FastAPI/Python application (which does not run in a standard JavaScript Worker). The Worker deployment serves a lightweight frequency-only survey analysis screen and restricted integration gateway; it is not the full Python SPSS-style product.

## Correct Workers Builds settings

Open **Workers & Pages → statlab → Settings → Builds**:

| Setting | Value |
| --- | --- |
| GitHub repository | mabrig1/StatLab |
| Production branch | main |
| Root directory | repository root (blank or / depending on dashboard) |
| Build command | leave blank |
| Deploy command | npx wrangler deploy |
| Wrangler configuration | wrangler.jsonc in repo root |
| Worker name | statlab |

If you intentionally set root to the cloudflare/ subdirectory, its cloudflare/wrangler.jsonc is also configured with matching relative paths. Choose only one root directory.

Save the changes, visit **Deployments**, open the most recent failed build, and use **Retry** once main is updated. If a new build still fails, inspect its **Build logs** and share the first meaningful error line (not your API keys).

## What has been fixed

- Wrangler now uses the exact existing Worker name (statlab).
- Root and nested Wrangler configurations both resolve correctly.
- The unconditional required-secret validation has been removed. Provider integrations remain disabled by default, and missing optional credentials will fail closed only when the relevant endpoint is explicitly called.
- Static assets under cloudflare/public serve a browser-only, frequency-count descriptive calculator. Results do not leave the browser.
- No Python packages, Pandas or FastAPI server are required in the Worker build.

## OpenRouter and Resend environment variables

Keep these as encrypted Cloudflare secrets (already visible in your screenshot): OPENROUTER_API_KEY, RESEND_API_KEY.

For optional, administrator-only integration tests later: STATLAB_ADMIN_TOKEN (secret; at least 32 random characters), RESEND_TEST_TO_EMAIL (secret; fixed test recipient), OPENROUTER_MODEL (text; valid model ID), RESEND_FROM_EMAIL (text; verified-domain sender), STATLAB_SITE_URL (text; optional). Leave INTEGRATIONS_ENABLED=false until secure authentication and quotas exist.

The Resend endpoint is only an administrator-initiated test email with a fixed recipient. It does NOT yet implement registration, password reset, or public transactional email. The OpenRouter endpoint is admin-only and requires explicit consent before sending aggregate summary text.

## Local validation (no deployment)

From the repository root:

    node --test cloudflare/tests/*.test.mjs
    npx wrangler deploy --dry-run

The Wrangler dry run packages the code without publishing to Cloudflare.

## Diagnosing errors

- Cannot find config: set root directory to repository root, or explicitly to cloudflare.
- Cannot resolve entrypoint: check cloudflare/src/index.mjs and the selected Wrangler config.
- Missing required secrets: use the current main branch, which removes the premature requirement.
- npm run build / pip / uvicorn failure: clear the dashboard Build command; deploy the Worker preview, not the Python backend.
- Cloudflare authentication failure: inspect the Git integration/Builds deploy token.
- Website returns 404: inspect asset upload output and visit the Worker root URL; the integration gateway alone does not implement the full Python API.

Official docs: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ and https://developers.cloudflare.com/workers/static-assets/binding/

## Browser Data View and Variable View (Cloudflare edition)

The Cloudflare-hosted interface now includes three functional tabs: **Data View**, **Variable View**, and **Frequency-only Analysis**. Its independently implemented spreadsheet layout follows familiar statistical-editor conventions: numbered cases, two-level nominal / metric / ordinal column headings, and a lightweight import/export toolbar. The supplied machine-quality example is **synthetic**, not genuine field-survey data.

- **Data View:** click cells to edit respondent-level observations; add/delete rows or columns; navigate up to 5,000 cases and 80 variables; search cases; paste up to 2,500 tab-separated cells at once; display value labels; undo/redo up to 25 actions.
- **Variable View:** edit name, numeric/string/date type, width, decimals, descriptive label, value labels, user-defined missing codes, displayed columns, alignment, nominal/ordinal/scale measurement and input/target role. Reorder or delete variables with their case values aligned.
- **Project handling:** browser-local IndexedDB save (when permitted), CSV import/export, variable dictionary export and complete JSON project backup/restore. Do not assume browser data is encrypted or backed up remotely. Users should export portable backups and avoid sensitive records on shared computers.
- **Analysis hand-off:** choose an encoded ordinal/scale question in Data View to generate frequency-only input using the actual observed counts and missing-value rules; it does not reconstruct data from marginal tables.
- **Sample presets:** synthetic machine-quality sample matching the spreadsheet reference format, and synthetic Likert survey sample. Start from a blank project if preferred.

**Security and deployment boundary:** These browser-only features do not send case records to the Cloudflare Worker, to OpenRouter, or to Resend. The static app does not yet provide full Python-based regression, t-tests, ANOVA, account logins, cross-device sync, a data backend, or secure multiuser storage. The Worker integrations remain disabled by default. Cloudflare builds use `wrangler.jsonc` from the repo root and `npx wrangler deploy` as previously documented.

## New: Likert Scale Studio for questionnaire research

The Cloudflare edition includes a dedicated **Likert Scale Studio** tab, alongside Data View, Variable View and Frequency-only Analysis. This is intended to lower the learning curve for students preparing research-question descriptives for Chapter Four. All calculations take place in the browser, not through OpenRouter or Resend.

1. Choose **4-, 5-, or 7-point Likert** and confirm the exact code-to-label meanings. Customize the labels when necessary.
2. Add distinct research objectives and assign questionnaire questions to each one.
3. Enter frequency counts in the editable grid, paste multiple items as Item 1 / Agree = 45 blocks or CSV/TSV matrices, **or** import real numeric Ordinal columns from Data View. If a codebook label conflicts with the selected scale, the import stops with a clear error instead of silently relabeling scores. An optional declared N is validated against the count sum.
4. Choose **sample SD (N-1, default)** or population SD (N), and mark any reversed questionnaire items individually.
5. Click **Analyze my Likert data** for per-item counts and percentages, weighted mean, SD, weighted median, modal answer(s), response bars, and plain-language descriptions. A numerical midpoint comparison is descriptive, **not** a hypothesis-test decision.
6. Download an objective-organized **CSV** table, download a safe HTML Chapter Four draft, or copy an editable plain-text Chapter Four discussion.

The objective panel shows an **unweighted mean of item means**, explicitly labeled as such; it does **not** calculate a respondent-level composite SD or manufacture paired answers. N can vary by item. Frequency-only counts cannot establish correlation, regression, reliability, t-tests or ANOVA. Do not report statistical significance or causality from counts alone.

### Privacy and provenance

- The starter survey uses explicitly **synthetic** 153-response frequency examples. Replace them with your actual questionnaire data before reporting findings.
- The source field is optional: it never assumes you conducted a 2026 field survey. The report attributes any entered source label to the user and identifies it as unverified.
- Importing actual Data View ordinal variables only derives single-item counts, respecting user-missing codes. It does not send respondent data to the Worker or reconstruct respondents from summary counts.
- Browser Data View projects may persist in IndexedDB (subject to browser controls). Export your own backup before clearing browser data. The generated CSV report is made safe against spreadsheet formula injection in text fields.
- The full Python inferential engine and multiuser authentication remain separate and are not deployed by this static Cloudflare Worker.

The synthetic questionnaire examples and numeric calculations are covered by tests in cloudflare/tests/likert.test.mjs.

## Student Likert project backups and Chapter Four tables

Likert Scale Studio now supports **unfinished-project backups** and **objective-aligned thesis tables**, including:

- Browser-local autosave of questionnaire settings and response counts when storage is available. Storage is not encrypted, synchronized or suitable for confidential research data on shared computers; users should download a portable backup.
- Download or reopen a validated **Likert Studio JSON project**. Partial draft count cells can remain blank. Only frequencies and questionnaire metadata are in the backup, not respondent-level rows, API secrets, or case pairings. If originally derived from Data View, the restored copy is explicitly treated as a detached frequency snapshot.
- A **Chapter Four thesis tables** section that presents every response category as frequency and valid percentage, with valid N, item mean, item SD and a descriptive comparison against the scale midpoint.
- Column order can be changed from strong agreement → disagreement (common thesis layout) to ascending codes, without changing original scores or calculations.
- Download a **print/Word-friendly HTML table** (with escaped user text and source notes) or a **spreadsheet-safe CSV table** grouped by research objective.
- Each objective's arithmetic average of item means is explicitly distinguished from a composite respondent score. No inferential significance test is implied.

StatLab does not fabricate field observations, response rates, or correlations from marginal frequency counts. Numerical means for ordered responses assume approximately equally spaced rating codes. The user must provide any survey source label, which remains unverified.

To review this feature locally: run `node --test cloudflare/tests/*.test.mjs` and open the static frontend through Wrangler. Files: `cloudflare/public/likert-student.mjs`, `cloudflare/tests/likert-student.test.mjs`.

## SPSS-style Value Labels popup

In **Variable View**, click the **Values** cell (for example "Add labels..." on Q1). A small dialog now follows the familiar SPSS workflow:

1. Enter a **Value** code, e.g. `1`, and a **Label**, e.g. `Strongly Disagree`.
2. Click **Add**; repeat for each code. Selecting an existing entry populates the fields for **Change** or **Remove**.
3. For questionnaires, choose **5-point Likert** to fill the standard `1 = Strongly Disagree` through `5 = Strongly Agree` mapping instantly; 4- and 7-point presets are also available. Existing draft labels are replaced only with confirmation.
4. Optionally mark the variable **Ordinal** and define user-missing codes such as `99`.
5. Click **OK — Save labels** to apply. Click **Cancel** or close the dialog to discard any uncommitted changes.

The editor prevents duplicate numeric codes, empty labels, invalid numeric entries and duplicate missing codes. Changing a label updates the data dictionary only; it **does not recode or overwrite existing respondent values**. Each variable has independent labels. Turn on **Display value labels** in Data View to see words instead of coded numbers. The underlying SPSS-style Data View and frequency-only/ Likert analysis tabs remain unchanged.

## Bulk Likert Quick Setup — Q1 through Q40

From **Variable View**, select **Set up Q1–Q40 Likert**. The dialog provides a safe way to apply the same questionnaire codebook across many questions without opening forty separate Value Labels windows.

- **Create missing Q1–Q40:** adds only questionnaire variable names that do not exist, each numeric/ordinal with a five-point value-label preset (1 = Strongly Disagree to 5 = Strongly Agree). New Data View cells are **blank** and do not represent actual respondents. Existing variables, labels and respondent values are preserved. Maximum 80 total variables applies.
- **Select target questions:** choose Q1–Q40, all numeric variables, or individual checkboxes. String/date variables are disabled.
- **Choose labels:** standard four-, five-, or seven-point presets, or copy the codebook of an existing Numeric variable with 2–11 defined response labels (including custom Never / Rarely / Often mappings).
- **Protect codebooks:** default **Skip variables with existing value labels**. To replace an existing codebook, explicitly switch to **Replace**, review the preview and confirm. Case values never change.
- **Preview and validate:** shows eligible and skipped variables and the reasons. Variables with non-missing observed scores not in the chosen coding scheme are skipped to prevent invalid analysis. Existing user-defined missing codes are retained.
- **Set measurement level:** checked by default to mark successfully updated questions as **Ordinal**. Each successful bulk operation is one undoable edit and uses the existing browser project save mechanism.

**Important:** A reverse-worded questionnaire statement may require reverse scoring in analysis; simply copying its value labels does not reverse individual response codes. Protect respondent-level source files with a backup before editing. This is a browser-local workflow and does not use OpenRouter, Resend or server-side data processing.

Automated checks: `node --test cloudflare/tests/*.test.mjs` and `npx wrangler deploy --dry-run`.
