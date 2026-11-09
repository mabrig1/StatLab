import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats
import statsmodels.api as sm

from app.stats_engine import analyze, AnalysisError, descriptive, correlations, crosstab, independent_t, paired_t, anova, regression, reliability, normality


@pytest.fixture
def survey():
    return pd.DataFrame({
        "Satisfaction": [1,2,2,3,3,4,4,5,3,2,4,5],
        "Productivity": [2,3,3,4,4,5,4,6,4,3,5,7],
        "Support": [2,2,3,4,3,4,5,5,4,2,4,5],
        "Group": ["Control"]*6+["Treatment"]*6,
        "Gender": ["F","F","M","M","F","M","F","M","F","M","F","M"],
        "Before": [5,4,4,6,7,8,9,6,7,6,5,6],
        "After": [5,5,5,7,7,9,10,7,8,8,7,7]
    })


def test_descriptive_uses_sample_standard_deviation(survey):
    ans=descriptive(survey,["Satisfaction"])
    row=ans["tables"][0]["rows"][0]
    assert row[1]==12
    assert row[3]==round(survey.Satisfaction.mean(),4)
    assert row[4]==round(survey.Satisfaction.std(ddof=1),4)


def test_correlation_uses_pearson_formula(survey):
    ans=correlations(survey,["Satisfaction","Productivity"])
    row=ans["tables"][0]["rows"][0]
    expected=stats.pearsonr(survey.Satisfaction,survey.Productivity)
    assert row[3]==round(expected.statistic,4)
    assert row[4]==round(expected.pvalue,7)


def test_spearman_with_ties(survey):
    ans=correlations(survey,["Satisfaction","Productivity"],"spearman")
    row=ans["tables"][0]["rows"][0]
    assert row[3]==round(stats.spearmanr(survey.Satisfaction,survey.Productivity).statistic,4)


def test_reliability_against_hand_formula(survey):
    ans=reliability(survey,["Satisfaction","Support","Productivity"])
    observed=ans["tables"][0]["rows"][0][-1]
    items=survey[["Satisfaction","Support","Productivity"]]
    expected=3/2*(1-items.var(ddof=1).sum()/items.sum(axis=1).var(ddof=1))
    assert observed==round(expected,4)


def test_chi_square(survey):
    ans=crosstab(survey,"Group","Gender")
    row=ans["tables"][1]["rows"][0]
    xt=pd.crosstab(survey.Group,survey.Gender)
    expected=stats.chi2_contingency(xt,correction=False)
    assert row[0]==round(expected.statistic,4)
    assert row[1]==expected.dof


def test_welch_t_test_against_scipy(survey):
    ans=independent_t(survey,"Productivity","Group")
    row=ans["tables"][1]["rows"][0]
    x=survey.iloc[:6].Productivity
    y=survey.iloc[6:].Productivity
    expected=stats.ttest_ind(x,y,equal_var=False)
    assert row[1]==round(expected.statistic,4)
    assert row[3]==round(expected.pvalue,7)


def test_paired_t(survey):
    ans=paired_t(survey,"After","Before")
    row=ans["tables"][0]["rows"][0]
    expected=stats.ttest_rel(survey.After,survey.Before)
    assert row[4]==round(expected.statistic,4)


def test_anova(survey):
    ans=anova(survey,"Productivity","Group")
    row=ans["tables"][1]["rows"][0]
    expected=stats.f_oneway(survey.iloc[:6].Productivity,survey.iloc[6:].Productivity)
    assert row[0]==round(expected.statistic,4)


def test_multiple_regression(survey):
    ans=regression(survey,"Productivity",["Satisfaction","Support"])
    row=ans["tables"][0]["rows"][0]
    mod=sm.OLS(survey.Productivity,sm.add_constant(survey[["Satisfaction","Support"]])).fit()
    assert row[1]==round(mod.rsquared,4)
    assert row[2]==round(mod.rsquared_adj,4)
    assert len(ans["tables"][1]["rows"])==3


def test_missing_data_handling(survey):
    survey.loc[2,"Satisfaction"]=np.nan
    ans=correlations(survey,["Satisfaction","Support"])
    assert ans["tables"][0]["rows"][0][2]==11


def test_zero_variance_is_flagged(survey):
    survey["Constant"]=1
    ans=correlations(survey,["Constant","Support"])
    assert ans["tables"][0]["rows"][0][3] is None
    assert ans["warnings"]
    with pytest.raises(AnalysisError):
        regression(survey,"Productivity",["Constant"])


def test_reject_unlisted_columns(survey):
    with pytest.raises(AnalysisError):
        descriptive(survey,["Salary__Injected"])
    with pytest.raises(AnalysisError):
        analyze(survey,{"analysis":"arbitrary_code"})


def test_reject_invalid_independent_group_count(survey):
    survey["newgroup"]=list(range(12))
    with pytest.raises(AnalysisError):
        independent_t(survey,"Productivity","newgroup")


def test_shapiro_valid(survey):
    ans=normality(survey,["Productivity"])
    assert 0<=ans["tables"][0]["rows"][0][-1]<=1
