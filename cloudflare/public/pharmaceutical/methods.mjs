// All routines operate on measured rows. Display rounding happens in the UI.
const mean = values => values.reduce((sum, x) => sum + x, 0) / values.length;
const ss = (values, center) => values.reduce((sum, x) => sum + (x - center) ** 2, 0);
function minimum(rows, n) {
  if (rows.length < n) throw Error(`Enter at least ${n} measurements.`);
}
function nonnegative(rows, column, label) {
  const i = rows.findIndex(row => row[column] < 0);
  if (i >= 0) throw Error(`Measurement ${i + 1}: ${label} must be non-negative.`);
}

function precision(rows) {
  minimum(rows, 2);
  nonnegative(rows, 0, 'measured concentration');
  const values = rows.map(row => row[0]);
  const average = mean(values);
  const sd = Math.sqrt(ss(values, average) / (values.length - 1));
  return {metrics: {'Measurements': values.length, 'Mean (mg/L)': average,
    'Sample SD (mg/L)': sd, 'Relative SD (%)': average === 0 ? null : 100 * sd / average}};
}

function calibration(rows) {
  minimum(rows, 3);
  nonnegative(rows, 0, 'standard concentration');
  const xs = rows.map(row => row[0]), ys = rows.map(row => row[1]);
  const mx = mean(xs), my = mean(ys), xx = ss(xs, mx), yy = ss(ys, my);
  if (new Set(xs).size < 3) throw Error('Supply at least three distinct standard concentrations.');
  const xy = rows.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const slope = xy / xx, intercept = my - slope * mx;
  const data = rows.map(([x, y]) => {
    const fit = my + slope * (x - mx);
    return [x, y, fit, y - fit];
  });
  const rss = data.reduce((sum, row) => sum + row[3] ** 2, 0);
  return {metrics: {'Measurements': rows.length, 'Slope (AU per mg/L)': slope, 'Intercept (AU)': intercept,
    'R²': yy === 0 ? null : 1 - rss / yy, 'Residual SD (AU)': Math.sqrt(rss / (rows.length - 2))},
    columns: ['Standard (mg/L)', 'Observed (AU)', 'Fitted (AU)', 'Residual (AU)'], data};
}

function profile(rows) {
  minimum(rows, 2);
  nonnegative(rows, 0, 'time');
  nonnegative(rows, 1, 'measured value');
  let area = 0;
  return rows.map(([t, value], i) => {
    if (i === 0) return [t, value, null, 0];
    const [previousTime, previousValue] = rows[i - 1];
    if (t <= previousTime) throw Error(`Measurement ${i + 1}: time must increase for one profile. Check duplicate times and profile identifiers.`);
    const interval = (t - previousTime) * (value + previousValue) / 2;
    area += interval;
    return [t, value, interval, area];
  });
}

function exposure(rows) {
  const data = profile(rows);
  const peak = rows.reduce((peak, row) => row[1] > peak[1] ? row : peak);
  return {metrics: {'Observations': rows.length, 'Start (h)': rows[0][0], 'End (h)': rows.at(-1)[0],
    'Observed Cmax (mg/L)': peak[1], 'Earliest observed Tmax (h)': peak[0],
    'AUC over observed interval (mg·h/L)': data.at(-1)[3]},
    columns: ['Time (h)', 'Concentration (mg/L)', 'Interval AUC (mg·h/L)', 'Cumulative AUC (mg·h/L)'], data};
}

function dissolution(rows) {
  const data = profile(rows);
  if (rows[0][0] !== 0) throw Error('Include a time-zero observation for dissolution efficiency.');
  const [end, amount, , area] = data.at(-1);
  return {metrics: {'Observations': rows.length, 'Duration (min)': end,
    'Final amount dissolved (% label claim)': amount, 'Area (%·min)': area, 'Dissolution efficiency (%)': area / end},
    columns: ['Time (min)', 'Dissolved (% label claim)', 'Interval area (%·min)', 'Cumulative area (%·min)'], data};
}

