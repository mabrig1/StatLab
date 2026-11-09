"""Transparent questionnaire-to-objective summaries for original, coded survey responses.

The submitted orientation and reverse-coded items are explicit analysis choices.
Raw data and the Variable View dictionary are never modified. No research
claims, inferential tests or field-survey observations are fabricated.
"""
from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pandas as pd

from .stats_engine import AnalysisError, fnum, result, table

MAX_OBJECTIVES = 8
MAX_ITEMS_PER_OBJECTIVE = 15
MAX_UNIQUE_ITEMS = 40

GLOSSARY = [
    {"term": "Valid N", "meaning": "Number of observed, usable answers to an individual question; user-defined missing codes are excluded."},
    {"term": "Valid %", "meaning": "Percentage among usable responses for that question, not all cases in the dataset."},
    {"term": "Favourable-coded %", "meaning": "Share of usable responses in the two favourable categories after any explicitly chosen reverse-keying. This is not the percentage of unique respondents."},
    {"term": "Objective score", "meaning": "For each eligible person, average the selected item codes (after reverse-keying). Then summarize these per-person averages. This arithmetic treatment of ordinal responses requires justification."},
    {"term": "Reverse-keyed item", "meaning": "A negatively worded question whose code is reversed for scores and favourable-coded percentages. Its original response counts stay unchanged."},
    {"term": "Cronbach’s alpha", "meaning": "Internal-consistency estimate from complete cases, provided when at least two items and three complete respondents are available. It does not prove validity."},
]


def _validate_objectives(frame: pd.DataFrame, objectives: list, specs: dict, points: int,
                         higher_is_favourable: bool, min_answered_pct: int) -> list[dict]:
    if points not in (4, 5) or isinstance(points, bool):
        raise AnalysisError("Choose either a 4-point or 5-point questionnaire coding scheme.")
    if not isinstance(higher_is_favourable, bool):
        raise AnalysisError("Confirm whether higher or lower codes indicate a favourable answer.")
    if min_answered_pct not in (50, 100) or isinstance(min_answered_pct, bool):
        raise AnalysisError("Choose a 50% or 100% minimum item-completion rule.")
    if not isinstance(objectives, list) or not 1 <= len(objectives) <= MAX_OBJECTIVES:
        raise AnalysisError(f"Define between 1 and {MAX_OBJECTIVES} research objectives.")

    validated, across = [], set()
    for idx, group in enumerate(objectives, 1):
        if not isinstance(group, dict):
            raise AnalysisError("Every objective must contain a title and a list of items.")
        if set(group) - {"title", "items", "reverse_items"}:
            raise AnalysisError("Unknown field in objective definition.")
        title = group.get("title")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
            raise AnalysisError(f"Objective {idx} requires a 1–120 character title.")
        items, reverse = group.get("items"), group.get("reverse_items", [])
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS_PER_OBJECTIVE or any(not isinstance(x, str) for x in items):
            raise AnalysisError(f"{title}: choose 1–{MAX_ITEMS_PER_OBJECTIVE} questionnaire items.")
        if len(set(items)) != len(items):
            raise AnalysisError(f"{title}: the same item was selected twice.")
        if not isinstance(reverse, list) or any(not isinstance(x, str) for x in reverse) or len(set(reverse)) != len(reverse) or not set(reverse).issubset(items):
            raise AnalysisError(f"{title}: reverse-keyed items must be a unique subset of its selected items.")
        for item in items:
            if item not in frame.columns:
                raise AnalysisError(f"{title}: unknown questionnaire variable {item}.")
            spec = specs.get(item, {})
            if spec.get("type") != "numeric":
                raise AnalysisError(f"{item}: questionnaire scoring needs numeric values. Review Type in Variable View.")
            if spec.get("measure") == "nominal":
                raise AnalysisError(f"{item} is Nominal. Only ordered questionnaire codes should be scored; review Measure in Variable View.")
        validated.append({"title": title.strip(), "items": items, "reverse_items": reverse})
        across.update(items)
    if len(across) > MAX_UNIQUE_ITEMS:
        raise AnalysisError(f"Select no more than {MAX_UNIQUE_ITEMS} distinct items across all objectives.")
    return validated


def _item_numeric(frame: pd.DataFrame, name: str, points: int) -> pd.Series:
    """A cleaned analysis-frame column, without attempting to infer or recode values."""
    s = pd.to_numeric(frame[name], errors="coerce").astype(float)
    observed = s.dropna()
    bad = observed[~(np.isfinite(observed) & observed.between(1, points) & (observed % 1 == 0))]
    if len(bad):
        examples = ", ".join(f"{x:g}" for x in bad.iloc[:3])
        raise AnalysisError(f"{name} contains {len(bad)} nonmissing code(s) outside whole numbers 1–{points} (e.g., {examples}). Mark refusal codes as Missing in Variable View or select only matching Likert items.")
    # Do not silently accept nonnumeric strings as missing. Variable View's
    # numeric type is required, and malformed imports must not be recoded.
    if int(s.isna().sum()) > int(frame[name].isna().sum()):
        raise AnalysisError(f"{name} contains nonnumeric responses that cannot be scored.")
    return s


