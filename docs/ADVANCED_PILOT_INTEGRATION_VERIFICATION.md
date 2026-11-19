# Advanced StatLab pilot: real gateway-to-engine integration verification

**Status:** Automated local CI validation. The live Cloudflare Worker, a hosted Python origin, a real Cloudflare Access application and a persistent D1 database **have not been provisioned**.

## Verified connection path

```
Synthetic browser exercise
   → Worker gateway request with explicit consent
   → RS256-signed Cloudflare Access JWT (test-only RSA key and JWKS)
   → bounded numeric-only schema and per-user daily quota (test fixture)
   → private bearer credential (test-only)
   → genuine localhost Uvicorn /internal/compute
   → statsmodels ARIMA or arch GARCH
   → actual forecast tables returned to gateway
```

The integration is implemented in `tests/integration/advanced-gateway.e2e.mjs`. It spawns `app.compute_service:app` on a temporary loopback port with a fresh test context, and never calls the live internet. The Cloudflare Worker JavaScript is imported and exercised using a fake Access issuer and in-memory D1 behaviour; the backend remains **real Python HTTP** running the actual statistical solvers. This is not the same as a full Cloudflare production environment or real D1 transaction testing.

Test cases demonstrate:
- disabled pilot gate rejects the submission;
- invalid JWT audience and missing explicit consent never reach Python;
- successful ARIMA(1,0,0) three-period forecast on **96 synthetic monthly observations**;
- successful GARCH(1,1) three-period volatility forecast on **320 synthetic daily prices**;
- identity is hashed before quota storage and quotas count requests;
- no raw source CSV, JWT, authentication token, or pilot identity is included in returned results;
- original unsecured dataset endpoints remain unavailable in the private service;
- process is terminated after the test.

## Reproduce the real gateway-to-Python check

```bash
python -m pip install -r requirements-dev.txt
node --version  # Node 22
node --test tests/integration/advanced-gateway.e2e.mjs
```

This also runs in the Python tests GitHub workflow, along with the existing Python suite and localhost HTTP smoke check.

## Verify the intended private Docker image

The separate `.github/workflows/compute-container-check.yml` builds `Dockerfile.compute` on GitHub-hosted Ubuntu and starts it bound to `127.0.0.1:8090` with a synthetic ephemeral shared secret, read-only root filesystem, non-root user, dropped capabilities, 1 CPU and 768 MiB memory. It invokes `scripts/check_compute_container.py` to test actual ARIMA and GARCH HTTP responses and failures of unauthorised access. It **never publishes an image, creates a droplet or modifies Cloudflare**.

On a machine with Docker, use the existing `compose.compute.yaml` and the runbook in `docs/PRIVATE_COMPUTE_DEPLOYMENT.md`. Do not commit credentials.

## Remaining launch blockers

1. An operator-approved **private** compute host with reviewed ingress, TLS, isolation and resource quotas.
2. Actual Cloudflare Access policy and identity validation at the desired preview hostname.
3. Dedicated D1 quota database and binding with live atomic-write tests (the integration CI uses an in-memory simulated D1 interface).
4. Secret injection from the hosting platform, secret rotation and an operator-visible kill switch.
5. Browser E2E testing on a deployed private staging environment including mobile devices and failed consent, oversized datasets, irregular time indexes, expired tokens and network outages.
6. Independent numerical benchmarks on rights-cleared empirical datasets and appropriate UNN research/ethics approvals if applicable.

**Release policy:** The feature remains disabled by default. No merge or production deployment should occur merely because local integration and Docker build tests pass. The feature requires explicit staged approval and infrastructure verification.