function factorial(rows) {
  nonnegative(rows, 2, 'breaking force');
  const levels = [-1, 1];
  const cells = [[], [], [], []];
  for (const [i, [a, b, response]] of rows.entries()) {
    if (!levels.includes(a) || !levels.includes(b)) throw Error(`Measurement ${i + 1}: code both factors as -1 (low) or 1 (high).`);
    cells[2 * levels.indexOf(a) + levels.indexOf(b)].push(response);
  }
  const n = cells[0].length;
  if (!n || cells.some(cell => cell.length !== n))
    throw Error('Supply all four factor combinations with the same number of independent runs in each.');
  const means = cells.map(mean);
  const [ll, lh, hl, hh] = means;
  const residualDF = rows.length - 4;
  const sse = cells.reduce((sum, cell, i) => sum + ss(cell, means[i]), 0);
  return {metrics: {'Independent runs': rows.length, 'Runs per combination': n, 'Grand mean (N)': mean(means),
    'A effect (N)': (hl + hh - ll - lh) / 2, 'B effect (N)': (lh + hh - ll - hl) / 2,
    'A × B effect (N)': (ll + hh - lh - hl) / 2, 'Residual degrees of freedom': residualDF,
    'Standard error of each effect (N)': residualDF ? Math.sqrt(sse / residualDF / n) : null},
    columns: ['Factor A', 'Factor B', 'Runs', 'Mean breaking force (N)'],
    data: cells.map((cell, i) => [levels[Math.floor(i / 2)], levels[i % 2], n, means[i]])};
}

