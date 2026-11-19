"""Regression, validation and API checks for local-only ARIMA.

Synthetic observations here are fixed-fixture test inputs, not published empirical data.
"""
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.advanced_timeseries import arima_forecast
from app.main import app, sessions
from app.stats_engine import AnalysisError


def observed_fixture(n=108):
    rng = np.random.default_rng(20261119)
    values = [10.0]
    for err in rng.normal(0.0, 0.7, size=n-1):
        values.append(4.0 + 0.6 * values[-1] + err)
    return pd.DataFrame({"period": range(n), "value": values})


def test_arima_uses_real_contiguous_holdout_and_produces_intervals():
    data = observed_fixture()
    response = arima_forecast(data, "value", p=1, d=0, q=0, steps=3)
    assert response["title"].startswith("ARIMA(1,0,0)")
    summary, metrics, forecasts, diagnostic = response["tables"]
    assert summary["rows"][0][0] == len(data)
    holdout = summary["rows"][0][2]
    assert 8 <= holdout <= 24
    assert len(forecasts["rows"]) == 3
    assert [row[0] for row in forecasts["rows"]] == ["T+1", "T+2", "T+3"]
    for _, mean, low, high in forecasts["rows"]:
        assert low <= mean <= high
        assert all(np.isfinite([mean, low, high]))
    y = data["value"].to_numpy()
    naive_reference = round(float(np.mean(np.abs(y[-holdout:] - y[-holdout-1]))), 4)
    assert metrics["rows"][1][0] == "Naive last observed value"
    assert metrics["rows"][1][1] == pytest.approx(naive_reference, abs=1e-4)
    assert diagnostic["rows"][0][0] == "Ljung–Box"
    assert response["chart"]["type"] == "bar"
    assert "holdout" in response["method"]


@pytest.mark.parametrize("frame,column,options", [
    (observed_fixture(45), "value", {}),
    (pd.DataFrame({"value": [3.0] * 100}), "value", {}),
    (observed_fixture(), "unknown", {}),
    (observed_fixture(), "value", {"p": 3}),
    (observed_fixture(), "value", {"p": 2, "q": 2}),
    (observed_fixture(), "value", {"steps": 13}),
])
def test_arima_rejects_invalid_inputs(frame, column, options):
    with pytest.raises(AnalysisError):
        arima_forecast(frame, column, **options)


def test_arima_does_not_discard_missing_time_periods():
    frame = observed_fixture()
    frame.loc[20, "value"] = np.nan
    with pytest.raises(AnalysisError, match="missing/text"):
        arima_forecast(frame, "value")


def test_arima_endpoint_and_capability_are_local_only():
    sessions.clear()
    client = TestClient(app)
    try:
        frame = observed_fixture()
        uploaded = client.post("/api/datasets", files={"file": ("series.csv", io.BytesIO(frame.to_csv(index=False).encode("utf-8")), "text/csv")})
        assert uploaded.status_code == 200, uploaded.text
        dataset_id = uploaded.json()["dataset_id"]
        payload = {"dataset_id": dataset_id, "analysis": "arima", "a": "value",
                   "arima_p": 1, "arima_d": 0, "arima_q": 0, "forecast_steps": 4}
        response = client.post("/api/analyze", json=payload)
        assert response.status_code == 200, response.text
        assert len(response.json()["tables"][2]["rows"]) == 4
        assert response.json()["provenance"]["file"] == "series.csv"
        assert client.post("/api/analyze", json={**payload, "arima_p": 9}).status_code == 422
        capabilities = client.get("/api/capabilities").json()
        assert "local_only_arima_manual_order_with_contiguous_holdout" in capabilities["features"]["time_series"]
        assert capabilities["browser_cloudflare_is_separate"] is True
    finally:
        sessions.clear()
