import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {DEFAULT_SCALE,DEFAULT_COUNTS,analyzeFrequencies,toSummaryCsv} from "../public/statistics.mjs";
const base=resolve(dirname(fileURLToPath(import.meta.url)),"../..");

test("existing Cloudflare worker name matches both build roots",()=>{
  const root=JSON.parse(readFileSync(resolve(base,"../wrangler.jsonc"),"utf8"));
  const nested=JSON.parse(readFileSync(resolve(base,"wrangler.jsonc"),"utf8"));
  assert.equal(root.name,"statlab");assert.equal(nested.name,"statlab");
  assert.equal(root.main,"./cloudflare/src/index.mjs");
  assert.equal(nested.main,"./src/index.mjs");
  assert.equal(root.assets.directory,"./cloudflare/public");
  assert.equal(nested.assets.directory,"./public");
  assert.equal(root.vars.INTEGRATIONS_ENABLED,"false");
  assert.equal(nested.vars.INTEGRATIONS_ENABLED,"false");
  assert.ok(!root.secrets?.required?.length && !nested.secrets?.required?.length);
  assert.ok(existsSync(resolve(base,"public/index.html")));
});
test("worked example from Item 5 agrees with manual computation",()=>{
  const [result]=analyzeFrequencies(DEFAULT_COUNTS,DEFAULT_SCALE);
  assert.equal(result.N,153);
  assert.ok(Math.abs(result.mean-3.2091503267973858)<1e-11);
  assert.ok(Math.abs(result.sd-1.4539130266612537)<1e-11);
  assert.equal(result.median,4);
  assert.deepEqual(result.modes,[4]);
  assert.equal(result.top,"Agree");
  assert.equal(result.rows.map(x=>x.count).reduce((a,b)=>a+b),153);
});
test("explicit reverse scoring changes mean but not original counts",()=>{
  const [original]=analyzeFrequencies(DEFAULT_COUNTS,DEFAULT_SCALE);
  const [reverse]=analyzeFrequencies(DEFAULT_COUNTS,DEFAULT_SCALE,{reversed:true});
  assert.ok(Math.abs(reverse.mean-(6-original.mean))<1e-10);
  assert.equal(reverse.rows[0].count,30);
});
test("mismatched total counts fail closed",()=>{
  assert.throws(()=>analyzeFrequencies(DEFAULT_COUNTS.replace("153","999"),DEFAULT_SCALE),/differs/);
});
test("sample SD requires at least two responses",()=>{
  const counts="Item 1:\nAgree = 1\nTotal N = 1";
  assert.equal(analyzeFrequencies(counts,DEFAULT_SCALE)[0].sd,null);
  assert.equal(analyzeFrequencies(counts,DEFAULT_SCALE,{sdMethod:"population"})[0].sd,0);
});
test("multiple pasted items and JSON objects work",()=>{
  assert.equal(analyzeFrequencies(DEFAULT_COUNTS+"\nItem 6:\nNeutral = 3",DEFAULT_SCALE).length,2);
  const json=JSON.stringify({"Item 5":{"Strongly Disagree":30,Disagree:23,Neutral:20,Agree:45,"Strongly Agree":35}});
  assert.equal(analyzeFrequencies(json,DEFAULT_SCALE)[0].N,153);
});
test("CSV export includes summary header and item",()=>{
  const csv=toSummaryCsv(analyzeFrequencies(DEFAULT_COUNTS,DEFAULT_SCALE));
  assert.match(csv,/Item,N,Mean,SD/);
  assert.match(csv,/"Item 5"/);
});
test("unknown categories and negative counts are rejected",()=>{
  assert.throws(()=>analyzeFrequencies("Item 1:\nUnicorn = 2",DEFAULT_SCALE),/unknown response/);
  assert.throws(()=>analyzeFrequencies("Item 1:\nAgree = -2",DEFAULT_SCALE));
});
