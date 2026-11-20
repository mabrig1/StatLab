# StatLab ARIMA/GARCH — development handoff (20 November 2026)

## Completed development chain (still unmerged)

- PR #23: local ARIMA forecasting and held-out error tests.
- PR #24: local GARCH volatility analysis and input-unit controls.
- PR #25: opt-in Cloudflare web gateway, protected Python compute service and D1 usage contract.
- PR #26: non-root, loopback-only Docker container, synthetic browser practice and HTTP smoke tests.
- PR #27: real JavaScript gateway-to-local Python HTTP integration plus Docker build tests.
- PR #28: streaming response limits, keyed quota pseudonyms and fail-closed readiness check.
- PR #29: real Chromium browser tests for mobile, tablet and desktop, consent, CSV chronology, export and errors.

Development checks have passed: 244 Python tests, 141 Node/Cloudflare tests, Docker numerical smoke tests and 9 Chromium browser tests. These are not live Cloudflare Access/D1 tests or validation on genuine university data.

All PRs are draft and stacked in order from #23 based on main through #29 based on #28. Merge and deployment are **not** part of this handoff.

## Production deployment remains blocked

No operator-verified private compute host or HTTPS ingress, real Cloudflare Access app, D1 quota DB/binding, or browser-to-host staging test currently exists. Production deployment could be triggered when main is updated via Cloudflare Git integration, so source merging needs its own review. The advanced-computing environment flag must remain false outside reviewed staging.

Release prerequisites:
1. Private compute service: use only app.compute_service:app, not the original app.main:app dataset session service; isolate CPU/memory and host access.
2. Environment secrets: distinct backend token and HMAC quota secret held in secret managers; never save these in source control or copy them into documentation.
3. Dedicated D1 quotas; validate actual atomic updates, identity protection and daily limits.
4. Cloudflare Access authentication; verify issuer/audience, expiry, forged JWT, key rotation, and session policy using real staging identities.
5. Private staging hostname; explicit consent, no real participant data, mobile testing, outage handling, secure logs and kill switch.
6. Appropriate university research permissions and dataset provenance before conducting a student pilot.

When these requirements are fulfilled, verify checks again and seek separate approval to merge/deploy each stacked PR. Do not represent synthetic results as empirical research. Keep production and existing data untouched until approval.

## Next application
MABRIG GovFriction Lab: validate held-out prediction performance and independent Kaggle reproduction, without duplicating StatLab’s computing infrastructure.

Further setup references:
- docs/ADVANCED_WEB_COMPUTE_PILOT.md
- docs/PRIVATE_COMPUTE_DEPLOYMENT.md
- docs/ADVANCED_PILOT_INTEGRATION_VERIFICATION.md
- docs/ADVANCED_BROWSER_ACCEPTANCE.md
