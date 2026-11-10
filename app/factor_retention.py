"""Reproducible Horn-style parallel analysis for local EFA screening.

This compares eigenvalues of the *observed Pearson correlation matrix* to
independent Gaussian null datasets with the same complete-case sample size
and number of variables. It is a component-eigenvalue retention GUIDE and
does not choose the number of principal-axis common factors automatically.
"""
from __future__ import annotations

import numpy as np

from .stats_engine import AnalysisError

MIN_SIMULATIONS = 50
MAX_SIMULATIONS = 200
MAX_RANDOM_VALUES = 50_000_000


def parallel_analysis(
    observed: np.ndarray,
    *,
    simulations: int = 100,
    seed: int = 20261110,
) -> dict:
    """Return per-rank observed, null mean, and null 95th-percentile eigenvalues.

    The random generator and its seed are local and deterministic for a given
    NumPy version. The function neither modifies the observed cases nor
    stores simulated "respondents" in the research dataset.
    """
    if not isinstance(observed, np.ndarray) or observed.ndim != 2:
        raise AnalysisError("Parallel analysis requires a 2D complete-case numeric matrix.")
    n, p = observed.shape
    if n < 3 or p < 2 or n <= p or not np.isfinite(observed).all():
        raise AnalysisError("Parallel analysis requires finite real cases with more rows than columns.")
    if (not isinstance(simulations, int) or isinstance(simulations, bool)
            or not MIN_SIMULATIONS <= simulations <= MAX_SIMULATIONS):
        raise AnalysisError(f"Parallel analysis needs {MIN_SIMULATIONS}–{MAX_SIMULATIONS} simulations.")
    if (not isinstance(seed, int) or isinstance(seed, bool)
            or not 0 <= seed <= 2**32 - 1):
        raise AnalysisError("Parallel analysis seed must be an integer from 0 to 4294967295.")
    if n * p * simulations > MAX_RANDOM_VALUES:
        raise AnalysisError(
            "Parallel analysis workload exceeds the interactive resource limit. "
            "Reduce the simulation count or use a separately justified data-processing plan."
        )

    observed_r = np.corrcoef(observed, rowvar=False)
    if observed_r.shape != (p, p) or not np.isfinite(observed_r).all():
        raise AnalysisError("Cannot calculate finite observed Pearson correlations.")
    observed_eigen = np.linalg.eigvalsh(observed_r)[::-1]
    if np.min(observed_eigen) < -1e-8:
        raise AnalysisError("Observed item correlation matrix is not positive semidefinite.")

    rng = np.random.default_rng(seed)
    null_eigen = np.empty((simulations, p), dtype=np.float64)
    for k in range(simulations):
        # Independent standard-normal columns. Correlation is invariant to
        # location and scale, so these form a suitable Pearson null reference.
        random_cases = rng.standard_normal((n, p))
        random_r = np.corrcoef(random_cases, rowvar=False)
        null_eigen[k] = np.linalg.eigvalsh(random_r)[::-1]

    null_mean = null_eigen.mean(axis=0)
    null_95 = np.quantile(null_eigen, 0.95, axis=0, method="linear")
    flags = observed_eigen > null_95
    # Retain contiguous leading components only; trailing isolated crossings
    # should not be presented as extra substantive common factors.
    leading = 0
    for flag in flags:
        if not flag:
            break
        leading += 1

    return {
        "observed": observed_eigen,
        "null_mean": null_mean,
        "null_95": null_95,
        "exceeds_95": flags,
        "leading_count": leading,
        "simulations": simulations,
        "seed": seed,
        "reference": "independent standard-normal Pearson correlation matrices",
        "method": "Horn-style component-eigenvalue 95th-percentile comparison",
        "caution": (
            "This benchmark compares eigenvalues of the full Pearson correlation "
            "matrix; it is a component-style retention aid, not an exact "
            "principal-axis common-factor parallel analysis. It does not "
            "automatically select or validate EFA factor count."
        ),
    }
