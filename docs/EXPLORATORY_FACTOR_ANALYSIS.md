# Exploratory Factor Analysis — Local StatLab Guide

**Implementation:** local Python/FastAPI workstation, not Cloudflare browser deployment. Added as an incremental research-method feature; does not make StatLab an independently validated IBM SPSS equivalent.

## What this module does

The researcher imports **observed, paired respondent-level cases** (CSV, TSV, XLSX, SAV) in the local FastAPI workstation, chooses **Analysis Workbench → Exploratory Factor Analysis**, selects **4 to 25 numeric scale/ordinal variables**, chooses **1 to 6 factors** (fewer than the item count), and chooses either orthogonal **varimax** or **no rotation**. The number of factors is an *explicit researcher choice*—it is not secretly selected to obtain desirable-looking results.

This is an **exploratory common-factor** workflow using **principal-axis factoring (PAF)** through Statsmodels `multivariate.factor.Factor(method="pa", smc=True)`; it is **not principal components analysis (PCA)**, nor confirmatory factor analysis (CFA), nor a polychoric analysis of ordinal responses.

### Factorability and adequacy checks

- **Complete-case / listwise deletion** after honoring Variable View's user-defined missing codes. Missing observations are excluded *together across selected items*; counts are reported. No mean imputation or reconstruction of individual responses.
- Hard safety gate: minimum **50 complete cases and five complete cases per selected variable**; maximum 10,000 complete cases and 25 variables in a single interactive EFA. Ten cases per item may be more appropriate in many weak or complex factor structures; the app issues a warning when this stricter heuristic is not met. These thresholds are conservative product guardrails, not universal sample-size theorems.
- Reject invalid mixed text/date/nominal items, constant variables, nonfinite values, exact/near-linear dependencies and singular correlation matrices. Strong ordinal skew or item distribution departures require methodological judgment.
- **Kaiser–Meyer–Olkin (KMO)** overall adequacy and per-item measures of sampling adequacy (MSA) are derived from Pearson correlations and partial correlations; if overall KMO is below **0.50**, the procedure refuses extraction. Below .60, the result is flagged as marginal. Items with MSA below .50 are flagged for review.
- **Bartlett's test of sphericity** approximates a chi-square statistic under distributional assumptions. A non-significant value is warned about, rather than treated as proof of a high-quality/low-quality measurement instrument.
- The scree/retention table lists **eigenvalues of the original Pearson correlation matrix** and a descriptive >1 heuristic. Correlation eigenvalues are **not** described as extracted-factor percentages or automatically interpreted as factor counts.
- For each item, the model reports **principal-axis factor loadings, communality, uniqueness, per-item MSA, largest loading factor, and descriptive cross-loading flag** (two or more absolute loadings ≥ .30).
- **Signs and factor order are indeterminate**. Naming factors requires the researcher's item content and theory, ideally independent validation.
- Statsmodels calls its EFA factor module *experimental*. Software outputs must be replicated with a trusted independent implementation before high-stakes publication. Numerical or improper-solution warnings are surfaced rather than concealed.

### Important limitations

1. **Pearson correlation assumption:** numerical Likert codes are treated as approximately continuous; strongly ordinal or sparse scales may need **polychoric** associations, not offered here. Reverse-keyed items must be recoded in Variable View before factor extraction.
2. **No oblique rotation:** only varimax (orthogonal, assumes uncorrelated factors) or no rotation are supported. In domains where correlated constructs are expected, an oblique rotation such as oblimin/promax should be a separately validated future enhancement. Do not assume underlying constructs are independent.
3. **No factor scores or respondent-level transformations** are automatically saved. The source dataset is unchanged; the output is a descriptive exploratory result only.
4. **No parallel analysis**, ordinal correlation fitting, CFA, fit indices, dimensionality proof, cross-validation, measurement invariance, or multi-group factor comparisons. Kaiser >1 alone should not determine factors.
5. **No raw source upload to Cloudflare**: this module runs in local FastAPI and is gated by an existing dataset ID with observed cases. The frequency-only API explicitly cannot accept `analysis=efa` or infer factor structure from item marginals.

## Results and traceability

The existing `POST /api/analyze` endpoint accepts:

```json
{
  "dataset_id": "<a valid imported local dataset ID>",
  "analysis": "efa",
  "columns": ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
  "factor_count": 2,
  "factor_rotation": "varimax"
}
```

The response uses the **existing results viewer**, including three tables (factorability, correlation eigenvalues, PAF loadings), warnings, a descriptive scree bar chart, and the original local dataset provenance (filename, SHA-256 of imported source, data revision, timestamp). The `efa_metadata` object adds input-kind, n complete, excluded rows, chosen factors, rotation, extraction method, KMO and Bartlett p-value. There are **no fabricated respondent cases, effect sizes, or hypothesis decisions**.

This release does not add new API credentials, backend data storage, cloud deployment, or services.

## Numerical references and testing

- Statsmodels Factor source and documentation: https://www.statsmodels.org/stable/generated/statsmodels.multivariate.factor.Factor.html
- Bartlett (1951) approximation: `chi^2 = -[N - 1 - (2p + 5)/6] * log(det(R))` with `df=p(p-1)/2`.
- KMO: ratio of squared off-diagonal item correlations to the sum of squared raw and partial correlations. Per-item MSA uses row-level quantities.
- Validation: independent formula checks for KMO, Bartlett χ² and df, Pearson scree eigenvalues; separate direct Statsmodels PAF solution; reproducible **synthetic** two-factor matrix with known generating structure. API tests verify source provenance and that frequency-only remains isolated.

## Future development

**v1.1+** after reproducibility review: implement defensible **parallel analysis** for factor retention with independently matched reference fixtures; oblique rotation pattern/structure tables and factor correlations; polychoric correlations for ordinal survey items; CFA and cross-validation in separate releases. Avoid making up methods or labelling unimplemented ones as complete.

To run locally:

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then visit `http://127.0.0.1:8000`. The web app has no authentication or multi-tenant isolation; **do not** expose its dataset upload and analysis endpoints on the public internet as-is.
