# StatLab: v1.0 workstation architecture decision

**Status:** incremental v1.0 foundation, not a claim that StatLab is production-ready or a complete IBM SPSS replacement.

## 1. Verified repository reality (10 November 2026)

The repository has **two different execution environments** which must not be presented as equivalent:

| | Local FastAPI edition | Cloudflare Worker/browser edition |
|---|---|---|
| Running environment | Python 3.12/FastAPI, Pandas, SciPy, Statsmodels, Pyreadstat | Static HTML, modern JavaScript and an intentionally restricted Cloudflare integration gateway |
| Case-level tests | Descriptives, Pearson/Spearman, regression, crosstabs, Cronbach alpha, t-tests, ANOVA and normality checks with observed, paired records | Browser Data View editing and item-frequency descriptives; **no hosted FastAPI stats engine** |
| Summary-only Likert | Weighted frequency statistics and objective-aligned reports, including editable Chapter Four DOCX | Local frequency-only analyses, guided Likert Studio, HTML/CSV drafts and APA-*inspired* tables |
| Additional areas | Research project manager, local dataset sessions, original front-end | Business dashboard/infographic, content analysis, local phrase discovery, CSAT/NPS |
| Stored respondent data | Transient process memory for FastAPI dataset sessions; explicit, local research backups if users opt in | Browser-local; Data View saved in browser storage. No permanent server database by default |
| Remote AI | No general-purpose authenticated public AI API | Optional gateway is **disabled by default** and protected by an administrator token; not a public research backend |
| Reliability/limitations | Do not assert parity with SPSS; verify method assumptions against references | Browser-only tools must not claim case-level regression, factor analysis, p-values or desktop availability |

The Python version still reports `0.9.0`. The present feature branch adds **v1.0-foundation UI and guarded exports**, not a blanket version bump or packaging release. The browser workstation is not guaranteed offline without installing and caching it appropriately.

### Addendum: a priori sample-size design (local FastAPI only)

StatLab now exposes a **local** Statsmodels-backed power/sample-size planner for a bounded set of two-sided designs: one-sample and paired t, pooled-variance independent t, balanced one-way ANOVA, and independent two-proportion z approximations. It takes only planning assumptions, refuses missing effect sizes, rounds and verifies sample sizes, and provides a separate attrition-adjusted recruitment target. No dataset sessions are created and no raw respondents or margins are processed. The `GET /api/capabilities` endpoint identifies this explicitly; the Cloudflare browser still cannot execute it. Advanced methods and exploratory factor analysis remain planned. See `docs/POWER_ANALYSIS_GUIDE.md`.

## 2. Architecture principles

1. **Data minimization:** Analyze in the user's browser or localhost process by default. Cloud sync and third-party AI are opt-in only, not prerequisite services.
2. **Trust boundaries:** Treat uploaded files as untrusted. Sanitize CSV export formulas and HTML. Cap file sizes and row counts. Keep API secrets server-only; never expose the admin gateway token in browser code.
3. **Statistics provenance:** Each analytical result should identify input type (`counts` vs `case_rows`), valid N, missing rules, method, assumptions, source label (if user supplied) and calculation version. Do not reconstruct paired responses from marginal counts.
4. **Feature discoverability:** A browser feature must be executable in the browser; a local-Python-only feature cannot appear as working within Cloudflare. Planned features must be labelled planned, not greyed-out successes.
5. **Reproducibility:** Use tests with known input/expected results, boundary values, malformed data, and negative safety cases. Record derivation and limitations; prefer independently verified algorithms over generative AI answers.
6. **Accessible UX:** Offer professional Academic/Business entry points, substantive tool descriptions, consistent titles, keyboard-accessible controls, and calm responsive design without unnecessary animation.
7. **Extensibility:** Separate pure computation modules from UI modules. Plugin extension points may be designed, but avoid untrusted arbitrary-code execution in the browser or local Python application.

## 3. First v1.0 foundation slice — implemented in this PR

