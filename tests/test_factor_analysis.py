"""EFA regression fixtures: simulated known two-factor construct, integrity failures.

The synthetic fixture is only a test of implementation—not real field evidence
and not a guaranteed factor interpretation for a research dataset.
"""
from __future__ import annotations

import io
import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy import stats
from statsmodels.multivariate.factor import Factor

from app.factor_analysis import exploratory_factor, correlation_factorability
from app.stats_engine import AnalysisError, analyze
from app.main import app, sessions


@pytest.fixture()
def synthetic_two_factor():
    rng=np.random.default_rng(20261110)
    n=240
    latent=rng.normal(size=(n,2))
    true_weights=np.array([
        [.9,.8,.85,0,0,0],
        [0,0,0,.9,.8,.82]
    ])
    observations=latent @ true_weights + rng.normal(size=(n,6))*.45
    return pd.DataFrame(observations,columns=[f"Q{i}" for i in range(1,7)])


def test_factorability_against_independently_computed_kmo_and_bartlett(synthetic_two_factor):
    data=synthetic_two_factor.to_numpy()
    n,p=data.shape
    report=correlation_factorability(data)
    R=np.corrcoef(data,rowvar=False)
    inverse=np.linalg.inv(R)
    partial=-inverse/np.sqrt(np.outer(np.diag(inverse),np.diag(inverse)))
    np.fill_diagonal(partial,0)
    corr=R.copy()
    np.fill_diagonal(corr,0)
    kmo=(corr**2).sum()/((corr**2).sum()+(partial**2).sum())
    chi2=-(n-1-(2*p+5)/6)*np.log(np.linalg.det(R))
    assert report["kmo"]==pytest.approx(kmo,abs=1e-10)
    assert report["bartlett_chi2"]==pytest.approx(chi2,rel=1e-8)
    assert report["bartlett_df"]==15
    assert report["bartlett_p"]==pytest.approx(stats.chi2.sf(chi2,15),abs=1e-9)
    assert 0.65<report["kmo"]<1
    assert report["bartlett_p"]<.001
    np.testing.assert_allclose(report["eigenvalues"],np.linalg.eigvalsh(R)[::-1],atol=1e-10)


def test_principal_axes_loadings_agree_with_statsmodels_and_two_latent_clusters(synthetic_two_factor):
    frame=synthetic_two_factor
    columns=list(frame)
    output=exploratory_factor(frame,columns,n_factors=2,rotation="varimax")
    assert output["title"].startswith("Exploratory Factor Analysis")
    assert output["efa_metadata"]["complete_n"]==240
    assert output["efa_metadata"]["excluded_n"]==0
    assert output["efa_metadata"]["input_kind"]=="observed_case_rows"
    assert output["efa_metadata"]["manual_review_required"] is True
    assert len(output["tables"])==3
    assert output["chart"]["type"]=="bar"
    loading_table=output["tables"][2]
    assert loading_table["columns"][:3]==["Item","Factor 1","Factor 2"]
    assert len(loading_table["rows"])==6
    observed=np.array([[r[1],r[2]] for r in loading_table["rows"]],dtype=float)
    independent=Factor(frame.to_numpy(),n_factor=2,method="pa",smc=True,missing="raise").fit(
        maxiter=200,tol=1e-8
    )
    independent.rotate("varimax")
    np.testing.assert_allclose(np.abs(observed),np.abs(independent.loadings),atol=1.2e-4)
    dominant=np.argmax(np.abs(observed),axis=1)
    assert len(set(dominant[:3]))==1
    assert len(set(dominant[3:]))==1
    assert dominant[0]!=dominant[-1]
    assert np.min(np.max(np.abs(observed),axis=1))>.70
    assert "PCA" in " ".join(output["warnings"])


def test_complete_case_deletion_and_user_defined_missing_rules(synthetic_two_factor):
    frame=synthetic_two_factor.copy()
    frame.loc[0,"Q1"]=np.nan
    frame.loc[1,"Q2"]=np.nan
    frame.loc[2,"Q3"]=np.nan
    out=exploratory_factor(frame,list(frame),n_factors=2)
    assert out["efa_metadata"]["complete_n"]==237
    assert out["efa_metadata"]["excluded_n"]==3
    assert "237 complete" in out["narrative"]
    assert "3 excluded" in " ".join(out["warnings"])


def test_corrupt_text_non_numeric_and_nominal_types_rejected(synthetic_two_factor):
    frame=synthetic_two_factor.copy()
    frame.loc[0,"Q1"]="Unknown response"
    with pytest.raises(AnalysisError,match="non-numeric"):
        exploratory_factor(frame,list(frame))
    specs={name:{"type":"numeric","measure":"scale"} for name in synthetic_two_factor.columns}
    specs["Q1"]["measure"]="nominal"
    with pytest.raises(AnalysisError,match="marked nominal"):
        exploratory_factor(synthetic_two_factor,list(synthetic_two_factor),variable_specs=specs)
    specs["Q1"]["measure"]="ordinal"
    specs["Q1"]["type"]="string"
    with pytest.raises(AnalysisError,match="not numeric"):
        exploratory_factor(synthetic_two_factor,list(synthetic_two_factor),variable_specs=specs)


