# Advanced Web Compute Pilot — guarded design and release checklist

**Status: implementation branch only. This is NOT active in production.** No Cloudflare settings, D1 tables or Cloudflare Access policies have been created by this branch. No research datasets have been uploaded to a cloud provider.

## What was implemented

- New responsive **/advanced.html** (Cloudflare static asset), with local-only CSV parsing, optional consecutive ISO dates/months validation, one chosen numeric variable and two acknowledgement checkboxes: time-series integrity and opt-in remote transfer.
- New Cloudflare **/api/advanced/status** public capability endpoint and **/api/advanced/run** Access-authenticated REST endpoint, both fail-closed unless explicitly configured.
- Access identity JWT verified using RS256 signature and Cloudflare team's published JWKS. Validates expected issuer, application-specific AUD, expiry, optional not-before and nonempty sub. Unauthenticated or forged tokens cannot invoke the Python backend.
- Request whitelist and <=60 KB JSON payload, method-specific bounds (ARIMA 50–1,200; GARCH 150–2,500 numeric observations), strict HTTPS backend host config, 25-second upstream timeout and sanitised errors.
- **Daily 20-request ceiling** enforced atomically by a dedicated D1 table. The database stores only a SHA-256-derived subject ID, UTC date and number of requests. The Worker neither stores input arrays nor results.
- A separate \`app.compute_service:app\` FastAPI process (do **NOT** expose \`app.main:app\`), accepting only \`GET /health\` and bearer-authorized \`POST /internal/compute\`. Uses the existing bounded ARIMA/GARCH numerical modules, no dataset sessions, auth UI, file uploads or OpenRouter.
- The existing browser-first Data View, Likert Studio and other pages do not auto-send any records; the new pilot is a separate opt-in page.

## Required security gates BEFORE enabling or enrolling actual students

1. **Private Python host:** Provision and audit a private CPU compute host (or managed container), install \`requirements.txt\`, run \`uvicorn app.compute_service:app --host 127.0.0.1 --port 8090\`, terminate TLS at a private tunnel or audited ingress. Never expose unauthenticated \`app.main:app\` to the public network.
2. **Unique random 32+ byte secret:** Set \`STATLAB_COMPUTE_SHARED_TOKEN\` only on the Python host and the identical \`ADVANCED_ENGINE_TOKEN\` as a Cloudflare Worker **secret**, not in HTML, repo, \`vars\` or screenshots. Rotate if accidentally disclosed.
3. **Dedicated D1 database:** Manually create a pilot database, apply \`cloudflare/migrations/0001_advanced_compute_quota.sql\`, and add binding \`ADVANCED_USAGE_DB\` to the intended Worker environment. Confirm atomic quota enforcement and day-boundary behaviour. Do not attach an unrelated learner or customer database.
4. **Cloudflare Access (JWT):** Configure a self-hosted Access application for the exact \`/api/advanced/run\` endpoint. Restrict to approved pilot identities and confirm Access policy enforcement. Configure trusted \`CF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com\` and exact \`CF_ACCESS_AUD\` unique application audience. The Worker independently verifies cryptographic signature and claims; an untrusted supplied Access header is never accepted without validation.
5. **Backend ingress security:** Set \`ADVANCED_COMPUTE_ORIGIN=https://<private-backend-host>\` via Worker environment settings. Restrict ingress to Cloudflare/Tunnel or another verified origin policy. Implement host-side request-size limits, concurrency limits and execution timeouts; the bearer token is defense in depth, not a replacement for a secured ingress.
6. **CPU/resource controls:** Isolate the service in a non-root container without shell/network access for analysis functions, with memory, CPU and concurrency caps. The Worker request timeout is not a kill switch for backend computation. Run a load test before allowing student access.
7. **Privacy ethics:** Obtain institution/participant permissions where applicable. Avoid uploading identifiable participant data. Confirm the infrastructure's logging policy: neither Worker nor Python service should log input arrays, JWT, token, raw file or response. Have a data retention/deletion statement and user support contacts.
8. **Stage and inspect:** Run Python and Node tests, review Wrangler dry-run artifact, test Access expiry/bad signature, test quota and outage failure, then conduct two-person, permission-cleared pilot using **synthetic** or public data before any real human-subject research.
9. **Enable only after approval:** Set \`ADVANCED_COMPUTE_ENABLED=true\` **only in the specifically tested environment**. Keep preview/prod disabled by default until signed off.

### Required bindings and configuration

| Name | Location | Purpose |
|---|---|---|
| \`STATLAB_COMPUTE_SHARED_TOKEN\` | Private Python host secret | Authenticated stateless computational endpoint |
| \`ADVANCED_ENGINE_TOKEN\` | Worker secret | Same unique private origin token |
| \`ADVANCED_COMPUTE_ORIGIN\` | Worker env | Exact HTTPS origin of Python service |
| \`CF_ACCESS_TEAM_DOMAIN\` | Worker env | Pinned Cloudflare Access issuer |
| \`CF_ACCESS_AUD\` | Worker env | Expected Access application audience |
| \`ADVANCED_USAGE_DB\` | Worker D1 binding | Per-user daily quotas; required |
| \`ADVANCED_COMPUTE_ENABLED\` | Worker env | **false** until approved pilot launch |

No provider API token or research data belongs in git.

### Local development verification

\`\`\`bash
python -m pip install -r requirements-dev.txt
python -m pytest -q tests/test_compute_service.py tests/test_advanced_timeseries.py tests/test_garch_volatility.py
python -m pytest -q
node --check cloudflare/src/index.mjs
node --check cloudflare/src/advanced-compute.mjs
node --check cloudflare/public/advanced.mjs
node --test cloudflare/tests/*.test.mjs
npx wrangler deploy --dry-run --outdir /tmp/statlab-cloudflare-dist
\`\`\`

The AWS/Cloudflare pilot deployment and actual Access/provider connections **are not** exercised by these tests. Real infrastructure verification remains necessary.

## User experience

1. Visit \`/advanced.html\`; disabled status shows clearly if compute is not provisioned.
2. Choose ARIMA value forecasts or GARCH return volatility.
3. Import a CSV locally, select a numeric column, optionally choose an ISO date/month column. Dates are checked for uninterrupted daily/weekly/monthly steps if selected; selecting manual chronology requires a separate acknowledgement.
4. Set model inputs; confirm regular time periods and explicit opt-in data transfer.
5. Submit selected numeric column to the Access-protected API; Worker authenticates, counts quota and sends it to the private Python endpoint. Original CSV/other columns never leave the device through this workflow.
6. Read research tables and warnings; export JSON. Predictions and diagnostic tests require independent review.

## Explicit exclusions

- Does not magically deploy Python into Workers.
- Does not let Cloudflare browser Data View silently access, send or sync other existing data.
- Does not provide a public multiuser statistical data store.
- Does not claim validated prediction accuracy on a UNN dataset or formal student pilot approval.
- Does not support long GPU simulations, queue persistence, arbitrary Python/R code or interactive user-authenticated remote dataset sessions.
- Does not replace a full security audit, protection against malicious repeated requests or fine-grained institution data governance.

For any sustained production service, add a job queue and durable budgets/limits, verify all Edge/Origin identities in independent tests, and undergo institutional data-protection review.

References:
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers static assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [D1 prepared statement API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
