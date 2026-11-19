# GARCH volatility analysis — MABRIG StatLab local Python edition

**Status:** Draft feature branch; not deployed to Cloudflare. This workflow runs in the local Python/FastAPI edition only. The Cloudflare browser workstation cannot execute this numerical model.

## Why it matters

A financial return can be hard to predict in *direction*, while its **conditional volatility** may still be predictable. This module fits a bounded GARCH(1,1) volatility model and compares its forecasts to a transparent baseline. It is suitable for teaching financial time-series methods at universities, not for investment decisions.

## Student quick start

1. Download `samples/SYNTHETIC_garch_daily_prices.csv`. This is **simulated practice data**, not observations from UNN or a financial exchange.
2. Run the local FastAPI edition on `127.0.0.1`. Import the sample CSV. Do not publish the unprotected API to the internet.
3. Go to **Analysis workbench → GARCH financial-volatility forecasting (local)**.
4. Select the `price` variable. Under **What does this column contain?**, choose **Positive prices**; the engine computes `100 × diff(log(price))` in return percentage points.
5. Choose 3, 5 or 10 future periods. Run analysis. Inspect model parameters, holdout MSE/QLIKE and the baseline, volatility forecasts, ARCH-LM diagnostics and limitations.
6. Download the existing HTML findings report or analysis recipe.

## Input contract

- Requires 150–2,500 chronological, equally spaced dataset **rows**.
- **Dates are not parsed, sorted or checked** in this version. The researcher must check duplicates, holidays and missing periods before importing.
- A selected numeric variable must contain **no gaps, NaNs, non-finite numbers or text**. No silent dropping or interpolation occurs.
- Choose a concrete type rather than auto-detecting:
  - `prices`: strictly positive price levels; converts to **log percentage returns** using adjacent observations; first price yields no return.
  - `returns_percent`: explicit percentage-point return values (e.g., 2.5 means 2.5%).
  - `returns_decimal`: explicit decimal returns (e.g., 0.025 means 2.5%); converts to percentage points.
- Guarded checks reject extreme values beyond the limits of this teaching implementation, nonconstant returns, nonconvergent fits and invalid forecast variances.
- Model: `arch.arch_model` with constant mean, GARCH(1,1), symmetric Gaussian innovations, `rescale=False`, maximum 180 optimisation iterations. GARCH variants, time-varying mean models and empirical error-distribution comparisons are not available yet.

## Backtesting: what is and is not measured

1. Convert observed financial prices to returns **before** determining the holdout.
2. Fit only the earliest observations. With `H=min(24,max(12,N_returns//10))`, the last `H` returns are **withheld** from estimation.
3. Produce a static, *single-origin*, `H`-step conditional variance forecast from the **training-only** model. It does not refit each test period.
4. Compare to the **training-only sample variance**, held constant for all withheld periods.
5. Use `(holdout return − training-estimated mean)^2` as an imperfect observable proxy for future latent variance. Compute mean squared variance-proxy loss and QLIKE loss (`mean(log(pred_variance)+realized_proxy/pred_variance)`). Lower values indicate better *proxy forecast loss* on this particular holdout.
6. Refit the model using all observations for the future 1–12 periods. Report **variance in percentage-points squared** and **volatility in percentage points per period**. No date labels or annualisation are inferred.
7. Run Engle ARCH-LM on standardized fitted residuals and display parameter persistence (`alpha+beta`), AIC/BIC and convergence limitations.

**Do not confuse** this task with price prediction, true latent conditional variance observed in a laboratory, out-of-sample validation of VaR, portfolio risk approval, or evidence of causal effects. A model can lose to the historical-variance baseline. QLIKE and MSE are descriptive losses on a noisy proxy, not guarantees.

## Reproducible checks

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q tests/test_garch_volatility.py
python -m pytest -q
node --check app/static/app.js
```

`arch>=9,<10` is supported for the repo's Python 3.12 CI. The project has a separate ARIMA branch/PR, upon which this new GARCH branch is stacked. The entire branch must be re-tested if the base changes.

## Next validation gates (NOT implemented)

- Select a verified time-index column, check regular frequency and gaps.
- Compare against independent R `rugarch` or Python reference outputs with openly available historical price data and a documented preprocessing recipe.
- Add rolling-origin one-step volatility forecasts, more distributions, GARCH order comparison and proper VaR coverage tests.
- Design a secure opt-in compute service with authentication, quotas, CPU/memory caps, encrypted storage controls and no default upload from browser; only then consider a live Cloudflare interface.

For numerical reference see [arch documentation](https://arch.readthedocs.io/en/stable/univariate/forecasting.html) and [PyPI project](https://pypi.org/project/arch/).