def test_near_singular_duplicate_and_constant_items_fail_closed(synthetic_two_factor):
    columns=list(synthetic_two_factor)
    duplicated=synthetic_two_factor.copy()
    duplicated["Q2"]=duplicated["Q1"]
    with pytest.raises(AnalysisError,match="singular|redundant"):
        exploratory_factor(duplicated,columns)
    constant=synthetic_two_factor.copy()
    constant["Q1"]=1
    with pytest.raises(AnalysisError,match="Constant|constant"):
        exploratory_factor(constant,columns)


@pytest.mark.parametrize("count,rotation",[
    (0,"varimax"),(7,"varimax"),(True,"varimax"),(2,"promax"),(2,"foo")
])
def test_reject_unsupported_factor_count_or_rotation(synthetic_two_factor,count,rotation):
    with pytest.raises(AnalysisError,match="Select an integer|rotation"):
        exploratory_factor(synthetic_two_factor,list(synthetic_two_factor),count,rotation)


def test_one_factor_does_not_fabricate_rotation(synthetic_two_factor):
    response=exploratory_factor(synthetic_two_factor,list(synthetic_two_factor),
                                n_factors=1,rotation="varimax")
    assert response["efa_metadata"]["rotation"]=="none"
    assert len(response["tables"][2]["columns"])==7
    assert any("one-factor" in w for w in response["warnings"])


def test_small_sample_and_fewer_than_four_items_rejected(synthetic_two_factor):
    with pytest.raises(AnalysisError,match="at least 50"):
        exploratory_factor(synthetic_two_factor.head(40),list(synthetic_two_factor))
    with pytest.raises(AnalysisError,match="at least 4"):
        exploratory_factor(synthetic_two_factor,["Q1","Q2","Q3"])
    with pytest.raises(AnalysisError,match="smaller than"):
        exploratory_factor(synthetic_two_factor,["Q1","Q2","Q3","Q4"],n_factors=4)


def test_low_kmo_random_independent_items_are_blocked():
    # Seeded, independent Gaussian items produce poor shared variance.
    independent=np.random.default_rng(7).normal(size=(200,5))
    columns=[f"X{i}" for i in range(5)]
    frame=pd.DataFrame(independent,columns=columns)
    check=correlation_factorability(independent)
    assert check["kmo"]<.5
    with pytest.raises(AnalysisError,match="below 0.50"):
        exploratory_factor(frame,columns,n_factors=2)


def test_efa_dispatch_uses_only_observed_case_rows(synthetic_two_factor):
    response=analyze(synthetic_two_factor,{"analysis":"efa","columns":list(synthetic_two_factor),
                           "factor_count":2,"factor_rotation":"varimax"})
    assert response["efa_metadata"]["complete_n"]==240
    assert "observed_case_rows"==response["efa_metadata"]["input_kind"]
    assert response["efa_metadata"]["is_confirmatory_factor_analysis"] is False


def test_api_efa_with_real_uploaded_complete_rows_and_statistical_provenance(synthetic_two_factor):
    client=TestClient(app)
    csv=synthetic_two_factor.to_csv(index=False).encode("utf-8")
    initial=client.post("/api/datasets",files={"file":("synthetic-test.csv",io.BytesIO(csv),"text/csv")})
    assert initial.status_code==200,initial.text
    dataset_id=initial.json()["dataset_id"]
    try:
        selected=list(synthetic_two_factor)
        r=client.post("/api/analyze",json={"dataset_id":dataset_id,"analysis":"efa","columns":selected,
                                           "factor_count":2,"factor_rotation":"varimax"})
        assert r.status_code==200,r.text
        body=r.json()
        assert body["efa_metadata"]["complete_n"]==240
        assert body["provenance"]["file"]=="synthetic-test.csv"
        assert body["provenance"]["rows"]==240
        assert body["efa_metadata"]["correlation"]=="pearson"
    finally:
        client.delete("/api/datasets/"+dataset_id)


def test_frequency_only_api_does_not_expose_case_level_factor_analysis():
    client=TestClient(app)
    before=len(sessions)
    payload={"items":{"Q1":{"1":4,"2":6,"3":10,"4":6,"5":4}},
             "scale_labels":{"1":"SD","2":"D","3":"N","4":"A","5":"SA"}}
    freq=client.post("/api/frequency-only/analyze",json=payload)
    assert freq.status_code==200,freq.text
    assert "efa_metadata" not in freq.text
    assert len(sessions)==before
    reject=client.post("/api/frequency-only/analyze",json={
        **payload,"analysis":"efa","factor_count":2})
    assert reject.status_code==422


def test_local_capability_and_user_interface_represent_proposed_method_correctly():
    client=TestClient(app)
    cap=client.get("/api/capabilities")
    assert cap.status_code==200
    value=cap.json()
    assert "exploratory_principal_axis_factor_analysis" in value["features"]["dimensionality"]
    assert "polychoric_factor_analysis" in value["unavailable"]
    assert "confirmatory_factor_analysis" in value["unavailable"]
    page=client.get("/")
    assert page.status_code==200
    assert 'data-mode="efa"' in page.text
    script=client.get("/static/app.js")
    assert script.status_code==200
    assert "efa-count" in script.text
    assert "efa-rotation" in script.text
