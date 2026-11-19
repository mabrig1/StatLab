"""Execute actual private FastAPI ARIMA/GARCH HTTP requests on localhost only.

Starts a temporary 127.0.0.1 Uvicorn child; uses synthetic repository samples.
No Cloudflare access, user files, external URLs, secrets or production deployment.
"""
from __future__ import annotations

import csv
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARIMA = ROOT / "samples" / "SYNTHETIC_arima_monthly_demo.csv"
GARCH = ROOT / "samples" / "SYNTHETIC_garch_daily_prices.csv"


def values(path: Path, name: str) -> list[float]:
    with path.open(newline="", encoding="utf-8") as source:
        return [float(r[name]) for r in csv.DictReader(source)]


def call(base: str, method: str, path: str, *, token: str = "", payload: dict | None = None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=25) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8"))


def main() -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    token = secrets.token_urlsafe(48)
    env = dict(os.environ, STATLAB_COMPUTE_SHARED_TOKEN=token)
    child = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.compute_service:app",
         "--host", "127.0.0.1", "--port", str(port), "--workers", "1"],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(60):
            if child.poll() is not None:
                raise RuntimeError("Private Python service exited during smoke-test startup.")
            try:
                code, health = call(url, "GET", "/health")
                if code == 200:
                    assert health["service"] == "statlab-private-compute"
                    break
            except (OSError, ValueError):
                time.sleep(0.2)
        else:
            raise RuntimeError("Private Python service did not become healthy.")
        assert call(url, "GET", "/api/datasets")[0] == 404
        assert call(url, "GET", "/docs")[0] == 404
        assert call(url, "GET", "/openapi.json")[0] == 404

        series = values(ARIMA, "value")
        arima = {"mode": "arima", "values": series, "steps": 3, "p": 1, "d": 0, "q": 0}
        assert call(url, "POST", "/internal/compute", payload=arima)[0] == 401
        assert call(url, "POST", "/internal/compute", token="invalid-token", payload=arima)[0] == 401
        code, forecast = call(url, "POST", "/internal/compute", token=token, payload=arima)
        assert code == 200, f"ARIMA HTTP status: {code}"
        assert "ARIMA" in forecast["title"]
        assert forecast["n_submitted"] == len(series)
        assert len(forecast["tables"][2]["rows"]) == 3
        print(f"ARIMA local HTTP smoke: PASS ({len(series)} synthetic periods; 3-step forecast)")

        prices = values(GARCH, "price")
        garch = {"mode": "garch", "values": prices, "steps": 3, "input_type": "prices"}
        code, risk = call(url, "POST", "/internal/compute", token=token, payload=garch)
        assert code == 200, f"GARCH HTTP status: {code}"
        assert "GARCH" in risk["title"]
        assert risk["n_submitted"] == len(prices)
        assert len(risk["tables"][3]["rows"]) == 3
        print(f"GARCH local HTTP smoke: PASS ({len(prices)} synthetic prices; 3-step forecast)")
        print("Security: unauthorized requests rejected and dataset/docs endpoints unavailable")
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


if __name__ == "__main__":
    main()
