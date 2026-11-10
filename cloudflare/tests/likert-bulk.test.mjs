import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  DEFAULT_QUESTION_COUNT,questionnaireNames,standardLikertValues,
  addQuestionnaireColumns,previewBulkLikert,applyBulkLikert
} from "../public/likert-bulk.mjs";
import {
  LIMITS,SCHEMA,makeVariable,newWorkspace,exampleWorkspace,addVariable,
  updateVariable,changeCell,validateWorkspace,frequencyFromColumn
} from "../public/workspace.mjs";
import {analyzeFrequencies} from "../public/statistics.mjs";

const blank=()=>newWorkspace();
test("Q1-Q40 adds exactly 40 pre-coded ordinal columns, no fabricated respondents",()=>{
  const initial=blank(),before=structuredClone(initial);
  const {project,added,kept}=addQuestionnaireColumns(initial);
  assert.equal(DEFAULT_QUESTION_COUNT,40);
  assert.equal(added.length,40);
  assert.equal(kept.length,0);
  assert.deepEqual(questionnaireNames().slice(0,3),["Q1","Q2","Q3"]);
  assert.deepEqual(project.variables.slice(1).map(v=>v.name),questionnaireNames());
  assert.equal(project.variables.length,41); // Existing VAR001 is preserved
  assert.equal(project.rows.length,initial.rows.length);
  assert.ok(project.rows.every(row=>row.length===41&&row.every(x=>x===null)));
  assert.deepEqual(project.variables[1].values,standardLikertValues(5));
  assert.equal(project.variables[1].measure,"ordinal");
  assert.equal(project.variables[1].decimals,0);
  assert.deepEqual(initial,before);
});
test("creating Q1-Q40 twice never overwrites existing labels or records",()=>{
  let initial=addQuestionnaireColumns(blank()).project;
  initial=changeCell(initial,0,1,4);
  initial=updateVariable(initial,1,{label:"Original questionnaire wording",values:{"1":"Custom coding"}});
  const {project,added,kept}=addQuestionnaireColumns(initial);
  assert.equal(added.length,0);
  assert.equal(kept.length,40);
  assert.equal(project.variables[1].label,"Original questionnaire wording");
  assert.deepEqual(project.variables[1].values,{"1":"Custom coding"});
  assert.equal(project.rows[0][1],4);
});
test("bulk apply labels to selected uncoded numeric variables only",()=>{
  let project=blank();
  project=addVariable(project,{name:"Q1",measure:"scale"});
  project=addVariable(project,{name:"Q2",measure:"scale"});
  project=changeCell(project,0,1,1);
  project=changeCell(project,1,2,5);
  const before=structuredClone(project.rows);
  const result=applyBulkLikert(project,{indices:[1,2],source:"preset:5",mode:"skip",ordinal:true});
  assert.deepEqual(result.preview.eligible.map(x=>x.name),["Q1","Q2"]);
  assert.deepEqual(result.project.variables[1].values,standardLikertValues(5));
  assert.deepEqual(result.project.variables[2].values,standardLikertValues(5));
  assert.equal(result.project.variables[1].measure,"ordinal");
  assert.deepEqual(result.project.rows,before);
  assert.equal(project.variables[1].values["1"],undefined);
  const payload=frequencyFromColumn(result.project,1);
  const analyzed=analyzeFrequencies(payload.counts,payload.scale);
  assert.equal(analyzed[0].N,1);
});
test("default skips variables that already have labels",()=>{
  const original=exampleWorkspace();
  const preview=previewBulkLikert(original,{indices:[3,4],source:"preset:5",mode:"skip"});
  assert.equal(preview.eligible.length,0);
  assert.equal(preview.skipped.length,2);
  assert.ok(preview.skipped.every(x=>x.reason.includes("Already has")));
  assert.throws(()=>applyBulkLikert(original,{indices:[3,4],source:"preset:5"}),/no eligible/);
  assert.equal(original.variables[3].values["4"],"Agree");
});
test("explicit Replace can change old labels but leaves recorded numeric codes and missing codes intact",()=>{
  let project=exampleWorkspace();
  project=updateVariable(project,3,{missing:["99"]});
  const initialRows=structuredClone(project.rows);
  const p=previewBulkLikert(project,{indices:[3],source:"preset:4",mode:"replace"});
  assert.equal(p.eligible.length,0);
  assert.equal(p.skipped.length,1);
  assert.match(p.skipped[0].reason,/code.*5|codes 5/);
  const repl=previewBulkLikert(project,{indices:[3],source:"preset:5",mode:"replace"});
  assert.equal(repl.eligible.length,0); // identical codebook and already ordinal
  project=updateVariable(project,3,{values:{"1":"Never","2":"Rarely","3":"Sometimes","4":"Often","5":"Always"}});
  const result=applyBulkLikert(project,{indices:[3],source:"preset:5",mode:"replace"});
  assert.deepEqual(result.preview.replacements,["Q1"]);
  assert.equal(result.project.variables[3].values["1"],"Strongly Disagree");
  assert.deepEqual(result.project.variables[3].missing,["99"]);
  assert.deepEqual(result.project.rows,initialRows);
  assert.equal(project.variables[3].values["1"],"Never");
});
test("non-numeric variables are skipped without altering the project",()=>{
  const project=addVariable(exampleWorkspace(),{name:"Shift",type:"string",measure:"nominal"});
  const source=JSON.stringify(project);
  const plan=previewBulkLikert(project,{indices:[5,3],source:"preset:5"});
  assert.equal(plan.skipped.length,2);
  assert.match(plan.skipped[0].reason,/String\/Date/);
  assert.equal(JSON.stringify(project),source);
});
test("existing values outside scale cannot be silently reinterpreted",()=>{
  let project=blank();
  project=addVariable(project,{name:"Q1"});
  project=changeCell(project,0,1,99);
  const plan=previewBulkLikert(project,{indices:[1],source:"preset:5",mode:"replace"});
  assert.equal(plan.eligible.length,0);
  assert.match(plan.skipped[0].reason,/99/);
  project=updateVariable(project,1,{missing:["99"]});
  const allowed=applyBulkLikert(project,{indices:[1],source:"preset:5"});
  assert.equal(allowed.project.rows[0][1],99);
  assert.deepEqual(allowed.project.variables[1].missing,["99"]);
});
test("copy custom response labels from existing numeric variable to multiple questions",()=>{
  let project=blank();
  project=addVariable(project,{name:"Source",values:{"1":"Never","2":"Sometimes","3":"Always"},measure:"ordinal"});
  project=addVariable(project,{name:"Q1"});
  project=addVariable(project,{name:"Q2"});
  const result=applyBulkLikert(project,{indices:[2,3],source:"copy:Source",mode:"skip"});
  assert.equal(result.preview.description,"value labels from Source");
  assert.deepEqual(result.project.variables[2].values,{"1":"Never","2":"Sometimes","3":"Always"});
  assert.equal(result.project.variables[3].measure,"ordinal");
});
test("capacity limit is checked before any Q column changes",()=>{
  let project=blank();
  for(let i=1;i<50;i++)project=addVariable(project,{name:"Z"+i});
  assert.equal(project.variables.length,50);
  const serialized=JSON.stringify(project);
  assert.throws(()=>addQuestionnaireColumns(project),/at most 80/);
  assert.equal(JSON.stringify(project),serialized);
});
test("invalid selection, duplicate indices and unsupported codebook fail closed",()=>{
  const project=blank();
  assert.throws(()=>previewBulkLikert(project,{indices:[]}),/Select at least one/);
  assert.throws(()=>previewBulkLikert(project,{indices:[0,0]}),/more than once/);
  assert.throws(()=>previewBulkLikert(project,{indices:[10]}),/no longer exists/);
  assert.throws(()=>previewBulkLikert(project,{indices:[0],source:"preset:9"}),/supported/);
  assert.throws(()=>previewBulkLikert(project,{indices:[0],source:"copy:Q40"}),/existing Numeric/);
});
test("bulk setup is connected to Variable View, modal contains all safety controls",()=>{
  const dir=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(dir,"index.html"),"utf8");
  const ui=readFileSync(resolve(dir,"workspace-ui.mjs"),"utf8");
  for(const id of ["open-bulk-likert","bulk-likert-dialog","bulk-create-questions",
    "bulk-source","bulk-mode","bulk-ordinal","bulk-pick-questions","bulk-pick-numeric",
    "bulk-pick-none","bulk-target-list","bulk-preview","bulk-apply","bulk-cancel"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing element "+id);
  }
  for(const call of ["addQuestionnaireColumns(","previewBulkLikert(","applyBulkLikert(",
    "bulkCreate","bulkPreview","bulkApply"]){
    assert.ok(ui.includes(call),"Missing handler "+call);
  }
});
