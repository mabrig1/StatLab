import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {
  parseBusinessCsv,syntheticBusinessData,analyzeBusiness,formatMoney,
  csvTemplate,businessReportCsv
} from "../public/business-analytics.mjs";
import {createBusinessInfographic} from "../public/business-infographic.mjs";

const transactions="date,order_id,product,category,region,channel,quantity,unit_price,unit_cost\n"+
"2026-09-01,INV-001,Printing,Services,Enugu,Walk-in,10,150,70\n"+
"2026-09-01,INV-001,Notebooks,Stationery,Enugu,Walk-in,2,1000,600\n"+
"2026-10-03,INV-002,Printing,Services,Lagos,Online,5,200,120\n";

test("transaction import computes line totals, distinct orders and gross margins",()=>{
  const source=parseBusinessCsv(transactions);
  const r=analyzeBusiness(source);
  assert.equal(source.mode,"transactions");
  assert.equal(source.rows.length,3);
  assert.equal(r.metrics.lineItems,3);
  assert.equal(r.metrics.orders,2);
  assert.equal(r.metrics.units,17);
  assert.equal(r.metrics.revenue,4500);
  assert.equal(r.metrics.cost,2500);
  assert.equal(r.metrics.profit,2000);
  assert.ok(Math.abs(r.metrics.margin-2000/4500)<1e-10);
  assert.equal(r.metrics.aov,2250);
  assert.deepEqual(r.byMonth.map(x=>x.name),["2026-09","2026-10"]);
  assert.equal(r.byProduct[0].name,"Notebooks");
});

test("monthly summary mode uses provided totals without inventing transactions",()=>{
  const csv="month,category,region,channel,revenue,cost,orders,units\n"+
    "2026-08,Services,Enugu,Walk-in,10000,6000,10,50\n"+
    "2026-09,Services,Lagos,Online,20000,13000,20,70\n";
  const r=analyzeBusiness(parseBusinessCsv(csv,"monthly"));
  assert.equal(r.metrics.revenue,30000);
  assert.equal(r.metrics.cost,19000);
  assert.equal(r.metrics.orders,30);
  assert.equal(r.metrics.units,120);
  assert.equal(r.metrics.aov,1000);
  assert.equal(r.byProduct.length,0);
  assert.equal(r.metrics.lineItems,2);
});

test("missing optional summary order counts are N/A, never zero orders",()=>{
  const r=analyzeBusiness(parseBusinessCsv(
    "month,revenue,cost\n2026-08,100,60\n2026-09,200,90\n","monthly"));
  assert.equal(r.metrics.orders,null);
  assert.equal(r.metrics.aov,null);
  assert.equal(r.metrics.units,null);
  assert.equal(r.metrics.profit,150);
  assert.equal(r.metrics.lineItems,2);
});

test("transaction rows without order_id cannot report an invented AOV",()=>{
  const csv="date,product,quantity,unit_price,unit_cost\n2026-10-01,Print,2,500,300\n";
  const r=analyzeBusiness(parseBusinessCsv(csv));
  assert.equal(r.metrics.orders,null);
  assert.equal(r.metrics.aov,null);
  assert.equal(r.metrics.lineItems,1);
});

test("filters compare category, channel, region and month using source data",()=>{
  const data=parseBusinessCsv(transactions);
  const filtered=analyzeBusiness(data,{category:"Services",channel:"Online",region:"Lagos",from:"2026-10",to:"2026-10"});
  assert.equal(filtered.metrics.revenue,1000);
  assert.equal(filtered.metrics.cost,600);
  assert.equal(filtered.byMonth.length,1);
  assert.equal(filtered.metrics.orders,1);
  const empty=analyzeBusiness(data,{region:"Abuja"});
  assert.equal(empty.metrics.revenue,0);
  assert.equal(empty.metrics.margin,null);
  assert.equal(empty.byCategory.length,0);
  assert.ok(empty.insights[0].includes("No records"));
});

test("CSV parser refuses invalid rows and impossible dates without guessing",()=>{
  assert.throws(()=>parseBusinessCsv("date,product,quantity,unit_price,unit_cost\n2026-02-30,Print,1,100,50\n"),/Invalid calendar date/);
  assert.throws(()=>parseBusinessCsv("date,product,quantity,unit_price,unit_cost\n2026-11-09,Print,-1,100,50\n"),/non-negative/);
  assert.throws(()=>parseBusinessCsv("date,product,quantity,unit_price,unit_cost\n2026-11-09,Print,2,100\n"),/inconsistent columns/);
  assert.throws(()=>parseBusinessCsv("date,product,quantity,unit_price\n2026-11-09,Print,2,100\n"),/missing required columns.*unit_cost/);
  assert.throws(()=>parseBusinessCsv("month,revenue,cost\n2026-13,100,70\n","monthly"),/Months must/);
  assert.throws(()=>parseBusinessCsv("month,revenue,cost\n2026-10,₦200,70\n","monthly"),/non-negative/);
});

