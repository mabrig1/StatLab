import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {
  EXAMPLE_STUDY,EXAMPLE_OBJECTIVES,emptyItem,exampleItems,presetLabels,
  scaleDefinition,analyzeLikert,casesToItems,itemsFromPasted,summaryCsv,
  chapterFourText,reportHtml
} from "../public/likert-engine.mjs";
import {exampleWorkspace,updateVariable,changeCell,newWorkspace} from "../public/workspace.mjs";

const scale=presetLabels(5);
const obj=["Digital skills","Employment readiness"];

test("standard 4/5/7-point scales and custom labels are supported",()=>{
  for(const n of [4,5,7]){
    const s=scaleDefinition(presetLabels(n),n);
    assert.equal(s.length,n);
    assert.deepEqual(s.map(x=>x.code),Array.from({length:n},(_,i)=>i+1));
  }
  assert.equal(scaleDefinition("1 = Never\n2 = Rarely\n3 = Sometimes\n4 = Often\n5 = Always",5)[4].label,"Always");
  assert.throws(()=>scaleDefinition(presetLabels(4),5),/exactly 5/);
});

test("user Item 5 sample: frequencies, percent, weighted mean, SD, median and mode",()=>{
  const report=analyzeLikert([exampleItems()[0]],scale,5,obj);
  const item=report.results[0];
  assert.equal(item.N,153);
  assert.deepEqual(item.counts,[30,23,20,45,35]);
  assert.ok(Math.abs(item.mean-3.2091503267973858)<1e-11);
  assert.ok(Math.abs(item.sd-1.4539130266612537)<1e-10);
  assert.equal(item.median,4);
  assert.deepEqual(item.mode,["Agree"]);
  assert.ok(Math.abs(item.rows[3].percent-45/153*100)<1e-8);
  assert.equal(item.above,"above");
});

test("sample and population SD use different denominators and N=1 edge case",()=>{
  const item={id:"Q1",question:"One answer",objective:0,reversed:false,counts:[1,0,0,0,0],declaredN:1};
  const sample=analyzeLikert([item],scale,5,["Single item"]);
  const population=analyzeLikert([item],scale,5,["Single item"],{sdMethod:"population"});
  assert.equal(sample.results[0].sd,null);
  assert.equal(population.results[0].sd,0);
});

test("reverse coding is item-specific and does not change observed frequency labels",()=>{
  const normal=exampleItems();
  const reversed=structuredClone(normal);
  reversed[0].reversed=true;
  const before=analyzeLikert(normal,scale,5,obj);
  const after=analyzeLikert(reversed,scale,5,obj);
  assert.ok(Math.abs(after.results[0].mean-(6-before.results[0].mean))<1e-10);
  assert.equal(after.results[0].topResponse,"Agree");
  assert.equal(after.results[1].mean,before.results[1].mean);
  assert.equal(after.results[0].rows[0].scoredCode,5);
});

test("per-item Total N mismatch and invalid counts cannot be silently repaired",()=>{
  const item=emptyItem(5,1);item.counts=[1,1,1,1,1];item.declaredN=153;
  assert.throws(()=>analyzeLikert([item],scale,5,["Research question"]),/does not match/);
  item.declaredN=null;item.counts[2]=-1;
  assert.throws(()=>analyzeLikert([item],scale,5,["Research question"]),/whole number/);
  item.counts[2]=1.5;
  assert.throws(()=>analyzeLikert([item],scale,5,["Research question"]),/whole number/);
});

test("objective mean is explicitly a mean of item means, never a composite SD",()=>{
  const result=analyzeLikert(exampleItems(),scale,5,obj);
  assert.equal(result.groups.length,2);
  const avg=(result.results[0].mean+result.results[1].mean)/2;
  assert.ok(Math.abs(result.groups[0].averageItemMean-avg)<1e-12);
  assert.equal(Object.hasOwn(result.groups[0],"sd"),false);
  assert.ok(result.warnings.some(x=>x.includes("NOT a respondent-level composite")));
  assert.equal(result.groups[1].items.length,1);
});