- A **dual Academic/Business home**, backed by `cloudflare/public/workstation-capabilities.mjs`, which explicitly marks browser, local-FastAPI-only and future capabilities.
- **CSAT** from five-category frequency counts: `(f4+f5)/N × 100` (percentage of valid responses satisfied); and **NPS** from the full 0–10 frequency scale: `%promoters(9–10) − %detractors(0–6)` (points −100 to +100). Missing values cannot be inferred, and the code never creates individual customer records.
- **APA-inspired** Likert tables exported from the validated item results already calculated in the browser. The exporter does not calculate new inferential statistics. Authors must adapt the draft to faculty or journal requirements.
- `GET /api/capabilities` in the local FastAPI edition, explicitly identifying its available methods and the absence of factor/power/desktop/sync.
- Regression tests for mode separation, CSAT/NPS inputs, export safety, independent descriptive numbers and source disclosure.

These changes avoid modifying the existing aggregate calculation engine or replacing the Chapter Four integrity safeguards.

## 4. Proposed common result contract (not yet implemented across engines)

```json
{
  "schema": "mabrig.statlab.result.v1",
  "mode": "frequency_counts",
  "analysis_id": "descriptives",
  "statistics": [{"item": "Q1", "n_valid": 153, "mean": 3.21, "sd_method": "sample"}],
  "metadata": {
    "source": "user_entered_unverified",
    "missing_handling": "per_item",
    "case_level": false,
    "calculator_version": "future-explicit-version"
  },
  "limitations": ["Do not infer correlations, alpha, or p-values from marginal counts."]
}
```

Before adopting a shared contract, introduce a versioned schema validator and migration tests for historical output/backups. Avoid a breaking change to the current `.statlab.json` format.

## 5. Proposed future local API endpoints (not implemented by this PR)

| Proposed endpoint | Inputs | Guardrails |
|---|---|---|
| `POST /api/power/sample-size` | Test family, target power, alpha, effect size, tails, allocation | Require explicit effect-size assumptions, validated SciPy/Statsmodels model, reasonable bounds; never call inferred numbers observed results |
| `POST /api/factor/exploratory` | `dataset_id`, columns, missing policy, factor method | Paired case-level observations only; sample adequacy, KMO/Bartlett, factorability, rotation warnings and sign indeterminacy |
| `POST /api/reports/apa` | Validated result snapshot, table spec, source/provenance | Never fabricate p-values, confidence intervals, citations or data |
| `GET /api/workstation/version` | None | Return backend/UI implementation hashes, schema and compatibility status |
| `POST /api/business/experiments` | Event counts or paired business measurements with explicit design | CI/effect-size corrections, randomization/observational caveats, careful small-sample inference |

The REST routes are **architecture proposals**, not available endpoints. Existing `GET /api/capabilities` is a read-only truthful capability endpoint. No public unauthenticated case-level API should be deployed as a shortcut.

## 6. Desktop packaging decision gate

**Option A: Tauri** for smaller shell/explicit OS permissions. A Python sidecar must still be separately packaged, integrity-checked, launched with loopback-only bindings, shut down cleanly, and tested across supported OS/CPU targets. Carefully review updater signing and user-data storage.

**Option B: Electron** for established desktop tooling and broader bundled runtime, accepting a heavier installation. The same Python service constraints and signing requirements remain.

Decision requires a reproducible build, per-platform installation/upgrade/uninstall tests, file import/export sandboxing, explicit local privacy messaging and license review. Do **not** claim `wrangler deploy` creates a native offline desktop application.

## 7. Research data handling

- `frequency_counts`: only per-item marginals, meaningful item descriptive statistics, no reconstructed participants. Inter-item relationships remain unknown.
- `case_rows`: real observed respondent records, with explicit missing-value handling, complete-pair checks, measure type and assumption notes before inferential methods.
- `synthetic_demo`: labelled and visually distinguished from real field data.
- `business_summary`: additive historical KPIs, no implied accounting audit or causal identification.
- `qualitative_text`: lexical matches are provisional codes; human review, source traceability, privacy and methodology determine valid interpretation.

**Security:** The current local sessions and browser local storage are not encrypted. Avoid shared devices for confidential projects; an encrypted, opt-in sync architecture must not silently upload existing projects. Power analysis is about **planned study design**, not post-hoc invented significance.
