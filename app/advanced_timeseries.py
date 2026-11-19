"""Bounded, observed-case ARIMA forecasting for the local StatLab edition.

Time is represented only by existing row order; callers must sort externally.
The holdout is always contiguous and excluded from training to avoid leakage.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tools.sm_exceptions import ConvergenceWarning

from .stats_engine import AnalysisError, fnum, result, table

MIN_CASES = 50
MAX_CASES = 1200


def _fit(values: np.ndarray, order: tuple[int, int, int]):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            fitted = ARIMA(values, order=order,
                           enforce_stationarity=True,
                           enforce_invertibility=True).fit(method_kwargs={"maxiter": 100})
    except (ValueError, TypeError, ArithmeticError, np.linalg.LinAlgError) as exc:
        raise AnalysisError("ARIMA could not fit these observations; try another order or inspect the series.") from exc
    converged = getattr(fitted, "mle_retvals", {}).get("converged", True)
    if not converged:
        raise AnalysisError("ARIMA optimisation did not converge. Try a simpler model or check your time series.")
    return fitted


def arima_forecast(df: pd.DataFrame, column: str, *, p: int = 1,
                   d: int = 0, q: int = 0, steps: int = 6) -> dict:
    """Forecast a single ordered series, with a strictly held-out naive baseline."""
    if column not in df.columns or not isinstance(column, str):
        raise AnalysisError("Select an existing numerical time-series variable.")
    if any(type(x) is not int for x in (p, d, q, steps)):
        raise AnalysisError("ARIMA settings must be integers.")
    if not (0 <= p <= 2 and 0 <= d <= 1 and 0 <= q <= 2 and p + q <= 3):
        raise AnalysisError("Supported ARIMA orders are p/q=0–2, d=0–1, with p+q at most 3.")
    if not 1 <= steps <= 12:
        raise AnalysisError("Choose 1–12 forecast periods.")
    if not MIN_CASES <= len(df) <= MAX_CASES:
        raise AnalysisError(f"ARIMA requires {MIN_CASES}–{MAX_CASES} chronologically ordered rows.")
    values = pd.to_numeric(df[column], errors="coerce")
    if values.isna().any():
        raise AnalysisError("ARIMA requires one numeric observation at every regular time step. Resolve missing/text values first; rows must not be silently dropped.")
    y = values.to_numpy(dtype=float)
    if not np.isfinite(y).all() or np.ptp(y) <= 1e-12:
        raise AnalysisError("ARIMA needs finite, non-constant observations.")

    order = (p, d, q)
    holdout = max(8, min(24, len(y) // 5))
    train, actual = y[:-holdout], y[-holdout:]
    training_fit = _fit(train, order)
    predicted = np.asarray(training_fit.get_forecast(steps=holdout).predicted_mean, dtype=float)
    naive = np.full(holdout, train[-1], dtype=float)
    if not np.isfinite(predicted).all():
        raise AnalysisError("ARIMA returned non-finite backtest predictions.")
    mae = float(np.mean(np.abs(actual - predicted)))
    rmse = float(np.sqrt(np.mean((actual - predicted) ** 2)))
    naive_mae = float(np.mean(np.abs(actual - naive)))
    naive_rmse = float(np.sqrt(np.mean((actual - naive) ** 2)))

    final = _fit(y, order)
    future = final.get_forecast(steps=steps)
    means = np.asarray(future.predicted_mean, dtype=float)
    intervals = np.asarray(future.conf_int(alpha=0.05), dtype=float)
    if intervals.shape != (steps, 2) or not np.isfinite(means).all() or not np.isfinite(intervals).all():
        raise AnalysisError("ARIMA returned invalid forecast intervals; review the model order.")

    lag = min(10, max(1, len(y) // 5))
    lb = acorr_ljungbox(np.asarray(final.resid, dtype=float), lags=[lag], return_df=True)
    lb_p = float(lb["lb_pvalue"].iloc[0])
    cautions = [
        "Each CSV/Excel row is treated as the next equally spaced time period. Sort chronologically and check equal intervals before importing; dates are not validated.",
        "The holdout is the last observations, excluded from training. Report both ARIMA and naive forecast error; these are not causal estimates.",
        "95% intervals are conditional model-based estimates; their real-world coverage has not been independently calibrated.",
    ]
    if mae >= naive_mae:
        cautions.append("ARIMA did not beat the naive last-observation baseline on holdout MAE; do not claim improved prediction accuracy.")
    if np.isfinite(lb_p) and lb_p < 0.05:
        cautions.append("Ljung–Box suggests residual autocorrelation (p < 0.05). Review model adequacy and differencing.")
    if d == 0:
        cautions.append("No differencing was selected. Examine stationarity and trend before interpreting a level-series forecast.")

    return result(
        f"ARIMA({p},{d},{q}) forecast — {column}",
        [table("Model and holdout", ["N", "Training N", "Holdout N", "Order", "AIC", "BIC"],
               [[len(y), len(train), holdout, f"({p},{d},{q})", fnum(final.aic), fnum(final.bic)]]),
         table("Genuine out-of-sample backtest", ["Model", "MAE", "RMSE", "Horizon"],
               [["ARIMA", fnum(mae), fnum(rmse), f"{holdout}-step holdout"],
                ["Naive last observed value", fnum(naive_mae), fnum(naive_rmse), f"{holdout}-step holdout"]],
               "Lower MAE/RMSE is better. Baseline repeats the final training value without peeking at the holdout."),
         table("Next periods (ordered by row)", ["Horizon", "Forecast", "95% low", "95% high"],
               [[f"T+{i+1}", fnum(means[i]), fnum(intervals[i, 0]), fnum(intervals[i, 1])]
                for i in range(steps)]),
         table("Residual diagnostic", ["Test", "Lag", "p-value"],
               [["Ljung–Box", lag, fnum(lb_p, 6)]],
               "A small p-value suggests remaining serial dependence; it is not a test of forecast accuracy.")],
        f"Forecast for {column} using ARIMA({p},{d},{q}) on {len(y)} equally spaced observations. "
        f"On the final {holdout} withheld periods, ARIMA MAE was {mae:.4g} versus {naive_mae:.4g} for the naive baseline. "
        "Predictions beyond the sample assume the fitted pattern continues; forecasting is not proof of causation.",
        warnings=cautions,
        chart={"type": "bar", "labels": [f"T+{i+1}" for i in range(steps)],
               "values": [float(x) for x in means],
               "note": "Model forecasts only; see the table for 95% uncertainty limits."},
        method="statsmodels ARIMA maximum-likelihood fit; contiguous time-ordered holdout, never shuffled; independent naive baseline; 95% model-based forecast intervals.",
    )