test("multiple-item text and pasted frequency matrices are both parsed",()=>{
  const pasted="Item 5 (5-point scale):\nStrongly Disagree = 30\nDisagree = 23\nNeutral = 20\nAgree = 45\nStrongly Agree = 35\nTotal N = 153\n\nItem 6:\n1 = 1\n2 = 2\n3 = 3\n4 = 4\n5 = 5";
  const parsed=itemsFromPasted(pasted,scaleDefinition(scale,5));
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].declaredN,153);
  assert.deepEqual(parsed[1].counts,[1,2,3,4,5]);
  const csv="Item,Strongly Disagree,Disagree,Neutral,Agree,Strongly Agree\nQ1,1,2,3,4,5\nQ2,5,4,3,2,1";
  const imported=itemsFromPasted(csv,scaleDefinition(scale,5));
  assert.equal(imported.length,2);
  assert.deepEqual(imported[1].counts,[5,4,3,2,1]);
});

test("pasted counts reject labels not in current scale",()=>{
  const bad="Item 1:\nExcellent = 10\nAgree = 5";
  assert.throws(()=>itemsFromPasted(bad,scaleDefinition(scale,5)),/Unrecognized response/);
});

test("Data View case import counts actual coded responses and respects user-missing",()=>{
  let workspace=exampleWorkspace();
  workspace=updateVariable(workspace,3,{missing:["99"]});
  workspace=changeCell(workspace,0,3,99);
  const items=casesToItems(workspace,scale,5);
  assert.deepEqual(items.map(x=>x.id),["Q1","Q2"]);
  assert.equal(items[0].declaredN,7);
  assert.equal(items[1].declaredN,8);
  const result=analyzeLikert(items,scale,5,["Survey"],{sourceType:"cases"});
  assert.equal(result.sourceType,"cases");
  assert.equal(result.unequalNs,true);
});

test("case import fails if codes are out of scale rather than excluding them",()=>{
  let workspace=exampleWorkspace();
  workspace=changeCell(workspace,0,3,10);
  assert.throws(()=>casesToItems(workspace,scale,5),/outside 1–5/);
  assert.throws(()=>casesToItems(newWorkspace(),scale,5),/No numeric ordinal variables/);
});

test("reports export objective-aligned and source-labeled Chapter Four text",()=>{
  const report=analyzeLikert(exampleItems(),scale,5,EXAMPLE_OBJECTIVES,{studyTitle:EXAMPLE_STUDY});
  const text=chapterFourText(report);
  assert.match(text,/CHAPTER FOUR/);
  assert.match(text,/Research Objective 1/);
  assert.match(text,/Table 4.1/);
  assert.match(text,/user-supplied frequency counts; not independently verified/);
  assert.match(text,/NOT a respondent-level composite score/);
  assert.match(text,/4.4 Limitations/);
  const csv=summaryCsv(report);
  assert.match(csv,/Frequency: Strongly Disagree/);
  assert.match(csv,/"Q3"/);
});

test("downloadable HTML escapes malicious questionnaire text",()=>{
  const items=exampleItems();
  items[0].question='<script>alert("x")</script>';
  const result=analyzeLikert(items,scale,5,obj);
  const html=reportHtml(result);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(html.includes('<script>alert("x")</script>'),false);
});

test("frontend has a dedicated Likert mode with objectives, scale and exports",()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(root,"index.html"),"utf8");
  const ui=readFileSync(resolve(root,"likert-ui.mjs"),"utf8");
  const tab=readFileSync(resolve(root,"workspace-ui.mjs"),"utf8");
  for(const id of ["workspace-likert","li-editor-body","li-objectives","li-pull-cases",
    "li-run","li-summary-body","li-csv","li-html","li-copy","li-scale","li-sd"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing UI "+id);
  }
  assert.match(html,/likert-ui\.mjs/);
  assert.match(tab,/statlab:likert-open/);
  assert.match(ui,/casesToItems/);
  assert.match(ui,/analyzeLikert/);
});
