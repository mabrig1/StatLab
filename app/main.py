"""Local-first statistical web application API.

WARNING: Development/local-only by design. No account system or tenant isolation.
Do not expose to the public internet before adding authentication and rate limits.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import secrets
import time
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel, Field
from typing import Literal

from .stats_engine import AnalysisError, analyze
from .power_analysis import PowerPlanRequest, PowerPlanningError, plan_sample_size, power_plan_html
from .aggregate_descriptives import SummaryError, analyze_frequencies, summary_csv
from .chapter_four import ChapterFourError, build_chapter_four, chapter_four_html, chapter_four_csv, chapter_four_docx
from .data_editor import (DataError, history_reset, history_state, rows_page, set_cells,
                          add_cases, delete_cases, step_history, paste_matrix)
from .variables import (VariableError, NAME_PATTERN, init_variables, apply_edit, create_variable,
                        delete_variable, reorder_variables, apply_dictionary, annotate_output, analysis_frame,
                        summary as variable_summary, preview_label, formatted_preview)

APP_DIR = Path(__file__).resolve().parent
MAX_FILE_SIZE = 12 * 1024 * 1024
MAX_ROWS = 100_000
MAX_COLUMNS = 250
MAX_SESSIONS = 12
TTL = 3600
# Each session contains df + metadata + creation time; no disk database.
sessions: dict[str, dict] = {}
app = FastAPI(title="MABRIG StatLab", version="0.9.0", docs_url=None, redoc_url=None)
app.mount("/pharmaceutical", StaticFiles(
    directory=APP_DIR.parent / "cloudflare" / "public" / "pharmaceutical", html=True
), name="pharmaceutical")



class FrequencyOnlyRequest(BaseModel):
    """No case-by-case data required or accepted by this endpoint."""
    model_config = {"extra": "forbid"}
    text: str | None = None
    items: dict[str, dict] | None = None
    scale_labels: dict[str, str] = Field(default_factory=lambda: {
        "1": "Strongly Disagree", "2": "Disagree", "3": "Neutral",
        "4": "Agree", "5": "Strongly Agree",
    })
    reversed: bool = False
    reverse_items: list[str] = Field(default_factory=list)
    population_size: int | None = Field(default=None, ge=1)
    sample_size: int | None = Field(default=None, ge=1)
    sd_method: Literal["sample", "population"] = "sample"


def _frequency_analysis(payload: FrequencyOnlyRequest):
    try:
        return analyze_frequencies(**payload.model_dump())
    except SummaryError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/power/sample-size")
def plan_study_sample_size(request: PowerPlanRequest):
    """Local-only a priori planning. No participant data, observed p-values or datasets."""
    try:
        return plan_sample_size(request)
    except (PowerPlanningError, ValueError, OverflowError, ArithmeticError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)[:250]) from exc


@app.post("/api/power/report.html")
def plan_study_html(request: PowerPlanRequest):
    """Recalculate from assumptions and download a script-free, printable memo."""
    try:
        result = plan_sample_size(request)
    except (PowerPlanningError, ValueError, OverflowError, ArithmeticError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)[:250]) from exc
    return HTMLResponse(power_plan_html(result), headers={
        "Content-Disposition": 'attachment; filename="statlab-a-priori-power-plan.html"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


@app.post("/api/frequency-only/analyze")
def frequency_only_analyze(request: FrequencyOnlyRequest):
    """Weighted descriptives from counts; never builds or stores individual cases."""
    return _frequency_analysis(request)


@app.post("/api/frequency-only/summary.csv")
def frequency_only_csv(request: FrequencyOnlyRequest):
    result = _frequency_analysis(request)
    return StreamingResponse(iter([summary_csv(result)]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": "attachment; filename=frequency-only-summary.csv"})


class ChapterFourRequest(BaseModel):
    """Report settings plus original counts (re-analysed on every request)."""
    model_config = {"extra": "forbid"}
    analysis: FrequencyOnlyRequest
    research_title: str = Field(default="", max_length=240)
    objectives: list[str] = Field(default_factory=list, max_length=12)
    item_objectives: dict[str, int] = Field(default_factory=dict)
    source_label: str = Field(default="", max_length=200)


def _chapter_four(request: ChapterFourRequest) -> dict:
    analysis = _frequency_analysis(request.analysis)
    try:
        return build_chapter_four(analysis,
                                  research_title=request.research_title,
                                  objectives=request.objectives,
                                  item_objectives=request.item_objectives,
                                  source_label=request.source_label)
    except ChapterFourError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post('/api/frequency-only/chapter-four')
def frequency_only_chapter_four(request: ChapterFourRequest):
    """Return structured report, escaped HTML, and CSV with no case-level records."""
    report = _chapter_four(request)
    return {'report': report, 'html': chapter_four_html(report), 'csv': chapter_four_csv(report)}


@app.post('/api/frequency-only/chapter-four.docx')
def frequency_only_chapter_four_docx(request: ChapterFourRequest):
    """Generate an editable Word draft from fresh calculations and supplied labels."""
    report = _chapter_four(request)
    content = chapter_four_docx(report)
    return StreamingResponse(iter([content]),
                             media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                             headers={'Content-Disposition': 'attachment; filename=statlab-chapter-four-draft.docx'})


class ImportDictionaryRequest(BaseModel):
    model_config = {"extra": "allow"}
    schema_name: str = Field(alias="schema")
    variables: list[dict]


class ReorderVariablesRequest(BaseModel):
    model_config = {"extra": "forbid"}
    order: list[str]


class VariablePatchRequest(BaseModel):
    # A field set to null is permitted only when null is meaningful, such as
    # missing_range. The request is patch semantics: omitted = unchanged.
    model_config = {"extra": "forbid"}
    name: str | None = None
    type: str | None = None
    width: int | None = None
    decimals: int | None = None
    label: str | None = None
    value_labels: list[dict] | None = None
    missing_values: list[str | int | float] | None = None
    missing_range: dict | None = None
    columns: int | None = None
    align: str | None = None
    measure: str | None = None
    role: str | None = None


class NewVariableRequest(VariablePatchRequest):
    name: str
    type: str = "numeric"


class NewDatasetRequest(BaseModel):
    model_config = {"extra": "forbid"}
    filename: str = "Untitled survey"
    variable: str = "var_1"
    type: str = "numeric"
    rows: int = 10


class CellPatch(BaseModel):
    model_config = {"extra": "forbid"}
    row: int
    column: str
    value: str | int | float | None


class CellBatchRequest(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int
    edits: list[CellPatch]


class PasteRequest(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int
    row: int
    column: str
    values: list[list[str | int | float | None]]


class AddCasesRequest(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int
    count: int = 1


class DeleteCasesRequest(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int
    indexes: list[int]


class HistoryStepRequest(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int


class QuestionnaireObjective(BaseModel):
    model_config = {"extra": "forbid"}
    title: str
    items: list[str]
    reverse_items: list[str] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    dataset_id: str
    analysis: str
    columns: list[str] = Field(default_factory=list)
    a: str | None = None
    b: str | None = None
    method: str = "pearson"
    detail_level: Literal["simple", "detailed"] = "simple"
    objectives: list[QuestionnaireObjective] = Field(default_factory=list)
    scale_points: int = 5
    higher_is_favourable: bool | None = None
    min_answered_pct: int = 50
    factor_count: int = Field(default=2, ge=1, le=6)
    factor_rotation: Literal["none", "varimax", "oblimin"] = "varimax"
    parallel_simulations: int = Field(default=100, ge=50, le=200)
    parallel_seed: int = Field(default=20261110, ge=0, le=4294967295)


def sanitize_value(x):
    if pd.isna(x):
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        f = float(x)
        return f if np.isfinite(f) else None
    if isinstance(x, (pd.Timestamp,)):
        return x.isoformat()
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return str(x) if not isinstance(x, (str, int, bool)) else x


def cleanup():
    now = time.monotonic()
    for key in list(sessions):
        if now - sessions[key]["created"] > TTL:
            del sessions[key]


def dataset_for(dataset_id: str):
    cleanup()
    if dataset_id not in sessions:
        raise HTTPException(status_code=404, detail="Dataset session expired or not found. Import your file again.")
    return sessions[dataset_id]


def parse_document(filename: str, raw: bytes) -> tuple[pd.DataFrame, dict]:
    ext = Path(filename.lower()).suffix
    sav_meta = None
    try:
        if ext == ".csv" or ext == ".tsv":
            decoded = None
            for encoding in ("utf-8-sig", "cp1252"):
                try:
                    decoded = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            if decoded is None:
                raise AnalysisError("Could not decode text file as UTF-8 or CP1252.")
            if not decoded.strip():
                raise AnalysisError("Text file is empty.")
            if ext == ".tsv":
                delimiter = "\t"
            else:
                try:
                    delimiter = csv.Sniffer().sniff(decoded[:8192], delimiters=",;\t|").delimiter
                except csv.Error:
                    delimiter = ","
            headers = next(csv.reader(io.StringIO(decoded), delimiter=delimiter))
            cleaned = [h.strip()[:100] for h in headers]
            if not all(cleaned) or len(set(cleaned)) != len(cleaned):
                raise AnalysisError("Column headings must be unique and nonblank.")
            df = pd.read_csv(io.StringIO(decoded), sep=delimiter)
        elif ext == ".xlsx":
            df = pd.read_excel(io.BytesIO(raw), engine="openpyxl")
        elif ext == ".sav":
            try:
                import pyreadstat
            except ImportError as exc:
                raise AnalysisError("SPSS .sav support needs pyreadstat (install with: pip install pyreadstat).") from exc
            # pyreadstat expects a filesystem path; temporary file is deleted on close.
            with tempfile.NamedTemporaryFile(suffix=".sav") as temp:
                temp.write(raw)
                temp.flush()
                df, sav_meta = pyreadstat.read_sav(temp.name, apply_value_formats=False, user_missing=True)
        else:
            raise AnalysisError("Supported formats are .csv, .tsv, .xlsx and .sav.")
    except AnalysisError:
        raise
    except Exception as exc:
        raise AnalysisError(f"Could not parse {ext} dataset: {str(exc)[:170]}") from exc
    if df.empty or not len(df.columns):
        raise AnalysisError("Dataset has no records or variable headings.")
    if len(df) > MAX_ROWS or len(df.columns) > MAX_COLUMNS:
        raise AnalysisError(f"Dataset exceeds {MAX_ROWS:,} records or {MAX_COLUMNS} variables. Split it before import.")
    df.columns = [str(c).strip()[:100] for c in df.columns]
    if not all(df.columns) or len(set(df.columns)) != len(df.columns):
        raise AnalysisError("Column names must be unique and nonblank.")
    df = df.replace([np.inf,-np.inf], np.nan)
    return df, sav_meta


def dataset_info(info: dict) -> dict:
    df = info["frame"]
    variables = [variable_summary(info, c) for c in df.columns]
    preview = []
    labelled_preview = []
    display_preview = []
    for vals in df.head(25).itertuples(index=False, name=None):
        preview.append([sanitize_value(x) for x in vals])
        labelled_preview.append([preview_label(value, info["variables"][name])
                                 for value, name in zip(vals, df.columns)])
        display_preview.append([formatted_preview(value, info["variables"][name])
                                for value, name in zip(vals, df.columns)])
    return {"dataset_id": info["id"], "filename": info["filename"],
            "rows": len(df), "columns": len(df.columns), "variables": variables,
            "preview": preview, "labelled_preview": labelled_preview,
            "formatted_preview": display_preview,
            "sha256": info["sha256"], "revision": info.get("revision", 0),
            "expires_in_minutes": 60, **history_state(info)}


@app.get("/")
def home():
    return FileResponse(APP_DIR / "static" / "index.html")


@app.get("/static/{path}")
def static(path: str):
    if path not in ("app.js", "styles.css", "frequency.js", "frequency.css", "chapter_four.js", "power.js", "power.css", "projects.js", "projects.css", "output_history.js", "output_history.css"):
        raise HTTPException(404, "Not found")
    return FileResponse(APP_DIR / "static" / path)


@app.get("/api/health")
def health():
    return {"ok":True,"app":"MABRIG StatLab","version":"0.9.0", "local_only":True}


@app.get("/api/capabilities")
def capabilities():
    """Truthful local-Python capability boundary; no datasets or secrets in payload."""
    return {
        "app": "MABRIG StatLab",
        "environment": "local-fastapi",
        "version": "0.9.0",
        "browser_cloudflare_is_separate": True,
        "features": {
            "data_import": ["CSV", "TSV", "XLSX", "SAV"],
            "case_level": ["descriptives", "correlations", "regression",
                           "crosstabs", "cronbach_alpha", "t_tests", "anova"],
            "aggregate_only": ["frequency_descriptives", "chapter_four_reports"],
            "study_design": ["a_priori_sample_size_power_planning"],
            "pharmaceutical_browser": ["linear_calibration", "assay_repeatability",
                                       "observed_exposure", "dissolution_efficiency", "two_factor_formulation"],
            "dimensionality": [
                "exploratory_principal_axis_factor_analysis",
                "horn_style_pearson_component_parallel_analysis",
                "oblique_quartimin_pattern_structure_and_factor_correlations",
            ],
        },
        "unavailable": ["confirmatory_factor_analysis", "polychoric_factor_analysis",
                        "advanced_power_analysis", "desktop_package",
                        "multi_device_encrypted_sync", "public_multiuser_auth"],
        "privacy": {
            "no_mandatory_cloud_database": True,
            "uploaded_dataset_sessions_expire": True,
            "do_not_expose_unprotected_api_publicly": True,
        },
        "integrity": {
            "frequency_only_never_reconstructs_cases": True,
            "statistics_require_observed_inputs": True,
            "browser_worker_does_not_host_python_engine": True,
        },
    }


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)):
    cleanup()
    if len(sessions) >= MAX_SESSIONS:
        raise HTTPException(429, "Too many active datasets. Delete an existing dataset or retry in an hour.")
    filename = os.path.basename(file.filename or "dataset.csv")
    if not filename.lower().endswith((".csv",".tsv",".xlsx",".sav")):
        raise HTTPException(400, "File extension must be CSV, TSV, XLSX or SAV.")
    raw = await file.read(MAX_FILE_SIZE + 1)
    await file.close()
    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(413,"File exceeds 12 MB limit.")
    try:
        df, sav_meta = parse_document(filename,raw)
    except AnalysisError as exc:
        raise HTTPException(400, str(exc)) from exc
    identifier=secrets.token_urlsafe(28)
    record={"id":identifier, "filename":filename, "sha256":hashlib.sha256(raw).hexdigest(),
            "frame":df,"variables":init_variables(df, sav_meta),"revision":0,"created":time.monotonic(),
            "undo_stack": [], "redo_stack": []}
    sessions[identifier]=record
    return dataset_info(record)


@app.post("/api/datasets/blank")
def new_blank_dataset(request: NewDatasetRequest):
    cleanup()
    if len(sessions) >= MAX_SESSIONS:
        raise HTTPException(429, "Too many active datasets. Clear an existing dataset first.")
    if not 1 <= len(request.filename.strip()) <= 80 or not re.fullmatch(r"[\w .-]+", request.filename.strip()):
        raise HTTPException(422, "Dataset name must be 1–80 letters, digits, spaces, periods, dashes or underscores.")
    if not NAME_PATTERN.fullmatch(request.variable):
        raise HTTPException(422, "First variable must be a valid name (letters, digits, underscore; not starting with a number).")
    if request.type not in {"numeric", "string", "date"}:
        raise HTTPException(422, "Choose numeric, string or date variable type.")
    if not 1 <= request.rows <= 100:
        raise HTTPException(422, "Start with 1–100 cases; add more from Data View.")
    # Distinct names and metadata are created just as on a file import.
    if request.type == "numeric":
        series = pd.Series([np.nan] * request.rows, dtype="float64")
    elif request.type == "date":
        series = pd.Series([pd.NaT] * request.rows, dtype="datetime64[ns]")
    else:
        series = pd.Series([pd.NA] * request.rows, dtype="string")
    frame = pd.DataFrame({request.variable: series})
    raw = frame.to_csv(index=False).encode("utf-8")
    filename = request.filename.strip()
    if not filename.lower().endswith(".csv"):
        filename += ".csv"
    identifier = secrets.token_urlsafe(28)
    record = {"id": identifier, "filename": filename, "sha256": hashlib.sha256(raw).hexdigest(),
              "frame": frame, "variables": init_variables(frame), "revision": 0,
              "created": time.monotonic(), "undo_stack": [], "redo_stack": []}
    sessions[identifier] = record
    return dataset_info(record)


# Project backup is explicit. This endpoint is only for a local, private server.
# Browser project files must NOT be uploaded to a publicly exposed service without
# authentication and tenant-isolated storage.
SNAPSHOT_SCHEMA = "mabrig-statlab-dataset-snapshot-v1"
MAX_SNAPSHOT_ROWS = 10000
MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024


class DatasetSnapshotRequest(BaseModel):
    model_config = {"extra": "forbid"}
    schema_name: Literal["mabrig-statlab-dataset-snapshot-v1"] = Field(alias="schema")
    filename: str = Field(min_length=1, max_length=200)
    variables: list[dict] = Field(min_length=1, max_length=MAX_COLUMNS)
    observations: list[list] = Field(max_length=MAX_SNAPSHOT_ROWS)
    source_sha256: str | None = None


@app.get("/api/datasets/{dataset_id}/snapshot")
def export_dataset_snapshot(dataset_id: str):
    """Back up case values and their editable Variable View definitions together."""
    info = dataset_for(dataset_id)
    frame = info["frame"]
    if len(frame) > MAX_SNAPSHOT_ROWS:
        raise HTTPException(413, f"Project backup supports up to {MAX_SNAPSHOT_ROWS:,} rows. Export CSV and the variable dictionary separately.")
    result = {
        "schema": SNAPSHOT_SCHEMA,
        "filename": info["filename"],
        "source_sha256": info["sha256"],
        "variables": [variable_summary(info, name) for name in frame.columns],
        "observations": [[sanitize_value(value) for value in row]
                         for row in frame.itertuples(index=False, name=None)],
    }
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Dataset is too large for a portable StatLab project backup. Export CSV and dictionary separately.")
    return result


@app.post("/api/datasets/from-snapshot")
def import_dataset_snapshot(request: DatasetSnapshotRequest):
    """Rebuild an opted-in local dataset from a portable backup, without guessing missing rows."""
    cleanup()
    if len(sessions) >= MAX_SESSIONS:
        raise HTTPException(429, "Too many active datasets. Clear a dataset and retry.")
    payload = request.model_dump(by_alias=True)
    if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Project dataset exceeds the 12 MB safety limit.")
    names = [var.get("name") if isinstance(var, dict) else None for var in request.variables]
    if any(not isinstance(name, str) or not NAME_PATTERN.fullmatch(name) for name in names):
        raise HTTPException(422, "Snapshot contains an invalid variable name.")
    if len({name.lower() for name in names}) != len(names):
        raise HTTPException(422, "Snapshot variable names must be unique.")
    if any(not isinstance(row, list) or len(row) != len(names) for row in request.observations):
        raise HTTPException(422, "Every stored case must contain exactly one value per variable.")
    try:
        # Only the stored, explicitly provided values are used. No case synthesis.
        columns = {}
        for index, variable in enumerate(request.variables):
            kind = variable.get("type")
            values = [row[index] for row in request.observations]
            if any(value is not None and (isinstance(value, (bool, list, dict)) or
                   not isinstance(value, (str, int, float)) or
                   (isinstance(value, float) and not np.isfinite(value))) for value in values):
                raise VariableError("Invalid value type in a stored case.")
            if kind == "numeric":
                series = pd.to_numeric(pd.Series(values, dtype="object"), errors="raise")
            elif kind == "date":
                series = pd.to_datetime(pd.Series(values, dtype="object"), errors="raise", format="ISO8601")
            elif kind == "string":
                series = pd.Series(values, dtype="string")
            else:
                raise VariableError("Stored variable type must be numeric, string or date.")
            columns[names[index]] = series
        frame = pd.DataFrame(columns)
        info = {"frame": frame, "variables": init_variables(frame), "revision": 0}
        apply_dictionary(info, {"schema":"mabrig-statlab-variable-dictionary-v1", "variables": request.variables})
    except (ValueError, TypeError, OverflowError, VariableError) as exc:
        raise HTTPException(422, f"Project data or variable definitions invalid: {str(exc)[:250]}") from exc
    filename = os.path.basename(request.filename.strip())
    if not filename or filename != request.filename.strip():
        raise HTTPException(422, "Invalid dataset file name.")
    identifier = secrets.token_urlsafe(28)
    # This digest identifies restored content, not the original uploaded file.
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    record = {"id": identifier, "filename": filename, "sha256": digest,
              "frame": frame, "variables": info["variables"], "revision": 0,
              "created": time.monotonic(), "undo_stack": [], "redo_stack": []}
    sessions[identifier] = record
    return dataset_info(record)


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    return dataset_info(dataset_for(dataset_id))




@app.get("/api/datasets/{dataset_id}/rows")
def get_rows(dataset_id: str, offset: int = 0, limit: int = 50, query: str = "",
             column: str = "", operator: str = "contains", sort: str = "",
             descending: bool = False):
    try:
        return rows_page(dataset_for(dataset_id), offset, limit, query, column, operator, sort, descending)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.patch("/api/datasets/{dataset_id}/rows/cells")
def patch_cells(dataset_id: str, request: CellBatchRequest):
    info = dataset_for(dataset_id)
    try:
        set_cells(info, [edit.model_dump() for edit in request.edits], request.revision)
        return dataset_info(info)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/rows/paste")
def paste_cases(dataset_id: str, request: PasteRequest):
    info = dataset_for(dataset_id)
    try:
        paste_matrix(info, request.row, request.column, request.values, request.revision)
        return dataset_info(info)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/rows")
def create_cases(dataset_id: str, request: AddCasesRequest):
    info = dataset_for(dataset_id)
    try:
        add_cases(info, request.count, request.revision)
        return dataset_info(info)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/rows/delete")
def remove_cases(dataset_id: str, request: DeleteCasesRequest):
    info = dataset_for(dataset_id)
    try:
        delete_cases(info, request.indexes, request.revision)
        return dataset_info(info)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/history/{direction}")
def change_history(dataset_id: str, direction: str, request: HistoryStepRequest):
    if direction not in ("undo", "redo"):
        raise HTTPException(404, "Unknown operation.")
    info = dataset_for(dataset_id)
    try:
        step_history(info, direction == "undo", request.revision)
        return dataset_info(info)
    except DataError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/variables")
def add_variable(dataset_id: str, request: NewVariableRequest):
    info = dataset_for(dataset_id)
    try:
        create_variable(info, request.name, request.type, request.model_dump(exclude_unset=True))
        history_reset(info)
        return dataset_info(info)
    except VariableError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.put("/api/datasets/{dataset_id}/variables/order")
def update_variable_order(dataset_id: str, request: ReorderVariablesRequest):
    info = dataset_for(dataset_id)
    try:
        reorder_variables(info, request.order)
        history_reset(info)
        return dataset_info(info)
    except VariableError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/datasets/{dataset_id}/variables/{variable_name}")
def remove_variable(dataset_id: str, variable_name: str):
    info = dataset_for(dataset_id)
    try:
        delete_variable(info, variable_name)
        history_reset(info)
        return dataset_info(info)
    except VariableError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.patch("/api/datasets/{dataset_id}/variables/{variable_name}")
def update_variable(dataset_id: str, variable_name: str, request: VariablePatchRequest):
    info = dataset_for(dataset_id)
    try:
        patch = request.model_dump(exclude_unset=True)
        # Pydantic's optional fields are nullable to permit missing_range
        # clearing. Other fields may never be explicitly set to null.
        for key, value in patch.items():
            if value is None and key != "missing_range":
                raise VariableError(f"{key} cannot be null.")
        apply_edit(info, variable_name, patch)
        history_reset(info)
        return dataset_info(info)
    except VariableError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/datasets/{dataset_id}/dictionary.json")
def export_dictionary(dataset_id: str):
    info = dataset_for(dataset_id)
    return {"schema": "mabrig-statlab-variable-dictionary-v1",
            "filename": info["filename"], "source_sha256": info["sha256"],
            "revision": info.get("revision", 0), "rows": len(info["frame"]),
            "variables": [variable_summary(info, name) for name in info["frame"].columns],
            "note": "User-defined missing codes are excluded from analysis, but preserved in raw CSV exports."}


@app.post("/api/datasets/{dataset_id}/dictionary")
def import_dictionary(dataset_id: str, request: ImportDictionaryRequest):
    info = dataset_for(dataset_id)
    try:
        apply_dictionary(info, request.model_dump(by_alias=True))
        history_reset(info)
        return dataset_info(info)
    except VariableError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    dataset_for(dataset_id)
    del sessions[dataset_id]
    return {"deleted":True}


@app.post("/api/analyze")
def analyze_dataset(request:AnalysisRequest):
    data=dataset_for(request.dataset_id)
    try:
        outcome=analyze(analysis_frame(data),request.model_dump(),
                        {col: variable_summary(data, col) for col in data["frame"].columns})
        annotate_output(outcome, data, request.model_dump())
        if request.analysis == "questionnaire":
            selected = dict.fromkeys(item for obj in request.objectives for item in obj.items)
            outcome["variable_definitions"] = [
                {"name": name, "label": data["variables"][name]["label"],
                 "measure": data["variables"][name]["measure"],
                 "role": data["variables"][name]["role"],
                 "user_missing_codes": data["variables"][name]["missing_values"],
                 "missing_range": data["variables"][name]["missing_range"]}
                for name in selected if name in data["variables"]]
        outcome["provenance"]={"file":data["filename"],"sha256":data["sha256"],"rows":len(data["frame"]),
                               "analyzed_at_utc":pd.Timestamp.now(tz="UTC").isoformat(),
                               "variable_revision":data.get("revision",0),
                               "data_revision":data.get("revision",0), "sha256_is_original_upload": True,
                               "user_missing_excluded":True}
        return outcome
    except AnalysisError as exc:
        raise HTTPException(422,str(exc)) from exc
    except (ValueError,TypeError,ZeroDivisionError,np.linalg.LinAlgError) as exc:
        raise HTTPException(422,f"Analysis could not be completed: {str(exc)[:180]}") from exc


@app.get("/api/datasets/{dataset_id}/download.csv")
def download_csv(dataset_id: str):
    info=dataset_for(dataset_id)
    df=info["frame"].copy()
    # Protect users opening exported CSV in spreadsheet programs from formula injection.
    def escaped(v):
        if isinstance(v,str) and re.match(r"^\s*[=+@-]",v):
            return "'"+v
        return v
    for col in df.select_dtypes(include=["object","string"]).columns:
        df[col]=df[col].map(escaped)
    buf=io.StringIO();df.to_csv(buf,index=False)
    return StreamingResponse(iter([buf.getvalue()]),media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition":"attachment; filename=statlab-export.csv"})
