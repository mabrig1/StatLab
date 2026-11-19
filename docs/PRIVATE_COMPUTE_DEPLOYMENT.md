# StatLab advanced web-compute pilot: private-host readiness and smoke test

**Status (19 November 2026):** Code preparation only. No VPS, Cloudflare Tunnel, Access policy, D1 binding, API secret or production site was changed. The web pilot remains disabled by default.

## What is ready in this branch

- `app.compute_service:app`: separate token-gated, stateless HTTP service for local-only ARIMA and GARCH, not the original unprotected `app.main:app`.
- `Dockerfile.compute`: Python 3.12, non-root user, one Uvicorn worker and low concurrency ceiling.
- `compose.compute.yaml`: binds **127.0.0.1:8090 only**, a read-only filesystem, reduced OS privileges and restricted memory/CPU/PIDs. It does not publish a domain, create a Cloudflare Access policy or attach a database.
- `scripts/smoke_compute_local.py`: boots a temporary localhost service with a new random token, calls both numerical engines using synthetic samples, checks unauthorized requests and verifies that the dataset and documentation endpoints are absent. Runs automatically in Python CI.
- Early authentication and request-size verification on the private compute endpoint, before parsing untrusted model data.
- Browser pilot offers **Try 96-month synthetic example** and **Try 320-day synthetic prices**. Both are deterministic local JavaScript practice datasets; they do not require remote access or silently call Python. Changing input or model invalidates the prior consent checkboxes.

## Local verification (no cloud account needed)

On a trusted development computer with Python 3.12:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python scripts/smoke_compute_local.py
node --test cloudflare/tests/*.test.mjs
```

The smoke test uses only `samples/SYNTHETIC_arima_monthly_demo.csv` and `samples/SYNTHETIC_garch_daily_prices.csv`. No real university records are submitted or saved. It is not proof that a Cloudflare Tunnel, Access token or D1 setup works.

## Optional Docker preparation (private operator machine)

After reviewing container limits and confirming Docker Engine + Compose are installed:

```bash
export STATLAB_COMPUTE_SHARED_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
docker compose -f compose.compute.yaml build
docker compose -f compose.compute.yaml up -d
curl --fail http://127.0.0.1:8090/health
```

**Never paste this token into a chat, commit it, publish it in screenshots, or put it in a browser.** This start command generates a new ephemeral token in the operator shell, so an actual deployment must preserve it using a supported private secrets manager. For a real Cloudflare pilot, set the same private token as the Worker **secret** `ADVANCED_ENGINE_TOKEN` and Python host variable `STATLAB_COMPUTE_SHARED_TOKEN`. Rotate both together.

To stop the *optional* Docker service:

```bash
docker compose -f compose.compute.yaml down
```

**Crucial:** The container binds only to loopback. The Cloudflare Worker cannot call `http://127.0.0.1:8090` on your machine. A separately configured HTTPS Cloudflare Tunnel or other reviewed ingress must connect a private backend hostname to this loopback listener, with backend ingress protection and additional rate limits.

## Cloudflare release gates (operator approval required)

1. **Pilot only:** Select a new test hostname and Cloudflare Access policy that restricts the analysis endpoint to explicitly authorised pilot users. Never open the original `/api/datasets` service publicly.
2. **Backend identity:** Create a private HTTPS origin accessible only through approved ingress. Audit token exchange and origin protection. Do not rely solely on obscurity of the hostname.
3. **Quota database:** Provision a dedicated D1 DB, apply `cloudflare/migrations/0001_advanced_compute_quota.sql`, and bind it as `ADVANCED_USAGE_DB`. The database should store only hashed user IDs, date and requests, not submitted time series.
4. **Cloudflare settings:** Secret `ADVANCED_ENGINE_TOKEN`; environment variables `ADVANCED_COMPUTE_ORIGIN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and pilot-only `ADVANCED_COMPUTE_ENABLED`. Both Wrangler configuration files default that flag to `false`; do not enable before tests.
5. **Security tests:** Attempt expired or forged Access JWT, wrong audience, missing D1 binding, wrong service token, malformed/overlarge payload, absent consent, cross-origin requests, 21st request in a day, backend timeout and response-size overflow. Verify that every failure rejects the job without leaking secrets or student data.
6. **Capacity tests:** Confirm CPU/memory quotas, error handling, concurrency limits and an operational kill switch. Cloudflare request timeouts do not necessarily stop work already running on the backend.
7. **Student ethics:** Start with explicitly synthetic data. Require institutional approval, privacy notice, data classification, consent, audit/log retention controls and an incident contact before real research records.
8. **Release decision:** Only after checks pass on a private test hostname should an operator consider enabling `ADVANCED_COMPUTE_ENABLED=true` in that single environment. Keep production false until separately reviewed.

## Rollback

Set the pilot environment's `ADVANCED_COMPUTE_ENABLED` back to `false` and redeploy approved configuration; this fails closed even if the backend remains running. Revoke Access pilot users, rotate the shared backend token if suspected exposed, and stop the private container. Do not destroy user data or delete unrelated Cloudflare projects.

## Known research limits

- ARIMA and GARCH are real numerical models, but results are based on sample data until a verified dataset and independent benchmark are supplied.
- This service is not a queued high-compute platform, is not hardened for arbitrary public access and should not be exposed without ingress and provider safeguards.
- No automatic date sort is performed by the Python backend. Browser time checks are opt-in, and standard stock-market trading days require a separately documented calendar.
- No student accounts, durable research jobs, recoverable input history, or GARCH confidence interval coverage calibration have been implemented.
- Existing Cloudflare browser features must remain browser-local and should never silently upload case-level research data.
