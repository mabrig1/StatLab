"""Beginner-friendly, measurement-aware descriptive summaries.

Numerical calculations operate on the cleaned analysis frame (system and
user-defined missing values excluded by the calling API). Metadata informs
which methods are appropriate; category labels never become numerical scores.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .stats_engine import AnalysisError, fnum, get_columns, result, table

MAX_SELECTED = 30
MAX_SHOWN_CATEGORIES = 12

GLOSSARY = [
    {"term": "Valid N", "meaning": "Number of cases with a usable response for this variable."},
    {"term": "Missing N", "meaning": "Number of cases without a usable response, including missing codes defined in Variable View."},
    {"term": "Average (mean)", "meaning": "Sum of numerical values divided by the number of valid values. Best suited to scale variables."},
    {"term": "Middle (median)", "meaning": "The midpoint of ordered valid responses; less sensitive to unusually high or low values."},
    {"term": "SD (standard deviation)", "meaning": "A measure of variation around the mean. A larger SD means more spread; calculated using n − 1."},
    {"term": "Most common (mode)", "meaning": "The response category appearing most often. If multiple responses tie, one is displayed."},
    {"term": "Valid %", "meaning": "Percentage among people who answered this question; excludes missing responses."},
    {"term": "Q1 / Q3", "meaning": "The 25th and 75th percentiles of valid numeric values."},
    {"term": "Skewness", "meaning": "Indicates asymmetry. Values near zero are more symmetric; not a pass/fail normality test."},
    {"term": "Excess kurtosis", "meaning": "Describes tail heaviness relative to a normal distribution; interpretation depends on sample size."},
]


def shown_category(value: Any, spec: dict) -> str:
    raw = str(value)
    if spec.get("type") == "numeric":
        try:
            raw = format(float(value), ".15g")
        except (ValueError, TypeError, OverflowError):
            pass
    labels = {str(pair.get("value")): str(pair.get("label", "")) for pair in (spec.get("value_labels") or [])}
    translated = labels.get(raw)
    return f"{raw} — {translated}" if translated else raw


def valid_values(frame: pd.DataFrame, name: str, spec: dict) -> pd.Series:
    series = frame[name]
    if spec.get("type") == "numeric" and pd.api.types.is_numeric_dtype(series):
        # Do not convert strings representing labels into numeric scores.
        return pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    return series.dropna()


def guided_descriptive(frame: pd.DataFrame, columns: list[str],
                       variable_specs: dict[str, dict] | None = None,
                       detail_level: str = "simple") -> dict:
    if detail_level not in {"simple", "detailed"}:
        raise AnalysisError("Choose Simple or Detailed for descriptive statistics.")
    selected = get_columns(frame, columns)
    if len(selected) > MAX_SELECTED:
        raise AnalysisError(f"Choose up to {MAX_SELECTED} variables at a time for a readable summary.")
    specs = variable_specs or {}
    total_cases = len(frame)
    table_numeric, table_ordinal, table_dates, category_tables = [], [], [], []
    advanced_rows, insights, warnings = [], [], []
    all_missing = 0
    count_scale = count_category = count_date = 0
    chart = None

    for name in selected:
        spec = specs.get(name) or {}
        kind = spec.get("type") or ("date" if pd.api.types.is_datetime64_any_dtype(frame[name]) else
                                    "numeric" if pd.api.types.is_numeric_dtype(frame[name]) else "string")
        measure = spec.get("measure", "scale" if kind == "numeric" else "nominal")
        label = str(spec.get("label", "")).strip()
        title = name + (f" — {label}" if label else "")
        values = valid_values(frame, name, {**spec, "type": kind})
        n = len(values)
        missing = total_cases - n
        all_missing += missing
        if missing and total_cases and missing / total_cases >= .1:
            warnings.append(f"{name}: {missing} of {total_cases} responses ({missing/total_cases:.0%}) are missing. Check missing-value coding and consider nonresponse bias.")
        user_missing = int(spec.get("user_missing", 0))
        if user_missing:
            warnings.append(f"{name}: {user_missing} user-defined missing code(s) were excluded according to Variable View.")

        if kind == "date":
            count_date += 1
            dates = pd.to_datetime(values, errors="coerce").dropna()
            n = len(dates)
            missing = total_cases - n
            table_dates.append([title, n, missing,
                                dates.min().date().isoformat() if n else None,
                                dates.max().date().isoformat() if n else None])
            insights.append({"variable": title, "kind": "Date", "text":
                             f"{n} of {total_cases} cases have a usable date." +
                             (f" Recorded dates range from {dates.min().date().isoformat()} to {dates.max().date().isoformat()}." if n else " No valid dates were found.")})
            continue

        # A numeric code is not a quantity unless Variable View specifies Scale.
        if measure == "scale" and kind == "numeric":
            count_scale += 1
            x = pd.to_numeric(values).astype(float)
            mean = fnum(x.mean(), 2) if n else None
            sd = fnum(x.std(ddof=1), 2) if n > 1 else None
            median = fnum(x.median(), 2) if n else None
            minimum = fnum(x.min(), 2) if n else None
            maximum = fnum(x.max(), 2) if n else None
            table_numeric.append([title, n, missing, mean, sd, median, minimum, maximum])
            if n:
                text = f"{name}: {n} valid values; average {mean}, middle value {median}"
                text += f", standard deviation {sd}." if sd is not None else ". A standard deviation needs at least two valid values."
                if minimum is not None:
                    text += f" Values range from {minimum} to {maximum}."
            else:
                text = f"{name}: no valid numeric values were available; averages cannot be calculated."
                warnings.append(f"{name}: this variable has no valid values.")
            insights.append({"variable": title, "kind": "Scale", "text": text})
            if n > 1 and x.nunique() == 1:
                warnings.append(f"{name}: all usable values are the same; the standard deviation is zero.")
            if n and x.nunique() <= 5 and x.map(float.is_integer).all():
                warnings.append(f"{name}: numeric values form only {x.nunique()} whole-number categories. If these represent a single Likert question or category codes, review its Measure in Variable View; median or percentages may be more appropriate than a mean.")
            if detail_level == "detailed":
                advanced_rows.append([title, n, fnum(x.var(ddof=1)) if n > 1 else None,
                    fnum(x.quantile(.25)) if n else None, fnum(x.quantile(.75)) if n else None,
                    fnum(x.quantile(.75)-x.quantile(.25)) if n else None,
                    fnum(x.skew()) if n > 2 else None, fnum(x.kurt()) if n > 3 else None])
            if len(selected) == 1 and n > 0:
                # A frequency histogram, rather than a bar chart comparing means in different units.
                bins = min(8, max(1, int(np.sqrt(n))))
                if x.nunique() == 1:
                    chart = {"type":"bar", "labels":[str(minimum)], "values":[int(n)], "label":"Cases", "note":"All valid values were the same."}
                else:
                    counts, edges = np.histogram(x.to_numpy(), bins=bins)
                    labels = [f"{edges[i]:.3g}–{edges[i+1]:.3g}" for i in range(len(counts))]
                    chart = {"type":"bar", "labels":labels, "values":counts.astype(int).tolist(), "label":"Cases", "note":"Approximate distribution across non-overlapping intervals; labels are rounded."}
            continue

        if measure == "scale" and kind != "numeric":
            warnings.append(f"{name}: this variable is marked Scale but stored as text; category counts were used. Convert the data type only if the observations are genuinely quantitative.")
        count_category += 1
        if n == 0:
            category_tables.append(table(f"Answers: {title}", ["Answer", "Count", "Valid %"], [],
                                         f"0 valid; {missing} missing. Valid % cannot be calculated."))
            if measure == "ordinal":
                table_ordinal.append([title, 0, missing, None, None])
            insights.append({"variable": title, "kind": measure.title(), "text":
                             f"{name}: no valid responses. Check the source data and missing-value definitions."})
            warnings.append(f"{name}: no valid answers were found.")
            continue

        counts = values.value_counts(dropna=True)
        if measure == "ordinal":
            try:
                counts = counts.sort_index()
            except TypeError:
                warnings.append(f"{name}: ordered categories could not be sorted by their recorded codes; check coding.")
        mode_value = values.value_counts(dropna=True).index[0]
        mode_n = int(values.value_counts(dropna=True).iloc[0])
        mode_text = shown_category(mode_value, {**spec, "type": kind})
        mode_pct = fnum(100 * mode_n / n, 1)
        median_text = None
        if measure == "ordinal":
            if kind == "numeric":
                median_value = pd.to_numeric(values).median()
                median_text = shown_category(median_value, {**spec, "type": kind})
            else:
                # There is no defensible ordinal ranking for arbitrary text codes.
                warnings.append(f"{name}: ordinal text responses have no defined order; median is omitted. Use ordered numeric codes to calculate a median.")
            table_ordinal.append([title, n, missing, median_text, mode_text])
        sorted_counts = counts if measure == "ordinal" else counts.sort_values(ascending=False)
        limited = len(sorted_counts) > MAX_SHOWN_CATEGORIES
        displayed = sorted_counts.iloc[:MAX_SHOWN_CATEGORIES]
        category_rows = [[shown_category(raw, {**spec, "type": kind}), int(count), fnum(100*int(count)/n, 1)]
                         for raw, count in displayed.items()]
        hidden_count = int(sorted_counts.iloc[MAX_SHOWN_CATEGORIES:].sum()) if limited else 0
        if limited:
            category_rows.append([f"Other {len(sorted_counts)-MAX_SHOWN_CATEGORIES} categories (combined)", hidden_count, fnum(100*hidden_count/n, 1)])
            warnings.append(f"{name}: {len(sorted_counts)} distinct answers; only {MAX_SHOWN_CATEGORIES} are listed individually, with the rest grouped as Other.")
        category_rows.append(["TOTAL VALID", n, 100.0])
        category_tables.append(table(f"Answers: {title}", ["Answer", "Count", "Valid %"], category_rows,
            f"Based on {n} valid responses. {missing} missing of {total_cases} total. Percentages are rounded; displayed parts may not add to exactly 100%."))
        insights.append({"variable": title, "kind": measure.title(), "text":
                         f"{name}: the most common answer was {mode_text} ({mode_n} of {n} valid responses; {mode_pct}%). "
                         + (f"The middle response code was {median_text}. " if median_text else "")
                         + f"{missing} response{'s were' if missing != 1 else ' was'} missing."})
        if len(selected) == 1:
            chart = {"type":"bar", "labels":[r[0] for r in category_rows[:-1]],
                     "values":[r[1] for r in category_rows[:-1]], "label":"Responses",
                     "note":"Category counts; missing responses excluded."}

    tables = []
    if table_numeric:
        tables.append(table("Numeric variables · quick summary",
                            ["Variable", "Valid N", "Missing N", "Average (mean)", "SD", "Middle (median)", "Lowest", "Highest"],
                            table_numeric, "The average and SD are shown only for numeric variables marked Scale. SD is the sample standard deviation (n − 1)."))
    if table_ordinal:
        tables.append(table("Ordered responses · quick summary",
                            ["Variable", "Valid N", "Missing N", "Middle (median)", "Most common answer"], table_ordinal,
                            "Ordinal medians use stored numeric codes; confirm that code order reflects the questionnaire's answer order."))
    if table_dates:
        tables.append(table("Date variables · quick summary", ["Variable", "Valid N", "Missing N", "Earliest", "Latest"], table_dates))
    tables.extend(category_tables)
    if advanced_rows:
        tables.append(table("Extra statistics · detailed view",
                            ["Variable", "Valid N", "Variance", "Q1 (25%)", "Q3 (75%)", "IQR", "Skewness", "Excess kurtosis"],
                            advanced_rows, "Sample variance (n − 1); sample-adjusted skewness and excess kurtosis. Empty cells mean too few usable observations."))

    populated = total_cases * len(selected) - all_missing
    summary_cards = [
        {"label": "Cases in dataset", "value": total_cases, "hint": "Rows included; Data View filters do not limit this report."},
        {"label": "Variables summarized", "value": len(selected), "hint": f"{count_scale} scale · {count_category} categorical · {count_date} date"},
        {"label": "Usable answers", "value": populated, "hint": "Across the selected variables; not unique respondents."},
        {"label": "Missing answers", "value": all_missing, "hint": "Across selected variables; system + user-defined missing."},
    ]
    narrative = (f"This report summarizes {len(selected)} selected variable(s) across {total_cases} cases. "
                 f"There were {populated} usable entries and {all_missing} missing entries across those variables. "
                 "For categories and ordered responses, read the counts and valid percentages; for continuous scale data, use the mean and SD. "
                 "These figures describe this dataset only; they do not establish causes, statistical significance, or population-level findings.")
    return {**result("Descriptive statistics · explained", tables, narrative, warnings=warnings, chart=chart,
                     method="Observed, unweighted values; each variable summarized independently. System and user-defined missing responses are excluded. Sample SD uses n − 1."),
            "summary_cards": summary_cards, "insights": insights, "glossary": GLOSSARY,
            "detail_level": detail_level}