const validation = ['ICH Q2(R2) · analytical procedure validation', 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q2r2-validation-analytical-procedures'];
export const methods = {
  calibration: {
    level: 'BSc', title: 'Linear calibration', question: 'How does absorbance change with standard concentration?',
    headers: ['standard_mg_L','absorbance_AU'], sample: '0,0.01\n2,0.19\n4,0.42\n6,0.60\n8,0.79',
    instructions: 'Enter known standard concentrations in mg/L and measured absorbance. Use at least three distinct concentrations.',
    interpretation: 'The slope gives the absorbance change per mg/L. Inspect the residuals for curvature or increasing spread. This unweighted fit assumes comparable error variance across the range. R² alone cannot establish analytical validity.',
    sources: [validation, ['Queen’s University Belfast · BSc Pharmaceutical Sciences','https://www.qub.ac.uk/courses/undergraduate/2026/pharmaceutical-sciences-bsc-b210/']], calculate: calibration
  },
  precision: {
    level: 'BSc', title: 'Assay repeatability', question: 'How closely do repeated assays of the same sample agree?',
    headers: ['measured_mg_L'], sample: '9.9\n10.1\n9.8\n10.2\n10.0',
    instructions: 'Enter one measured concentration in mg/L per row, at a single nominal level under the same conditions.',
    interpretation: 'Sample SD measures spread in mg/L. Relative SD is 100 × sample SD / mean and is undefined at a zero mean. Assess accuracy separately using a known reference.',
    sources: [validation, ['SUMAS · Practical Pharmaceutical Analysis','https://sumas.edu.ng/course/practical-pharmaceutical-analysis/']], calculate: precision
  },
  exposure: {
    level: 'MSc', title: 'Observed pharmacokinetic exposure', question: 'How much exposure was measured during the sampling period?',
    headers: ['time_h','concentration_mg_L'], sample: '0,0\n1,4\n2,6\n4,3\n8,1',
    instructions: 'Use one subject and one sampling occasion. Enter actual times in hours and quantifiable concentrations in mg/L in strictly increasing time order. Resolve below-quantification values under your study protocol.',
    interpretation: 'AUC sums linear trapezoids from the first to the last supplied time. Cmax is the highest measured concentration and Tmax is its earliest observed time. Sampling gaps affect these estimates. This summary does not estimate an elimination phase, AUC to infinity or a dose.',
    sources: [['University of Nigeria, Nsukka · postgraduate specialties','https://pharmaceuticalandmedicinal.unn.edu.ng/programmes/'],['Statistical analysis and reporting of clinical pharmacokinetic studies','https://doi.org/10.1111/cts.13305'],['PKNCA · AUC integration methods','https://cloud.r-project.org/web/packages/PKNCA/vignettes/v23-auc-integration-methods.html']], calculate: exposure
  },
  dissolution: {
    level: 'MSc', title: 'Dissolution efficiency', question: 'How much of the labelled amount was dissolved, on average, over the test period?',
    headers: ['time_min','dissolved_percent'], sample: '0,0\n5,22\n10,54\n20,83\n30,96',
    instructions: 'Use one dissolution vessel. Enter elapsed minutes starting at zero and measured cumulative percent of label claim, corrected for sampling according to your protocol.',
    interpretation: 'Efficiency is the trapezoidal area divided by the area of a 100% reference rectangle over the same duration, expressed as a percent. Compare profiles over an identical interval. Measurements above 100% are retained as entered. This summary does not establish equivalence between products.',
    sources: [['Khan · The concept of dissolution efficiency','https://pubmed.ncbi.nlm.nih.gov/235616/'],['National University of Singapore · MSc formulation science','https://pharmacy.nus.edu.sg/study/postgraduate-programmes/msc-pharmaceutical-science-technology-programme/full-time/']], calculate: dissolution
  },
  factorial: {
    level: 'PhD', title: 'Two-factor formulation experiment', question: 'Does the effect of binder level on tablet breaking force depend on compression setting?',
    headers: ['binder_code','compression_code','breaking_force_N'], sample: '-1,-1,40\n-1,-1,42\n-1,1,48\n-1,1,50\n1,-1,44\n1,-1,46\n1,1,60\n1,1,62',
    instructions: 'Use a balanced 2 × 2 design. Code low as −1 and high as +1. Enter an independent batch-run response in newtons per row. Average technical readings within each batch first.',
    interpretation: 'Main effects are high-minus-low differences averaged over the other factor. The interaction is half the difference between the two simple effects of A. Its sign depends on factor coding. The pooled standard error assumes independent runs with common variance and needs replication in every cell.',
    sources: [['UCL · doctoral formulation experiment','https://discovery.ucl.ac.uk/id/eprint/10104798/'],['NIST · estimating main and interaction effects','https://www.itl.nist.gov/div898/handbook/pri/section6/pri615.htm']], calculate: factorial
  }
};

export function analyze(id, text) {
  if (!Object.hasOwn(methods, id)) throw Error('Choose a listed method.');
  const method = methods[id];
  if (typeof text !== 'string' || !text.trim()) throw Error('Enter measurements or load the teaching example.');
  if (text.length > 200000) throw Error('Use up to 200,000 characters per analysis.');
  const lines = text.trim().split(/\r?\n/);
  const split = line => line.split(line.includes('\t') ? '\t' : ',').map(x => x.trim());
  const header = split(lines[0]);
  if (header.length === method.headers.length && header.every((v, i) => v === method.headers[i])) lines.shift();
  if (lines.length > 5000) throw Error('Use up to 5,000 measurement rows.');
  const rows = lines.map((line, i) => {
    const fields = split(line);
    if (fields.length !== method.headers.length) throw Error(`Measurement ${i + 1}: expected ${method.headers.length} columns.`);
    return fields.map((field, j) => {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(field) || !Number.isFinite(Number(field)))
        throw Error(`Measurement ${i + 1}, ${method.headers[j]}: enter a finite number.`);
      return Number(field);
    });
  });
  const result = method.calculate(rows);
  for (const value of [...Object.values(result.metrics), ...(result.data ?? []).flat()]) {
    if (value !== null && !Number.isFinite(value)) throw Error('Numerical range exceeded. Check measurement values and units.');
  }
  return result;
}
