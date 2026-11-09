import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  SCHEMA,LIMITS,makeVariable,newWorkspace,exampleWorkspace,industrialWorkspace,
  validateWorkspace,changeCell,addRows,removeRow,addVariable,updateVariable,
  deleteVariable,moveVariable,pasteCells,parseCsv,importCsv,exportCsv,
  exportDictionary,exportProject,importProject,displayValue,isUserMissing,
  frequencyFromColumn
} from "../public/workspace.mjs";
import {analyzeFrequencies} from "../public/statistics.mjs";

test("new workspace has SPSS-style variable settings and blank cases",()=>{
  const w=newWorkspace();
  assert.equal(w.schema,SCHEMA);
  assert.equal(w.variables[0].type,"numeric");
  assert.equal(w.variables[0].measure,"scale");
  assert.equal(w.rows.length,10);
  assert.deepEqual(w.rows[0],[null]);
});
test("reference-style example has Machine, Shift, metric columns, Result, Quality",()=>{
  const w=industrialWorkspace();
  assert.deepEqual(w.variables.map(v=>v.name),["Machine","Shift","Temperature","CycleTime","Strength","Result","Quality"]);
  assert.deepEqual(w.variables.map(v=>v.measure),["nominal","nominal","scale","scale","scale","nominal","ordinal"]);
  assert.equal(w.rows.length,12);
  assert.deepEqual(w.rows[0],["A","Morning",182,41.5,310,"Pass","Medium"]);
  validateWorkspace(w);
});
test("numeric and string data editor rejects wrong type without mutating old data",()=>{
  let w=newWorkspace();
  w=changeCell(w,0,0,"42.5");
  assert.equal(w.rows[0][0],42.5);
  assert.throws(()=>changeCell(w,0,0,"wrong"),/number/);
  assert.equal(w.rows[0][0],42.5);
  w=addVariable(w,{type:"string",measure:"nominal"});
  w=changeCell(w,0,1,"Shift A");
  assert.equal(w.rows[0][1],"Shift A");
  w=changeCell(w,0,0,"");
  assert.equal(w.rows[0][0],null);
});
test("Variable View validates labels, missing codes and conflicting changes",()=>{
  let w=exampleWorkspace();
  w=updateVariable(w,3,{label:"Satisfaction question",missing:["99"]});
  assert.equal(w.variables[3].values["4"],"Agree");
  assert.equal(displayValue(w.rows[0][3],w.variables[3],true),"Agree");
  assert.equal(displayValue(w.rows[0][3],w.variables[3],false),"4");
  w=changeCell(w,0,3,"99");
  assert.equal(isUserMissing(w.rows[0][3],w.variables[3]),true);
  assert.throws(()=>updateVariable(w,3,{name:"Gender"}),/already exists/);
  assert.throws(()=>updateVariable(w,3,{type:"date"}),/conflicts/);
  assert.equal(w.variables[3].type,"numeric");
});
test("values stay with their case when columns move or are deleted",()=>{
  let w=changeCell(newWorkspace(),0,0,"3");
  w=addVariable(w,{name:"Score"});
  w=changeCell(w,0,1,"5");
  w=moveVariable(w,1,-1);
  assert.deepEqual(w.rows[0],[5,3]);
  w=deleteVariable(w,0);
  assert.deepEqual(w.rows[0],[3]);
  assert.throws(()=>deleteVariable(w,0),/at least one/);
});
test("add and remove cases while keeping other rows",()=>{
  let w=addRows(newWorkspace(),2);
  w=changeCell(w,11,0,"7");
  w=removeRow(w,10);
  assert.equal(w.rows.length,11);
  assert.equal(w.rows[10][0],7);
  assert.throws(()=>addRows(w,LIMITS.rows),/Maximum/);
});
test("Excel-like paste is atomic and has a safe maximum",()=>{
  let w=addVariable(newWorkspace(),{name:"Score"});
  w=pasteCells(w,0,0,[["3","4"],["5","2"]]);
  assert.deepEqual(w.rows[1],[5,2]);
  assert.throws(()=>pasteCells(w,0,1,[["1","2"]]),/exceeds/);
  assert.deepEqual(w.rows[1],[5,2]);
  assert.throws(()=>pasteCells(w,0,0,Array.from({length:2501},()=>["1"])),/2,500/);
});
test("CSV import preserves categories, escaped quotes, and respondent pairings",()=>{
  const parsed=parseCsv('Machine,Shift,Note\r\nA,Morning,"A, B"\r\nB,Night,"Said ""Yes"""\r\n');
  assert.deepEqual(parsed[1],["A","Morning","A, B"]);
  assert.deepEqual(parsed[2],["B","Night",'Said "Yes"']);
  const w=importCsv("ID,Shift,Score\n1,Morning,4\n2,Night,5\n","sample");
  assert.equal(w.rows.length,2);
  assert.deepEqual(w.rows[0],[1,"Morning",4]);
  assert.equal(w.variables[1].type,"string");
  assert.throws(()=>importCsv("A,B\n1\n"),/inconsistent/);
});
test("CSV output protects against formula injection in string cells",()=>{
  let w=addVariable(newWorkspace(),{name:"Text",type:"string",measure:"nominal"});
  w=changeCell(w,0,1,"=2+2");
  const csv=exportCsv(w);
  assert.match(csv,/'=2\+2/);
  assert.equal(parseCsv(csv)[1][1],"'=2+2");
});
test("project backups can restore Data View and Variable View together",()=>{
  const data=industrialWorkspace();
  const parsed=importProject(exportProject(data));
  assert.deepEqual(parsed,data);
  const dictionary=JSON.parse(exportDictionary(data));
  assert.equal(dictionary.variables[6].measure,"ordinal");
  assert.throws(()=>importProject('{"schema":"unsupported","rows":[],"variables":[]}'),/Not a supported/);
});
test("coded Likert items transfer to the frequency calculator without synthesis",()=>{
  const w=exampleWorkspace();
  const source=frequencyFromColumn(w,3);
  assert.match(source.counts,/Item Q1:/);
  const [result]=analyzeFrequencies(source.counts,source.scale);
  assert.equal(result.N,8);
  assert.equal(result.mean,3.75);
  assert.equal(result.top,"Agree");
});
test("missing codes are excluded, nominal variables cannot be averaged",()=>{
  let w=exampleWorkspace();
  w=updateVariable(w,3,{missing:["99"]});
  w=changeCell(w,0,3,99);
  const data=frequencyFromColumn(w,3);
  const [result]=analyzeFrequencies(data.counts,data.scale);
  assert.equal(result.N,7);
  assert.throws(()=>frequencyFromColumn(w,1),/numeric Ordinal or Scale/);
  assert.throws(()=>frequencyFromColumn(newWorkspace(),0),/no usable responses/);
});
test("date entries use actual valid calendar dates",()=>{
  let w=addVariable(newWorkspace(),{name:"VisitDate",type:"date"});
  w=changeCell(w,0,1,"2026-11-09");
  assert.equal(w.rows[0][1],"2026-11-09");
  assert.throws(()=>changeCell(w,0,1,"2026-02-30"),/invalid calendar date/);
});
test("UI implements reference-style two-level headings and three working views",()=>{
  const dir=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(dir,"index.html"),"utf8");
  const js=readFileSync(resolve(dir,"workspace-ui.mjs"),"utf8");
  for(const id of ["workspace-data","workspace-variables","workspace-frequency","data-head","data-body",
    "variable-body","menu-new","menu-import","menu-export","menu-prepare","menu-sample","file-picker"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing control "+id);
  }
  assert.ok(js.includes("head.append(typeRow,nameRow)"));
  assert.ok(js.includes('el("menu-import").addEventListener'));
  assert.ok(js.includes('industrialWorkspace()'));
});
