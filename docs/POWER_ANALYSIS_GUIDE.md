# A Priori Power & Sample-Size Planner — Local FastAPI Edition

> **Scope:** A research **design** calculator, not an analysis of completed fieldwork. Available only when the Python/FastAPI StatLab workstation is running on a trusted local machine. Not hosted on Cloudflare, not a native desktop installer, and not a guarantee of statistical significance.

## How to use

1. Start the local workstation with `pip install -r requirements.txt` and `uvicorn app.main:app --host 127.0.0.1 --port 8000` (do **not** expose this unauthenticated API publicly).
2. Select **Power & Sample Size** in the left navigation. Choose the planned design before fieldwork.
3. Supply your own justified research assumptions: effect size (or expected proportions), significance level alpha, target power, allocation ratio / ANOVA group count if relevant, and expected attrition.
4. Click **Calculate proposed sample size**. StatLab computes the continuous analytic solution, rounds to complete independent sample/group sizes, then recalculates and verifies the *planned* power after rounding.
5. Download a script-free **HTML sample-size planning memo** describing assumptions and warnings. Confirm the assumptions with a supervisor or statistical methodologist before quoting the plan in a proposal.

**Important:** The form deliberately leaves the effect size **blank**. Neither StatLab nor AI assigns an effect size for a student, and a user must justify its choice from a prior study, a scientifically meaningful minimum difference, or a well-described pilot.

## Supported designs

| Design | Inputs | Calculator | Interpretation of sample size |
|---|---|---|---|
| Two-sided, one-sample t test | Cohen's **d**: expected mean difference from null divided by expected SD | Statsmodels `TTestPower` | Completed independent participants |
| Two-sided, paired t test | Cohen's **d_z**: mean paired difference divided by SD of paired differences | Statsmodels `TTestPower` | Completed **matched pairs**; not independent unmatched participants |
| Two-sided, independent pooled-variance t test | Cohen's **d**, allocation ratio n2/n1 | Statsmodels `TTestIndPower` | Completed participants in each independent group |
| Two-sided, one-way balanced ANOVA | Cohen's **f**, number of groups | Statsmodels `FTestAnovaPower` | Completed participants **per group** (balanced) and across all groups |
| Two-sided, independent two-proportion z approximation | Assumed p1 and p2, allocation ratio | Statsmodels `NormalIndPower`, `proportion_effectsize` | Completed participants in each independent group |

**The independent t design assumes equal variances and uses the pooled t approximation; it is not exact Welch unequal-variance power.** The existing local analysis workbench uses Welch for independent t testing. Any study planning a Welch-specific inference should seek a validated tailored design method instead of claiming this plan is exact.

The two-proportion calculation uses **Cohen's h = 2arcsin(sqrt(p1)) − 2arcsin(sqrt(p2))** with the normal approximation; it is not exact for rare events, small expected cell counts, or clustered/paired proportions. No continuity correction is applied.

A one-way ANOVA plan assumes an omnibus fixed-effects F test and balanced independent groups; factor analysis, two-way ANOVA, repeated measures, survival models, clustered trials, survey design effects and multiple-testing corrections are **not included**.

## Rounding and attrition policy

- Per-group and per-pair integers are rounded **up**, and achieved *modelled planning power* is checked again for those rounded allocations. Study sample limits fail closed when unreasonable.
- Attrition percentage is used only to inflate **recruitment targets** via `ceil(completers / (1 − attrition_rate))`, separately per group. It does not improve the assumed power and does not guarantee enough usable observations. A 20% attrition assumption with 34 required complete pairs yields a recruitment target of **43 pairs**.
- Outputs include `kind=a_priori_power_plan` and `data_kind=researcher_defined_planning_assumptions_not_observed_data`, not actual case-level observations, p-values, confidence intervals or effect-size estimates.
- The module does not need or accept respondent files, dataset IDs, frequency marginals, source names, or observed p-values. It operates without session storage or external AI calls.
- Input limits constrain alpha, target power, effect sizes, proportions, allocation ratio, groups and attrition to prevent invalid/infinite/numerically unstable requests; huge sample plans return validation errors rather than unrealistic outputs.

## Reference example (two-sided, alpha .05, target power .80)

| Design assumption | Completed sample estimate |
|---|---:|
| One-sample t, Cohen's d = .50 | 34 participants |
| Paired t, Cohen's d_z = .50 | 34 complete pairs |
| Pooled independent t, Cohen's d = .50, equal allocation | 64 + 64 = 128 participants |
| Balanced one-way ANOVA, Cohen's f = .25, 3 groups | 53 per group = 159 total |
| Independent proportions p1 = .50 vs p2 = .65 | 170 + 170 = 340 participants |

These are **test fixtures for a design under hypothetical assumptions**, not empirical sample-size recommendations for an unrelated real project. Never choose an assumption just to copy these example counts.

## Local endpoints

- `POST /api/power/sample-size` — JSON plan for allowed design assumptions.
- `POST /api/power/report.html` — fresh calculation and a script-free, downloadable HTML methodology memo.
- `GET /api/capabilities` — lists local power planning separately from the Cloudflare browser features.

Example request:

```json
{
  "test_family": "independent_t",
  "effect_size": 0.5,
  "alpha": 0.05,
  "target_power": 0.8,
  "allocation_ratio": 1,
  "attrition_percent": 10
}
```

Note that `n1 = 64`, `n2 = 64` are **required completed** groups, and 10% attrition raises recruitment targets to `72` per group.

## Statistical integrity and validation

Automated tests cover known-reference samples, independent recalculation using Statsmodels APIs, unequal allocation, proportional assumptions, integer rounding, attrition, all-zero/unknown/malformed inputs, invalid design assumptions, missing effect sizes, absence of session creation, HTML report headers, and UI/navigation.

The formulas follow the public Statsmodels power implementations:

- `statsmodels.stats.power.TTestPower`, `TTestIndPower`, `FTestAnovaPower` and `NormalIndPower`
- `statsmodels.stats.proportion.proportion_effectsize`

Documentation: https://www.statsmodels.org/stable/stats.html#power-and-sample-size-calculations

Researcher caution: calculations depend on a prespecified effect and test model. Sample size alone never proves that observations are representative or that the eventual results are valid. Estimate design effects, cluster sizes, loss to follow-up and practical feasibility independently. Power analysis is **not** a substitute for ethical approval, sampling strategy or statistical supervision.

## Not implemented

The Cloudflare browser app does **not** run Statsmodels and does not expose these endpoints. Native desktop packaging, encrypted multi-device sync, a full family of power methods, and exploratory factor analysis remain future engineering work. This feature does not change the existing frequency-only Chapter Four engine, modify local research project backups, or send sensitive data to cloud services.
