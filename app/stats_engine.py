"""Tested numerical core for MABRIG StatLab.

This is independent code: it uses SciPy and Statsmodels, not IBM SPSS or REA code.
All inferential methods operate on the actual uploaded rows, never synthetic data.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm


class AnalysisError(ValueError):
    """A user-correctable selection or analysis error."""


def safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError, OverflowError):
        return None
    return f if math.isfinite(f) else None


def fnum(x: Any, n: int = 4) -> float | None:
    f = safe_float(x)
    return round(f, n) if f is not None else None


def p_text(p: float) -> str:
    v = safe_float(p)
    return "unavailable" if v is None else ("< .001" if v < .001 else f"= {v:.3f}")


def get_columns(df: pd.DataFrame, names: list[str], min_count: int = 1) -> list[str]:
    if not isinstance(names, list) or len(names) < min_count or len(names) > 100:
        raise AnalysisError(f"Select at least {min_count} and no more than 100 variables.")
    if len(names) != len(set(names)) or any(not isinstance(c, str) or c not in df.columns for c in names):
        raise AnalysisError("Selection contains an unknown or duplicate variable.")
    return names


def numeric(df: pd.DataFrame, column: str) -> pd.Series:
    if column not in df.columns:
        raise AnalysisError(f"Unknown variable: {column}")
    # Do not automatically convert nominal labels to ordinal scores.
    return pd.to_numeric(df[column], errors="coerce").astype(float)


def good_numeric(df: pd.DataFrame, columns: list[str], min_rows: int = 3) -> pd.DataFrame:
    x = pd.DataFrame({name: numeric(df, name) for name in columns}).replace([np.inf, -np.inf], np.nan).dropna()
    if len(x) < min_rows:
        raise AnalysisError(f"Need at least {min_rows} complete numerical cases for the selected variables.")
    return x


def table(title: str, columns: list[str], rows: list[list[Any]], note: str = "") -> dict:
    return {"title": title, "columns": columns, "rows": rows, "note": note}


def result(title: str, tables: list[dict], narrative: str, warnings: list[str] | None = None, chart: dict | None = None, method: str = "") -> dict:
    return {"title": title, "tables": tables, "narrative": narrative, "warnings": warnings or [], "chart": chart, "method": method}


def descriptive(df: pd.DataFrame, columns: list[str]) -> dict:
    cols = get_columns(df, columns)
    rows = []
    means = []
    for col in cols:
        x = numeric(df, col).replace([np.inf, -np.inf], np.nan).dropna()
        if not len(x):
            rows.append([col, 0, len(df), None, None, None, None, None, None, None, None, None]); continue
        rows.append([col, len(x), len(df) - len(x), fnum(x.mean()), fnum(x.std(ddof=1)) if len(x)>1 else None,
                     fnum(x.median()), fnum(x.min()), fnum(x.max()), fnum(x.quantile(.25)), fnum(x.quantile(.75)),
                     fnum(x.skew()) if len(x)>2 else None, fnum(x.kurt()) if len(x)>3 else None])
        means.append((col, fnum(x.mean())))
    return result("Descriptive statistics", [table("Descriptives", ["Variable", "Valid N", "Missing N", "Mean", "SD", "Median", "Min", "Max", "Q1", "Q3", "Skewness", "Excess kurtosis"], rows, "SD uses n−1; skewness and kurtosis are sample-adjusted.")],
                  "Descriptive statistics summarize the observed data; they do not test causal relationships.",
                  chart={"type": "bar", "labels": [x[0] for x in means], "values": [x[1] for x in means], "label": "Mean"},
                  method="Sample standard deviation; complete observed values per variable.")


def frequencies(df: pd.DataFrame, column: str) -> dict:
    get_columns(df, [column])
    s = df[column].astype("string")
    valid = s.dropna()
    counts = valid.value_counts(dropna=False)
    counts = counts.head(50)  # bound output on high-cardinality columns
    rows = []
    cum = 0.0
    n = len(df); nv = len(valid)
    for label, count in counts.items():
        pct = 100*int(count)/n if n else 0
        valid_pct = 100*int(count)/nv if nv else 0
        cum += valid_pct
        rows.append([str(label), int(count), fnum(pct, 2), fnum(valid_pct, 2), fnum(cum, 2)])
    warnings = ["Showing 50 most frequent categories; percentages do not total 100%." ] if len(valid.value_counts()) > 50 else []
    return result(f"Frequencies — {column}", [table("Frequency distribution", ["Category", "Count", "% of all", "Valid %", "Cumulative valid %"], rows,
                               f"Valid cases: {nv}; missing cases: {n-nv}; total: {n}.")],
                  f"{nv} of {n} records contain a nonmissing value for {column}.", warnings,
                  chart={"type": "bar", "labels": [r[0] for r in rows[:15]], "values": [r[1] for r in rows[:15]], "label": "Frequency"},
                  method="Unweighted counts; percentages exclude missing only for valid percentages.")


def correlations(df: pd.DataFrame, columns: list[str], method: str = "pearson") -> dict:
    cols = get_columns(df, columns, 2)
    if method not in ("pearson", "spearman"):
        raise AnalysisError("Correlation method must be Pearson or Spearman.")
    rows, warnings = [], []
    for i in range(len(cols)):
        for j in range(i+1, len(cols)):
            x = good_numeric(df, [cols[i], cols[j]])
            if x[cols[i]].nunique() < 2 or x[cols[j]].nunique() < 2:
                warnings.append(f"{cols[i]} / {cols[j]} has a constant variable; correlation is undefined.")
                r, p = None, None
            else:
                out = stats.pearsonr(x.iloc[:,0], x.iloc[:,1]) if method == "pearson" else stats.spearmanr(x.iloc[:,0], x.iloc[:,1])
                r, p = fnum(out.statistic), fnum(out.pvalue, 7)
            rows.append([cols[i], cols[j], len(x), r, p])
    return result(f"{method.title()} correlation", [table("Pairwise correlations", ["Variable 1", "Variable 2", "N", "Coefficient", "p (two-sided)"], rows)],
                  "Coefficients measure association, not causation. Review the p-values and effect sizes in context.", warnings,
                  method=f"{method.title()} correlation; pairwise complete-case deletion; two-sided tests.")


def crosstab(df: pd.DataFrame, a: str, b: str) -> dict:
    get_columns(df, [a,b], 2)
    filtered = df[[a,b]].dropna()
    if len(filtered) < 2:
        raise AnalysisError("Not enough complete records.")
    xt = pd.crosstab(filtered[a].astype(str), filtered[b].astype(str))
    if xt.shape[0] < 2 or xt.shape[1] < 2:
        raise AnalysisError("Chi-square needs at least two observed categories in both variables.")
    if xt.size > 10000:
        raise AnalysisError("Too many categories for a contingency table.")
    chi, p, dof, expected = stats.chi2_contingency(xt, correction=False)
    n = int(xt.to_numpy().sum())
    cramers_v = math.sqrt(float(chi)/(n*min(xt.shape[0]-1,xt.shape[1]-1))) if n else 0
    cells_under_5 = int((expected<5).sum())
    low_ratio = cells_under_5 / expected.size
    warnings = []
    if np.any(expected<1) or low_ratio>.2:
        warnings.append(f"Chi-square approximation may be unreliable: {cells_under_5}/{expected.size} expected counts are below 5. Consider collapsing defensible categories or an exact test.")
    rows = [[str(ix), *[int(x) for x in xt.loc[ix].tolist()], int(xt.loc[ix].sum())] for ix in xt.index]
    rows.append(["Total", *[int(x) for x in xt.sum(axis=0).tolist()], n])
    return result("Crosstab and Pearson chi-square", [table("Observed counts", [a+" \\ "+b,*[str(c) for c in xt.columns], "Total"],rows),
        table("Association test",["Chi-square", "df", "p", "Cramér's V", "N", "Expected cells < 5"], [[fnum(chi),int(dof),fnum(p,7),fnum(cramers_v),n, cells_under_5]])],
        f"Pearson χ²({dof}, N={n}) = {chi:.3f}, p {p_text(p)}; Cramér's V = {cramers_v:.3f}.", warnings,
        method="Pearson chi-square without continuity correction; complete-case deletion.")


def reliability(df: pd.DataFrame, columns: list[str]) -> dict:
    cols = get_columns(df, columns, 2)
    x = good_numeric(df, cols)
    k = x.shape[1]
    total_var = x.sum(axis=1).var(ddof=1)
    if total_var <= 0 or not math.isfinite(float(total_var)):
        raise AnalysisError("Total score has zero or undefined variance; alpha cannot be calculated.")
    alpha = k/(k-1)*(1-x.var(ddof=1).sum()/total_var)
    warnings = []
    if alpha < 0:
        warnings.append("Negative alpha suggests discordant items or coding issues. Review reverse-scored questions before interpretation.")
    if k < 3:
        warnings.append("Only two items selected. Interpret alpha cautiously and consider the inter-item correlation.")
    return result("Scale reliability", [table("Cronbach's alpha", ["Items", "Complete cases", "Alpha"],[[k,len(x),fnum(alpha)]])],
                  f"Cronbach's α = {alpha:.3f} across {k} items (complete-case N = {len(x)}). This is an internal-consistency estimate, not proof of validity.", warnings,
                  method="Raw (unstandardized) Cronbach alpha; complete-case deletion; assumes items were scored in the same direction.")


def regression(df: pd.DataFrame, dependent: str, predictors: list[str]) -> dict:
    cols = get_columns(df,[dependent]+predictors,2)
    if len(predictors) > 20:
        raise AnalysisError("For stability, select no more than 20 predictors.")
    x = good_numeric(df, cols, min_rows=len(cols)+2)
    if x[dependent].nunique() < 2:
        raise AnalysisError("Dependent variable is constant.")
    X = sm.add_constant(x[predictors], has_constant="add")
    if np.linalg.matrix_rank(X.to_numpy()) < X.shape[1]:
        raise AnalysisError("Predictors are linearly dependent or constant. Remove redundant variables.")
    fit = sm.OLS(x[dependent],X).fit()
    rows=[]
    ci=fit.conf_int()
    for k in fit.params.index:
        rows.append(["Intercept" if k=="const" else k,fnum(fit.params[k]), fnum(fit.bse[k]), fnum(fit.tvalues[k]), fnum(fit.pvalues[k],7),fnum(ci.loc[k,0]), fnum(ci.loc[k,1])])
    warnings=[]
    if fit.condition_number > 1000:
        warnings.append(f"High model condition number ({fit.condition_number:.0f}) may indicate scaling issues or multicollinearity.")
    return result("Multiple linear regression", [table("Model summary", ["N", "R²", "Adjusted R²", "F", "F p-value", "Residual df", "AIC"],
               [[len(x),fnum(fit.rsquared),fnum(fit.rsquared_adj),fnum(fit.fvalue),fnum(fit.f_pvalue,7),int(fit.df_resid),fnum(fit.aic)]]),
               table("Regression coefficients",["Variable", "B", "SE", "t", "p", "95% CI low", "95% CI high"],rows)],
        f"OLS explained {100*fit.rsquared:.1f}% of sample variation in {dependent} (R² = {fit.rsquared:.3f}; model p {p_text(fit.f_pvalue)}). Association does not establish causation.",warnings,
        method="Ordinary least squares with intercept; listwise deletion; two-sided t-tests. Check linearity, residuals, influence and homoscedasticity.")


def independent_t(df: pd.DataFrame, dependent: str, group: str) -> dict:
    get_columns(df, [dependent,group],2)
    data = pd.DataFrame({"value":numeric(df,dependent),"group":df[group].astype("string")}).dropna()
    groups = data.group.unique().tolist()
    if len(groups)!=2:
        raise AnalysisError("Independent t-test requires exactly two observed group values. Filter/recode groups first.")
    a = data.loc[data.group==groups[0],"value"]
    b = data.loc[data.group==groups[1],"value"]
    if min(len(a),len(b))<2:
        raise AnalysisError("Each group needs at least two numeric observations.")
    out=stats.ttest_ind(a,b,equal_var=False)
    v1=float(a.var(ddof=1));v2=float(b.var(ddof=1));n1=len(a);n2=len(b)
    se=math.sqrt(v1/n1+v2/n2)
    if se==0:raise AnalysisError("Both groups have zero variation.")
    dfw=(v1/n1+v2/n2)**2 / ((v1/n1)**2/(n1-1)+(v2/n2)**2/(n2-1))
    diff=float(a.mean()-b.mean());tcrit=float(stats.t.ppf(.975,dfw))
    pooled=math.sqrt(((n1-1)*v1+(n2-1)*v2)/(n1+n2-2))
    d=diff/pooled if pooled>0 else None
    return result("Independent-samples t-test (Welch)", [table("Group descriptives",["Group","N","Mean","SD"],[[str(groups[0]),n1,fnum(a.mean()),fnum(a.std(ddof=1))],[str(groups[1]),n2,fnum(b.mean()),fnum(b.std(ddof=1))]]),
          table("Welch t-test",["Mean difference","t","df","p","95% CI low","95% CI high","Cohen's d"],[[fnum(diff),fnum(out.statistic),fnum(dfw,2),fnum(out.pvalue,7),fnum(diff-tcrit*se),fnum(diff+tcrit*se),fnum(d)]])],
        f"Welch's t({dfw:.2f}) = {out.statistic:.3f}, p {p_text(out.pvalue)}. The estimated mean difference ({groups[0]} − {groups[1]}) was {diff:.3f}.",
        method="Welch unequal-variance independent samples t-test, two-sided; listwise deletion. Cohen's d uses pooled SD.")


def paired_t(df: pd.DataFrame,a:str,b:str)->dict:
    get_columns(df,[a,b],2)
    x=good_numeric(df,[a,b],3)
    difference=x[a]-x[b]
    if difference.std(ddof=1)==0:
        raise AnalysisError("Paired differences have zero variance.")
    out=stats.ttest_rel(x[a],x[b]); n=len(x)
    mean=float(difference.mean());sd=float(difference.std(ddof=1));se=sd/math.sqrt(n)
    crit=float(stats.t.ppf(.975,n-1))
    return result("Paired-samples t-test",[table("Paired comparisons",["Pair","N","Mean difference","SD difference","t","df","p","95% CI low","95% CI high","Cohen's dz"],
       [[f"{a} − {b}",n,fnum(mean),fnum(sd),fnum(out.statistic),n-1,fnum(out.pvalue,7),fnum(mean-crit*se),fnum(mean+crit*se),fnum(mean/sd)]])],
       f"Paired t({n-1}) = {out.statistic:.3f}, p {p_text(out.pvalue)}; mean paired difference = {mean:.3f}.",
       method="Two-sided dependent t-test; complete paired cases; assumes roughly symmetric/normal difference scores for small samples.")


def anova(df:pd.DataFrame,dependent:str,group:str)->dict:
    get_columns(df,[dependent,group],2)
    data=pd.DataFrame({"value":numeric(df,dependent),"group":df[group].astype("string")}).dropna()
    split=[(name,dat.value.to_numpy(dtype=float)) for name,dat in data.groupby("group")]
    if len(split)<2 or len(split)>30 or any(len(v)<2 for _,v in split):
        raise AnalysisError("ANOVA requires 2–30 groups with at least two observations per group.")
    f,p=stats.f_oneway(*[values for _,values in split]);n=len(data);k=len(split)
    overall=data.value.mean();ss_between=sum(len(values)*(values.mean()-overall)**2 for _,values in split)
    ss_total=float(((data.value-overall)**2).sum());eta=ss_between/ss_total if ss_total>0 else None
    rows=[[name,len(values),fnum(np.mean(values)),fnum(np.std(values,ddof=1))] for name,values in split]
    return result("One-way ANOVA",[table("Group descriptives",["Group","N","Mean","SD"],rows),table("ANOVA test",["F","df between","df within","p","Eta squared","N"],[[fnum(f),k-1,n-k,fnum(p,7),fnum(eta),n]])],
        f"F({k-1}, {n-k}) = {f:.3f}, p {p_text(p)}; η² = {eta:.3f}. An omnibus test does not identify which groups differ.",
        method="Classical one-way ANOVA; complete cases; assumes approximate normality and equal population variances. No post-hoc comparisons included.")


def normality(df:pd.DataFrame, columns:list[str])->dict:
    cols=get_columns(df,columns)
    rows=[]
    for c in cols:
        x=numeric(df,c).dropna()
        if not 3<=len(x)<=5000:
            raise AnalysisError(f"Shapiro–Wilk for {c} requires 3–5000 valid cases.")
        w,p=stats.shapiro(x)
        rows.append([c,len(x),fnum(w),fnum(p,7)])
    return result("Shapiro–Wilk normality",[table("Normality tests",["Variable","N","W","p"],rows)],
          "A small p-value indicates evidence against a normal distribution; normality tests become sensitive in large samples. Inspect plots as well.",
          method="Shapiro–Wilk, univariate per variable.")


def analyze(df: pd.DataFrame, request:dict, variable_specs: dict[str, dict] | None = None) -> dict:
    mode=request.get("analysis")
    columns=request.get("columns",[])
    a=request.get("a");b=request.get("b")
    if mode=="descriptives":
        from .descriptive_guide import guided_descriptive
        return guided_descriptive(df,columns,variable_specs,request.get("detail_level","simple"))
    if mode=="questionnaire":
        from .questionnaire_guide import questionnaire_summary
        return questionnaire_summary(df, request.get("objectives", []), variable_specs,
                                    request.get("scale_points", 5),
                                    request.get("higher_is_favourable"),
                                    request.get("min_answered_pct", 50))
    if mode=="frequencies":return frequencies(df,a)
    if mode=="correlation":return correlations(df,columns,request.get("method","pearson"))
    if mode=="crosstab":return crosstab(df,a,b)
    if mode=="reliability":return reliability(df,columns)
    if mode=="regression":return regression(df,a,columns)
    if mode=="ttest_ind":return independent_t(df,a,b)
    if mode=="ttest_paired":return paired_t(df,a,b)
    if mode=="anova":return anova(df,a,b)
    if mode=="normality":return normality(df,columns)
    if mode=="efa":
        from .factor_analysis import exploratory_factor
        return exploratory_factor(df, columns,
                                  n_factors=request.get("factor_count", 2),
                                  rotation=request.get("factor_rotation", "varimax"),
                                  variable_specs=variable_specs)
    raise AnalysisError("Unknown analysis. Choose a supported statistical procedure.")
