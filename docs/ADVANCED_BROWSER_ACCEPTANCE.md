# StatLab advanced pilot — real-browser acceptance checks

**Development-only QA.** No production Worker deployment, paid infrastructure, university participants, or real datasets are involved. The separate private Python backend and real numerical models have their own tests; this suite checks the actual Chromium browser interface.

## Automated coverage

Run the dedicated `Advanced pilot real-browser checks` GitHub workflow or reproduce locally:

```bash
python -m pip install "pytest>=8,<10" "playwright>=1.50,<2"
python -m playwright install chromium
python -m pytest -q browser_checks/test_advanced_pilot.py
```

The checks start a temporary HTTP server bound to localhost serving `cloudflare/public`. Browser calls to `/api/advanced/status` and `/api/advanced/run` are intercepted within the test browser. **No live Cloudflare, Python service, D1 database or institutional records** are accessed.

- **Disabled mode:** Run button disabled, two synthetic examples accessible locally, no data transfer.
- **Consent:** Cannot submit until time order and remote numeric processing are both acknowledged. Only selected numerical values and bounded model settings are present in captured requests.
- **Data quality:** Date/month gaps or duplicates block analysis before a network request.
- **Change management:** Selecting another method, dataset or variable resets explicit consent and/or chronology acknowledgement.
- **Output safety:** Server-supplied HTML-like strings display as text; no script executes. Report JSON can be downloaded.
- **Responsive screens:** 360, 768 and 1280 CSS-pixel widths have usable data controls and no unexpected horizontal page overflow.
- **Network faults:** Pilot availability failures keep the Run button disabled while letting researchers view synthetic examples.

## What is not yet demonstrated

A green Chromium suite is **not** proof of working production Cloudflare Access, a real D1 database, secure live Python ingress, high concurrency, genuine input-data privacy, statistical validity on real-world data, or completion of institutional ethics approval. The page's HTTP endpoints are intentionally mocked here; the separate integration tests exercise the Worker through a real local Python server.

Before inviting UNN or Nsukka participants, create an isolated staging hostname, configure authenticated Access and a dedicated quota D1 database, run the same browser tests against staging with a separate approved test identity, verify backend outage and token-rotation failures, and conduct a documented privacy/security review. Keep `ADVANCED_COMPUTE_ENABLED=false` in production until those checks pass.
