import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {WORKSTATION_FEATURES,EXECUTION_MODES,capabilitiesFor,capabilityCounts,featureById}
  from "../public/workstation-capabilities.mjs";
import {CUSTOMER_SCALES,customerExample,analyzeCustomerCounts,customerMetricsCsv}
  from "../public/customer-metrics.mjs";
import {analyzeLikert,exampleItems,presetLabels} from "../public/likert-engine.mjs";
import {objectiveTables} from "../public/likert-student.mjs";
import {apaLikertHtml} from "../public/apa-likert.mjs";

test("capability statuses distinguish browser, local Python and future features",()=>{
  const counts=capabilityCounts();
  assert.ok(counts.browser>=7);
  assert.ok(counts.local_python>0);
  assert.ok(counts.planned>0);
  assert.equal(featureById("inferential").status,"local_python");
  assert.equal(featureById("factor").status,"local_python");
  assert.ok(featureById("factor").description.includes("Cloudflare browser cannot"));
  assert.equal(featureById("business").view,"business");
  assert.ok(capabilitiesFor("academic").some(x=>x.id==="frequency"));
  assert.ok(capabilitiesFor("business").some(x=>x.id==="customer"));
  assert.ok(EXECUTION_MODES.local_python.includes("not in the Cloudflare"));
  assert.ok(WORKSTATION_FEATURES.filter(x=>x.status==="browser").every(x=>x.view || x.href));
  assert.throws(()=>capabilitiesFor("unknown"),/Unknown workspace/);
});

test("CSAT computes top-two-box satisfaction from counts only",()=>{
  const result=analyzeCustomerCounts("csat",customerExample("csat"));
  assert.equal(result.N,100);
  assert.equal(result.score,55);
  assert.deepEqual(result.groups,{satisfied:55,dissatisfied:25,neutral:20});
  assert.equal(result.rows.length,5);
  assert.equal(result.rows[3].frequency,35);
  assert.equal(result.rows[4].percent,20);
  assert.equal(result.measure,"CSAT");
  assert.match(result.formula,/4 \+ rating 5/);
  assert.match(result.warnings.join(" "),/no individual customer records/);
});

test("NPS calculates promoters minus detractors, not a percent",()=>{
  const r=analyzeCustomerCounts("nps",customerExample("nps"));
  assert.equal(r.N,100);
  assert.deepEqual(r.groups,{promoters:50,passives:30,detractors:20});
  assert.equal(r.score,30);
  assert.equal(r.rows.length,11);
  assert.equal(r.groupPercent.promoters,50);
  assert.equal(r.measure,"NPS");
  assert.match(r.warnings.join(" "),/points/);
  assert.equal(analyzeCustomerCounts("nps",[1,0,0,0,0,0,0,0,0,0,0]).score,-100);
  assert.equal(analyzeCustomerCounts("nps",[0,0,0,0,0,0,0,0,0,0,1]).score,100);
  assert.equal(analyzeCustomerCounts("nps",[0,0,0,0,0,0,0,2,2,0,0]).score,0);
});

test("CSAT with one response, weighted percentages and empty cases",()=>{
  const r=analyzeCustomerCounts("csat",[0,0,0,1,0]);
  assert.equal(r.score,100);
  assert.equal(r.N,1);
  assert.equal(r.rows[3].percent,100);
  assert.throws(()=>analyzeCustomerCounts("csat",[0,0,0,0,0]),/at least one/);
  assert.throws(()=>analyzeCustomerCounts("nps",Array(5).fill(1)),/exactly 11/);
  assert.throws(()=>analyzeCustomerCounts("csat",[1,-1,0,0,0]),/whole number|non-negative/);
  assert.throws(()=>analyzeCustomerCounts("csat",[1,1.4,0,0,0]),/whole number|integer/);
  assert.throws(()=>analyzeCustomerCounts("csat",["",0,0,0,0]),/integer/);
});

test("customer exports carry verified formula but no fabricated respondents",()=>{
  const csv=customerMetricsCsv(analyzeCustomerCounts("nps",customerExample("nps")));
  assert.match(csv,/Data source/);
  assert.match(csv,/User-entered frequencies/);
  assert.match(csv,/Valid N/);
  assert.match(csv,/0–6 detractors/);
  assert.ok(!csv.includes("respondent_id"));
  assert.throws(()=>customerMetricsCsv({mode:"csat",rows:null}),/Run a customer/);
});

test("APA-like exported tables reuse unchanged computed frequency distributions",()=>{
  const report=analyzeLikert(exampleItems(),presetLabels(5),5,[
    "Digital skills readiness","Employability readiness"
  ],{studyTitle:"Graduate digital skills",sourceLabel:"User supplied survey, 2026"});
  const plain=objectiveTables(report);
  const html=apaLikertHtml(report);
  assert.ok(plain.tables.length===2);
  assert.match(html,/Table 4.1/);
  assert.match(html,/Table 4.2/);
  assert.match(html,/font-style:italic/);
  assert.match(html,/border-top:1.3px solid/);
  assert.match(html,/35 \(22.9%\)/);
  assert.match(html,/3.21/);
  assert.match(html,/Sample standard deviation/);
  assert.match(html,/not a hypothesis test/);
  assert.match(html,/not independently verified/);
  assert.match(html,/No significance tests or raw cases are inferred/);
});

test("APA style HTML escapes source and questionnaire statements",()=>{
  const items=exampleItems();
  items[0].question='<script>alert("x")</script>';
  const report=analyzeLikert(items,presetLabels(5),5,[
    'Aim <svg onload="alert(1)">',"Aim 2"
  ],{studyTitle:"<img src=x onerror=alert(1)>"});
  const html=apaLikertHtml(report);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
});

test("v1 foundation UI is wired without removing existing research and business sections",()=>{
  const dir=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(dir,"index.html"),"utf8");
  const workspace=readFileSync(resolve(dir,"workspace-ui.mjs"),"utf8");
  const likert=readFileSync(resolve(dir,"likert-ui.mjs"),"utf8");
  const home=readFileSync(resolve(dir,"workstation-home.mjs"),"utf8");
  const customer=readFileSync(resolve(dir,"customer-metrics-ui.mjs"),"utf8");
  for(const id of ["workspace-home","workspace-data","workspace-variables","workspace-likert",
    "workspace-business","workspace-content","workspace-frequency","ws-academic","ws-business",
    "ws-capabilities","cm-entry-grid","cm-calculate","cm-export","li-apa-html"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
  }
  assert.match(workspace,/setTab\("home"\)/);
  assert.match(workspace,/"home","data"/);
  assert.match(home,/capabilitiesFor/);
  assert.match(customer,/analyzeCustomerCounts/);
  assert.match(likert,/apaLikertHtml/);
  assert.ok(!customer.includes("fetch("));
  assert.ok(!home.includes("fetch("));
});
