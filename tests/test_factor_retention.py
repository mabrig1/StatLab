"""Regression tests for Horn-style component retention and oblique EFA.

All research data in this file are deterministic SYNTHETIC test fixtures.
No actual respondents or published study statistics are implied.
"""
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from statsmodels.multivariate.factor import Factor

from app.factor_analysis import exploratory_factor
from app.factor_retention import parallel_analysis
from app.main import app
from app.stats_engine import AnalysisError


@pytest.fixture(scope="module")
def two_factor_cases():
    rng = np.random.default_rng(20261110)
    n = 240
    latent = rng.normal(size=(n, 2))
    weights = np.array([
        [.90, .80, .85, 0, 0, 0],
        [0, 0, 0, .90, .80, .82],
    ])
    cases = latent @ weights + rng.normal(size=(n, 6)) * .45
    return pd.DataFrame(cases, columns=[f"Q{i}" for i in range(1, 7)])


@pytest.fixture(scope="module")
def correlated_cases():
    rng = np.random.default_rng(456789)
    n = 320
    latent = rng.normal(size=(n, 2))
    latent[:, 1] = .62 * latent[:, 0] + np.sqrt(1 - .62**2) * latent[:, 1]
    weights = np.array([
        [.87, .83, .80, 0, 0, 0],
        [0, 0, 0, .88, .79, .82],
    ])
    return pd.DataFrame(latent @ weights + rng.normal(size=(n, 6)) * .46,
                        columns=[f"Q{i}" for i in range(1, 7)])


def test_parallel_analysis_uses_observed_cases_but_never_reconstructs_respondents(two_factor_cases):
    original = two_factor_cases.to_numpy().copy()
    result = parallel_analysis(original, simulations=100, seed=12345)
    assert result["leading_count"] == 2
    assert result["simulations"] == 100
    assert result["seed"] == 12345
    assert result["method"].startswith("Horn-style")
    assert "not an exact" in result["caution"]
    assert len(result["observed"]) == 6
    assert len(result["null_95"]) == 6
    assert result["exceeds_95"].tolist() == [True, True, False, False, False, False]
    np.testing.assert_array_equal(original, two_factor_cases.to_numpy())


def test_parallel_comparison_matches_independent_monte_carlo_reference(two_factor_cases):
    x = two_factor_cases.to_numpy()
    seed, runs = 12345, 50
    answer = parallel_analysis(x, simulations=runs, seed=seed)
    # Independent reimplementation: explicit correlation and eigenvalue loop,
    # separate from production function but same documented RNG seed.
    rng = np.random.default_rng(seed)
    simulation = []
    for _ in range(runs):
        null = rng.standard_normal(size=(len(x), x.shape[1]))
        simulation.append(np.linalg.eigvalsh(np.corrcoef(null, rowvar=False))[::-1])
    expected = np.array(simulation)
    np.testing.assert_allclose(answer["observed"],
                               np.linalg.eigvalsh(np.corrcoef(x, rowvar=False))[::-1],
                               atol=1e-12)
    np.testing.assert_allclose(answer["null_mean"], expected.mean(axis=0), atol=1e-12)
    np.testing.assert_allclose(answer["null_95"], np.quantile(expected, .95, axis=0),
                               atol=1e-12)
    assert answer["leading_count"] == 2


def test_parallel_seed_reproduces_results_and_changed_seed_changes_null_threshold(two_factor_cases):
    x = two_factor_cases.to_numpy()
    a = parallel_analysis(x, simulations=50, seed=987)
    b = parallel_analysis(x, simulations=50, seed=987)
    c = parallel_analysis(x, simulations=50, seed=988)
    np.testing.assert_array_equal(a["null_95"], b["null_95"])
    assert not np.array_equal(a["null_95"], c["null_95"])
    np.testing.assert_array_equal(a["observed"], c["observed"])


@pytest.mark.parametrize("runs,seed", [
    (0, 123), (49, 123), (201, 123), (100.0, 123),
    (True, 123), (100, -1), (100, 2**32), (100, True),
])
def test_reject_bad_parallel_settings(two_factor_cases, runs, seed):
    with pytest.raises(AnalysisError,match="Parallel analysis"):
        parallel_analysis(two_factor_cases.to_numpy(), simulations=runs, seed=seed)


def test_parallel_random_nulls_are_not_factorizable_research_data(two_factor_cases):
    result = parallel_analysis(two_factor_cases.to_numpy(), simulations=50, seed=111)
    assert result["reference"] == "independent standard-normal Pearson correlation matrices"
    assert not isinstance(result["observed"], pd.DataFrame)
    assert "raw_cases" not in result
    assert "simulated_records" not in result
    assert "respondent_ids" not in result


def test_efa_parallel_retention_table_and_factor_count_remain_separate(two_factor_cases):
    model = exploratory_factor(two_factor_cases, list(two_factor_cases), 2,
                               parallel_runs=50, parallel_seed=12345)
    retention = model["efa_metadata"]["parallel_analysis"]
    assert retention["leading_components_above_null"] == 2
    assert model["efa_metadata"]["factors"] == 2
    assert retention["comparison"] == "pearson_correlation_component_eigenvalues"
    assert retention["is_common_factor_parallel_analysis"] is False
    assert len(model["tables"][1]["rows"]) == 6
    assert model["tables"][1]["columns"] == [
        "Rank", "Observed eigenvalue", "Null mean", "Null 95th percentile",
        "Above null 95th?", "Kaiser > 1",
    ]
    assert model["tables"][1]["rows"][0][4] == "Yes"
    assert model["tables"][1]["rows"][2][4] == "No"
    assert any("not parallel analysis of principal-axis" in w for w in model["warnings"])


