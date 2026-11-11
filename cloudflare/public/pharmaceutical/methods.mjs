import {fSurvival, intervals95} from './inference.mjs';

// All routines operate on measured rows. Display rounding happens in the UI.
function mean(values) {
  const first = values[0];
  return first + values.reduce((sum, x) => sum + (x - first), 0) / values.length;
}
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
    'Sample SD (mg/L)': sd, 'Relative SD (%)': average === 0 ? null : 100 * sd / average},
    intervals: intervals95(values.length - 1, [['Mean concentration (mg/L)', average, sd / Math.sqrt(values.length)]])};
}

function spikeRecovery(rows) {
  minimum(rows, 2);
  nonnegative(rows, 0, 'unspiked concentration');
  nonnegative(rows, 1, 'spiked concentration');
  const added = rows[0][2];
  if (added <= 0 || rows.some(row => row[2] !== added))
    throw Error('Use one positive added concentration per analysis. Analyze each spike level separately.');
  const data = rows.map(([native, spiked, added]) => [native, spiked, added, (spiked - native) / added * 100]);
  const values = data.map(row => row[3]), average = mean(values);
  const sd = Math.sqrt(ss(values, average) / (values.length - 1));
  return {metrics: {'Independent pairs': rows.length, 'Added concentration (mg/L)': added,
    'Mean recovery (%)': average, 'Recovery SD (percentage points)': sd, 'Bias from 100% (percentage points)': average - 100},
    intervals: intervals95(rows.length - 1, [['Mean recovery (%)', average, sd / Math.sqrt(rows.length)]]),
    columns: ['Unspiked (mg/L)', 'Spiked (mg/L)', 'Added (mg/L)', 'Recovery (%)'], data};
}

