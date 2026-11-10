> **Milestone update (10 November 2026):** Local EFA now includes a bounded, reproducible 95th-percentile **Pearson-component parallel-analysis guide** and oblique **oblimin/quartimin** rotation with pattern/structure/Φ. Exact common-factor parallel analysis, validated polychoric ordinal EFA, CFA and measurement invariance remain future work. The existing researcher-selected factor count is not automatically overridden.

> **EFA milestone update (10 November 2026):** A bounded, respondent-level **principal-axis Exploratory Factor Analysis** module now exists **only in local FastAPI** with KMO/Bartlett diagnostics and optional orthogonal varimax. The roadmap's broader v1.1 factor-analysis tasks now mean *validated parallel analysis, oblique rotation, polychoric ordinal associations and independent reference checks*. CFA and measurement invariance are not implemented. See [EXPLORATORY_FACTOR_ANALYSIS.md](EXPLORATORY_FACTOR_ANALYSIS.md).

> **Updated 10 November 2026:** A **limited, validated a priori power/sample-size planning module** is now implemented **only in local FastAPI**. The v1.1 milestone below refers to extending design coverage, sensitivity analysis and reference validation—not implementing this first module. See [POWER_ANALYSIS_GUIDE.md](POWER_ANALYSIS_GUIDE.md). Exploratory factor analysis remains unimplemented.

# MABRIG StatLab — Prioritized product roadmap

**Product:** independent privacy-first academic and business statistical workstation. State of repository verified 2026-11-10. This is a roadmap, not a claim that every planned feature already exists.

## Impact × effort × risk assessment

| Proposal | Impact | Effort | Primary risk | Decision |
|---|---|---|---|---|
| Dual Academic / Business welcome screen with capability boundaries | High | Low | Misrepresenting browser as Python | **Implement in first v1 slice** |
| CSAT/NPS from frequency counts | High | Low | Wrong denominator or NPS scale | **Implement, test edge cases** |
| APA-style Likert export | High | Low | Misleading formatting or invented fields | **Implement as editable/reviewable draft** |
| Explicit localhost feature endpoint | Medium | Low | Public exposure of local API | **Implement read-only disclosure** |
| Consistent common result schema, immutable analysis provenance | Very high | Medium | Breaking old projects/reports | **v1.0 gate after migration tests** |
| Confidential-research data warnings, backup/recovery and accessibility QA | Very high | Medium | Data loss or disclosure | **v1.0 gate** |
| Questionnaire wizard + Nigerian institution templates | High | Medium | Overgeneralizing university requirements | **v1.0 candidate** |
| Validated power/sample-size design tool | High | Medium | False effect-size assumptions | **v1.1** |
| EFA/factor analysis and diagnostics | High | High | Invalid factorability or misinterpretation | **v1.1** |
| Business A/B testing + CIs | Medium/High | Medium | Observational confounding, multiplicity | **v1.1** |
| Business what-if scenarios | Medium | Medium | Presenting scenario as forecast | **v1.1** |
| Native desktop package (Tauri or Electron + Python sidecar) | Very high | High | Signed updates and local backend lifecycle | **v1.2+** |
| Multi-device E2E-encrypted opt-in sync | Medium | Very high | Key loss, privacy breaches, conflict resolution | **Future** |
| Third-party plugin SDK and local AI explainer | Medium | High | Remote code execution and invented analysis | **Future, only with isolation** |

## v1.0: must-have acceptance checklist

**Implemented in this initial PR:**

- [x] Clearly choose Academic or Business tasks from a professional home screen.
- [x] Display whether a feature runs in the current browser, in the separate local Python runtime, or is planned.
- [x] Offer business customer metrics from user-supplied frequency counts (CSAT, NPS).
- [x] Offer APA-inspired Likert descriptive HTML without modifying statistics.
- [x] Provide read-only local FastAPI capability details and tests.

**Remaining v1.0 gates (not yet implemented):**

- [ ] Consolidate analysis metadata, provenance and reproducibility across two runtimes without breaking existing project files.
- [ ] Create end-to-end accessibility checks for screen readers, keyboard navigation, contrast, mobile and print views.
- [ ] Conduct comprehensive method-by-method numeric regression against trusted published/independent reference outputs; include missing values, very small N and degenerate inputs.
- [ ] Design user-friendly questionnaire setup/variable-codebook wizards and faculty-specific templates with clear editable rules.
- [ ] Build offline/recovery tests for browser-only workflows; do not promise offline support for unbundled FastAPI calls.
- [ ] Full security threat model for local FastAPI sessions, document uploads, backups, and any permitted external interactions.
- [ ] Document explicit production deployment boundaries and verify the Cloudflare Worker live endpoints; CI dry-run alone is not production proof.
- [ ] Create a release checklist (tag, changelog, fixture hashes, bundled software and supported platform list).

**Acceptance condition:** A student can enter a questionnaire or summary counts, validate all input assumptions, produce reproducible descriptive tables, save a backup, and understand exactly which analyses require paired records. A business owner can import a sales summary or customer score frequencies and export a correctly labelled descriptive report. No runtime claims a feature it cannot execute.

## v1.1: methods and report depth

Power analysis should use a separate validated study-design request model with effect size, alpha, desired power, tail direction and allocation. No invented effect size, no post-hoc observed-power claim in place of a well-designed study. Factor analysis requires paired source data, adequate sample/design prerequisites and diagnostics; not possible from frequency marginals. Add clean APA-style exports beyond Likert only after results carry sufficient provenance. Add CSAT/NPS confidence intervals only when defensible from the sampling design and raw counts. For business A/B experiments, require explicit randomized/observational design distinction and clearly reported uncertainty.

## v1.2+: native workstation and reproducibility

Design a lightweight desktop shell (Tauri first for evaluation, Electron as fallback) with bundled signed Python sidecar where needed; start on localhost only, protect against external requests, and package per OS with updates and backup/recovery tests. Offline use must be demonstrated without network access. The Cloudflare version can remain an entry-level browser analytics companion.

## Longer-term: optional services

Encrypted sync must be opt-in, end-to-end encrypted client-side, recoverable, versioned and revocable. Local AI may explain already-calculated statistics or suggest questions for the researcher; it must not compute unknown statistics or silently send confidential data. A plugin SDK should only be considered with a manifest/schema contract, permission prompts, isolation, signature verification and fail-closed capability gates.

## Evidence of completion

Use green tests **plus** an actual user-facing smoke check; no merge or passing workflow substitutes for deployment verification. Prefer small reversible PRs with explicit release notes, each limited to one feature cluster. Preserve historical project formats and support migration rather than silently deleting user data.