test("monthly summary categories are additive, and warning explains non-overlap assumption",()=>{
  const d=parseBusinessCsv("month,category,revenue,cost\n2026-10,A,100,70\n2026-10,B,200,100\n","monthly");
  const r=analyzeBusiness(d);
  assert.equal(r.metrics.revenue,300);
  assert.equal(r.byCategory[0].name,"B");
  assert.ok(r.caveats.some(x=>x.includes("non-overlapping")));
});

test("currency selection controls display only, and no FX conversion is performed",()=>{
  const data=parseBusinessCsv(transactions);
  assert.equal(analyzeBusiness(data,{currency:"NGN"}).metrics.revenue,
    analyzeBusiness(data,{currency:"USD"}).metrics.revenue);
  assert.ok(formatMoney(2300,"NGN").includes("₦"));
  assert.ok(formatMoney(2300,"USD").includes("$"));
  assert.throws(()=>analyzeBusiness(data,{currency:"XYZ"}),/supported/);
  assert.throws(()=>analyzeBusiness(data,{from:"2026-11",to:"2026-10"}),/after end/);
});

test("synthetic sample is clearly identified and contains no user records",()=>{
  const dataset=syntheticBusinessData();
  assert.equal(dataset.synthetic,true);
  assert.ok(dataset.source.includes("Synthetic"));
  assert.equal(dataset.rows.length,15);
  assert.ok(analyzeBusiness(dataset).metrics.revenue>0);
});

test("infographic SVG creates actual graphics and displays business data without scripts",()=>{
  const d=analyzeBusiness(parseBusinessCsv(transactions));
  const svg=createBusinessInfographic(d,{brand:"MABRIG",title:"September business"});
  assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg,/<polyline/);
  assert.match(svg,/<circle/);
  assert.match(svg,/<rect/);
  assert.match(svg,/REVENUE/);
  assert.match(svg,/BUSINESS/);
  assert.match(svg,/<title/);
  assert.ok(!svg.includes("<script"));
  assert.match(svg,/SOURCE/);
});

test("SVG escapes malicious category, source and title inputs",()=>{
  const data=parseBusinessCsv("month,category,revenue,cost\n2026-09,<script>bad<\\/script>,100,30\n","monthly");
  data.source='<img src=x onerror=alert(1)>';
  const svg=createBusinessInfographic(analyzeBusiness(data),{title:'Foo <script>alert(1)</script>'});
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&lt;img"));
  assert.ok(!svg.includes("<script>alert(1)</script>"));
  assert.ok(!svg.includes('<img src=x'));
});

test("KPI export sanitizes spreadsheet formulas",()=>{
  const data=parseBusinessCsv("month,category,revenue,cost\n2026-09,=1+1,100,80\n","monthly");
  data.source="=HYPERLINK(1,2)";
  const csv=businessReportCsv(analyzeBusiness(data));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'=1+1"));
});

test("import/export templates work for both transaction and monthly formats",()=>{
  const t=csvTemplate("transactions"),m=csvTemplate("monthly");
  assert.equal(parseBusinessCsv(t).rows.length,1);
  assert.equal(parseBusinessCsv(m,"monthly").rows.length,1);
  assert.throws(()=>csvTemplate("wrong"),/Unknown template/);
});

test("app provides business workspace, all data controls and accessible infographic",()=>{
  const base=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(base,"index.html"),"utf8");
  const ui=readFileSync(resolve(base,"business-ui.mjs"),"utf8");
  const workspace=readFileSync(resolve(base,"workspace-ui.mjs"),"utf8");
  for(const id of ["workspace-business","menu-business","ba-raw","ba-import","ba-file",
    "ba-analyze","ba-demo","ba-template","ba-category","ba-region","ba-channel",
    "ba-from","ba-to","ba-currency","ba-kpis","ba-infographic","ba-export-svg",
    "ba-export-png","ba-export-csv","ba-month-rows","ba-category-rows"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing business UI field "+id);
  }
  assert.ok(workspace.includes('"business"'));
  assert.ok(ui.includes("parseBusinessCsv("));
  assert.ok(ui.includes("createBusinessInfographic("));
  assert.ok(ui.includes("canvas.toBlob("));
});
