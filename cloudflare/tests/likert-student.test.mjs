import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {exampleItems,presetLabels,analyzeLikert} from "../public/likert-engine.mjs";
import {
  DRAFT_SCHEMA,MAX_DRAFT_BYTES,normalizeLikertDraft,exportLikertDraft,importLikertDraft,
  objectiveTables,objectiveTablesCsv,objectiveTablesHtml
} from "../public/likert-student.mjs";

const objectives=["Student digital skills","Perceived employability"];
const example=()=>analyzeLikert(exampleItems(),presetLabels(5),5,objectives,{
  studyTitle:"Digital Skills for Nigerian Students",sourceLabel:"Field Survey, 2026",
  sdMethod:"sample",sourceType:"frequencies"
});
const draft=()=>({
  points:5,title:"Graduate employability",scaleLabels:presetLabels(5),
  sourceLabel:"",sdMethod:"sample",objectives:["Skills","Opportunities"],
  items:exampleItems(),sourceType:"frequencies"
});

test("students can back up and reopen a 5-point questionnaire",()=>{
  const obj=importLikertDraft(exportLikertDraft(draft()));
  assert.equal(obj.schema,DRAFT_SCHEMA);
  assert.equal(obj.points,5);
  assert.equal(obj.items.length,3);
  assert.deepEqual(obj.items[0].counts,[30,23,20,45,35]);
  assert.deepEqual(obj.objectives,["Skills","Opportunities"]);
});

test("unfinished answers, empty counts, customized labels and objectives survive backup",()=>{
  const data=draft();
  data.items[0].counts=["",0,"","4",0];
  data.items[0].declaredN=null;
  data.objectives=["","Research Objective 2"];
  data.scaleLabels="1 = Never\n2 = Rarely\n3 = Sometimes\n4 = Often\n5 = Always";
  const restored=importLikertDraft(exportLikertDraft(data));
  assert.deepEqual(restored.items[0].counts,["",0,"","4",0]);
  assert.equal(restored.objectives[0],"");
  assert.match(restored.scaleLabels,/Never/);
  assert.equal(restored.items[0].declaredN,null);
});

test("portable drafts never retain case-level provenance as paired respondent records",()=>{
  const data=draft();data.sourceType="cases";
  const restored=importLikertDraft(exportLikertDraft(data));
  assert.equal(restored.sourceType,"frequencies");
  assert.equal(restored.wasDerivedFromCases,true);
  assert.equal("rows" in restored,false);
});

test("invalid project content fails closed and cannot carry extra data through",()=>{
  const data=draft();
  data.items[0].counts[0]=-1;
  assert.throws(()=>exportLikertDraft(data),/whole number/);
  data.items[0].counts[0]=30;
  data.apiKey="test-private-value";
  const raw=exportLikertDraft(data);
  assert.ok(!raw.includes("test-private-value"));
  assert.throws(()=>importLikertDraft('{"schema":"wrong"}'),/Not a supported/);
  assert.throws(()=>importLikertDraft("x".repeat(MAX_DRAFT_BYTES+1)),/smaller than/);
});

test("five-point thesis table shows original frequency and valid percentage",()=>{
  const report=example();
  const tables=objectiveTables(report);
  assert.deepEqual(tables.headers.slice(0,3),[
    "Item","Questionnaire statement","Strongly Agree (5) f (%)"
  ]);
  const row=tables.tables[0].rows[0];
  assert.equal(row.cells[0],"Q1");
  assert.equal(row.cells[2],"35 (22.9%)"); // SA
  assert.equal(row.cells[3],"45 (29.4%)"); // A
  assert.equal(row.cells[4],"20 (13.1%)"); // N
  assert.equal(row.cells[5],"23 (15.0%)"); // D
  assert.equal(row.cells[6],"30 (19.6%)"); // SD
  assert.equal(row.cells[7],153);
  assert.equal(row.cells[8],"3.21");
  assert.equal(row.cells[9],"1.45");
  assert.equal(row.cells[10],"Above midpoint");
  assert.equal(tables.tables[0].number,1);
});

test("table order can change without changing mean or frequency",()=>{
  const report=example();
  const low=objectiveTables(report,{highestFirst:false});
  const high=objectiveTables(report,{highestFirst:true});
  assert.equal(low.headers[2],"Strongly Disagree (1) f (%)");
  assert.equal(high.headers[2],"Strongly Agree (5) f (%)");
  assert.equal(low.tables[0].rows[0].cells[8],high.tables[0].rows[0].cells[8]);
  assert.equal(low.tables[0].rows[0].cells[2],"30 (19.6%)");
});

test("reverse-coded items remain visibly marked and scale labels remain observed",()=>{
  const items=exampleItems();items[0].reversed=true;
  const report=analyzeLikert(items,presetLabels(5),5,objectives);
  const row=objectiveTables(report).tables[0].rows[0];
  assert.equal(row.cells[0],"Q1 †");
  assert.equal(row.cells[2],"35 (22.9%)"); // Observed SA unchanged
  assert.equal(row.cells[8],"2.79"); // Reverse-scored mean
});

test("7-point scale produces 7 frequency categories without assuming 5-point coding",()=>{
  const item={id:"Q1",question:"Digital literacy",objective:0,reversed:false,
    counts:[1,2,3,4,5,6,7],declaredN:28};
  const report=analyzeLikert([item],presetLabels(7),7,["Goal"]);
  const t=objectiveTables(report);
  assert.equal(t.scalePoints,7);
  assert.equal(t.headers.length,2+7+4);
  assert.equal(t.tables[0].rows[0].cells[2],"7 (25.0%)");
});

test("HTML report escapes user-supplied labels and source text",()=>{
  const items=exampleItems();
  items[0].question='<img src=x onerror="alert(1)">';
  const report=analyzeLikert(items,presetLabels(5),5,objectives,{
    sourceLabel:'Field Survey <script>evil</script>'
  });
  const html=objectiveTablesHtml(report);
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;evil&lt;/script&gt;"));
  assert.match(html,/not independently verified/);
  assert.match(html,/NOT a respondent-level composite/);
  assert.match(html,/cannot substantiate regression/);
});

test("CSV protects formulas and labels objective provenance",()=>{
  const items=exampleItems();items[0].question="=HYPERLINK(1,2)";
  const report=analyzeLikert(items,presetLabels(5),5,objectives);
  const csv=objectiveTablesCsv(report);
  assert.ok(csv.includes("'=HYPERLINK(1,2)"));
  assert.match(csv,/Research objective/);
  assert.match(csv,/Objective 1/);
});

test("project UI wires local backup, table ordering and exports",()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(root,"index.html"),"utf8");
  const ui=readFileSync(resolve(root,"likert-ui.mjs"),"utf8");
  for(const name of ["li-backup-export","li-backup-open","li-backup-file",
    "li-save-status","li-thesis-tables","li-table-order","li-tables-html","li-tables-csv"]){
    assert.ok(html.includes('id="'+name+'"'),"Missing "+name);
  }
  assert.match(ui,/restoreBrowserDraft/);
  assert.match(ui,/objectiveTablesHtml/);
  assert.match(ui,/e\("li-table-order"\)/);
  assert.match(ui,/localStorage\.setItem/);
});
