import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, methods} from '../public/pharmaceutical/methods.mjs';

test('linear calibration uses an intercept and returns observed-minus-fitted residuals', () => {
  const result = analyze('calibration', 'standard_mg_L,absorbance_AU\n0,1\n1,4\n2,5');
  const m = result.metrics;
  assert.equal(m['Slope (AU per mg/L)'], 2);
  assert.ok(Math.abs(m['Intercept (AU)'] - 4 / 3) < 1e-12);
  assert.ok(Math.abs(m['R²'] - 12 / 13) < 1e-12);
  assert.ok(Math.abs(result.data[1][3] - 2 / 3) < 1e-12);
  assert.equal(analyze('calibration', '0,2\n1,2\n2,2').metrics['R²'], null);
  assert.throws(() => analyze('calibration','0,0\n0,1\n1,2'), /distinct/);
});

test('repeatability uses sample SD and handles a zero mean', () => {
  const m = analyze('precision', '9\n10\n11').metrics;
  assert.equal(m['Mean (mg/L)'], 10);
  assert.equal(m['Sample SD (mg/L)'], 1);
  assert.equal(m['Relative SD (%)'], 10);
  assert.equal(analyze('precision', '0\n0').metrics['Relative SD (%)'], null);
});

test('single profile integration respects nonzero start, uneven spacing and earliest peak', () => {
  const m = analyze('exposure', 'time_h\tconcentration_mg_L\n1\t2\n2\t4\n5\t4').metrics;
  assert.equal(m['Start (h)'], 1);
  assert.equal(m['AUC over observed interval (mg·h/L)'], 15);
  assert.equal(m['Earliest observed Tmax (h)'], 2);
  assert.equal(m['Observed Cmax (mg/L)'], 4);
  for (const text of ['1,1\n1,2','2,1\n1,1']) assert.throws(() => analyze('exposure', text), /increase/);
});

test('dissolution efficiency uses the 100 percent rectangle and requires time zero', () => {
  const m = analyze('dissolution', '0,0\n10,50\n30,100').metrics;
  assert.equal(m['Area (%·min)'], 1750);
  assert.equal(m['Dissolution efficiency (%)'], 1750 / 30);
  assert.throws(() => analyze('dissolution', '5,20\n10,50'), /time-zero/);
});

test('balanced factorial effects and pooled standard error match manual contrasts', () => {
  const m = analyze('factorial', methods.factorial.sample).metrics;
  assert.equal(m['A effect (N)'], 8);
  assert.equal(m['B effect (N)'], 12);
  assert.equal(m['A × B effect (N)'], 4);
  assert.equal(m['Standard error of each effect (N)'], 1);
  assert.equal(m['Residual degrees of freedom'], 4);
  const once = '-1,-1,40\n-1,1,48\n1,-1,44\n1,1,60';
  assert.equal(analyze('factorial', once).metrics['Standard error of each effect (N)'], null);
  for (const text of [once + '\n1,1,60', '-1,-1,1']) assert.throws(() => analyze('factorial', text), /all four/);
  assert.throws(() => analyze('factorial', '0,1,5'), /code both/);
});

test('all examples run and malformed, missing and invalid data never become zeroes', () => {
  for (const [id, m] of Object.entries(methods)) assert.ok(analyze(id, m.sample).metrics);
  for (const text of ['0,0\n1,', '0,0\n1,BLQ', '0,0\n1,NaN', '0,0\n1,2,3', '0,1\n1,-2', '1,1e999']) {
    assert.throws(() => analyze('exposure', text));
  }
  assert.throws(() => analyze('precision', '1'), /at least/);
  assert.throws(() => analyze('precision', '0\n1e308'), /range exceeded/);
  assert.throws(() => analyze('precision', Array(5001).fill('1').join('\n')), /5,000/);
});

test('replicated calibration separates pure error from curvature; zero variance and singletons are explicit', () => {
  const r = analyze('calibration', '0,-1\n0,1\n1,2\n1,4\n2,-1\n2,1');
  assert.equal(r.metrics['Pure-error SS (AU²)'], 6);
  assert.equal(r.metrics['Lack-of-fit SS (AU²)'], 12);
  assert.equal(r.metrics['Lack-of-fit F'], 6);
  assert.ok(Math.abs(r.metrics['Lack-of-fit p'] - 0.09172111331157187) < 1e-10);
  assert.equal(r.intervals[0].df, 4);
  assert.ok(analyze('calibration', '0,1\n1,2\n2,3').note.includes('requires replicate'));
  const identical = analyze('calibration', '0,0.1\n0,0.1\n0,0.1\n1,2\n2,5');
  assert.equal(identical.metrics['Lack-of-fit p'], null);
  assert.match(identical.note, /zero within-level/);
});