function lackOfFit(data) {
  const groups = new Map();
  for (const [x, observed, fitted] of data) {
    if (!groups.has(x)) groups.set(x, {values: [], fitted});
    groups.get(x).values.push(observed);
  }
  const pureDF = data.length - groups.size;
  if (!pureDF) return {note: 'Lack of fit requires replicate responses at the same standard concentration.'};
  let pureSS = 0, lackSS = 0;
  for (const {values, fitted} of groups.values()) {
    const center = mean(values);
    pureSS += ss(values, center);
    lackSS += values.length * (center - fitted) ** 2;
  }
  const lackDF = groups.size - 2;
  const f = pureSS > 0 ? (lackSS / lackDF) / (pureSS / pureDF) : null;
  const p = f === null ? null : fSurvival(f, lackDF, pureDF);
  const note = f === null ? 'The F test is undefined because replicate responses have zero within-level variance.'
    : p < 0.05 ? 'At the 5% level, the straight line shows significant lack of fit relative to replicate variability.'
    : 'At the 5% level, the test did not detect lack of fit. Inspect the residuals and the studied concentration range.';
  return {metrics: {'Pure-error SS (AU²)': pureSS, 'Pure-error df': pureDF, 'Lack-of-fit SS (AU²)': lackSS,
    'Lack-of-fit df': lackDF, 'Lack-of-fit F': f, 'Lack-of-fit p': p}, note};
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
  const df = rows.length - 2, residualSD = Math.sqrt(rss / df);
  const diagnostic = lackOfFit(data);
  return {note: diagnostic.note, intervals: intervals95(df, [
    ['Slope (AU per mg/L)', slope, residualSD / Math.sqrt(xx)],
    ['Intercept (AU)', intercept, residualSD * Math.hypot(1 / Math.sqrt(rows.length), mx / Math.sqrt(xx))]]),
    metrics: {'Measurements': rows.length, 'Slope (AU per mg/L)': slope, 'Intercept (AU)': intercept,
    'R²': yy === 0 ? null : 1 - rss / yy, 'Residual SD (AU)': residualSD, ...diagnostic.metrics},
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
  let comparisonArea = 0;
  for (const [i, row] of data.entries()) {
    const [time, c, linearArea] = row;
    let interval = linearArea;
    if (i > 0) {
      const [previousTime, previous] = rows[i - 1];
      if (previous > c && c > 0) {
        const difference = previous - c;
        const logRatio = difference < c ? Math.log1p(difference / c) : Math.log(previous) - Math.log(c);
        interval = difference / logRatio * (time - previousTime);
      }
      comparisonArea += interval;
    }
    row.push(interval);
  }
  const peak = rows.reduce((peak, row) => row[1] > peak[1] ? row : peak);
  return {metrics: {'Observations': rows.length, 'Start (h)': rows[0][0], 'End (h)': rows.at(-1)[0],
    'Observed Cmax (mg/L)': peak[1], 'Earliest observed Tmax (h)': peak[0],
    'AUC over observed interval (mg·h/L)': data.at(-1)[3], 'Linear-up/log-down AUC (mg·h/L)': comparisonArea},
    columns: ['Time (h)', 'Concentration (mg/L)', 'Linear interval AUC (mg·h/L)', 'Cumulative linear AUC (mg·h/L)', 'Linear-up/log-down interval AUC (mg·h/L)'], data};
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
  const effects = [['A effect (N)', (hl + hh - ll - lh) / 2], ['B effect (N)', (lh + hh - ll - hl) / 2],
    ['A × B effect (N)', (ll + hh - lh - hl) / 2]];
  const se = residualDF ? Math.sqrt(sse / residualDF / n) : null;
  return {intervals: residualDF ? intervals95(residualDF, effects.map(([label, value]) => [label, value, se])) : [],
    note: residualDF ? 'Intervals are individual 95% intervals for the three effects. They assume independent runs and approximately normal errors of similar variance in all four cells.'
      : 'One run per combination gives effect estimates. Independent replication is required for confidence intervals.',
    metrics: {'Independent runs': rows.length, 'Runs per combination': n, 'Grand mean (N)': mean(means),
    ...Object.fromEntries(effects), 'Residual degrees of freedom': residualDF,
    'Standard error of each effect (N)': se},
    columns: ['Factor A', 'Factor B', 'Runs', 'Mean breaking force (N)'],
    data: cells.map((cell, i) => [levels[Math.floor(i / 2)], levels[i % 2], n, means[i]])};
}

const validation = ['ICH Q2(R2) · analytical procedure validation', 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q2r2-validation-analytical-procedures'];
export const methods = {
  calibration: {
    level: 'BSc', title: 'Linear calibration', question: 'How does absorbance change with standard concentration?',
    headers: ['standard_mg_L','absorbance_AU'], sample: '0,0.01\n0,0.02\n2,0.19\n2,0.21\n4,0.42\n4,0.40\n6,0.60\n6,0.62\n8,0.79\n8,0.81',
    instructions: 'Enter known standard concentrations in mg/L and measured absorbance. Use at least three distinct concentrations. Independent replicates at the same level enable a lack-of-fit test.',
    interpretation: 'The slope gives the absorbance change per mg/L. Inspect the residuals for curvature or increasing spread. This unweighted fit assumes independent errors with comparable variance across the range. The intervals and F test also assume approximately normal errors. R² alone cannot establish analytical validity.',
    sources: [validation, ['Calibration and regression error components','https://pmc.ncbi.nlm.nih.gov/articles/PMC10774644/'], ['Queen’s University Belfast · BSc Pharmaceutical Sciences','https://www.qub.ac.uk/courses/undergraduate/2026/pharmaceutical-sciences-bsc-b210/']], calculate: calibration
  },
  precision: {
    level: 'BSc', title: 'Assay repeatability', question: 'How closely do repeated assays of the same sample agree?',
    headers: ['measured_mg_L'], sample: '9.9\n10.1\n9.8\n10.2\n10.0',
    instructions: 'Enter one measured concentration in mg/L per row, at a single nominal level under the same conditions.',
    interpretation: 'Sample SD measures spread in mg/L. Relative SD is 100 × sample SD / mean and is undefined at a zero mean. The t interval estimates the mean under repeatability conditions, assuming independent, approximately normal measurements. Assess accuracy separately using a known reference.',
    sources: [validation, ['SUMAS · Practical Pharmaceutical Analysis','https://sumas.edu.ng/course/practical-pharmaceutical-analysis/']], calculate: precision
  },
  recovery: {
    level: 'MSc', title: 'Spike recovery', question: 'How much of a known addition does the assay recover from this sample matrix?',
    headers: ['unspiked_mg_L','spiked_mg_L','added_mg_L'], sample: '2,6.8,5\n2.1,7.2,5\n1.9,6.9,5\n2,6.9,5',
    instructions: 'Enter independent paired preparations at a single spike level. Express both measured concentrations and the known addition in mg/L on the same final-volume basis.',
    interpretation: 'Recovery is 100 × (spiked − unspiked) / added. Bias is the difference from 100% in percentage points. The t interval estimates mean recovery for this level and matrix assuming independent, approximately normal recoveries. Set acceptance limits according to your study protocol.',
    sources: [validation, ['USGS · paired spike recovery calculation','https://pubs.usgs.gov/ds/1124/ds1124.pdf']], calculate: spikeRecovery
  },
  exposure: {
    level: 'MSc', title: 'Observed pharmacokinetic exposure', question: 'How much exposure was measured during the sampling period?',
    headers: ['time_h','concentration_mg_L'], sample: '0,0\n1,4\n2,6\n4,3\n8,1',
    instructions: 'Use one subject and one sampling occasion. Enter actual times in hours and quantifiable concentrations in mg/L in strictly increasing time order. Resolve below-quantification values under your study protocol.',
    interpretation: 'Both AUC estimates cover the first to the last supplied time. The original AUC uses linear trapezoids. The comparison uses logarithmic interpolation for declines between positive concentrations and linear interpolation elsewhere. Use the method specified in your protocol. Cmax is the highest measured concentration and Tmax is its earliest observed time. Sampling gaps affect these estimates. This summary does not estimate an elimination phase, AUC to infinity or a dose.',
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
  const limits = (result.intervals ?? []).flatMap(row => [row.standardError, row.lower, row.upper]);
  for (const value of [...Object.values(result.metrics), ...(result.data ?? []).flat(), ...limits]) {
    if (value !== null && !Number.isFinite(value)) throw Error('Numerical range exceeded. Check measurement values and units.');
  }
  return result;
}
