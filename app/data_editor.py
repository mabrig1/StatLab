"""SPSS-style Data View operations with revision checks and atomic edits.

All row indices are 0-based positions in the unfiltered original case order.
Sorting, filtering and searching change only the display, never the dataset.
History holds small inverse operations rather than copies of entire datasets.
This is an in-memory, single-user prototype, not a multi-user database.
"""
from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd

from .variables import as_code, preview_label, formatted_preview, user_missing_mask

MAX_EDIT_CELLS = 2500
MAX_ROW_BATCH = 100
MAX_HISTORY = 25
DATE_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$")


class DataError(ValueError):
    pass


def history_reset(record: dict) -> None:
    record["undo_stack"] = []
    record["redo_stack"] = []


def history_state(record: dict) -> dict:
    return {
        "can_undo": bool(record.get("undo_stack")),
        "can_redo": bool(record.get("redo_stack")),
        "revision": record.get("revision", 0),
    }


def _require_revision(record: dict, revision: int) -> None:
    if revision != record.get("revision", 0):
        raise DataError("Dataset changed after this page was loaded. Refresh Data View before editing.")


def _push(record: dict, action: dict) -> None:
    record.setdefault("undo_stack", []).append(action)
    record["undo_stack"] = record["undo_stack"][-MAX_HISTORY:]
    record["redo_stack"] = []
    record["revision"] = record.get("revision", 0) + 1


def _cell_value(spec: dict, value: Any):
    """Validate user-entered data. Blank text means a system-missing value."""
    kind = spec["type"]
    if value is None or (isinstance(value, str) and not value.strip()):
        return pd.NaT if kind == "date" else (pd.NA if kind == "string" else np.nan)
    if isinstance(value, (dict, list, bool)):
        raise DataError(f"{spec['name']}: cell values must be plain text or numbers.")
    if kind == "numeric":
        try:
            number = float(value)
        except (ValueError, TypeError, OverflowError) as exc:
            raise DataError(f"{spec['name']}: expected a numeric value; received '{str(value)[:50]}'.") from exc
        if not math.isfinite(number):
            raise DataError(f"{spec['name']}: NaN and infinity cannot be entered as numbers. Leave blank for missing.")
        return number
    if kind == "date":
        text = str(value).strip()
        if not DATE_REGEX.fullmatch(text):
            raise DataError(f"{spec['name']}: dates must use ISO format YYYY-MM-DD [HH:MM[:SS]].")
        try:
            stamp = pd.Timestamp(text)
        except (ValueError, TypeError, OverflowError) as exc:
            raise DataError(f"{spec['name']}: invalid calendar date '{text}'.") from exc
        if pd.isna(stamp):
            raise DataError(f"{spec['name']}: invalid date value.")
        return stamp
    value = str(value)
    if len(value) > spec["width"]:
        raise DataError(f"{spec['name']}: text is {len(value)} characters but variable Width is {spec['width']}. Increase Width in Variable View first.")
    if len(value) > 255:
        raise DataError(f"{spec['name']}: text is limited to 255 characters.")
    return value


def _encode(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, pd.Timestamp):
        return value.isoformat(sep=" ")
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value if isinstance(value, (str, bool, int)) else str(value)


