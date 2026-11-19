"""Tests for the independently implemented local GARCH(1,1) teaching workflow."""
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.garch_volatility import _prepare, garch_volatility
from app.main import app, sessions
from app.stats_engine import AnalysisError


def synthetic_garch_returns(n=380):
    # Explicitly simulated test fixture, not published market prices or UNN data.
    rng = np.random.default_rng(20261119)
    variances = np.empty(n)
    errors = np.empty(n)
    variances[0] = 1.2
    errors[0] = np.sqrt(variances[0]) * rng.normal()
    for i in range(1, n):
        variances[i] = 0.10 + 0.12 * errors[i-1] ** 2 + 0.78 * variances[i-1]
        errors[i] = np.sqrt(variances[i]) * rng.normal()
    return errors + 0.1


def synthetic_prices(n=380):
    ret = synthetic_garch_returns(n)
    return pd.DataFrame({"date": pd.date_range("2024-01-01", periods=n, freq="D").astype(str),
                         "price": 80 * np.exp(np.cumsum(ret / 100.0))})


def test_price_log_return_transformation_is_numerically_exact():
    prices = pd.DataFrame({"price": [100.0, 102.0] * 75})
    returns, description = _prepare(prices, "price", "prices")
    expected = 100 * np.diff(np.log(prices["price"].to_numpy()))
    assert returns == pytest.approx(expected)
    assert "log returns" in description


def test_decimal_and_percent_return_units_are_not_confused():
    vals = synthetic_garch_returns()
    a, _ = _prepare(pd.DataFrame({"r": vals}), "r", "returns_percent")
    b, _ = _prepare(pd.DataFrame({"r": vals / 100}), "r", "returns_decimal")
    assert a == pytest.approx(b)


def test_garch_reports_actual_holdout_and_positive_volatility():
    data = synthetic_prices()
    r = garch_volatility(data, "price", input_type="prices", steps=3)
    assert "GARCH(1,1)" in r["title"]
    inputs, params, score, future, diagnostic = r["tables"]
    assert inputs["rows"][0][0] == 380
    assert inputs["rows"][0][1] == 379
    assert inputs["rows"][0][2] + inputs["rows"][0][3] == 379
    assert score["rows"][0][0] == "GARCH(1,1)"
    assert score["rows"][1][0] == "Historical training variance"
    assert len(future["rows"]) == 3
    assert [v[0] for v in future["rows"]] == ["T+1", "T+2", "T+3"]
    for _, variance, sigma in future["rows"]:
        assert variance > 0
        assert sigma == pytest.approx(np.sqrt(variance), abs=0.000002)
    assert params["rows"][-1][0] == "alpha + beta"
    assert diagnostic["rows"][0][0] == "ARCH-LM on standardized residuals"
    assert "not future returns" in r["chart"]["note"]


@pytest.mark.parametrize("series,column,kind", [
    (pd.DataFrame({"price": np.ones(180)}), "price", "prices"),
    (pd.DataFrame({"price": np.arange(1, 120)}), "price", "prices"),
    (pd.DataFrame({"price": [-1.0] + list(np.arange(1, 180))}), "price", "prices"),
    (pd.DataFrame({"price": [np.nan] + list(np.arange(1, 180))}), "price", "prices"),
    (pd.DataFrame({"returns": [0.1] * 170}), "returns", "returns_percent"),
    (pd.DataFrame({"returns": [0.001] * 170}), "unknown", "returns_decimal"),
    (pd.DataFrame({"returns": [2.1] + [0.001] * 179}), "returns", "returns_decimal"),
])
def test_garch_rejects_invalid_or_unsafe_inputs(series, column, kind):
    with pytest.raises(AnalysisError):
        garch_volatility(series, column, input_type=kind)


def test_local_api_garch_and_capabilities():
    sessions.clear()
    client = TestClient(app)
    try:
        sample = synthetic_prices()
        r = client.post("/api/datasets", files={
            "file": ("SYNTHETIC_prices.csv", io.BytesIO(sample.to_csv(index=False).encode()), "text/csv"),
        })
        assert r.status_code == 200, r.text
        dataset_id = r.json()["dataset_id"]
        payload = {"dataset_id": dataset_id, "analysis": "garch", "a": "price",
                   "garch_input_type": "prices", "forecast_steps": 3}
        a = client.post("/api/analyze", json=payload)
        assert a.status_code == 200, a.text
        body = a.json()
        assert body["title"].startswith("GARCH(1,1)")
        assert body["provenance"]["file"] == "SYNTHETIC_prices.csv"
        assert len(body["tables"][3]["rows"]) == 3
        assert client.post("/api/analyze", json={**payload, "garch_input_type": "auto"}).status_code == 422
        caps = client.get("/api/capabilities").json()
        assert "local_only_garch_volatility_with_contiguous_holdout" in caps["features"]["time_series"]
        assert caps["browser_cloudflare_is_separate"] is True
    finally:
        sessions.clear()
