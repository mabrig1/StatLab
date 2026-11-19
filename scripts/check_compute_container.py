"""Exercise a running, localhost-bound private *container* HTTP service.

Requires STATLAB_COMPUTE_SHARED_TOKEN (a fresh test-only token) and two synthetic
CSV files checked into this repository. Uses Python's standard library only.
This script never calls Cloudflare, uploads research data or provisions services.
"""
from __future__ import annotations

import csv
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8090"
TOKEN = os.environ.get("STATLAB_COMPUTE_SHARED_TOKEN", "")


def values(path: str, variable: str):
    with (ROOT / "samples" / path).open(newline="", encoding="utf-8") as f:
        return [float(row[variable]) for row in csv.DictReader(f)]


def call(method: str, path: str, *, payload=None, token: str | None = None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(URL + path, method=method, data=body, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8"))


def main():
    if len(TOKEN) < 32:
        raise RuntimeError("Supply a unique test-only token (32+ chars).")
    for attempt in range(100):
        try:
            status, health = call("GET", "/health")
            if status == 200 and health.get("service") == "statlab-private-compute":
                break
        except (OSError, ValueError):
            time.sleep(0.25)
    else:
        raise RuntimeError("Container service did not become healthy.")

    assert call("GET", "/api/datasets")[0] == 404
    assert call("GET", "/docs")[0] == 404
    assert call("GET", "/openapi.json")[0] == 404

    arima = {"mode": "arima", "values": values("SYNTHETIC_arima_monthly_demo.csv", "value"),
             "p": 1, "d": 0, "q": 0, "steps": 3}
    assert call("POST", "/internal/compute", payload=arima)[0] == 401
    assert call("POST", "/internal/compute", payload=arima, token="invalid")[0] == 401
    status, arima_result = call("POST", "/internal/compute", payload=arima, token=TOKEN)
    assert status == 200, f"ARIMA container response code {status}"
    assert arima_result["title"].startswith("ARIMA(1,0,0)")
    assert arima_result["n_submitted"] == 96
    assert len(arima_result["tables"][2]["rows"]) == 3
    print("Container HTTP ARIMA: PASS (96 synthetic months)")

    garch = {"mode": "garch",
             "values": values("SYNTHETIC_garch_daily_prices.csv", "price"),
             "input_type": "prices", "steps": 3}
    status, garch_result = call("POST", "/internal/compute", payload=garch, token=TOKEN)
    assert status == 200, f"GARCH container response code {status}"
    assert garch_result["title"].startswith("GARCH(1,1)")
    assert garch_result["n_submitted"] == 320
    assert len(garch_result["tables"][3]["rows"]) == 3
    print("Container HTTP GARCH: PASS (320 synthetic daily prices)")
    print("Container authentication and route isolation: PASS")


if __name__ == "__main__":
    main()