def rows_page(record: dict, offset: int = 0, limit: int = 50,
              query: str = "", column: str = "", operator: str = "contains",
              sort: str = "", descending: bool = False) -> dict:
    frame = record["frame"]
    if not 0 <= offset <= 100_000:
        raise DataError("Invalid page offset.")
    if limit not in (25, 50, 100, 200):
        raise DataError("Page size must be 25, 50, 100, or 200.")
    if len(query) > 128:
        raise DataError("Search text cannot exceed 128 characters.")
    if column and column not in frame.columns:
        raise DataError("Filter column does not exist.")
    if sort and sort not in frame.columns:
        raise DataError("Sort column does not exist.")
    if operator not in {"contains", "equals", "is_missing", "is_valid"}:
        raise DataError("Unsupported filter type.")
    if operator in {"is_missing", "is_valid"} and not column:
        raise DataError("Choose a variable to filter by missing/valid observations.")

    # Boolean selection; never modify frame or its natural case order.
    selection = pd.Series(True, index=frame.index)
    needle = query.casefold().strip()
    if column:
        s = frame[column]
        if operator == "is_missing":
            selection &= s.isna() | user_missing_mask(s, record["variables"][column])
        elif operator == "is_valid":
            selection &= ~(s.isna() | user_missing_mask(s, record["variables"][column]))
        elif needle:
            # Search raw codes and any matching labels, without changing underlying values.
            raw = s.astype("string").str.casefold()
            if operator == "equals":
                mask = raw.eq(needle).fillna(False)
            else:
                mask = raw.str.contains(needle, regex=False, na=False)
            for item in record["variables"][column]["value_labels"]:
                label = item["label"].casefold()
                if (label == needle if operator == "equals" else needle in label):
                    if record["variables"][column]["type"] == "numeric":
                        mask |= pd.to_numeric(s, errors="coerce").eq(float(item["value"])).fillna(False)
                    elif record["variables"][column]["type"] == "date":
                        mask |= pd.to_datetime(s, errors="coerce").eq(pd.Timestamp(item["value"])).fillna(False)
                    else:
                        mask |= raw.eq(item["value"].casefold()).fillna(False)
            selection &= mask
    elif needle:
        # Limit work by processing one column at a time, short-circuiting on match.
        found = pd.Series(False, index=frame.index)
        for name in frame.columns:
            found |= frame[name].astype("string").str.casefold().str.contains(needle, regex=False, na=False)
        selection &= found

    indexes = np.flatnonzero(selection.to_numpy())
    if sort:
        # pandas' mergesort is stable, preserving case order for ties.
        ordered = frame.iloc[indexes].sort_values(by=sort, ascending=not descending,
                                                   kind="mergesort", na_position="last")
        indexes = ordered.index.to_numpy(dtype=int)
    selected = indexes[offset:offset + limit]
    specs = record["variables"]
    names = list(frame.columns)
    # Precalculate user-defined missing flags for just the page (not whole dataset).
    page_df = frame.iloc[selected]
    missing_masks = {name: user_missing_mask(page_df[name], specs[name]).to_numpy()
                     for name in names}
    cases = []
    for i, position in enumerate(selected):
        values = [frame.iat[position, col] for col in range(len(names))]
        cases.append({
            "index": int(position), "values": [_encode(v) for v in values],
            "formatted": [formatted_preview(v, specs[name]) for name, v in zip(names, values)],
            "labelled": [preview_label(v, specs[name]) for name, v in zip(names, values)],
            "system_missing": [pd.isna(v) for v in values],
            "user_missing": [bool(missing_masks[name][i]) for name in names],
        })
    return {"rows": cases, "total": len(frame), "filtered": len(indexes), "offset": offset,
            "limit": limit, "revision": record.get("revision", 0),
            "columns": names, **history_state(record)}


def set_cells(record: dict, edits: list[dict], revision: int) -> None:
    _require_revision(record, revision)
    if not edits or len(edits) > MAX_EDIT_CELLS:
        raise DataError(f"Edit between 1 and {MAX_EDIT_CELLS} cells per request.")
    df = record["frame"]
    names = list(df.columns)
    positions = {name: i for i, name in enumerate(names)}
    prepared = []
    unique = set()
    for edit in edits:
        if set(edit) != {"row", "column", "value"}:
            raise DataError("Each edit must specify row, column and value.")
        row, column = edit["row"], edit["column"]
        if isinstance(row, bool) or not isinstance(row, int) or not (0 <= row < len(df)):
            raise DataError("A cell edit references an invalid case number.")
        if column not in positions:
            raise DataError(f"Unknown variable: {column}.")
        if (row, column) in unique:
            raise DataError("Repeated edits to the same cell are not permitted in one batch.")
        unique.add((row, column))
        val = _cell_value(record["variables"][column], edit["value"])
        prepared.append((row, positions[column], df.iat[row, positions[column]], val))
    # Only commit after every edit validates successfully.
    result = df.copy()
    for row, position, previous, next_value in prepared:
        column = names[position]
        if (record["variables"][column]["type"] == "numeric" and
                pd.api.types.is_integer_dtype(result[column].dtype) and
                (pd.isna(next_value) or not float(next_value).is_integer())):
            result[column] = result[column].astype("float64")
        result.iat[row, position] = next_value
    record["frame"] = result
    _push(record, {"type": "cells", "changes": prepared})


