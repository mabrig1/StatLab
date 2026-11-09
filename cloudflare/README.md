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
