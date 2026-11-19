"""Dedicated, stateless advanced-compute service for *trusted* Cloudflare proxy.

Launch with: uvicorn app.compute_service:app --host 127.0.0.1 --port 8090
Do NOT host app.main:app publicly; it intentionally has unauthenticated sessions.
Use HTTPS/Tunnel, network isolation, a random service secret, and Cloudflare Access.
"""
from __future__ import annotations

import hmac
import os
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .advanced_timeseries import arima_forecast
from .garch_volatility import garch_volatility
from .stats_engine import AnalysisError

app = FastAPI(title="StatLab private compute service", docs_url=None,
              redoc_url=None, openapi_url=None, version="0.1.0")


class ComputeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["arima", "garch"]
    values: list[float] = Field(min_length=50, max_length=2500)
    steps: int = Field(ge=1, le=12)
    p: int = Field(default=0, ge=0, le=2)
    d: int = Field(default=0, ge=0, le=1)
    q: int = Field(default=0, ge=0, le=2)
    input_type: Literal["prices", "returns_percent", "returns_decimal"] = "prices"


def _authorize(authorization: str | None) -> None:
    secret = os.getenv("STATLAB_COMPUTE_SHARED_TOKEN", "")
    if len(secret) < 32:
        raise HTTPException(503, "Private compute token is not configured.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Private compute authorization is required.")
    supplied = authorization[len("Bearer "):]
    if not hmac.compare_digest(supplied, secret):
        raise HTTPException(401, "Private compute authorization is required.")


@app.get("/health")
def health():
    return {"ok": True, "service": "statlab-private-compute", "public_data_uploads": False}


@app.post("/internal/compute")
def compute(request: ComputeRequest, authorization: str | None = Header(default=None)):
    _authorize(authorization)
    if request.mode == "arima":
        if len(request.values) > 1200 or request.p + request.q > 3:
            raise HTTPException(422, "This guarded ARIMA workflow supports at most 1200 rows and p+q at most 3.")
    elif len(request.values) < 150:
        raise HTTPException(422, "GARCH requires at least 150 observations.")
    values = np.asarray(request.values, dtype=float)
    if not np.isfinite(values).all():
        raise HTTPException(422, "Observations must all be finite.")
    df = pd.DataFrame({"value": values})
    try:
        if request.mode == "arima":
            answer = arima_forecast(df, "value", p=request.p, d=request.d,
                                    q=request.q, steps=request.steps)
        else:
            answer = garch_volatility(df, "value", input_type=request.input_type,
                                      steps=request.steps)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)[:240]) from exc
    # No dataset ID, user identifiers, project storage or output history on server.
    answer["input_type"] = "numeric_series_user_submitted"
    answer["n_submitted"] = len(request.values)
    return answer
