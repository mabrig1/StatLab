"""Research study power/sample-size planning based on Statsmodels.

Planning inputs are ASSUMPTIONS, not statistics calculated from participants.
This module accepts no respondent records, dataset IDs, or frequency tables.
"""
from __future__ import annotations

import math
import warnings
from html import escape
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from statsmodels.stats.power import TTestIndPower, TTestPower, FTestAnovaPower, NormalIndPower
from statsmodels.stats.proportion import proportion_effectsize

# Bound the work and reject unsupportable numerical roots rather than returning huge,
# misleading or non-finite estimates. This is a product constraint, not an N formula.
MAX_COMPLETERS = 200_000
MAX_SOLVER_N = 1_000_000


class PowerPlanningError(ValueError):
    """Invalid or numerically unsupported study design."""


class PowerPlanRequest(BaseModel):
    """A-priori sample-size planning. No respondent-level or aggregate dataset input."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    test_family: Literal[
        "one_sample_t", "paired_t", "independent_t", "anova_one_way", "two_proportions"
    ]
    alpha: float = Field(default=0.05, ge=0.0001, le=0.2, allow_inf_nan=False)
    target_power: float = Field(default=0.8, ge=0.5, le=0.99, allow_inf_nan=False)
    effect_size: float | None = Field(default=None, gt=0, le=3, allow_inf_nan=False)
    proportion_1: float | None = Field(default=None, ge=0.05, le=0.95, allow_inf_nan=False)
    proportion_2: float | None = Field(default=None, ge=0.05, le=0.95, allow_inf_nan=False)
    allocation_ratio: float = Field(default=1.0, ge=0.25, le=4, allow_inf_nan=False)
    groups: int = Field(default=3, ge=2, le=10)
    attrition_percent: float = Field(default=0.0, ge=0, le=50, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_design(self):
        if self.test_family == "two_proportions":
            if self.effect_size is not None:
                raise ValueError("For two proportions, provide the two assumed proportions, not Cohen's d/f.")
            if self.proportion_1 is None or self.proportion_2 is None:
                raise ValueError("Two-proportion planning needs both assumed proportions.")
            if self.proportion_1 == self.proportion_2:
                raise ValueError("Assumed proportions must differ to calculate a detectable effect.")
        else:
            if self.effect_size is None:
                raise ValueError("Choose and justify an assumed effect size before planning sample size.")
            if self.proportion_1 is not None or self.proportion_2 is not None:
                raise ValueError("Proportions are only supported for two-proportion planning.")
        if self.test_family not in {"two_proportions", "independent_t"} and self.allocation_ratio != 1:
            raise ValueError("Allocation ratio applies only to independent two-group designs.")
        if self.test_family == "anova_one_way" and self.effect_size is not None and self.effect_size > 2:
            raise ValueError("One-way ANOVA Cohen's f must be at most 2 for this planner.")
        return self


def _recruitment(completers: int, attrition_percent: float) -> int:
    return math.ceil(completers / (1 - attrition_percent / 100))


def _finite(value: float, name: str) -> float:
    if not math.isfinite(float(value)):
        raise PowerPlanningError(name + " could not be calculated. Review the effect-size assumptions.")
    return float(value)


def _rounded_design(solved: float, multiplier: int, power_at, target: float):
    """Round conservatively and independently check achieved power.

    multiplier=groups for balanced ANOVA, otherwise=1.
    Up to 64 extra increments protects against floating/rounding disagreement.
    """
    base = max(2, math.ceil(_finite(solved, "Estimated sample size") / multiplier))
    for extra in range(65):
        n = base + extra
        completed = multiplier * n
        if completed > MAX_COMPLETERS:
            raise PowerPlanningError("Required completed sample exceeds the 200,000-person planner limit.")
        achieved = _finite(power_at(n), "Achieved design power")
        if 0 <= achieved <= 1 and achieved + 1e-10 >= target:
            return n, completed, achieved
    raise PowerPlanningError("Could not verify planned power after rounding sample size.")


def plan_sample_size(request: PowerPlanRequest) -> dict:
    """Return a priori sample size, rounded achieved *planned* power, and caveats.

    Statsmodels' pooled-variance t test differs from Welch t testing. The result
    clearly labels this assumption rather than claiming exact Welch power.
    """
    family = request.test_family
    assumptions = [
        "A priori planning only: inputs are researcher's assumed effects, not observed outcomes.",
        "Two-sided hypothesis test; alpha is the per-test Type I error rate.",
        "Target power applies under the stated effect and test assumptions; actual achieved study power cannot be guaranteed.",
        "The required completed sample assumes independent, usable observations; account separately for nonresponse, missingness and design effects.",
        "This plan is not a confidence interval, statistical result, or evidence of a significant effect.",
    ]
    alpha, target = request.alpha, request.target_power
    ratio = request.allocation_ratio
    effect_label = ""
    estimated = None
    if family in ("one_sample_t", "paired_t"):
        model = TTestPower()
        effect = request.effect_size
        effect_label = "Cohen's d" if family == "one_sample_t" else "Paired Cohen's d_z"
        with warnings.catch_warnings():
            warnings.simplefilter("error", RuntimeWarning)
            estimated = model.solve_power(effect_size=effect, nobs=None,
                                          alpha=alpha, power=target, alternative="two-sided")
        n, total, achieved = _rounded_design(estimated, 1,
            lambda size: model.power(effect_size=effect, nobs=size,
                                     alpha=alpha, alternative="two-sided"), target)
        completed = {"participants": n} if family == "one_sample_t" else {"complete_pairs": n}
        if family == "paired_t":
            assumptions.append("Paired effect size d_z means the expected mean within-person difference divided by the SD of within-person differences; N counts complete matched pairs.")
            assumptions.append("A paired design requires actual linked pre/post or matched observations, not independent group summaries.")
        else:
            assumptions.append("One-sample d is the prespecified mean difference from the null divided by the expected SD.")
        assumptions.append("Noncentral-t power computed with Statsmodels TTestPower.")
    elif family == "independent_t":
        model = TTestIndPower()
        effect = request.effect_size
        effect_label = "Cohen's d (pooled SD)"
        estimated = model.solve_power(effect_size=effect, nobs1=None,
            alpha=alpha, power=target, ratio=ratio, alternative="two-sided")
        if not math.isfinite(float(estimated)) or estimated > MAX_SOLVER_N:
            raise PowerPlanningError("Sample size exceeds supported design limits.")
        start = max(2, math.ceil(estimated))
        for increment in range(65):
            n1 = start + increment
            n2 = max(2, math.ceil(n1 * ratio))
            if n1 + n2 > MAX_COMPLETERS:
                raise PowerPlanningError("Required completed sample exceeds 200,000 participants.")
            achieved = _finite(model.power(effect_size=effect, nobs1=n1, alpha=alpha,
                ratio=n2 / n1, alternative="two-sided"), "Achieved design power")
            if 0 <= achieved <= 1 and achieved + 1e-10 >= target:
                break
        else:
            raise PowerPlanningError("Could not verify power after integer group rounding.")
        completed = {"group_1": n1, "group_2": n2}
        total = n1 + n2
        assumptions.append("Independent groups are planned with pooled-variance Student t power, assuming approximately equal variances and independent observations.")
        assumptions.append("This is NOT exact power for Welch's unequal-variance t test currently available in the StatLab analysis workbench.")
        assumptions.append("Cohen's d divides the expected group mean difference by a prespecified pooled standard deviation.")
    elif family == "anova_one_way":
        model = FTestAnovaPower()
        effect = request.effect_size
        effect_label = "Cohen's f"
        estimated = model.solve_power(effect_size=effect, nobs=None, alpha=alpha,
                                      power=target, k_groups=request.groups)
        n, total, achieved = _rounded_design(estimated, request.groups,
            lambda group_n: model.power(effect_size=effect, nobs=group_n * request.groups,
                                        alpha=alpha, k_groups=request.groups), target)
        completed = {"per_group": n, "groups": request.groups}
        assumptions.append("One-way fixed-effects omnibus F-test assumes independent observations, approximately normal residuals, common variance, and BALANCED group sizes.")
        assumptions.append("Cohen's f is an assumed population-level standardized spread of group means; it is not eta-squared or Cohen's d.")
    else:
        model = NormalIndPower()
        effect = abs(float(proportion_effectsize(request.proportion_1, request.proportion_2)))
        effect_label = "Cohen's h (arcsine-transformed proportions)"
        estimated = model.solve_power(effect_size=effect, nobs1=None,
            alpha=alpha, power=target, ratio=ratio, alternative="two-sided")
        if not math.isfinite(float(estimated)) or estimated > MAX_SOLVER_N:
            raise PowerPlanningError("Sample size exceeds supported design limits.")
        start = max(2, math.ceil(estimated))
        for increment in range(65):
            n1 = start + increment
            n2 = max(2, math.ceil(n1 * ratio))
            if n1 + n2 > MAX_COMPLETERS:
                raise PowerPlanningError("Required completed sample exceeds 200,000 participants.")
            achieved = _finite(model.power(effect_size=effect, nobs1=n1, alpha=alpha,
                ratio=n2 / n1, alternative="two-sided"), "Achieved design power")
            if 0 <= achieved <= 1 and achieved + 1e-10 >= target:
                break
        else:
            raise PowerPlanningError("Could not verify power after integer group rounding.")
        completed = {"group_1": n1, "group_2": n2}
        total = n1 + n2
        assumptions.append("An asymptotic two-sample proportion z-test is assumed, using Cohen's h = 2arcsin(sqrt(p1)) − 2arcsin(sqrt(p2)); this is an APPROXIMATION.")
        assumptions.append("Inputs p1 and p2 are expected proportions set before collecting data; allocation groups are independent and no continuity correction is used.")
        assumptions.append("For rare events or small expected cell counts, prefer exact or simulation-based design methods.")
        expected_cells=[n1*request.proportion_1, n1*(1-request.proportion_1),
                        n2*request.proportion_2, n2*(1-request.proportion_2)]
        if min(expected_cells) < 5:
            assumptions.append("WARNING: An expected event/non-event count is below 5; this normal approximation may be unreliable.")
    if total > MAX_COMPLETERS:
        raise PowerPlanningError("Required completed sample exceeds the 200,000-person planner limit.")
    recruited = {label: _recruitment(count, request.attrition_percent)
                 for label, count in completed.items() if label != "groups"}
    if family == "anova_one_way":
        recruited["groups"] = request.groups
        recruited_total = recruited["per_group"] * request.groups
    else:
        recruited_total = sum(recruited.values())
    if request.attrition_percent:
        assumptions.append("Recruitment totals were increased by the assumed attrition rate and rounded per group; retaining that completion rate is not guaranteed.")
    assumptions.append("No clustering, finite-population correction, unequal weighting, covariates, multiplicity correction, or ethical/recruitment constraints are incorporated.")
    return {
        "kind": "a_priori_power_plan",
        "test_family": family, "tails": "two-sided",
        "alpha": alpha, "target_power": target, "planned_power": round(float(achieved), 8),
        "effect_size": round(effect, 8), "effect_size_definition": effect_label,
        "assumed_proportions": ({"group_1": request.proportion_1, "group_2": request.proportion_2}
                                if family == "two_proportions" else None),
        "allocation_ratio_requested": ratio if family in {"independent_t", "two_proportions"} else None,
        "completed": completed, "completed_total": total,
        "attrition_percent": request.attrition_percent,
        "recruitment": recruited, "recruitment_total": recruited_total,
        "method": "Statsmodels analytic power function; rounded-up integer sample sizes checked again for minimum target power",
        "assumptions": assumptions,
        "data_kind": "researcher_defined_planning_assumptions_not_observed_data",
        "requires_dataset": False,
        "reference": "https://www.statsmodels.org/stable/stats.html#power-and-sample-size-calculations",
    }


def power_plan_html(plan: dict) -> str:
    """Standalone, script-free, printable sample-size planning memo."""
    def e(value):
        return escape(str(value), quote=True)
    human_names={
        "one_sample_t": "One-sample t test", "paired_t": "Paired-samples t test",
        "independent_t": "Independent two-group pooled-variance t test",
        "anova_one_way": "One-way balanced ANOVA", "two_proportions": "Independent two-proportion z approximation",
    }
    rows=[("Statistical design",human_names.get(plan["test_family"],plan["test_family"])),
          ("Significance level alpha",plan["alpha"]),
          ("Target power",plan["target_power"]),
          ("Assumed effect",str(plan["effect_size"])+" — "+plan["effect_size_definition"]),
          ("Verified planned power",plan["planned_power"]),
          ("Completed sample total",plan["completed_total"]),
          ("Completed distribution", ", ".join(f"{k}: {v}" for k,v in plan["completed"].items())),
          ("Assumed attrition",str(plan["attrition_percent"])+"%"),
          ("Recruitment total",plan["recruitment_total"]),
          ("Recruitment distribution", ", ".join(f"{k}: {v}" for k,v in plan["recruitment"].items()))]
    if plan["assumed_proportions"]:
        rows.insert(4,("Assumed proportions",str(plan["assumed_proportions"])))
    table="".join("<tr><th scope='row'>"+e(a)+"</th><td>"+e(b)+"</td></tr>" for a,b in rows)
    cautions="".join("<li>"+e(a)+"</li>" for a in plan["assumptions"])
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
      "<title>StatLab A Priori Sample Size Planning</title><style>body{font:12pt/1.6 Georgia,serif;max-width:850px;margin:35px auto;"
      "padding:20px;color:#202b35}h1,h2{color:#1c4660}h1{font-size:22pt}table{border-collapse:collapse;width:100%}"
      "th,td{text-align:left;border-bottom:1px solid #bac7cd;padding:10px;vertical-align:top}th{width:40%}li{margin:9px 0}"
      ".note{border-left:4px solid #2b8374;background:#f0f7f6;padding:11px 15px}"
      "@media print{body{margin:0;padding:0}}"
      "</style></head><body><h1>Sample Size & Power — A Priori Plan</h1>"
      "<p class='note'><b>Planning assumptions, not observed research findings.</b> No participants, measurements or study outcomes were reconstructed or uploaded.</p>"
      "<table><tbody>"+table+"</tbody></table><h2>Methods and limitations</h2><ol>"+cautions+"</ol>"
      "<p>Calculation: "+e(plan["method"])+"</p>"
      "<p>Reference: <a href='"+e(plan["reference"])+"'>Statsmodels power methods</a></p>"
      "<p><b>Researcher note:</b> Document how the effect-size and attrition assumptions were chosen before collecting data.</p>"
      "</body></html>")