def test_retention_guide_never_overrides_user_supplied_factor_count(two_factor_cases):
    model = exploratory_factor(two_factor_cases, list(two_factor_cases), 1,
                               parallel_runs=50, parallel_seed=12345)
    assert model["efa_metadata"]["factors"] == 1
    assert model["efa_metadata"]["parallel_analysis"]["leading_components_above_null"] == 2
    assert any("requested 1 common factor" in w for w in model["warnings"])


def test_oblimin_pattern_phi_and_structure_match_independent_statsmodels(correlated_cases):
    variables = list(correlated_cases)
    data = correlated_cases.to_numpy()
    response = exploratory_factor(correlated_cases, variables, 2, rotation="oblimin",
                                  parallel_runs=50, parallel_seed=101)
    assert len(response["tables"]) == 5
    assert response["efa_metadata"]["rotation"] == "oblimin"
    assert response["efa_metadata"]["oblique_pattern_structure_separate"] is True

    ref = Factor(data, n_factor=2, method="pa", smc=True, missing="raise").fit(
        maxiter=200, tol=1e-8
    )
    ref.rotate("oblimin")
    phi = ref.rotation_matrix.T @ ref.rotation_matrix
    pattern = np.asarray(ref.loadings)
    structure = pattern @ phi

    pat_table = response["tables"][2]["rows"]
    phi_table = response["tables"][3]["rows"]
    struct_table = response["tables"][4]["rows"]
    actual_pattern = np.array([[row[1], row[2]] for row in pat_table])
    actual_phi = np.array([[row[1], row[2]] for row in phi_table])
    actual_structure = np.array([[row[1], row[2]] for row in struct_table])

    np.testing.assert_allclose(actual_pattern, pattern, atol=7e-5)
    np.testing.assert_allclose(actual_phi, phi, atol=7e-5)
    np.testing.assert_allclose(actual_structure, structure, atol=7e-5)
    assert abs(actual_phi[0, 1]) > .20
    assert actual_phi[0, 1] == pytest.approx(actual_phi[1, 0], abs=1e-5)
    assert abs(actual_phi[0, 0] - 1) < 1e-5
    assert abs(actual_phi[1, 1] - 1) < 1e-5
    assert not np.allclose(actual_pattern, actual_structure, atol=1e-3)
    assert any("pattern" in message and "structure" in message for message in response["warnings"])


def test_one_factor_oblimin_does_not_claim_factor_correlations(two_factor_cases):
    x = exploratory_factor(two_factor_cases, list(two_factor_cases), 1, rotation="oblimin",
                           parallel_runs=50)
    assert x["efa_metadata"]["rotation"] == "none"
    assert x["efa_metadata"]["oblique_pattern_structure_separate"] is False
    assert len(x["tables"]) == 3
    assert any("one-factor" in message for message in x["warnings"])


def test_existing_varimax_remains_orthogonal_and_has_no_extra_oblique_tables(two_factor_cases):
    r = exploratory_factor(two_factor_cases, list(two_factor_cases), 2, rotation="varimax",
                           parallel_runs=50)
    assert len(r["tables"]) == 3
    assert r["efa_metadata"]["oblique_pattern_structure_separate"] is False
    assert "Oblique structure" not in r["narrative"]


def test_api_exposes_bounded_settings_without_accepting_unsupported_rotation(two_factor_cases):
    client = TestClient(app)
    upload = client.post("/api/datasets", files={
        "file": ("synthetic-parallel.csv",
                 io.BytesIO(two_factor_cases.to_csv(index=False).encode()), "text/csv")
    })
    assert upload.status_code == 200, upload.text
    dataset_id = upload.json()["dataset_id"]
    body = {
        "dataset_id": dataset_id, "analysis": "efa",
        "columns": list(two_factor_cases), "factor_count": 2,
        "factor_rotation": "oblimin", "parallel_simulations": 50,
        "parallel_seed": 666,
    }
    try:
        response = client.post("/api/analyze", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["efa_metadata"]["parallel_analysis"]["seed"] == 666
        assert response.json()["efa_metadata"]["rotation"] == "oblimin"
        for bad in [{"factor_rotation": "promax"}, {"parallel_simulations": 5},
                    {"parallel_simulations": 250}, {"parallel_seed": -1}]:
            invalid = client.post("/api/analyze", json={**body, **bad})
            assert invalid.status_code == 422, invalid.text
    finally:
        client.delete(f"/api/datasets/{dataset_id}")


def test_frequency_only_cannot_run_factor_retention_or_oblique_inference():
    client = TestClient(app)
    response = client.post("/api/frequency-only/analyze", json={
        "analysis": "efa", "factor_rotation": "oblimin",
        "parallel_simulations": 100, "items": {
            "Q1": {"1": 10, "2": 8, "3": 12, "4": 15, "5": 20}
        }
    })
    assert response.status_code == 422


def test_ui_has_reproducibility_and_rotation_controls_only_in_local_python():
    client = TestClient(app)
    page = client.get("/")
    assert page.status_code == 200
    script = client.get("/static/app.js")
    assert script.status_code == 200
    for marker in ("efa-parallel-simulations", "efa-parallel-seed",
                   "oblimin", "out.parallel_seed", "out.parallel_simulations"):
        assert marker in script.text
    capabilities = client.get("/api/capabilities").json()
    assert capabilities["environment"] == "local-fastapi"