test('recovery uses within-pair differences, preserves negative recoveries, and checks spike levels', () => {
  const r = analyze('recovery', '1,5.5,5\n1,6.5,5');
  assert.ok(Math.abs(r.data[0][3] - 90) < 1e-12);
  assert.ok(Math.abs(r.data[1][3] - 110) < 1e-12);
  assert.equal(r.metrics['Mean recovery (%)'], 100);
  const ci = r.intervals[0];
  assert.ok(Math.abs(ci.standardError - 10) < 1e-12);
  assert.ok(Math.abs(ci.upper - 227.0620473617) < 1e-8);
  assert.equal(analyze('recovery', '2,1,5\n1,6,5').data[0][3], -20);
  for (const input of ['1,4,0\n1,5,0','1,6,5\n1,12,10','1,4,-1\n1,4,-1']) {
    assert.throws(() => analyze('recovery', input), /positive added/);
  }
});

test('mean and factorial intervals match t references; unreplicated designs omit intervals', () => {
  const ci = analyze('precision', '9\n10\n11').intervals[0];
  assert.ok(Math.abs(ci.lower - (10 - 4.30265272975 / Math.sqrt(3))) < 1e-9);
  const effects = analyze('factorial', methods.factorial.sample).intervals;
  assert.equal(effects.length, 3);
  assert.ok(Math.abs(effects[2].upper - (4 + 2.7764451052)) < 1e-9);
  assert.deepEqual(analyze('factorial', '-1,-1,40\n-1,1,48\n1,-1,44\n1,1,60').intervals, []);
});

test('log-down AUC interpolates positive declines only, including nearly equal concentrations', () => {
  const r = analyze('exposure', '0,0\n1,8\n3,4\n4,4\n6,0');
  assert.equal(r.metrics['AUC over observed interval (mg·h/L)'], 24);
  assert.ok(Math.abs(r.metrics['Linear-up/log-down AUC (mg·h/L)'] - (12 + 8 / Math.log(2))) < 1e-12);
  assert.equal(r.data[0][4], null);
  assert.ok(Math.abs(analyze('exposure', '0,1.000000000000001\n1,1').data[1][4] - 1) < 1e-14);
});

test('dissolution comparison uses one efficiency per vessel and agrees with the SciPy unequal-variance interval', () => {
  const input = methods.dissolutionComparison.sample;
  const result = analyze('dissolutionComparison', input);
  assert.equal(result.data.length, 7);
  assert.deepEqual(result.data.map(row => row.at(-1)), [40,42,38,42,44,46,52]);
  const [ci] = result.intervals;
  assert.equal(ci.estimate, 6);
  assert.ok(Math.abs(ci.df - 4.418181818181819) < 1e-12);
  assert.ok(Math.abs(ci.lower + 0.554378784679133) < 1e-10);
  assert.ok(Math.abs(ci.upper - 12.554378784679134) < 1e-10);
  assert.match(result.note, /includes zero/);
  assert.deepEqual(analyze('dissolutionComparison', input.split('\n').reverse().join('\n')), result);
});

test('single vessels, zero variance, unequal times and malformed dissolution designs', () => {
  const input = '1,1,0,0\n1,1,20,80\n2,1,0,0\n2,1,10,44\n2,1,20,88';
  const result = analyze('dissolutionComparison', input);
  assert.deepEqual(result.intervals, []);
  assert.match(result.note, /two independent vessels/);
  assert.match(result.note, /Interior sampling times differ/);
  const replicated = input + '\n' + input.replaceAll(',1,', ',2,');
  assert.match(analyze('dissolutionComparison', replicated).note, /undefined/);
  assert.throws(() => analyze('dissolutionComparison', input.replace('1,1,20,80', '1,1,15,80')), /same final time/);
  assert.throws(() => analyze('dissolutionComparison', input + '\n2,1,10,45'), /vessel 1:.*duplicate/);
  assert.throws(() => analyze('dissolutionComparison', input.replace('1,1,0,0','1,1,5,0')), /time-zero/);
  assert.throws(() => analyze('dissolutionComparison', '1,1,0,0'), /each formulation/);
  assert.throws(() => analyze('dissolutionComparison', '3,1,0,0'), /formulation code/);
  assert.throws(() => analyze('dissolutionComparison', '1,1.2,0,0'), /whole-number vessel/);
});

test('CSV preserves numeric results and the data source for all analysis tables', async () => {
  const {resultTableCsv} = await import('../public/pharmaceutical/table-export.mjs');
  for (const [id, method] of Object.entries(methods)) {
    const result = analyze(id, method.sample);
    const csv = resultTableCsv({result, method:method.title, source:'Synthetic teaching example'});
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines.length, 1 + (result.data?.length ?? Object.keys(result.metrics).length));
    assert.match(lines[0], /^"Method","Data source",/);
    assert.ok(lines[1].includes('"Synthetic teaching example"'));
    if (id === 'dissolutionComparison') assert.equal(lines.at(-1), '"Compare dissolution efficiency","Synthetic teaching example",2,4,3,20,1040,52');
  }
});
