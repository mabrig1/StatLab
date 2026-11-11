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