def _alpha(complete: pd.DataFrame) -> float | None:
    if complete.shape[1] < 2 or len(complete) < 3:
        return None
    total_variance = complete.sum(axis=1).var(ddof=1)
    if not np.isfinite(total_variance) or total_variance <= 0:
        return None
    k = complete.shape[1]
    alpha = k / (k - 1) * (1 - complete.var(ddof=1).sum() / total_variance)
    return fnum(alpha, 3)


def questionnaire_summary(frame: pd.DataFrame, objectives: list, specs: dict | None = None,
                          points: int = 5, higher_is_favourable: bool | None = None,
                          min_answered_pct: int = 50) -> dict:
    """Build objective-by-objective summaries with clear denominators and traceable choices."""
    specs = specs or {}
    groups = _validate_objectives(frame, objectives, specs, points, higher_is_favourable, min_answered_pct)
    total = len(frame)
    warnings, insights, tables, objective_data, figure_rows = [], [], [], [], []
    cache: dict[str, pd.Series] = {}
    if len({item for g in groups for item in g["items"]}) < sum(len(g["items"]) for g in groups):
        warnings.append("An item appears in multiple objectives; results across objectives are not statistically independent.")

    # Scores are a deliberate, labelled exploratory convenience—not proof that
    # ordinal response gaps are psychologically equal.
    for number, group in enumerate(groups, 1):
        title, items, reverse_set = group["title"], group["items"], set(group["reverse_items"])
        aligned, overview_rows, frequency_tables = {}, [], []
        valid_answers, favourable_answers, missing_answers = 0, 0, 0
        scale_warning = False
        for item in items:
            if item not in cache:
                cache[item] = _item_numeric(frame, item, points)
            observed = cache[item]
            valid = observed.dropna()
            n, missing = len(valid), total-len(valid)
            valid_answers += n
            missing_answers += missing
            key = (points + 1 - observed) if item in reverse_set else observed.copy()
            # The scale's favourable codes can run high or low, as explicitly
            # specified by the researcher.
            favourable = (key >= points - 1) if higher_is_favourable else (key <= 2)
            favourable_n = int(favourable.fillna(False).sum())
            favourable_answers += favourable_n
            aligned[item] = key
            spec = specs.get(item, {})
            label = (spec.get("label") or "").strip()
            display_name = item + (" — " + label if label else "")
            if spec.get("measure") == "scale":
                scale_warning = True
            overview_rows.append([display_name, n, missing, favourable_n, fnum(100*favourable_n/n, 1) if n else None,
                                  "Reverse-keyed" if item in reverse_set else "Normal"])
            mapping = {str(entry.get("value")): str(entry.get("label")) for entry in spec.get("value_labels", [])}
            counts = Counter(int(x) for x in valid.to_list())
            freq = []
            for code in range(1, points+1):
                answer_label = f"{code}" + (f" — {mapping[str(code)]}" if str(code) in mapping else "")
                freq.append([answer_label, counts[code], fnum(100 * counts[code] / n, 1) if n else None])
            freq.append(["TOTAL VALID", n, 100.0 if n else None])
            frequency_tables.append(table(f"Question {item} · original answer frequencies",
                ["Recorded code / answer", "Count", "Valid %"], freq,
                f"Original codes (not reverse-keyed); {n} valid responses and {missing} missing of {total} cases. Percentages may not add to 100% due to rounding."))
            if n == 0:
                warnings.append(f"{title} / {item}: no usable responses; verify missing codes or entered data.")
            elif total and missing/total >= .2:
                warnings.append(f"{title} / {item}: {missing} of {total} cases ({missing/total:.0%}) missing. Consider nonresponse bias.")
        if scale_warning:
            warnings.append(f"{title}: one or more selected items are marked Scale, not Ordinal. Confirm that arithmetic composite scoring of these questionnaire codes is justified.")

        keyed = pd.DataFrame(aligned)
        answered = keyed.notna().sum(axis=1)
        required = math.ceil(len(items)*min_answered_pct/100)
        eligible = answered >= required
        means = keyed.mean(axis=1).where(eligible).dropna()
        n_composite = len(means)
        full = keyed.dropna()
        alpha = _alpha(full) if len(items)>1 else None
        if len(items)>1 and alpha is None:
            warnings.append(f"{title}: Cronbach's alpha was unavailable (need at least three complete cases, item variation and nonzero total-score variance).")
        if alpha is not None and alpha < 0:
            warnings.append(f"{title}: negative alpha; review item direction, reverse keying and construct definition.")
        if not n_composite:
            warnings.append(f"{title}: no respondents met the {min_answered_pct}% item-completion rule; objective mean is omitted.")
        objective = {
            "number": number, "title": title, "items": list(items), "reverse_items": sorted(reverse_set),
            "item_count": len(items), "cases_total": total, "cases_with_any_answer": int((answered>0).sum()),
            "cases_eligible": n_composite, "complete_cases": int(len(full)), "min_items_answered": required,
            "valid_item_answers": valid_answers, "missing_item_answers": missing_answers,
            "favourable_item_answers": favourable_answers,
            "favourable_percent": fnum(100*favourable_answers/valid_answers, 1) if valid_answers else None,
            "composite_mean": fnum(means.mean(), 3) if n_composite else None,
            "composite_sd": fnum(means.std(ddof=1), 3) if n_composite > 1 else None,
            "composite_median": fnum(means.median(), 3) if n_composite else None,
            "cronbach_alpha": alpha,
        }
        objective_data.append(objective)
        figure_rows.append([title, len(items), n_composite, objective["composite_mean"],
                            objective["composite_sd"], objective["favourable_percent"], alpha])
        tables.append(table(f"Objective {number} · {title} — question overview",
            ["Question", "Valid N", "Missing N", "Favourable N", "Favourable-coded %", "Keying"], overview_rows,
            f"Favourable-coded % uses each question's valid responses; 1–{points} coding; reverse-keyed items affect only scoring, not raw frequencies."))
        tables.extend(frequency_tables)
        share = objective["favourable_percent"]
        share_text = f"{share}% of {valid_answers} valid item-responses were favourable-coded" if share is not None else "no valid item-responses were available"
        mean_text = (f"The exploratory per-person average was {objective['composite_mean']} (N = {n_composite}; minimum {required} of {len(items)} items answered)."
                     if n_composite else "No per-person average could be computed under the completion rule.")
        insights.append({"variable": f"Objective {number}: {title}", "kind": "Questionnaire", "text":
                         f"Across {len(items)} selected questions, {share_text}; this is a proportion of answers, not people. "
                         f"{mean_text} {missing_answers} item-responses were missing."
                         + (f" Cronbach's alpha among {len(full)} complete respondents was {alpha}." if alpha is not None else "")})

    tables.insert(0, table("Research objectives · at a glance",
        ["Objective", "Items", "Eligible cases", "Mean score*", "SD*", "Favourable-coded %", "Cronbach α"], figure_rows,
        "*Exploratory arithmetic summaries of per-respondent coded ordinal items; only cases meeting the selected completion threshold are included. "
        "Favourable-coded % is across valid item-responses, not respondents. Alpha uses complete cases only."))
    selected_count = sum(len(g["items"]) for g in groups)
    total_missing = sum(o["missing_item_answers"] for o in objective_data)
    cards = [
        {"label": "Cases in dataset", "value": total, "hint": "Original dataset rows, not a new sample."},
        {"label": "Objectives summarized", "value": len(groups), "hint": f"{selected_count} item selections across objectives."},
        {"label": "Usable item-answers", "value": sum(o["valid_item_answers"] for o in objective_data), "hint": "Counted by item; respondents may contribute multiple answers."},
        {"label": "Missing item-answers", "value": total_missing, "hint": "System + user-defined missing responses."},
    ]
    narrative = (f"This descriptive questionnaire report summarizes {len(groups)} researcher-defined objective(s) from {total} dataset cases. "
                 f"Items used a 1–{points} coding scheme with {'higher' if higher_is_favourable else 'lower'} codes designated favourable and a {min_answered_pct}% minimum item-completion rule. "
                 "Question frequencies preserve the recorded answers; any reverse-keying applies only to derived scores. "
                 "The objective means are exploratory arithmetic summaries of ordered response codes, not significance tests, causal effects, or evidence that hypotheses are accepted. "
                 "Check the original questionnaire, wording, missing data, reverse-keying and measurement assumptions before reporting findings.")
    return {**result("Questionnaire analysis · research objectives", tables, narrative, warnings,
                     method=f"Descriptive survey counts, valid percentages and optional exploratory Likert composites; {points}-point scale; "
                            f"{'higher' if higher_is_favourable else 'lower'} codes favourable; completion ≥{min_answered_pct}% per objective; "
                            "Cronbach alpha where calculable on complete cases."),
            "summary_cards": cards, "insights": insights, "glossary": GLOSSARY,
            "objectives": objective_data,
            "scoring_settings": {"scale_points": points, "higher_is_favourable": higher_is_favourable,
                                 "min_answered_pct": min_answered_pct,
                                 "raw_data_changed": False}}