def _blank_extension(frame: pd.DataFrame, variables: dict, count: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Promote integer columns to float before inserting missing numeric cells."""
    prepared = frame.copy()
    for name, spec in variables.items():
        if spec["type"] == "numeric" and pd.api.types.is_integer_dtype(prepared[name].dtype):
            prepared[name] = prepared[name].astype("float64")
    extra = pd.DataFrame({
        name: pd.Series([pd.NaT if spec["type"] == "date" else
                         pd.NA if spec["type"] == "string" else np.nan] * count,
                        dtype=prepared[name].dtype)
        for name, spec in variables.items()
    })
    return prepared, extra


def add_cases(record: dict, count: int, revision: int) -> None:
    _require_revision(record, revision)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_ROW_BATCH:
        raise DataError("Add between 1 and 100 blank cases at a time.")
    if len(record["frame"]) + count > 100_000:
        raise DataError("Dataset cannot exceed 100,000 cases.")
    df = record["frame"]
    # Use the original pandas dtypes for blank observations.
    prepared, extra = _blank_extension(df, record["variables"], count)
    record["frame"] = pd.concat([prepared, extra], ignore_index=True)
    _push(record, {"type": "append", "count": count})


def delete_cases(record: dict, indexes: list[int], revision: int) -> None:
    _require_revision(record, revision)
    df = record["frame"]
    if not isinstance(indexes, list) or not 1 <= len(indexes) <= 100:
        raise DataError("Select between 1 and 100 cases to delete at a time.")
    if len(set(indexes)) != len(indexes) or any(isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= len(df) for i in indexes):
        raise DataError("Case selection is invalid or contains duplicates.")
    if len(df) - len(indexes) < 1:
        raise DataError("Cannot delete all cases. Use Clear data instead.")
    positions = sorted(indexes)
    removed = [(i, df.iloc[[i]].copy()) for i in positions]
    record["frame"] = df.drop(index=positions).reset_index(drop=True)
    _push(record, {"type": "delete", "removed": removed})


def paste_matrix(record: dict, start_row: int, start_column: str, matrix: list[list], revision: int) -> None:
    """Paste a spreadsheet rectangle atomically; append up to 100 blank cases."""
    _require_revision(record, revision)
    df = record["frame"]
    columns = list(df.columns)
    if start_column not in columns or not isinstance(start_row, int) or isinstance(start_row, bool) or start_row < 0 or start_row > len(df):
        raise DataError("Paste start must refer to a valid variable and case position.")
    if not isinstance(matrix, list) or not matrix or len(matrix) > MAX_EDIT_CELLS or not isinstance(matrix[0], list) or not matrix[0]:
        raise DataError("Paste a rectangular table with 1–2,500 cells.")
    width = len(matrix[0])
    if any(not isinstance(row, list) or len(row) != width for row in matrix) or len(matrix)*width > MAX_EDIT_CELLS:
        raise DataError("Clipboard paste must be a rectangle of no more than 2,500 cells.")
    col_offset = columns.index(start_column)
    if col_offset + width > len(columns):
        raise DataError("Pasted data exceeds the last variable. Add variables first.")
    appended = max(0, start_row + len(matrix) - len(df))
    if appended > MAX_ROW_BATCH or len(df) + appended > 100_000:
        raise DataError("Paste can add no more than 100 new cases at a time.")
    prepared = []
    for i, row_values in enumerate(matrix):
        for j, raw in enumerate(row_values):
            position = col_offset + j
            old = df.iat[start_row+i, position] if start_row+i < len(df) else None
            new = _cell_value(record["variables"][columns[position]], raw)
            prepared.append((start_row+i, position, old, new))
    # All input validated; create blank cases in a working copy, then change cells.
    result = df.copy()
    if appended:
        result, extra = _blank_extension(result, record["variables"], appended)
        result = pd.concat([result, extra], ignore_index=True)
    for row, col, _old, new in prepared:
        column = columns[col]
        if (record["variables"][column]["type"] == "numeric" and
                pd.api.types.is_integer_dtype(result[column].dtype) and
                (pd.isna(new) or not float(new).is_integer())):
            result[column] = result[column].astype("float64")
        result.iat[row, col] = new
    record["frame"] = result
    _push(record, {"type": "paste", "changes": prepared, "appended": appended})


def _apply(record: dict, action: dict, undo: bool) -> None:
    kind = action["type"]
    df = record["frame"]
    if kind in ("cells", "paste"):
        appended = action.get("appended", 0)
        if appended and not undo:
            df, extra = _blank_extension(df, record["variables"], appended)
            df = pd.concat([df, extra], ignore_index=True)
        result = df.copy()
        for row, position, old, new in action["changes"]:
            result.iat[row, position] = old if undo else new
        record["frame"] = result.iloc[:-appended].reset_index(drop=True).copy() if appended and undo else result
    elif kind == "append":
        count = action["count"]
        if undo:
            record["frame"] = df.iloc[:-count].reset_index(drop=True).copy()
        else:
            # Re-add missing cells without creating history.
            df, extra = _blank_extension(df, record["variables"], count)
            record["frame"] = pd.concat([df, extra], ignore_index=True)
    elif kind == "delete":
        removed = action["removed"]
        if undo:
            restored = df.copy()
            # Reinsert each original row at its original index in ascending order.
            for position, row in removed:
                restored = pd.concat([restored.iloc[:position], row, restored.iloc[position:]], ignore_index=True)
            record["frame"] = restored.reset_index(drop=True)
        else:
            record["frame"] = df.drop(index=[i for i, _ in removed]).reset_index(drop=True)


def step_history(record: dict, undo: bool, revision: int) -> None:
    _require_revision(record, revision)
    source = record.setdefault("undo_stack" if undo else "redo_stack", [])
    if not source:
        raise DataError("No operation available to undo." if undo else "No operation available to redo.")
    action = source.pop()
    _apply(record, action, undo)
    destination = record.setdefault("redo_stack" if undo else "undo_stack", [])
    destination.append(action)
    record["revision"] = record.get("revision", 0) + 1
