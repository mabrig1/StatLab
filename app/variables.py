"""Variable dictionary and safe, reversible-in-session metadata editing.

Original observations are retained unless the researcher explicitly changes storage
Type. User-defined missing codes are masked only in the analysis working copy.
"""
from __future__ import annotations

import math
import re
from collections.abc import Mapping

import numpy as np
import pandas as pd

NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
TYPES = {"numeric", "string", "date"}
MEASURES = {"nominal", "ordinal", "scale"}
ROLES = {"input", "target", "both", "none", "partition", "split"}
ALIGNMENTS = {"left", "center", "right"}
MAX_LABELS = 200


class VariableError(ValueError):
    pass


def as_code(value: object, kind: str) -> str:
    """Canonical representation of a code without display-label substitution."""
    if not isinstance(value, (str, int, float, np.integer, np.floating)) or isinstance(value, bool):
        raise VariableError("Value codes must be text or finite numbers.")
    text = str(value).strip()
    if not text or len(text) > 128:
        raise VariableError("Value codes must be 1–128 characters.")
    if kind == "numeric":
        try:
            number = float(text)
        except ValueError as exc:
            raise VariableError(f"'{text}' is not a numeric code.") from exc
        if not math.isfinite(number):
            raise VariableError("Numeric codes must be finite.")
        return format(number, ".15g")
    if kind == "date":
        try:
            date = pd.to_datetime(text, errors="raise")
            if pd.isna(date):
                raise ValueError("invalid date")
        except (ValueError, TypeError, OverflowError) as exc:
            raise VariableError(f"'{text}' is not a valid date code.") from exc
        return pd.Timestamp(date).isoformat()
    return text


