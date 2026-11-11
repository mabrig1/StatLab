// Positive integer and half-integer parameters from t and F distributions.
const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7];
function logGamma(z) {
  const x = z - 1;
  const sum = coefficients.reduce((s, c, i) => s + c / (x + i + 1), 0.9999999999998099);
  const t = x + 7.5;
  return 0.9189385332046727 + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

// Modified Lentz continued fraction for the regularized incomplete beta.
function betaFraction(a, b, x) {
  const safe = n => Math.abs(n) < 1e-300 ? 1e-300 : n;
  let c = 1, d = 1 / safe(1 - (a + b) * x / (a + 1)), value = d;
  for (let i = 1; i <= 1000; i++) {
    const k = 2 * i;
    let step = i * (b - i) * x / ((a + k - 1) * (a + k));
    d = 1 / safe(1 + step * d);
    c = safe(1 + step / c);
    value *= d * c;
    step = -(a + i) * (a + b + i) * x / ((a + k) * (a + k + 1));
    d = 1 / safe(1 + step * d);
    c = safe(1 + step / c);
    const change = d * c;
    value *= change;
    if (Math.abs(change - 1) < 1e-13) return value;
  }
  throw Error('The probability calculation did not converge.');
}

export function fSurvival(f, numeratorDF, denominatorDF) {
  if (f === 0) return 1;
  const a = denominatorDF / 2, b = numeratorDF / 2;
  const ratio = f * (numeratorDF / denominatorDF);
  const x = 1 / (1 + ratio), y = ratio < 1 ? ratio / (1 + ratio) : 1 - x;
  if (x === 0) return 0;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
    - a * Math.log1p(ratio) + b * Math.log(y));
  const value = x < (a + 1) / (a + b + 2)
    ? front * betaFraction(a, b, x) / a : 1 - front * betaFraction(b, a, y) / b;
  return Math.max(0, Math.min(1, value));
}

export function intervals95(df, estimates) {
  // t² follows F(1, df). At df >= 1 the 97.5th percentile is below 13.
  let lower = 0, upper = 13;
  for (let i = 0; i < 45; i++) {
    const mid = (lower + upper) / 2;
    if (fSurvival(mid * mid, 1, df) > 0.05) lower = mid;
    else upper = mid;
  }
  return estimates.map(([label, estimate, standardError]) => {
    const margin = (lower + upper) / 2 * standardError;
    return {label, estimate, standardError, df, lower: estimate - margin, upper: estimate + margin};
  });
}
