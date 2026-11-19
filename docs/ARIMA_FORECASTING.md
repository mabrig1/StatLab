# ARIMA forecasting in MABRIG StatLab (first advanced-analysis slice)

**Implementation scope:** The existing **local Python/FastAPI** edition only. The separate Cloudflare/Worker/browser edition does not run Python forecasting or call the local API. No production secrets, D1 database, public API, migration or external AI service are involved.

## Try the practice dataset first

Download `samples/SYNTHETIC_arima_monthly_demo.csv` from this branch. Its 96 monthly values are **generated demonstration data**, not observations of UNN students, a real market or a published study. Import it and select the `value` column; its `month` text column simply documents chronology.

## Student workflow

1. Prepare an observed CSV, TSV, Excel or SPSS SAV dataset, sorted **oldest to newest**.
2. Use one numeric variable with one observation at each **equally spaced period** (daily, monthly, quarterly, etc.). Do not assume missing timestamps are filled automatically.
3. Open the local StatLab -> Import data -> Analysis workbench -> **ARIMA time-series forecasting (local)**.
4. Select the variable, choose p (0–2), d (0–1), q (0–2) with p+q <= 3, and a 1–12-period forecast horizon. Start at (1,0,0) only as a teaching default; select orders from domain knowledge, stationarity checks and model diagnostics, not an invented "optimal" setting.
5. Review the actual last-period holdout against a **naive last-value baseline**, MAE/RMSE, residual Ljung–Box result, full-model AIC/BIC and 95% forecast intervals. Report all caveats alongside results.
6. Download the HTML report or reproducible recipe in the existing output viewer. The browser UI never infers a timestamp or time frequency.

## Computational contract and limitations

- Uses `statsmodels.tsa.arima.model.ARIMA`; requires **50–1,200** observed, finite, non-constant, numeric rows and zero missing observations. This cap bounds CPU/memory on a local workstation.
- Fits a model using **only the earliest observations**. The last min(24, max(8, N//5)) periods are an out-of-sample **contiguous holdout**, not shuffled or used as fitting targets.
- Evaluates a genuine multistep static forecast against the withheld observations; a naive predictor repeats the last training value. Reports both MAE and RMSE.
- Re-fits a model to the full series for the requested 1–12 future periods and model-conditional 95% intervals. The table labels future periods T+1, etc., since date parsing and frequency verification are **not implemented**.
- Reports Ljung–Box residual-autocorrelation diagnostic for the final fit, flags p < 0.05, and warns when ARIMA does not outperform naive MAE.
- Model convergence is required. Failed/non-finite fits fail closed. The researcher remains responsible for stationarity, seasonal effects, anomalies, transformations, order selection and independent validation.
- These results are **not** validated against the UNN thesis dataset. Synthetic numerical fixtures in tests are development data, not empirical evidence.
- The local FastAPI server has **no multi-user authentication or tenant isolation**. Bind to `127.0.0.1`; do not publish the raw statistical API.

## Validation

Run:

```bash
pip install -r requirements-dev.txt
pytest -q tests/test_advanced_timeseries.py
pytest -q
node --check app/static/app.js
```

CI must pass before merge. Compare the output with an independent R or Python implementation and a real, rights-cleared UNN time-series dataset before describing predictive performance in an academic paper.

## Planned follow-up (not implemented)

1. Date/time column selection with explicit sort, duplicate detection, frequency/integrity checks and training/test data lineage.
2. An ADF/KPSS diagnostics assistant, fixed order comparison, and walk-forward cross-validation.
3. GARCH volatility modelling **only on appropriately transformed financial return series**, with held-out risk estimates, parameter and convergence checks, and dedicated `arch` dependency.
4. Opt-in remote compute via authenticated service endpoints and asynchronous job status, without uploading participant data by default.

No GARCH, VAR, VECM, Bayesian forecasting or public Cloudflare computation is claimed to be implemented by this first slice.
