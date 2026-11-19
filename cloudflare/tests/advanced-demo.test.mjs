import test from "node:test";
import assert from "node:assert/strict";
import {syntheticTimeSeries} from "../public/advanced-demo.mjs";

test("synthetic ARIMA teaching series is deterministic, complete and monthly",()=>{
  const rows=syntheticTimeSeries("arima");
  assert.equal(rows.length,97);
  assert.deepEqual(rows[0],["month","value"]);
  assert.equal(rows[1][0],"2018-01");
  assert.equal(rows.at(-1)[0],"2025-12");
  assert.deepEqual(rows,syntheticTimeSeries("arima"));
  const y=rows.slice(1).map(r=>Number(r[1]));
  assert.equal(y.length,96);
  assert.ok(y.every(Number.isFinite));
  assert.ok(Math.max(...y)>Math.min(...y));
});

test("synthetic GARCH teaching prices are daily, positive and nonconstant",()=>{
  const rows=syntheticTimeSeries("garch");
  assert.equal(rows.length,321);
  assert.deepEqual(rows[0],["date","price"]);
  assert.equal(rows[1][0],"2024-01-01");
  assert.equal(rows.at(-1)[0],"2024-11-15");
  assert.deepEqual(rows,syntheticTimeSeries("garch"));
  const y=rows.slice(1).map(r=>Number(r[1]));
  assert.ok(y.every(v=>Number.isFinite(v)&&v>0));
  assert.ok(Math.max(...y)>Math.min(...y));
});
test("synthetic generator rejects unknown methods",()=>{
  assert.throws(()=>syntheticTimeSeries("real_market_data"),/Unknown synthetic/);
});
