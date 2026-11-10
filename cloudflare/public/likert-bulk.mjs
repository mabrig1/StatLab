// Bulk questionnaire coding for browser StatLab.
// Only Variable View dictionaries change; never reconstruct or recode respondents.
import {LIMITS,makeVariable,validateWorkspace} from "./workspace.mjs";
import {VALUE_LABEL_PRESETS,canonicalCode} from "./value-labels.mjs";

const MODES=new Set(["skip","replace"]);
const MAX_CODE_OPTIONS=11;
function fail(message){throw Error(message);}
export const DEFAULT_QUESTION_COUNT=40;
export function questionnaireNames(count=DEFAULT_QUESTION_COUNT,prefix="Q"){
  if(!Number.isInteger(count)||count<1||count>LIMITS.variables)fail("Choose between 1 and 80 questionnaire variables.");
  if(typeof prefix!=="string"||!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(prefix))
    fail("Questionnaire prefix must begin with a letter and contain letters, digits or underscores.");
  return Array.from({length:count},(_,i)=>prefix+(i+1));
}
export function standardLikertValues(points=5){
  const labels=VALUE_LABEL_PRESETS[Number(points)];
  if(!labels)fail("Use a supported 4-, 5-, or 7-point Likert scale.");
  return Object.fromEntries(labels.map((label,i)=>[String(i+1),label]));
}
export function addQuestionnaireColumns(project,{count=40,prefix="Q",points=5}={}){
  const names=questionnaireNames(count,prefix);
  const values=standardLikertValues(points);
  const existing=new Set(project.variables.map(v=>v.name.toLowerCase()));
  const toCreate=names.filter(name=>!existing.has(name.toLowerCase()));
  if(project.variables.length+toCreate.length>LIMITS.variables)
    fail("Cannot add "+toCreate.length+" questionnaire columns: StatLab supports at most "+
      LIMITS.variables+" variables. Create fewer or remove unnecessary columns first.");
  const next=structuredClone(project);
  for(const name of toCreate){
    next.variables.push(makeVariable(name,{
      label:"Question "+name.slice(prefix.length)+" (replace with exact questionnaire wording)",
      type:"numeric",measure:"ordinal",decimals:0,values:{...values}
    }));
    for(const row of next.rows)row.push(null);
  }
  return {project:validateWorkspace(next),added:toCreate,kept:names.filter(x=>existing.has(x.toLowerCase()))};
}
function normalizeExistingMap(v){
  const map={};
  for(const [raw,label] of Object.entries(v.values||{})){
    const code=canonicalCode(raw,"numeric");
    if(Object.hasOwn(map,code))fail(v.name+" contains conflicting equivalent numeric value codes.");
    map[code]=label;
  }
  return map;
}
function sourceValues(project,source){
  if(source===undefined||source===null)source="preset:5";
  if(typeof source!=="string")fail("Choose a codebook source.");
  if(source.startsWith("preset:")){
    const points=Number(source.slice(7));
    return {values:standardLikertValues(points),description:points+"-point Likert preset"};
  }
  if(source.startsWith("copy:")){
    const name=source.slice(5);
    const variable=project.variables.find(v=>v.name.toLowerCase()===name.toLowerCase());
    if(!variable||variable.type!=="numeric")
      fail("Choose an existing Numeric variable to copy its value labels.");
    const values=normalizeExistingMap(variable);
    if(Object.keys(values).length<2||Object.keys(values).length>MAX_CODE_OPTIONS)
      fail(variable.name+" needs 2–11 value labels to serve as a questionnaire codebook.");
    return {values,description:"value labels from "+variable.name};
  }
  fail("Choose a Likert preset or an existing Numeric variable.");
}
function sameValues(a,b){
  const keysA=Object.keys(a),keysB=Object.keys(b);
  return keysA.length===keysB.length && keysA.every(k=>Object.hasOwn(b,k)&&a[k]===b[k]);
}
export function previewBulkLikert(project,{indices=[],source="preset:5",mode="skip",ordinal=true}={}){
  if(!project||!Array.isArray(project.variables)||!Array.isArray(project.rows))
    fail("Open a valid Data View project first.");
  if(!MODES.has(mode))fail("Choose Skip existing labels or Replace existing labels.");
  if(typeof ordinal!=="boolean")fail("Ordinal setting must be enabled or disabled.");
  if(!Array.isArray(indices)||indices.length===0)fail("Select at least one variable.");
  if(indices.length>LIMITS.variables)fail("Too many target variables.");
  if(new Set(indices).size!==indices.length)fail("A variable was selected more than once.");
  const {values,description}=sourceValues(project,source);
  const knownCodes=new Set(Object.keys(values));
  const eligible=[],skipped=[],replacements=[];
  for(const index of indices){
    if(!Number.isInteger(index)||index<0||index>=project.variables.length)
      fail("A selected variable no longer exists.");
    const variable=project.variables[index];
    if(variable.type!=="numeric"){
      skipped.push({index,name:variable.name,reason:"String/Date variables cannot use numeric Likert coding."});continue;
    }
    let existing;
    try{existing=normalizeExistingMap(variable);}
    catch(error){skipped.push({index,name:variable.name,reason:error.message});continue;}
    const hasLabels=Object.keys(existing).length>0;
    if(hasLabels&&mode==="skip"){
      skipped.push({index,name:variable.name,reason:"Already has value labels (protected)."});continue;
    }
    const mismatched=new Set();
    for(const row of project.rows){
      const cell=row[index];
      if(cell===null||cell===undefined||cell===""||variable.missing.includes(String(cell)))continue;
      const code=canonicalCode(cell,"numeric");
      if(!knownCodes.has(code))mismatched.add(code);
      if(mismatched.size>=5)break;
    }
    if(mismatched.size){
      skipped.push({index,name:variable.name,reason:"Existing case codes "+
        [...mismatched].join(", ")+" are not in this scale. Fix data or mark genuine missing codes first."});
      continue;
    }
    if(sameValues(existing,values)&&(!ordinal||variable.measure==="ordinal")){
      skipped.push({index,name:variable.name,reason:"Already uses this codebook."});continue;
    }
    if(hasLabels&&!sameValues(existing,values))replacements.push(variable.name);
    eligible.push({index,name:variable.name,replace:hasLabels&&!sameValues(existing,values)});
  }
  return {values:{...values},description,mode,ordinal,eligible,skipped,replacements,
    selected:indices.length};
}
export function applyBulkLikert(project,options={}){
  const preview=previewBulkLikert(project,options);
  if(!preview.eligible.length)fail("There are no eligible variables to update. Review the preview warnings.");
  const next=structuredClone(project);
  for(const target of preview.eligible){
    const variable=next.variables[target.index];
    variable.values={...preview.values};
    if(preview.ordinal)variable.measure="ordinal";
    // Existing missing codes and recorded values are preserved.
  }
  return {project:validateWorkspace(next),preview};
}
