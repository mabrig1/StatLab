"""Regression tests for transparent a-priori power and sample size planning.

Known fixtures are verified directly against Statsmodels, not generated counts.
"""
import math
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from statsmodels.stats.power import FTestAnovaPower, NormalIndPower, TTestIndPower
from statsmodels.stats.proportion import proportion_effectsize

from app.main import app, sessions
from app.power_analysis import PowerPlanRequest, PowerPlanningError, plan_sample_size, power_plan_html

client = TestClient(app)


@pytest.mark.parametrize("family,effect,n_expected", [
    ("one_sample_t", .5, 34),
    ("paired_t", .5, 34),
    ("independent_t", .5, 128),
    ("anova_one_way", .25, 159),
])
def test_published_model_reference_fixtures(family, effect, n_expected):
    plan = plan_sample_size(PowerPlanRequest(test_family=family, effect_size=effect))
    assert plan["completed_total"] == n_expected
    assert plan["planned_power"] >= .8
    assert plan["kind"] == "a_priori_power_plan"
    assert plan["data_kind"] == "researcher_defined_planning_assumptions_not_observed_data"
    assert plan["requires_dataset"] is False
    assert plan["assumed_proportions"] is None


def test_paired_count_means_complete_pairs_and_attrition_is_per_design_unit():
    plan = plan_sample_size(PowerPlanRequest(
        test_family="paired_t", effect_size=.5, attrition_percent=20))
    assert plan["completed"] == {"complete_pairs": 34}
    assert plan["recruitment"] == {"complete_pairs": 43}
    assert plan["recruitment_total"] == 43
    assert any("matched" in note for note in plan["assumptions"])


@pytest.mark.parametrize("ratio", [.25,.5,1,1.5,2,4])
def test_integer_group_allocations_are_reverified(ratio):
    req = PowerPlanRequest(test_family="independent_t",
                           effect_size=.45,allocation_ratio=ratio,attrition_percent=18)
    plan = plan_sample_size(req)
    n1,n2 = plan["completed"]["group_1"],plan["completed"]["group_2"]
    achieved = TTestIndPower().power(effect_size=.45,nobs1=n1,ratio=n2/n1,alpha=.05)
    assert achieved >= .8 - 1e-10
    assert plan["completed_total"] == n1+n2
    assert plan["recruitment"]["group_1"] == math.ceil(n1/.82)
    assert any("Welch" in note for note in plan["assumptions"])


def test_one_way_anova_is_balanced_and_power_rechecked_after_rounding():
    plan = plan_sample_size(PowerPlanRequest(test_family="anova_one_way",
                                            effect_size=.3,groups=5))
    n = plan["completed"]["per_group"]
    assert plan["completed_total"] == n*5
    solver = FTestAnovaPower()
    assert solver.power(effect_size=.3,nobs=5*n,alpha=.05,k_groups=5) >= .8
    assert solver.power(effect_size=.3,nobs=5*(n-1),alpha=.05,k_groups=5) < .8


def test_two_proportions_use_explicit_risks_and_arcsine_h():
    req=PowerPlanRequest(test_family="two_proportions",
                         proportion_1=.5,proportion_2=.65)
    plan=plan_sample_size(req)
    assert plan["completed_total"]==340
    assert plan["completed"]=={"group_1":170,"group_2":170}
    h=abs(proportion_effectsize(.5,.65))
    assert math.isclose(plan["effect_size"],h,rel_tol=1e-6)
    assert NormalIndPower().power(effect_size=h,nobs1=170,alpha=.05,ratio=1)>=.8
    assert any("approximation" in note.lower() for note in plan["assumptions"])


def test_unreasonably_large_design_fails_without_unbounded_allocation():
    with pytest.raises(PowerPlanningError,match="exceeds|size"):
        plan_sample_size(PowerPlanRequest(
            test_family="one_sample_t",effect_size=.005,target_power=.99))


@pytest.mark.parametrize("payload", [
    {"test_family":"paired_t"},
    {"test_family":"paired_t","effect_size":0},
    {"test_family":"paired_t","effect_size":.5,"allocation_ratio":2},
    {"test_family":"paired_t","effect_size":.5,"alpha":1},
    {"test_family":"paired_t","effect_size":.5,"target_power":0},
    {"test_family":"paired_t","effect_size":.5,"target_power":float("nan")},
    {"test_family":"paired_t","effect_size":.5,"dataset_id":"dataset123"},
    {"test_family":"independent_t","effect_size":.5,"observed_p_value":.0001},
    {"test_family":"two_proportions","proportion_1":.5},
    {"test_family":"two_proportions","proportion_1":.4,"proportion_2":.4},
    {"test_family":"two_proportions","proportion_1":.5,"proportion_2":.6,"effect_size":.5},
    {"test_family":"two_proportions","proportion_1":.02,"proportion_2":.5},
    {"test_family":"anova_one_way","effect_size":.25,"groups":11},
    {"test_family":"anova_one_way","effect_size":.25,"allocation_ratio":2},
    {"test_family":"two_proportions","proportion_1":.5,"proportion_2":.6,"allocation_ratio":6},
    {"test_family":"independent_t","effect_size":.5,"attrition_percent":60},
])
def test_invalid_designs_rejected_by_strict_request_model(payload):
    with pytest.raises(ValidationError):PowerPlanRequest(**payload)


def test_api_plans_without_dataset_and_does_not_create_sessions():
    sessions.clear()
    response=client.post("/api/power/sample-size",
                         json={"test_family":"independent_t","effect_size":.5})
    assert response.status_code==200,response.text
    plan=response.json()
    assert plan["completed"]=={"group_1":64,"group_2":64}
    assert plan["target_power"]==.8
    assert plan["planned_power"]>=.8
    assert sessions=={}


def test_api_rejects_missing_effect_nan_unknown_fields_and_oversized_design():
    for payload in [
        {"test_family":"paired_t"},
        {"test_family":"paired_t","effect_size":0},
        {"test_family":"paired_t","effect_size":.5,"dataset_id":"not allowed"},
        {"test_family":"paired_t","effect_size":.005,"target_power":.99},
    ]:
        response=client.post("/api/power/sample-size",json=payload)
        assert response.status_code==422,(response.status_code,response.text)


def test_printable_html_is_script_free_and_newly_calculated():
    payload={"test_family":"two_proportions","proportion_1":.5,"proportion_2":.65}
    response=client.post("/api/power/report.html",json=payload)
    assert response.status_code==200,response.text
    assert "text/html" in response.headers["content-type"]
    assert "no-store" in response.headers["cache-control"]
    assert "attachment" in response.headers["content-disposition"]
    assert "340" in response.text
    assert "Planning assumptions, not observed research findings." in response.text
    assert "<script" not in response.text
    assert "Required completed sample" not in response.text


def test_html_escape_and_research_methodology_warnings():
    plan=plan_sample_size(PowerPlanRequest(test_family="independent_t",effect_size=.5))
    html=power_plan_html(plan)
    assert "Welch" in html
    assert "A Priori" in html
    assert "Researcher note:" in html
    assert "<script" not in html


def test_local_nav_capabilities_and_frontend_available_without_public_cloud_python():
    home=client.get("/")
    assert home.status_code==200
    assert 'id="view-power"' in home.text
    assert 'data-view="power"' in home.text
    assert client.get("/static/power.js").status_code==200
    assert client.get("/static/power.css").status_code==200
    cap=client.get("/api/capabilities").json()
    assert "a_priori_sample_size_power_planning" in cap["features"]["study_design"]
    assert "power_analysis" not in cap["unavailable"]
    assert "factor_analysis" in cap["unavailable"]