def type_of(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    nonempty = series.dropna()
    if len(nonempty) and pd.to_numeric(nonempty, errors="coerce").notna().all():
        return "numeric"
    return "string"


def default_variable(name: str, series: pd.Series) -> dict:
    kind = type_of(series)
    if kind == "numeric":
        numbers = pd.to_numeric(series, errors="coerce").dropna()
        decimals = 0 if len(numbers) and np.allclose(numbers, np.round(numbers), rtol=0, atol=1e-9) else 2
    else:
        decimals = 0
    return {
        "name": name, "type": kind, "width": 8 if kind == "numeric" else 24,
        "decimals": decimals, "label": "", "value_labels": [],
        "missing_values": [], "missing_range": None,
        "columns": 12, "align": "right" if kind == "numeric" else "left",
        "measure": "scale" if kind == "numeric" else "nominal", "role": "input",
    }


def init_variables(frame: pd.DataFrame, sav_meta: object | None = None) -> dict[str, dict]:
    output = {name: default_variable(name, frame[name]) for name in frame.columns}
    if sav_meta is None:
        return output
    names_labels = getattr(sav_meta, "column_names_to_labels", {}) or {}
    raw_labels = getattr(sav_meta, "variable_value_labels", {}) or {}
    measurements = getattr(sav_meta, "variable_measure", {}) or {}
    widths = getattr(sav_meta, "variable_display_width", {}) or {}
    alignments = getattr(sav_meta, "variable_alignment", {}) or {}
    missing_ranges = getattr(sav_meta, "missing_ranges", {}) or {}
    for name, spec in output.items():
        spec["label"] = str(names_labels.get(name) or "")[:255]
        for code, label in (raw_labels.get(name) or {}).items():
            try:
                spec["value_labels"].append({"value": as_code(code, spec["type"]), "label": str(label)[:128]})
            except VariableError:
                continue
        measure = str(measurements.get(name, "")).lower()
        if measure in MEASURES:
            spec["measure"] = measure
        width = widths.get(name)
        if isinstance(width, (int, float)) and 1 <= width <= 255:
            spec["columns"] = min(int(width), 60)
        align = str(alignments.get(name, "")).lower()
        if align in ALIGNMENTS:
            spec["align"] = align
        values, range_spec = [], None
        for item in (missing_ranges.get(name) or []):
            if not isinstance(item, dict):
                continue
            lo, hi = item.get("lo"), item.get("hi")
            if lo is None or hi is None:
                continue
            try:
                if lo == hi:
                    values.append(as_code(lo, spec["type"]))
                elif spec["type"] == "numeric" and range_spec is None:
                    range_spec = {"low": as_code(lo, "numeric"), "high": as_code(hi, "numeric")}
            except VariableError:
                continue
        spec["missing_values"] = list(dict.fromkeys(values))[:3]
        spec["missing_range"] = range_spec
    return output


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise VariableError(f"{name} must be an integer between {minimum} and {maximum}.")
    return value


def _bounded_text(value: object, name: str, max_length: int) -> str:
    if not isinstance(value, str) or len(value) > max_length:
        raise VariableError(f"{name} must be text of no more than {max_length} characters.")
    return value


def _normalize_labels(labels: object, kind: str) -> list[dict]:
    if not isinstance(labels, list) or len(labels) > MAX_LABELS:
        raise VariableError(f"Value labels must be a list with at most {MAX_LABELS} items.")
    out, used = [], set()
    for item in labels:
        if not isinstance(item, dict) or set(item) != {"value", "label"}:
            raise VariableError("Each value label needs exactly 'value' and 'label'.")
        code = as_code(item["value"], kind)
        label = _bounded_text(item["label"], "Value label", 128).strip()
        if not label:
            raise VariableError("Value labels cannot be blank.")
        if code in used:
            raise VariableError(f"Duplicate value label code: {code}.")
        used.add(code)
        out.append({"value": code, "label": label})
    return out


def validate_patch(original: dict, patch: Mapping, existing_names: list[str]) -> dict:
    allowed = set(original)
    if not patch or set(patch) - allowed:
        raise VariableError("Submit one or more supported Variable View fields only.")
    result = {**original, **dict(patch)}
    name = result["name"]
    if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
        raise VariableError("Name must start with a letter/underscore, use only letters, numbers or _, and be 1–64 characters.")
    if any(other.casefold() == name.casefold() for other in existing_names if other != original["name"]):
        raise VariableError("Another variable already has that name (names are case-insensitive).")
    kind = result["type"]
    if kind not in TYPES:
        raise VariableError("Type must be numeric, string, or date.")
    result["width"] = _integer(result["width"], "Width", 1, 255)
    result["decimals"] = _integer(result["decimals"], "Decimals", 0, 12)
    result["columns"] = _integer(result["columns"], "Columns", 3, 60)
    result["label"] = _bounded_text(result["label"], "Variable label", 255).strip()
    if result["align"] not in ALIGNMENTS:
        raise VariableError("Align must be left, center, or right.")
    if result["measure"] not in MEASURES:
        raise VariableError("Measure must be nominal, ordinal, or scale.")
    if result["role"] not in ROLES:
        raise VariableError("Invalid variable role.")
    if kind != "numeric":
        if result["decimals"] != 0:
            raise VariableError("Decimals must be 0 for string and date variables.")
    result["value_labels"] = _normalize_labels(result["value_labels"], kind)
    missing = result["missing_values"]
    if not isinstance(missing, list) or len(missing) > 3:
        raise VariableError("Specify no more than three discrete missing codes.")
    normalized = [as_code(item, kind) for item in missing]
    if len(normalized) != len(set(normalized)):
        raise VariableError("Duplicate user-missing codes are not allowed.")
    if result["missing_range"] is not None:
        r = result["missing_range"]
        if kind != "numeric" or not isinstance(r, dict) or set(r) != {"low", "high"}:
            raise VariableError("Only numeric variables can have a missing-value range.")
        lo = as_code(r["low"], "numeric")
        hi = as_code(r["high"], "numeric")
        if float(lo) > float(hi):
            raise VariableError("Missing range lower limit cannot exceed upper limit.")
        if len(normalized) > 1:
            raise VariableError("A missing range permits at most one additional discrete code.")
        result["missing_range"] = {"low": lo, "high": hi}
    result["missing_values"] = normalized
    return result


def convert_series(series: pd.Series, kind: str) -> pd.Series:
    if kind == "string":
        return series.astype("string")
    if kind == "numeric":
        converted = pd.to_numeric(series, errors="coerce")
        if (series.notna() & converted.isna()).any():
            raise VariableError("Some nonmissing observations cannot be converted to numeric. Recode them first or retain String type.")
        if not np.isfinite(converted.dropna().astype(float)).all():
            raise VariableError("Cannot convert non-finite observations to numeric.")
        return converted
    # Date requires unambiguous ISO YYYY-MM-DD values or pre-existing datetimes.
    if pd.api.types.is_datetime64_any_dtype(series):
        return series.copy()
    s = series.dropna().astype("string")
    if not s.str.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?").all():
        raise VariableError("Date conversion requires ISO dates (YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]).")
    converted = pd.to_datetime(series, errors="coerce")
    if (series.notna() & converted.isna()).any():
        raise VariableError("Some observations cannot be converted to dates.")
    return converted


def apply_edit(record: dict, old_name: str, patch: dict) -> dict:
    if old_name not in record["variables"]:
        raise VariableError("Variable not found.")
    original = record["variables"][old_name]
    new = validate_patch(original, patch, list(record["frame"].columns))
    new_name = new["name"]
    old_series = record["frame"][old_name]
    # Validate conversion first. No record changes occur on failure.
    converted = convert_series(old_series, new["type"]) if new["type"] != original["type"] else None
    # Preserve column position during renaming and leave all other variables untouched.
    frame = record["frame"].copy()
    if converted is not None:
        frame[old_name] = converted
    if new_name != old_name:
        frame = frame.rename(columns={old_name: new_name})
    variables = {new_name if name == old_name else name: (new if name == old_name else spec)
                 for name, spec in record["variables"].items()}
    record["frame"] = frame
    record["variables"] = variables
    record["revision"] = record.get("revision", 0) + 1
    return new


def user_missing_mask(series: pd.Series, spec: dict) -> pd.Series:
    mask = pd.Series(False, index=series.index)
    if spec["type"] == "numeric":
        numbers = pd.to_numeric(series, errors="coerce")
        for code in spec["missing_values"]:
            mask |= numbers.eq(float(code)).fillna(False)
        if spec["missing_range"] is not None:
            r = spec["missing_range"]
            mask |= numbers.between(float(r["low"]), float(r["high"]), inclusive="both").fillna(False)
    elif spec["type"] == "date":
        dates = pd.to_datetime(series, errors="coerce")
        for code in spec["missing_values"]:
            mask |= dates.eq(pd.Timestamp(code)).fillna(False)
    else:
        text = series.astype("string")
        for code in spec["missing_values"]:
            mask |= text.eq(code).fillna(False)
    return mask.astype(bool) & series.notna()


def analysis_frame(record: dict) -> pd.DataFrame:
    df = record["frame"].copy()
    for name, spec in record["variables"].items():
        if spec["missing_values"] or spec["missing_range"]:
            df.loc[user_missing_mask(df[name], spec), name] = np.nan
    return df


def summary(record: dict, name: str) -> dict:
    spec = record["variables"][name]
    series = record["frame"][name]
    system_missing = int(series.isna().sum())
    user_missing = int(user_missing_mask(series, spec).sum())
    return {**spec, "missing": system_missing + user_missing,
            "system_missing": system_missing, "user_missing": user_missing,
            "valid": len(series)-system_missing-user_missing,
            "distinct": int(series[~(series.isna()|user_missing_mask(series,spec))].nunique(dropna=True))}


def preview_label(value: object, spec: dict) -> str | None:
    if pd.isna(value):
        return None
    try:
        code = as_code(value, spec["type"])
    except VariableError:
        return str(value)
    return next((item["label"] for item in spec["value_labels"] if item["value"] == code), str(value))


def create_variable(record: dict, name: str, kind: str = "numeric", patch: dict | None = None) -> None:
    if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
        raise VariableError("New variable name must be 1–64 letters, digits or underscores and cannot start with a digit.")
    if any(col.casefold() == name.casefold() for col in record["frame"].columns):
        raise VariableError("Variable name already exists (case-insensitive).")
    if kind not in TYPES:
        raise VariableError("Type must be numeric, string, or date.")
    if len(record["frame"].columns) >= 250:
        raise VariableError("Maximum of 250 variables per dataset.")
    count = len(record["frame"])
    if kind == "numeric":
        values = pd.Series([np.nan] * count, index=record["frame"].index, dtype="float64")
    elif kind == "date":
        values = pd.Series([pd.NaT] * count, index=record["frame"].index, dtype="datetime64[ns]")
    else:
        values = pd.Series([pd.NA] * count, index=record["frame"].index, dtype="string")
    spec = default_variable(name, values)
    if kind == "date":
        spec["width"] = 24
    patch = {**(patch or {}), "name": name, "type": kind}
    if patch.get("decimals") is None and kind != "numeric":
        patch.pop("decimals", None)
    for key, value in patch.items():
        if value is None and key != "missing_range":
            raise VariableError(f"{key} cannot be null.")
    spec = validate_patch(spec, patch, list(record["frame"].columns))
    record["frame"][name] = values
    record["variables"][name] = spec
    record["revision"] = record.get("revision", 0) + 1


def delete_variable(record: dict, name: str) -> None:
    if name not in record["variables"]:
        raise VariableError("Variable not found.")
    if len(record["frame"].columns) <= 1:
        raise VariableError("Cannot delete the final variable of a dataset.")
    record["frame"] = record["frame"].drop(columns=[name])
    del record["variables"][name]
    record["revision"] = record.get("revision", 0) + 1


def reorder_variables(record: dict, order: list[str]) -> None:
    existing = list(record["frame"].columns)
    if not isinstance(order, list) or len(order) != len(existing) or len(set(order)) != len(order) or set(order) != set(existing):
        raise VariableError("Provide each existing variable exactly once in the new order.")
    if order == existing:
        return
    record["frame"] = record["frame"][order].copy()
    record["variables"] = {name: record["variables"][name] for name in order}
    record["revision"] = record.get("revision", 0) + 1


def apply_dictionary(record: dict, payload: object) -> None:
    """Apply a saved codebook by exact column name, all-or-nothing.

    A codebook can be reused on data with the same headings, but its values are
    never taken to be observations. Source SHA is informational, not a match gate.
    """
    if not isinstance(payload, dict) or payload.get("schema") != "mabrig-statlab-variable-dictionary-v1":
        raise VariableError("Invalid dictionary format. Import a StatLab variable-dictionary-v1 JSON file.")
    items = payload.get("variables")
    names = list(record["frame"].columns)
    if not isinstance(items, list) or len(items) != len(names):
        raise VariableError("Codebook must contain exactly the same variable names as this dataset.")
    incoming = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or item["name"] in incoming:
            raise VariableError("Invalid or duplicated names in codebook.")
        incoming[item["name"]] = item
    if set(names) != set(incoming):
        raise VariableError("Codebook column names differ from dataset. Rename/reconcile the variables before import.")
    # Preflight all metadata AND all type conversions without touching the record.
    specs, converted = {}, {}
    for name in names:
        current = record["variables"][name]
        patch = {k: v for k, v in incoming[name].items() if k in current}
        validated = validate_patch(current, patch, names)
        if validated["name"] != name:
            raise VariableError("Dictionary import cannot rename variables.")
        if current["type"] != validated["type"]:
            converted[name] = convert_series(record["frame"][name], validated["type"])
        specs[name] = validated
    frame = record["frame"].copy() if converted else record["frame"]
    for name, series in converted.items():
        frame[name] = series
    record["frame"] = frame
    record["variables"] = specs
    record["revision"] = record.get("revision", 0) + 1


def annotate_output(outcome: dict, record: dict, recipe: dict) -> None:
    """Show category labels in tables without changing numeric estimates."""
    mode = recipe.get("analysis")
    specs = record["variables"]

    def shown(column: str, observed: object) -> str:
        spec = specs.get(column)
        if spec is None:
            return str(observed)
        try:
            code = as_code(observed, spec["type"])
        except VariableError:
            return str(observed)
        label = next((e["label"] for e in spec["value_labels"] if e["value"] == code), None)
        return f"{observed} — {label}" if label is not None else str(observed)

    if not outcome.get("tables"):
        return
    if mode == "frequencies":
        name = recipe.get("a")
        for row in outcome["tables"][0]["rows"]:
            row[0] = shown(name, row[0])
        chart = outcome.get("chart")
        if chart and chart.get("labels"):
            chart["labels"] = [shown(name, value) for value in chart["labels"]]
    elif mode == "crosstab":
        a, b = recipe.get("a"), recipe.get("b")
        tab = outcome["tables"][0]
        tab["columns"][1:-1] = [shown(b, h) for h in tab["columns"][1:-1]]
        for row in tab["rows"][:-1]:
            row[0] = shown(a, row[0])
    elif mode in ("ttest_ind", "anova"):
        group = recipe.get("b")
        for row in outcome["tables"][0]["rows"]:
            row[0] = shown(group, row[0])
    selected = list(dict.fromkeys((recipe.get("columns") or []) +
                                 ([recipe["a"]] if recipe.get("a") else []) +
                                 ([recipe["b"]] if recipe.get("b") else [])))
    outcome["variable_definitions"] = [
        {"name": name, "label": specs[name]["label"],
         "measure": specs[name]["measure"], "role": specs[name]["role"],
         "user_missing_codes": specs[name]["missing_values"],
         "missing_range": specs[name]["missing_range"]}
        for name in selected if name in specs
    ]


def formatted_preview(value: object, spec: dict) -> str | None:
    """Format for Data View without altering stored values or calculations."""
    if pd.isna(value):
        return None
    if spec["type"] == "numeric":
        try:
            return f"{float(value):.{spec['decimals']}f}"
        except (TypeError, ValueError, OverflowError):
            return str(value)
    if spec["type"] == "date":
        try:
            return pd.Timestamp(value).isoformat(sep=" ", timespec="seconds").replace(" 00:00:00", "")
        except (ValueError, TypeError):
            return str(value)
    return str(value)
