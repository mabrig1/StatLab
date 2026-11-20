import os

import numpy as np
from fastapi.testclient import TestClient

from app.compute_service import app

client = TestClient(app)
SECRET = "test-only-service-secret-with-more-than-32-chars"


def series_values(n=120):
    rng = np.random.default_rng(20261119)
    values = [10.0]
    for shock in rng.normal(0, 0.6, size=n - 1):
        values.append(4 + 0.6 * values[-1] + shock)
    return [float(x) for x in values]


def auth():
    return {"Authorization": "Bearer " + SECRET}


def test_dedicated_service_never_exposes_dataset_sessions(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    assert client.get("/health").status_code == 200
    assert client.get("/api/datasets").status_code == 404
    assert client.post("/api/datasets").status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_private_service_denies_missing_or_wrong_secret(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    data={"mode": "arima", "values": series_values(), "steps": 3, "p": 1, "d": 0, "q": 0}
    assert client.post("/internal/compute", json=data).status_code == 401
    assert client.post("/internal/compute", json=data, headers={"Authorization": "Bearer wrong"}).status_code == 401
    monkeypatch.delenv("STATLAB_COMPUTE_SHARED_TOKEN")
    assert client.post("/internal/compute", json=data, headers=auth()).status_code == 503


def test_private_arima_json_response_is_stateless(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    r=client.post("/internal/compute", headers=auth(),
                  json={"mode": "arima", "values": series_values(), "p": 1, "d": 0, "q": 0, "steps": 3})
    assert r.status_code == 200, r.text
    body=r.json()
    assert "ARIMA" in body["title"] and body["n_submitted"] == 120
    assert len(body["tables"][2]["rows"]) == 3
    assert "dataset_id" not in body
    assert body["input_type"] == "numeric_series_user_submitted"


def test_private_service_rejects_overbounds_and_extra_fields(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    payload={"mode": "arima", "values": series_values(), "steps": 3, "p": 1, "d": 0, "q": 0}
    assert client.post("/internal/compute", headers=auth(),json={**payload,"extra": "x"}).status_code == 422
    assert client.post("/internal/compute", headers=auth(),json={**payload,"p": 2,"q":2}).status_code == 422
    assert client.post("/internal/compute", headers=auth(),json={**payload,"values": [3.0]*2800}).status_code == 422


def test_private_garch_stateless_computation(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    rng=np.random.default_rng(12)
    errors=[];v=1.1;last=0.0
    for shock in rng.normal(size=330):
        v=0.13+0.15*last**2+0.7*v
        last=float(np.sqrt(v)*shock)
        errors.append(last+0.04)
    response=client.post("/internal/compute",headers=auth(),json={
        "mode": "garch", "values": errors, "steps": 3, "input_type": "returns_percent"
    })
    assert response.status_code == 200, response.text
    body=response.json()
    assert "GARCH" in body["title"] and body["n_submitted"] == 330
    assert len(body["tables"][3]["rows"]) == 3


def test_private_service_checks_auth_before_parsing_large_uploads(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    huge = b"x" * 65000
    blocked = client.post("/internal/compute", content=huge,
                          headers={"Content-Type": "application/json"})
    assert blocked.status_code == 401
    too_large = client.post("/internal/compute", content=huge,
                            headers={**auth(), "Content-Type": "application/json"})
    assert too_large.status_code == 413
    wrong_type = client.post("/internal/compute", content=b"plain text",
                             headers={**auth(), "Content-Type": "text/plain"})
    assert wrong_type.status_code == 415


def test_private_readiness_requires_backend_token(monkeypatch):
    monkeypatch.setenv("STATLAB_COMPUTE_SHARED_TOKEN", SECRET)
    assert client.get("/internal/ready").status_code == 401
    assert client.get("/internal/ready", headers={"Authorization": "Bearer wrong"}).status_code == 401
    ready = client.get("/internal/ready", headers=auth())
    assert ready.status_code == 200
    assert ready.json() == {
        "ok": True, "service": "statlab-private-compute",
        "models": ["arima", "garch"],
    }
    monkeypatch.delenv("STATLAB_COMPUTE_SHARED_TOKEN")
    assert client.get("/internal/ready", headers=auth()).status_code == 503
