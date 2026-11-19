"""Bounded GARCH(1,1) volatility forecasts for *observed* financial time series.

The local FastAPI edition uses the independent `arch` numerical library.
No prices/returns are sent to AI services or to the Cloudflare Worker.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from arch import arch_model
from statsmodels.stats.diagnostic import het_arch

from .stats_engine import AnalysisError, fnum, result, table

MIN_OBSERVATIONS = 150
MAX_OBSERVATIONS = 2500
INPUT_TYPES = ("prices", "returns_percent", "returns_decimal")


def _prepare(df: pd.DataFrame, column: str, input_type: str) -> tuple[np.ndarray, str]:
    if not isinstance(column, str) or column not in df.columns:
        raise AnalysisError("Select an existing numeric price or return variable.")
    if input_type not in INPUT_TYPES:
        raise AnalysisError("Select an explicit input type: prices, returns_percent or returns_decimal.")
    if not MIN_OBSERVATIONS <= len(df) <= MAX_OBSERVATIONS:
        raise AnalysisError(f"GARCH requires {MIN_OBSERVATIONS}–{MAX_OBSERVATIONS} equally spaced, chronologically ordered rows.")
    values = pd.to_numeric(df[column], errors="coerce")
    if values.isna().any():
        raise AnalysisError("GARCH cannot infer missing periods or convert text observations. Correct the dataset first.")
    series = np.asarray(values, dtype=float)
    if not np.isfinite(series).all():
        raise AnalysisError("The chosen series must contain only finite numbers.")
    if input_type == "prices":
        if np.any(series <= 0):
            raise AnalysisError("Financial prices must be positive to compute logarithmic percentage returns.")
        returns = 100.0 * np.diff(np.log(series))
        transform = "100 × [ln(price_t) − ln(price_t−1)] (log returns in percentage points)"
    elif input_type == "returns_decimal":
        if np.any(np.abs(series) > 2.0):
            raise AnalysisError("Decimal returns above 200% in magnitude require review. Confirm units or supply percent returns explicitly.")
        returns = series * 100.0
        transform = "decimal returns × 100 (percentage points)"
    else:
        returns = series
        transform = "input already supplied as percentage-point returns (no transform)"
    if not np.isfinite(returns).all() or np.std(returns) <= 1e-8:
        raise AnalysisError("GARCH requires non-constant, finite financial returns.")
    if np.any(np.abs(returns) > 100):
        raise AnalysisError("Returns over 100 percentage points in magnitude are outside this guarded teaching workflow. Review data and units.")
    return returns, transform


def _fit(returns: np.ndarray):
    try:
        model = arch_model(
            returns, mean="Constant", vol="GARCH", p=1, o=0, q=1,
            dist="normal", rescale=False,
        )
        fit = model.fit(disp="off", show_warning=False, options={"maxiter": 180})
    except (ValueError, TypeError, OverflowError, ArithmeticError, np.linalg.LinAlgError) as exc:
        raise AnalysisError("GARCH optimisation failed. Check return units, variability and time order.") from exc
    if getattr(fit, "convergence_flag", 1) != 0:
        raise AnalysisError("GARCH did not converge; predictions would be unreliable. Check data before retrying.")
    params = fit.params
    if any(not np.isfinite(float(params[name])) for name in ["mu", "omega", "alpha[1]", "beta[1]"]):
        raise AnalysisError("GARCH returned invalid model parameters.")
    return fit


def _variance_forecast(fit, horizon: int) -> np.ndarray:
    try:
        output = np.asarray(fit.forecast(horizon=horizon, method="analytic", reindex=False).variance.iloc[-1], dtype=float)
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise AnalysisError("GARCH failed to produce the requested variance forecasts.") from exc
    if output.shape != (horizon,) or np.any(~np.isfinite(output)) or np.any(output <= 0):
        raise AnalysisError("GARCH returned non-positive or invalid forecast variances.")
    return output


def _variance_losses(pred: np.ndarray, proxy: np.ndarray) -> tuple[float, float]:
    # Realized squared innovations are a *noisy proxy* for latent conditional variance.
    mse = float(np.mean((pred - proxy) ** 2))
    qlike = float(np.mean(np.log(pred) + proxy / pred))
    return mse, qlike


def garch_volatility(df: pd.DataFrame, column: str, *, input_type: str = "prices",
                     steps: int = 5) -> dict:
    """Predict conditional variance with one untouched, contiguous holdout.

    Holdout evaluation makes *static* multi-step forecasts from one origin.
    The naive comparator is the constant historical training sample variance.
    """
    if type(steps) is not int or not 1 <= steps <= 12:
        raise AnalysisError("Choose an integer forecast horizon between 1 and 12 periods.")
    returns, transformation = _prepare(df, column, input_type)
    holdout = min(24, max(12, len(returns) // 10))
    training, observed = returns[:-holdout], returns[-holdout:]
    train_fit = _fit(training)
    train_predicted_variance = _variance_forecast(train_fit, holdout)
    reference_mean = float(train_fit.params["mu"])
    observed_proxy = (observed - reference_mean) ** 2
    reference_variance = float(np.var(training, ddof=1))
    if reference_variance <= 0 or not np.isfinite(reference_variance):
        raise AnalysisError("Cannot construct a reliable training-only reference variance.")
    baseline = np.full(holdout, reference_variance)
    mse, qlike = _variance_losses(train_predicted_variance, observed_proxy)
    base_mse, base_qlike = _variance_losses(baseline, observed_proxy)

    full_fit = _fit(returns)
    variance = _variance_forecast(full_fit, steps)
    volatility = np.sqrt(variance)
    params = full_fit.params
    persistence = float(params["alpha[1]"] + params["beta[1]"])
    standardized = np.asarray(full_fit.std_resid, dtype=float)
    standardized = standardized[np.isfinite(standardized)]
    if len(standardized) < 25:
        raise AnalysisError("Not enough finite residuals for GARCH diagnostics.")
    # After fitting, remaining ARCH effects are assessed on standardized residuals.
    lm_stat, lm_p, _, _ = het_arch(standardized, nlags=10)
    if not np.isfinite(lm_p):
        raise AnalysisError("Residual ARCH diagnostic could not be computed.")

    cautions = [
        "Sort original rows oldest-to-newest and ensure equally spaced periods. Dates and gaps are not automatically checked.",
        "GARCH models conditional volatility of returns, not future prices, investment profits, or causal effects.",
        "Evaluation uses a single fixed-origin multi-step holdout. Realized squared innovations are a noisy proxy for latent variance, so holdout scores alone cannot validate a risk model.",
        "Forecast volatility is reported in return percentage points per observation period, not annualized. Distribution assumption: normal innovations.",
    ]
    if mse >= base_mse:
        cautions.append("GARCH did not outperform the historical-variance baseline on holdout variance-proxy MSE.")
    if qlike >= base_qlike:
        cautions.append("GARCH did not outperform the historical-variance baseline on holdout QLIKE.")
    if persistence >= 1.0:
        cautions.append("Estimated alpha + beta is at least 1; the fitted volatility process may lack finite long-run variance.")
    if lm_p < .05:
        cautions.append("ARCH-LM on standardized residuals is significant; remaining conditional heteroskedasticity warrants model review.")

    return result(
        f"GARCH(1,1) volatility — {column}",
        [
            table("Input and estimation", ["Original rows", "Return observations", "Train returns",
                                           "Holdout returns", "Input type", "AIC", "BIC"],
                  [[len(df), len(returns), len(training), holdout, input_type,
                    fnum(full_fit.aic), fnum(full_fit.bic)]],
                  f"Observed-data transformation: {transformation}. Only the final holdout is excluded from the training fit."),
            table("Fitted parameters", ["Parameter", "Estimate"],
                  [[name, fnum(float(params[name]), 6)] for name in ["mu", "omega", "alpha[1]", "beta[1]"]]
                  + [["alpha + beta", fnum(persistence, 6)]]),
            table("Out-of-sample variance proxy benchmark", ["Model", "MSE on squared innovations", "QLIKE", "Horizon"],
                  [["GARCH(1,1)", fnum(mse, 6), fnum(qlike, 6), f"{holdout} periods"],
                   ["Historical training variance", fnum(base_mse, 6), fnum(base_qlike, 6), f"{holdout} periods"]],
                  "Lower loss is better. Both models are fit without the final holdout. Squared returns do not reveal true latent variance."),
            table("Conditional variance forecast", ["Future period", "Variance (percent-points squared)",
                                                    "Volatility (percent points)"],
                  [[f"T+{i+1}", fnum(variance[i], 6), fnum(volatility[i], 6)] for i in range(steps)]),
            table("Residual diagnostic", ["Test", "Lag", "Statistic", "p-value"],
                  [["ARCH-LM on standardized residuals", 10, fnum(lm_stat, 6), fnum(lm_p, 6)]],
                  "Residual ARCH effects challenge the adequacy of the model but do not directly measure predictive error."),
        ],
        (f"GARCH(1,1) estimates conditional volatility of {column} using {len(returns)} real ordered returns. "
         f"Holdout variance-proxy MSE is {mse:.4g} versus {base_mse:.4g} for a training-only constant-variance comparator. "
         "The forecasts are estimates of return volatility, not return direction or guaranteed risk."),
        warnings=cautions,
        chart={"type": "bar", "labels": [f"T+{i+1}" for i in range(steps)],
               "values": [float(v) for v in volatility],
               "note": "Future conditional volatility in percentage points per period; not future returns."},
        method=("arch GARCH(1,1), constant mean, normal innovations; chronological static multi-step holdout "
                "with no training leakage; benchmark against constant training-sample variance; "
                "ARCH-LM diagnostic on standardized residuals."),
    )
