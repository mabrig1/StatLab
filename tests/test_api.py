import io
import pytest
from fastapi.testclient import TestClient
from app.main import app, sessions

client=TestClient(app)


@pytest.fixture(autouse=True)
def clear_sessions():
    sessions.clear()
    yield
    sessions.clear()


def upload(data:bytes=b"score,other,group\n1,2,A\n2,3,A\n3,5,B\n4,7,B\n5,8,A\n",filename="survey.csv"):
    return client.post("/api/datasets",files={"file":(filename,io.BytesIO(data))})


def test_local_home_and_health():
    page=client.get("/")
    assert page.status_code==200
    assert "MABRIG StatLab" in page.text
    health=client.get("/api/health")
    assert health.json()["local_only"] is True
    assert client.get("/static/app.js").status_code==200
    assert client.get("/static/../../app/main.py").status_code==404


def test_upload_analyze_export_delete():
    r=upload()
    assert r.status_code==200,r.text
    d=r.json();assert d["rows"]==5 and d["columns"]==3
    dataset=d["dataset_id"]
    a=client.post('/api/analyze',json={"dataset_id":dataset,"analysis":"descriptives","columns":["score"]})
    assert a.status_code==200,a.text
    assert a.json()["tables"][0]["rows"][0][3]==3
    csv=client.get(f'/api/datasets/{dataset}/download.csv')
    assert csv.status_code==200 and b'score,other,group' in csv.content
    assert client.delete(f'/api/datasets/{dataset}').json()=={"deleted":True}
    assert client.get(f'/api/datasets/{dataset}').status_code==404


def test_fails_closed_unknown_columns():
    r=upload();dataset=r.json()["dataset_id"]
    result=client.post('/api/analyze',json={"dataset_id":dataset,"analysis":"descriptives","columns":["unknown"]})
    assert result.status_code==422


def test_limits_and_bad_data():
    assert upload(b"file\nvalue", "danger.exe").status_code==400
    assert upload(b"", "empty.csv").status_code==400
    assert upload(b"a,a\n1,2\n", "duplicate.csv").status_code==400
    assert upload(b'a\n' + b'1\n'*160000).status_code==400


def test_avoid_csv_formula_injection():
    r=upload(b'entry,score\n=1+2,1\nnormal,2\n')
    id=r.json()['dataset_id']
    csv=client.get(f'/api/datasets/{id}/download.csv').text
    assert "'=1+2" in csv


def test_missing_sav_support_message_or_parser():
    r=upload(b'not-a-real-sav',"sample.sav")
    assert r.status_code==400
    assert "pyreadstat" in r.text or "parse" in r.text


def test_capabilities_separate_local_python_from_cloudflare_and_future():
    r = client.get("/api/capabilities")
    assert r.status_code == 200
    payload = r.json()
    assert payload["environment"] == "local-fastapi"
    assert payload["browser_cloudflare_is_separate"] is True
    assert "correlations" in payload["features"]["case_level"]
    assert "factor_analysis" in payload["unavailable"]
    assert "power_analysis" in payload["unavailable"]
    assert "desktop_package" in payload["unavailable"]
    assert payload["integrity"]["frequency_only_never_reconstructs_cases"] is True
    assert payload["integrity"]["browser_worker_does_not_host_python_engine"] is True
    assert "dataset_id" not in payload
    assert "secret" not in str(payload).lower()
