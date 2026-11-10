import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {
  canonicalCode,createValueDraft,addValueLabel,changeValueLabel,removeValueLabel,
  applyLikertPreset,orderedLabels,parseMissingCodes,valueDraftPatch
} from "../public/value-labels.mjs";
import {makeVariable,newWorkspace,addVariable,updateVariable,changeCell,displayValue,
  frequencyFromColumn} from "../public/workspace.mjs";
import {analyzeFrequencies} from "../public/statistics.mjs";

test("enter Value and Label, click Add, change, and remove without modifying source",()=>{
  const original=makeVariable("Role",{type:"numeric",values:{"1":"CEO"}});
  const originalDraft=createValueDraft(original);
  const added=addValueLabel(originalDraft,"2","Manager");
  assert.deepEqual(orderedLabels(added),[
    {code:"1",label:"CEO"},{code:"2",label:"Manager"}
  ]);
  const changed=changeValueLabel(added,"2","2","Senior Manager");
  assert.equal(changed.entries.find(x=>x.code==="2").label,"Senior Manager");
  const removed=removeValueLabel(changed,"1");
  assert.equal(removed.entries.length,1);
  assert.deepEqual(original.values,{"1":"CEO"});
  assert.deepEqual(originalDraft.entries,[{code:"1",label:"CEO"}]);
});
test("numeric codes are canonical: 01, 1.0 and 1 all mean code 1",()=>{
  const start=createValueDraft(makeVariable("Q1"));
  const one=addValueLabel(start,"01","Never");
  assert.equal(one.entries[0].code,"1");
  assert.throws(()=>addValueLabel(one,"1.0","Sometimes"),/already exists/);
  assert.throws(()=>addValueLabel(start,"abc","Invalid"),/Numeric/);
  assert.throws(()=>addValueLabel(start,"Infinity","Invalid"),/Numeric/);
  assert.throws(()=>addValueLabel(start,"","Missing code"),/Enter a value code/);
});
test("labels are required, codes cannot be overwritten accidentally",()=>{
  let draft=createValueDraft(makeVariable("Q1"));
  draft=addValueLabel(draft,1,"Strongly Disagree");
  draft=addValueLabel(draft,2,"Disagree");
  assert.throws(()=>changeValueLabel(draft,"1","2","Different label"),/already exists/);
  assert.throws(()=>changeValueLabel(draft,null,"4","Agree"),/Select/);
  assert.throws(()=>removeValueLabel(draft,null),/Select/);
  assert.throws(()=>addValueLabel(draft,"3",""),/Enter a label/);
  assert.equal(draft.entries.length,2);
});
test("string-valued categorical variables support alphabetic codes",()=>{
  let draft=createValueDraft(makeVariable("Shift",{type:"string"}));
  draft=addValueLabel(draft,"M","Morning");
  draft=addValueLabel(draft,"E","Evening");
  assert.deepEqual(orderedLabels(draft).map(x=>x.code),["E","M"]);
  assert.deepEqual(valueDraftPatch(draft,"").values,{M:"Morning",E:"Evening"});
});
test("single-click 4/5/7-point Likert presets fill scale labels in correct order",()=>{
  const start=createValueDraft(makeVariable("Q1"));
  for(const n of [4,5,7]){
    const draft=applyLikertPreset(start,n);
    assert.equal(draft.entries.length,n);
    assert.equal(draft.entries[0].code,"1");
    assert.equal(draft.entries[0].label,"Strongly Disagree");
    assert.equal(draft.entries[n-1].label,"Strongly Agree");
  }
  assert.equal(start.entries.length,0);
  assert.throws(()=>applyLikertPreset(createValueDraft(makeVariable("Shift",{type:"string"}))),/Numeric/);
});
test("OK patch changes value labels while keeping every respondent's recorded code",()=>{
  let data=newWorkspace();
  data=updateVariable(data,0,{name:"Q1",measure:"ordinal"});
  data=changeCell(data,0,0,1);
  data=changeCell(data,1,0,5);
  let labels=createValueDraft(data.variables[0]);
  labels=applyLikertPreset(labels,5);
  const next=updateVariable(data,0,valueDraftPatch(labels,"99, -9",{likertPreset:true}));
  assert.equal(next.variables[0].values["1"],"Strongly Disagree");
  assert.equal(next.variables[0].values["5"],"Strongly Agree");
  assert.deepEqual(next.variables[0].missing,["99","-9"]);
  assert.equal(next.variables[0].measure,"ordinal");
  assert.deepEqual(next.rows.slice(0,2),[[1],[5]]);
  assert.equal(displayValue(next.rows[0][0],next.variables[0],true),"Strongly Disagree");
  const counts=frequencyFromColumn(next,0);
  const result=analyzeFrequencies(counts.counts,counts.scale)[0];
  assert.equal(result.N,2);
  assert.equal(result.mean,3);
  assert.equal(data.variables[0].values["1"],undefined);
});
test("optional missing codes validate numeric format, duplicates, and capacity",()=>{
  assert.deepEqual(parseMissingCodes("99, -9","numeric"),["99","-9"]);
  assert.throws(()=>parseMissingCodes("99, 99.0","numeric"),/unique/);
  assert.throws(()=>parseMissingCodes("abc","numeric"),/Numeric/);
  assert.throws(()=>parseMissingCodes(Array.from({length:21},(_,i)=>String(i)).join(","),"numeric"),/at most 20/);
});
test("save must not recode variable or erase labels from other questions",()=>{
  let data=addVariable(newWorkspace(),{name:"Q2",measure:"ordinal",values:{"1":"Original"}});
  const draft=applyLikertPreset(createValueDraft(data.variables[0]),5);
  const result=updateVariable(data,0,valueDraftPatch(draft,"",{likertPreset:true}));
  assert.equal(result.variables[0].values["1"],"Strongly Disagree");
  assert.equal(result.variables[1].values["1"],"Original");
  assert.equal(data.variables[0].values["1"],undefined);
});
test("dialog contains the exact SPSS controls and preserves separate Data/Variable Views",()=>{
  const dir=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(dir,"index.html"),"utf8");
  const ui=readFileSync(resolve(dir,"workspace-ui.mjs"),"utf8");
  for(const id of ["workspace-data","workspace-variables","value-code-editor",
    "value-text-editor","value-add","value-change","value-remove","value-list-editor",
    "value-preset-four","value-preset-five","value-preset-seven","value-label-error",
    "missing-editor","cancel-details","save-details"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
  }
  assert.ok(ui.includes("valueDraftPatch("));
  assert.ok(ui.includes("valueEditor.draft=addValueLabel("));
  assert.ok(ui.includes("valueEditor.draft=changeValueLabel("));
  assert.ok(ui.includes("valueEditor.draft=removeValueLabel("));
  assert.ok(ui.includes("el(\"variable-dialog\").close()"));
});
