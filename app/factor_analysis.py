"""Bounded, respondent-level exploratory factor analysis for local StatLab.

Uses principal-axis common-factor extraction (not PCA), orthogonal varimax or
oblique quartimin/oblimin rotation, Pearson correlation diagnostics, optional
reproducible component-eigenvalue parallel analysis, and an explicitly
researcher-selected factor count. NEVER reconstructs cases from marginals.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.multivariate.factor import Factor

from .stats_engine import AnalysisError, fnum, p_text, get_columns, result, table
from .factor_retention import parallel_analysis

MIN_VARIABLES = 4
MAX_VARIABLES = 25
MAX_FACTORS = 6
MAX_CASES = 10000


def _numeric_frame(df: pd.DataFrame, variables: list[str],
                   specs: dict[str, dict] | None) -> tuple[np.ndarray, int, int]:
    """Explicitly reject text/non-ordered variables and use listwise deletion."""
    if not isinstance(df, pd.DataFrame):
        raise AnalysisError("EFA requires a respondent-level dataset with real cases.")
    columns = get_columns(df, variables, MIN_VARIABLES)
    if len(columns) > MAX_VARIABLES:
        raise AnalysisError(f"EFA accepts at most {MAX_VARIABLES} variables per model.")

    if specs is not None:
        for name in columns:
            spec = specs.get(name, {})
            if spec.get("type") not in (None, "numeric"):
                raise AnalysisError(f"{name} is not numeric; remove text/date variables from EFA.")
            if spec.get("measure") not in (None, "scale", "ordinal"):
                raise AnalysisError(f"{name} is marked nominal. EFA requires scale or ordered-item scores.")

    data = {}
    for name in columns:
        source = df[name]
        converted = pd.to_numeric(source, errors="coerce")
        corrupted = source.notna() & converted.isna()
        if bool(corrupted.any()):
            raise AnalysisError(f"{name} contains text/non-numeric values. Recode or remove the variable.")
        data[name] = converted.replace([np.inf, -np.inf], np.nan)

    raw = pd.DataFrame(data).dropna(axis=0, how="any")
    n = len(raw)
    missing = len(df) - n
    p = len(columns)
    threshold = max(50, p * 5)
    if n < threshold:
        raise AnalysisError(
            f"EFA requires at least {threshold} complete respondent rows for {p} variables "
            f"(minimum 50 and at least five cases per variable); only {n} available."
        )
    if n > MAX_CASES:
        raise AnalysisError(
            f"EFA accepts up to {MAX_CASES:,} complete cases for interactive local analysis. "
            "Create an explicitly documented subset; StatLab will not silently sample records."
        )
    matrix = raw.to_numpy(dtype=np.float64)
    std = matrix.std(axis=0, ddof=1)
    if np.any(~np.isfinite(std)) or np.any(std < 1e-12):
        bad = [name for name, sd in zip(columns, std) if not math.isfinite(sd) or sd < 1e-12]
        raise AnalysisError(
            "Selected variables must vary across complete cases. Constant/near-constant: "
            + ", ".join(bad[:8]) + "."
        )
    return matrix, n, missing


def correlation_factorability(data: np.ndarray) -> dict:
    """Pearson R, overall/per-item KMO, and Bartlett's approximate test.

    KMO = sum(r_ij²)/(sum(r_ij²)+sum(partial_r_ij²)), off-diagonal pairs.
    Bartlett χ² = −[n−1−(2p+5)/6] ln|R|, df=p(p−1)/2.
    """
    if not isinstance(data, np.ndarray) or data.ndim != 2:
        raise AnalysisError("Factorability requires a two-dimensional numeric case matrix.")
    n, p = data.shape
    if p < MIN_VARIABLES or not np.isfinite(data).all():
        raise AnalysisError("Factorability requires at least four finite numerical variables.")
    with np.errstate(over="raise", invalid="raise", divide="raise"):
        corr = np.corrcoef(data, rowvar=False)
    if corr.shape != (p, p) or not np.isfinite(corr).all():
        raise AnalysisError("Cannot compute a finite correlation matrix; check the selected variables.")
    corr = (corr + corr.T) / 2
    eigenvalues = np.linalg.eigvalsh(corr)
    smallest = float(eigenvalues[0])
    if smallest <= 1e-6:
        raise AnalysisError(
            "The item correlation matrix is singular or nearly singular (redundant/duplicate items). "
            "Remove linearly dependent variables; EFA cannot be trusted on this selection."
        )
    inv = np.linalg.inv(corr)
    den = np.sqrt(np.outer(np.diag(inv), np.diag(inv)))
    partials = -inv / den
    np.fill_diagonal(partials, 0)
    corr_offdiag = corr.copy()
    np.fill_diagonal(corr_offdiag, 0)
    r2 = corr_offdiag ** 2
    p2 = partials ** 2
    kmo_denom = float(np.sum(r2) + np.sum(p2))
    if kmo_denom <= 1e-15:
        raise AnalysisError("Variables show essentially no shared correlation; EFA is not appropriate.")
    kmo = float(np.sum(r2) / kmo_denom)
    item_r2 = r2.sum(axis=0)
    item_p2 = p2.sum(axis=0)
    msas = item_r2 / (item_r2 + item_p2 + 1e-30)

    sign, logdet = np.linalg.slogdet(corr)
    if sign <= 0:
        raise AnalysisError("Correlation matrix is not positive definite.")
    correction = n - 1 - (2 * p + 5) / 6
    if correction <= 0:
        raise AnalysisError("Insufficient cases for Bartlett's test.")
    chi2 = max(0., float(-correction * logdet))
    df_chi2 = p * (p - 1) // 2
    bartlett_p = float(stats.chi2.sf(chi2, df_chi2))
    return {
        "correlation": corr,
        "eigenvalues": np.sort(eigenvalues)[::-1],
        "kmo": kmo,
        "msa": msas,
        "bartlett_chi2": chi2,
        "bartlett_df": df_chi2,
        "bartlett_p": bartlett_p,
        "determinant": math.exp(logdet),
    }


def exploratory_factor(df: pd.DataFrame, columns: list[str], n_factors: int = 2,
                       rotation: str = "varimax",
                       variable_specs: dict[str, dict] | None = None,
                       parallel_runs: int = 100,
                       parallel_seed: int = 20261110) -> dict:
    """Estimate case-level principal-axis EFA with documented retention aids.

    Factor count is always researcher-specified. The optional oblique rotation
    reports pattern, structure and factor correlations separately. The parallel
    benchmark uses full Pearson-correlation *component* eigenvalues, not a
    common-factor model. Neither aid validates constructs or determines the
    requested number of factors automatically.
    """
    if not isinstance(n_factors, int) or isinstance(n_factors, bool) or not 1 <= n_factors <= MAX_FACTORS:
        raise AnalysisError(f"Select an integer number of factors between 1 and {MAX_FACTORS}.")
    if rotation not in ("none", "varimax", "oblimin"):
        raise AnalysisError("EFA rotation must be 'none', 'varimax' or 'oblimin'.")
    if not isinstance(columns, list):
        raise AnalysisError("EFA requires a list of selected numerical variables.")
    get_columns(df, columns, MIN_VARIABLES)
    if n_factors >= len(columns):
        raise AnalysisError("Factor count must be smaller than number of selected variables.")
    matrix, n, missing = _numeric_frame(df, columns, variable_specs)
    p = len(columns)

    check = correlation_factorability(matrix)
    if check["kmo"] < 0.5:
        raise AnalysisError(
            f"Overall KMO is {check['kmo']:.3f}, below 0.50. "
            "These variables are not adequately factorable. Revise items before EFA."
        )

    # Reproducible Monte Carlo comparisons are computed from the same complete
    # real-case matrix, but simulated null cases are never added to the dataset.
    retention = parallel_analysis(matrix, simulations=parallel_runs, seed=parallel_seed)

    with warnings.catch_warnings(record=True) as seen:
        warnings.simplefilter("always")
        try:
            model = Factor(matrix, n_factor=n_factors, method="pa", smc=True, missing="raise")
            fit = model.fit(maxiter=200, tol=1e-8)
            selected_rotation = rotation if n_factors > 1 else "none"
            if selected_rotation in ("varimax", "oblimin"):
                fit.rotate(selected_rotation)
        except (ValueError, FloatingPointError, ArithmeticError, np.linalg.LinAlgError,
                RuntimeError, AssertionError) as exc:
            raise AnalysisError(
                "Principal-axis factor extraction/rotation failed. "
                "Check missingness, correlations, sample size and factor count."
            ) from exc

    loadings = np.asarray(fit.loadings, dtype=float)
    communality = np.asarray(fit.communality, dtype=float)
    uniqueness = np.asarray(fit.uniqueness, dtype=float)
    # Statsmodels' oblimin is quartimin; rotation T is the transform of
    # canonical factors. Phi = T.T @ T is their correlation matrix and
    # structure = pattern @ Phi. Unlike orthogonal varimax, squared pattern
    # loadings do not in general equal communalities.
    phi = None
    structure_loadings = None
    if selected_rotation == "oblimin":
        rotation_matrix = np.asarray(fit.rotation_matrix, dtype=float)
        phi = rotation_matrix.T @ rotation_matrix
        phi = (phi + phi.T) / 2
        structure_loadings = loadings @ phi
        if (phi.shape != (n_factors, n_factors) or
                not np.isfinite(phi).all() or
                not np.allclose(np.diag(phi), 1, atol=1e-5) or
                np.linalg.eigvalsh(phi).min() <= 1e-8 or
                not np.isfinite(structure_loadings).all()):
            raise AnalysisError("Oblique rotation produced an invalid factor-correlation matrix.")
    if (loadings.shape != (p, n_factors) or
        communality.shape != (p,) or uniqueness.shape != (p,) or
        not np.isfinite(loadings).all() or
        not np.isfinite(communality).all() or
        not np.isfinite(uniqueness).all()):
        raise AnalysisError("Factor solution is unstable or contains non-finite estimates.")

    messages = [
        "Exploratory factors are proposed latent patterns, not proof of a validated instrument or causal effect.",
        f"Complete-case (listwise) deletion: {n} usable respondents; {missing} excluded from the {n + missing} original rows.",
        "Factor count was supplied by the researcher; Kaiser >1 and parallel analysis are descriptive aids, not automatic factor-retention decisions.",
        f"Parallel analysis used {retention['simulations']} reproducible independent Gaussian simulations "
        f"(seed {retention['seed']}) and compared *full Pearson correlation* component eigenvalues "
        "at the 95th percentile. This is not parallel analysis of principal-axis common-factor eigenvalues.",
        "Pearson correlations assume numeric item coding treated as approximately continuous. "
        "For strongly ordinal/non-normal Likert data, polychoric EFA may be more suitable; it is not included.",
        "Common-factor extraction uses Statsmodels principal axes (PAF, squared multiple correlation starting communalities), not principal components analysis (PCA).",
        "Loadings can flip signs without changing the substantive factor solution. "
        "Factors must be interpreted using item content and theory, not named automatically.",
        "Bartlett's χ² is an asymptotic approximation under distributional assumptions; "
        "a small p-value alone does not prove adequate measurement quality.",
        "Statsmodels Factor is experimental; reproduce findings with an independent reference implementation before publication.",
    ]
    if n < 10 * p:
        messages.append(
            "Fewer than ten complete cases per item. This may destabilize loadings; "
            "sample adequacy depends on communalities and factor strength."
        )
    if check["bartlett_p"] >= .05:
        messages.append("Bartlett's sphericity test is not significant at .05; the items may be poorly suited to factor extraction.")
    if check["kmo"] < .6:
        messages.append(f"Overall KMO {check['kmo']:.3f} is marginal. Review items and theoretical rationale.")
    if any(x < .5 for x in check["msa"]):
        bad = [name for name, msa in zip(columns, check["msa"]) if msa < .5]
        messages.append("Per-item MSA below .50 for: " + ", ".join(bad[:12]) +
                        ". Consider item revision and rerun a separately documented model.")
    if np.any(communality > 1.001) or np.any(communality < -.001) or np.any(uniqueness < -.001):
        messages.append("Heywood/improper communalities or uniqueness estimates detected. "
                        "Do not interpret this as a stable, valid factor solution.")
    if selected_rotation == "none" and n_factors == 1 and rotation != "none":
        messages.append("Rotation not applied: one-factor solutions do not benefit from rotation.")
    if selected_rotation == "oblimin":
        messages.append("Oblimin uses Statsmodels' oblique quartimin rotation. Interpret *pattern* and "
                        "*structure* matrices separately; estimated factor correlations are not causal links.")
    if retention["leading_count"] != n_factors:
        messages.append(
            f"The leading-component 95th-percentile parallel benchmark suggests "
            f"{retention['leading_count']} component(s), while you requested {n_factors} common factor(s). "
            "This difference requires theoretical and methodological review, not an automatic override."
        )
    if any(isinstance(w.message, (RuntimeWarning, UserWarning)) for w in seen):
        messages.append("Numerical warnings arose during extraction. Check estimates independently before use.")

    eigenvalues = check["eigenvalues"]
    kaiser = int(np.sum(eigenvalues > 1.0))
    load_rows = []
    for j, name in enumerate(columns):
        loading_values = [float(x) for x in loadings[j]]
        top = np.sort(np.abs(loading_values))[::-1]
        crossload = bool(len(top) > 1 and top[0] >= .30 and top[1] >= .30)
        major = int(np.argmax(np.abs(loading_values)) + 1) if max(np.abs(loading_values)) >= .3 else None
        load_rows.append([name, *[fnum(x, 4) for x in loading_values],
                          fnum(communality[j], 4), fnum(uniqueness[j], 4),
                          fnum(check["msa"][j], 4), major, "Yes" if crossload else "No"])
    if any(row[-1] == "Yes" for row in load_rows):
        messages.append("One or more items cross-load at |loading| ≥ .30 on two or more factors. "
                        "Review construct definition; thresholds are descriptive heuristics.")

    score_rows = [
        [i + 1, fnum(value, 4), fnum(retention["null_mean"][i], 4),
         fnum(retention["null_95"][i], 4),
         "Yes" if retention["exceeds_95"][i] else "No",
         "Yes" if value > 1. else "No"]
        for i, value in enumerate(eigenvalues)
    ]
    tables = [
        table("Factorability and sample characteristics",
              ["Complete N", "Listwise omitted", "Variables", "Overall KMO",
               "Bartlett χ²", "df", "Bartlett p", "Correlation det(R)"],
              [[n, missing, p, fnum(check["kmo"], 4), fnum(check["bartlett_chi2"], 3),
                check["bartlett_df"], fnum(check["bartlett_p"], 7), fnum(check["determinant"], 8)]],
              "KMO uses off-diagonal squared Pearson/partial correlations. "
              "Bartlett's test assesses whether the correlation matrix differs from identity."),
        table("Parallel analysis and Pearson correlation eigenvalues",
              ["Rank", "Observed eigenvalue", "Null mean", "Null 95th percentile",
               "Above null 95th?", "Kaiser > 1"], score_rows,
              f"Horn-style benchmark: {retention['simulations']} independent standard-normal "
              f"simulations with {n} complete cases and {p} variables, random seed {retention['seed']}. "
              "The original Pearson correlation matrix is compared to null component eigenvalues. "
              "These are not extracted common-factor eigenvalues; the guide does not select a PAF model automatically."),
        table("Principal-axis factor loadings (" + selected_rotation + " rotation)",
              ["Item", *[f"Factor {i + 1}" for i in range(n_factors)],
               "Communality", "Uniqueness", "MSA", "Largest |loading| factor", "Cross-loading ≥ .30"],
              load_rows,
              "Principal-axis common-factor loadings. With oblimin, these are the "
              "*pattern* coefficients, not structure correlations; squared pattern "
              "coefficients should not be summed to estimate communalities. "
              "Communalities/uniquenesses are model estimates. Factor order and signs are indeterminate."),
    ]
    if phi is not None:
        tables.append(table("Oblique factor correlation matrix (Phi)",
                            ["Factor", *[f"Factor {i + 1}" for i in range(n_factors)]],
                            [[f"Factor {i + 1}", *[fnum(v, 4) for v in phi[i]]]
                             for i in range(n_factors)],
                            "Factor associations implied by oblique quartimin rotation; "
                            "not observed person-level correlations or causal estimates."))
        tables.append(table("Oblique structure matrix (item–factor correlations)",
                            ["Item", *[f"Factor {i + 1}" for i in range(n_factors)]],
                            [[name, *[fnum(v, 4) for v in structure_loadings[i]]]
                             for i, name in enumerate(columns)],
                            "Structure = pattern × Phi; pattern and structure differ when factors correlate."))
    narrative = (
        f"Exploratory principal-axis analysis of {p} selected observed variables and {n} complete "
        f"respondent rows ({missing} omitted). Overall KMO = {check['kmo']:.3f}. "
        f"Bartlett's χ²({check['bartlett_df']}) = {check['bartlett_chi2']:.2f}, "
        f"p {p_text(check['bartlett_p'])}. "
        f"The researcher specified {n_factors} factor(s), "
        f"with {selected_rotation} rotation; {kaiser} raw correlation eigenvalue(s) exceed 1. "
        f"The 95th-percentile *component*-eigenvalue benchmark has {retention['leading_count']} "
        "leading component(s) above their simulated null values. "
        "These comparisons do not determine the correct common-factor count. "
        "Examine item meanings, adequacy and replication before naming the factors."
    )
    response = result("Exploratory Factor Analysis (principal axes)", tables, narrative, messages,
                      chart={"type": "bar", "labels": [f"Component {i+1}" for i in range(p)],
                             "values": [fnum(v, 4) for v in eigenvalues],
                             "label": "Correlation eigenvalue",
                             "note": "Original Pearson correlation matrix eigenvalues; "
                                     "not loadings and not a claim of extracted factor variance."},
                      method=f"Principal-axis common-factor extraction; {selected_rotation} rotation; "
                             "Pearson correlations; listwise valid cases; researcher-chosen factor count.")
    response["efa_metadata"] = {
        "input_kind": "observed_case_rows", "complete_n": n, "excluded_n": missing,
        "variables": columns, "factors": n_factors, "rotation": selected_rotation,
        "extraction": "principal_axis", "correlation": "pearson",
        "missing": "listwise", "manual_review_required": True,
        "kmo": fnum(check["kmo"], 6),
        "bartlett_p": fnum(check["bartlett_p"], 9),
        "kaiser_count": kaiser,
        "parallel_analysis": {
            "simulations": retention["simulations"],
            "seed": retention["seed"],
            "comparison": "pearson_correlation_component_eigenvalues",
            "percentile": 95,
            "leading_components_above_null": retention["leading_count"],
            "is_common_factor_parallel_analysis": False,
        },
        "oblique_pattern_structure_separate": phi is not None,
        "is_confirmatory_factor_analysis": False,
    }
    return response
