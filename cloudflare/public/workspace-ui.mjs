import {
  LIMITS, DEFAULT_LIKERT, newWorkspace, exampleWorkspace, industrialWorkspace, validateWorkspace,
  renameProject, changeCell, addRows, removeRow, addVariable, updateVariable,
  deleteVariable, moveVariable, pasteCells, importCsv, exportCsv,
  exportDictionary, exportProject, importProject, displayValue, isUserMissing,
  frequencyFromColumn
} from "./workspace.mjs";
import {
  canonicalCode,createValueDraft,addValueLabel,changeValueLabel,removeValueLabel,
  applyLikertPreset,orderedLabels,valueDraftPatch
} from "./value-labels.mjs";

const el=id=>document.getElementById(id);
const state={data:industrialWorkspace(),undo:[],redo:[],page:0,selected:null,
  search:"",labels:false,active:"data",editVar:null,ready:false,db:null};
const valueEditor={draft:null,selected:null,presetApplied:false};
const PAGE_SIZE=50;
let saveChain=Promise.resolve();

function showStatus(id,text,error=false){
  const target=el(id);target.textContent=text;target.classList.toggle("is-error",error);
}
function make(tag,text="",className=""){
  const node=document.createElement(tag);
  if(text!==undefined&&text!==null)node.textContent=String(text);
  if(className)node.className=className;
  return node;
}
function button(text,handler,className="secondary"){
  const b=make("button",text,className);b.type="button";b.addEventListener("click",handler);return b;
}
function option(value,label){
  const o=document.createElement("option");o.value=value;o.textContent=label;return o;
}
function selectControl(values,selected,onChange){
  const s=document.createElement("select");
  values.forEach(([value,label])=>s.append(option(value,label)));
  s.value=String(selected);
  s.addEventListener("change",()=>onChange(s.value));
  return s;
}
function inputControl(value,handler,type="text"){
  const field=make("input");
  field.type=type;
  field.value=String(value??"");
  field.addEventListener("change",()=>handler(field.value));
  return field;
}
function updateAction(fn) {
  try {
    const next=fn(state.data);
    validateWorkspace(next);
    state.undo.push(state.data);
    if(state.undo.length>LIMITS.history)state.undo.shift();
    state.redo=[];
    state.data=next;renderAll();queueSave();
    showStatus("data-message","Changes applied.");
    showStatus("variable-message","");
  }catch(error){
    showStatus("data-message",error.message,true);
    showStatus("variable-message",error.message,true);
    renderAll();
  }
}
function undoRedo(direction) {
  const source=direction==="undo"?state.undo:state.redo;
  const destination=direction==="undo"?state.redo:state.undo;
  if(!source.length)return;
  destination.push(state.data);
  state.data=source.pop();
  state.selected=null;renderAll();queueSave();
}
function clearHistory(){
  state.undo=[];state.redo=[];state.page=0;state.selected=null;
}
function setTab(name){
  if(!["data","variables","frequency","likert"].includes(name))return;
  state.active=name;
  for(const b of document.querySelectorAll("[data-workspace-view]")){
    const active=b.dataset.workspaceView===name;
    b.classList.toggle("active",active);
    if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
  }
  for(const section of document.querySelectorAll(".workspace-section"))
    section.hidden=section.id!=="workspace-"+name;
  if(name==="likert")window.dispatchEvent(new CustomEvent("statlab:likert-open",
    {detail:{project:structuredClone(state.data)}}));
}
function rowsMatchingQuery(){
  const q=state.search.trim().toLowerCase();
  if(!q)return state.data.rows.map((_,i)=>i);
  return state.data.rows.reduce((list,row,i)=>{
    if(row.some((value,col)=>String(value??"").toLowerCase().includes(q) ||
      displayValue(value,state.data.variables[col],true).toLowerCase().includes(q)))
      list.push(i);
    return list;
  },[]);
}
function inputCell(value,variable,rowIndex,colIndex){
  const wrap=make("div","","cell-wrap");
  const input=make("input","","data-cell");
  input.setAttribute("aria-label","Case "+(rowIndex+1)+", variable "+variable.name);
  input.setAttribute("autocomplete","off");
  input.setAttribute("spellcheck","false");
  const original=String(value??"");
  const labeled=state.labels && value!==null && Object.hasOwn(variable.values,original);
  input.value=labeled?variable.values[original]:original;
  input.title=variable.label||variable.name;
  if(variable.type==="numeric")input.inputMode="decimal";
  wrap.style.minWidth=Math.min(270,Math.max(110,variable.columns*10))+"px";
  if(isUserMissing(value,variable))wrap.classList.add("missing-cell");
  input.addEventListener("focus",()=>{
    if(labeled)input.value=original;
    input.select();
  });
  input.addEventListener("blur",()=>{
    if(input.value!==original)updateAction(data=>changeCell(data,rowIndex,colIndex,input.value));
    else if(labeled)input.value=variable.values[original];
  });
  input.addEventListener("paste",event=>{
    const text=event.clipboardData?.getData("text/plain")||"";
    if(!text.includes("\t")&&!/[\r\n]/.test(text))return;
    event.preventDefault();
    const lines=text.replace(/\r\n/g,"\n").replace(/\n$/,"").split("\n");
    const grid=lines.map(line=>line.split("\t"));
    updateAction(data=>pasteCells(data,rowIndex,colIndex,grid));
  });
  wrap.append(input);return wrap;
}
function renderData(){
  const head=el("data-head"),body=el("data-body");
  head.replaceChildren();body.replaceChildren();
  const typeRow=make("tr","","column-types");
  const nameRow=make("tr","","column-names");
  const caseHead=make("th","Case","case-heading");
  caseHead.rowSpan=2;caseHead.scope="col";
  typeRow.append(caseHead);
  state.data.variables.forEach((v,index)=>{
    const type=v.measure==="scale"?"metric":v.measure;
    const typeHead=make("th","","variable-type-cell");
    const symbol=make("span",v.measure==="nominal"?"● ●":v.measure==="ordinal"?"▥":"✎","type-icon "+v.measure);
    typeHead.append(make("span",type,"measure-mark"),symbol);
    typeHead.scope="col";
    typeRow.append(typeHead);
    const th=make("th","","variable-heading");
    th.scope="col";
    const pick=button(v.name,()=>{setTab("variables");el("variable-body").querySelector('[data-var-index="'+index+'"]')?.scrollIntoView({block:"nearest"});},"column-name");
    pick.title=(v.label||v.name)+" — edit in Variable View";
    th.append(pick);
    nameRow.append(th);
  });
  head.append(typeRow,nameRow);
  const matching=rowsMatchingQuery();
  const pages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
  state.page=Math.max(0,Math.min(state.page,pages-1));
  const start=state.page*PAGE_SIZE;
  for(const originalIndex of matching.slice(start,start+PAGE_SIZE)){
    const values=state.data.rows[originalIndex];
    const tr=make("tr");
    if(state.selected===originalIndex)tr.classList.add("selected-row");
    const rowHead=make("th","","case-heading");
    const choose=make("input");choose.type="radio";choose.name="selected-case";
    choose.value=String(originalIndex);choose.checked=state.selected===originalIndex;
    choose.setAttribute("aria-label","Select case "+(originalIndex+1));
    choose.addEventListener("change",()=>{state.selected=originalIndex;renderData();});
    rowHead.append(choose,make("span",originalIndex+1));
    tr.append(rowHead);
    values.forEach((value,index)=>{
      const td=make("td");td.append(inputCell(value,state.data.variables[index],originalIndex,index));tr.append(td);
    });
    body.append(tr);
  }
  el("data-count").textContent=state.data.rows.length+" cases × "+state.data.variables.length+" variables"+
    (state.search?" · "+matching.length+" matching":"");
  el("page-status").textContent="Page "+(state.page+1)+" of "+pages;
  el("prev-page").disabled=state.page===0;
  el("next-page").disabled=state.page>=pages-1;
  el("delete-case").disabled=state.selected===null;
  el("undo-data").disabled=state.undo.length===0;
  el("redo-data").disabled=state.redo.length===0;
  if(document.activeElement!==el("project-title"))el("project-title").value=state.data.title;
  const options=el("question-variable"),old=options.value;options.replaceChildren();
  state.data.variables.forEach((v,index)=>{
    if(v.type==="numeric" && ["ordinal","scale"].includes(v.measure))
      options.append(option(String(index),(v.label?v.label+" · ":"")+v.name));
  });
  if(options.querySelector('option[value="'+old+'"]'))options.value=old;
  el("send-to-frequency").disabled=!options.options.length;
}
function variableValueSummary(v){
  return Object.keys(v.values).length?Object.keys(v.values).length+" labels · Edit":"Add labels...";
}
function patchVar(index,patch){updateAction(data=>updateVariable(data,index,patch));}
function renderVariables(){
  const tbody=el("variable-body");tbody.replaceChildren();
  state.data.variables.forEach((v,index)=>{
    const tr=make("tr");tr.dataset.varIndex=String(index);
    const number=make("th",index+1);tr.append(number);
    const field=(value,transform,name,type="text")=>{
      const td=make("td");const input=inputControl(value,newValue=>patchVar(index,{[name]:transform(newValue)}),type);
      input.setAttribute("aria-label",name+" for "+v.name);
      td.append(input);tr.append(td);
    };
    field(v.name,String,"name");
    const choice=(name,choices)=>{
      const td=make("td");
      const s=selectControl(choices,v[name],value=>patchVar(index,{[name]:value}));
      s.setAttribute("aria-label",name+" for "+v.name);
      td.append(s);tr.append(td);
    };
    choice("type",[["numeric","Numeric"],["string","String"],["date","Date"]]);
    field(v.width,Number,"width","number");
    field(v.decimals,Number,"decimals","number");
    field(v.label,String,"label");
    const valuesTd=make("td"),valuesBtn=button(variableValueSummary(v),()=>openVariableDialog(index));
    valuesBtn.title="Edit value labels and missing codes";valuesTd.append(valuesBtn);tr.append(valuesTd);
    tr.append(make("td",v.missing.length?v.missing.join(", "):"None"));
    field(v.columns,Number,"columns","number");
    choice("align",[["left","Left"],["center","Center"],["right","Right"]]);
    choice("measure",[["nominal","Nominal"],["ordinal","Ordinal"],["scale","Scale"]]);
    choice("role",[["input","Input"],["target","Target"],["both","Both"],["none","None"]]);
    const actions=make("td","","variable-actions");
    const prev=button("↑",()=>updateAction(data=>moveVariable(data,index,-1)));
    prev.title="Move variable left";prev.disabled=index===0;
    const next=button("↓",()=>updateAction(data=>moveVariable(data,index,1)));
    next.title="Move variable right";next.disabled=index===state.data.variables.length-1;
    const remove=button("×",()=>{
      if(confirm("Delete "+v.name+" and its values from all "+state.data.rows.length+" cases?"))
        updateAction(data=>deleteVariable(data,index));
    });
    remove.title="Delete variable";remove.disabled=state.data.variables.length<=1;
    actions.append(prev,next,remove);tr.append(actions);
    tbody.append(tr);
  });
}
function renderAll(){renderData();renderVariables();}

function valueError(message=""){
  el("value-label-error").textContent=message;
}
function refreshValueControls(){
  const active=valueEditor.selected!==null;
  el("value-change").disabled=!active;
  el("value-remove").disabled=!active;
  el("value-add").disabled=!el("value-code-editor").value.trim()||
    !el("value-text-editor").value.trim();
}
function renderValueList(){
  const list=el("value-list-editor");list.replaceChildren();
  for(const entry of orderedLabels(valueEditor.draft)){
    const opt=option(entry.code,entry.code+" = "+entry.label);list.append(opt);
  }
  const valid=valueEditor.selected!==null &&
    valueEditor.draft.entries.some(x=>x.code===valueEditor.selected);
  if(valid)list.value=valueEditor.selected;
  else {valueEditor.selected=null;list.selectedIndex=-1;}
  refreshValueControls();
}
function resetValueEntry({focus=false}={}){
  valueEditor.selected=null;
  el("value-code-editor").value="";
  el("value-text-editor").value="";
  renderValueList();
  if(focus)el("value-code-editor").focus();
}
function selectLabelEntry(){
  const selected=el("value-list-editor").value;
  const record=valueEditor.draft.entries.find(item=>item.code===selected);
  if(!record){valueEditor.selected=null;refreshValueControls();return;}
  valueEditor.selected=record.code;
  el("value-code-editor").value=record.code;
  el("value-text-editor").value=record.label;
  valueError();
  refreshValueControls();
}
function addLabelEntry(){
  try{
    valueEditor.draft=addValueLabel(valueEditor.draft,
      el("value-code-editor").value,el("value-text-editor").value);
    valueError();
    resetValueEntry({focus:true});
  }catch(error){valueError(error.message);}
}
function changeLabelEntry(){
  try{
    const code=canonicalCode(el("value-code-editor").value,valueEditor.draft.type);
    valueEditor.draft=changeValueLabel(valueEditor.draft,valueEditor.selected,
      code,el("value-text-editor").value);
    valueEditor.selected=code;
    renderValueList();valueError();
  }catch(error){valueError(error.message);}
}
function removeLabelEntry(){
  try{
    valueEditor.draft=removeValueLabel(valueEditor.draft,valueEditor.selected);
    valueError();resetValueEntry({focus:true});
  }catch(error){valueError(error.message);}
}
function useLikertPreset(points){
  try{
    if(valueEditor.draft.entries.length &&
      !confirm("Replace the value labels in this editor with a "+points+
        "-point Likert scale? Click Cancel in the dialog to discard all unsaved changes."))return;
    valueEditor.draft=applyLikertPreset(valueEditor.draft,points);
    valueEditor.presetApplied=true;
    el("value-ordinal").checked=true;
    valueError();resetValueEntry();
  }catch(error){valueError(error.message);}
}
function openVariableDialog(index){
  state.editVar=index;
  const variable=state.data.variables[index];
  try{
    valueEditor.draft=createValueDraft(variable);
    valueEditor.selected=null;
    valueEditor.presetApplied=false;
    el("dialog-heading").textContent="Value Labels — "+variable.name;
    el("missing-editor").value=variable.missing.join(", ");
    el("value-ordinal").checked=variable.measure==="ordinal";
    el("value-code-editor").value="";
    el("value-text-editor").value="";
    valueError();
    renderValueList();
    el("variable-dialog").showModal();
    el("value-code-editor").focus();
  }catch(error){showStatus("variable-message",error.message,true);}
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window))return reject(Error("IndexedDB is unavailable."));
    const req=indexedDB.open("mabrig-statlab-browser",1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("projects"))req.result.createObjectStore("projects");};
    req.onerror=()=>reject(Error("Browser storage blocked."));
    req.onsuccess=()=>resolve(req.result);
  });
}
function readDb(){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction("projects","readonly");
    const request=tx.objectStore("projects").get("current");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error("Unable to read saved project."));
  });
}
function writeDb(data){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction("projects","readwrite");
    tx.objectStore("projects").put(data,"current");
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(Error("Browser project could not be saved."));
    tx.onabort=()=>reject(Error("Browser save transaction was aborted."));
  });
}
function eraseDb(){
  return new Promise((resolve,reject)=>{
    if(!state.db)return resolve();
    const tx=state.db.transaction("projects","readwrite");
    tx.objectStore("projects").delete("current");
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(Error("Browser project could not be cleared."));
  });
}
function queueSave(){
  if(!state.ready)return;
  const snapshot=structuredClone(state.data);
  if(!state.db){
    el("workspace-save").textContent="Local storage unavailable · export a backup";return;
  }
  el("workspace-save").textContent="Saving locally...";
  saveChain=saveChain.catch(()=>{}).then(()=>writeDb(snapshot))
    .then(()=>{el("workspace-save").textContent="Saved on this device";})
    .catch(()=>{el("workspace-save").textContent="Save failed · export a backup";});
}
function downloadText(filename,content,mime){
  const blob=new Blob([content],{type:mime||"application/octet-stream"});
  const url=URL.createObjectURL(blob);
  const a=make("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function replaceProject(next){
  state.data=validateWorkspace(next);clearHistory();renderAll();queueSave();
}
async function loadFromFile(file){
  if(!file)return;
  try{
    if(file.size>LIMITS.importBytes)throw Error("Choose a file smaller than 4 MB.");
    const content=await file.text();
    const incoming=file.name.toLowerCase().endsWith(".csv")?
      importCsv(content,file.name.replace(/\.csv$/i,"")):importProject(content);
    if(!confirm("Replace the current browser project with "+file.name+"? Export a backup first if needed."))return;
    replaceProject(incoming);
    showStatus("data-message","Imported "+incoming.rows.length+" cases and "+incoming.variables.length+" variables.");
    setTab("data");
  }catch(e){showStatus("data-message",e.message,true);}
  finally{el("file-picker").value="";}
}
function wire(){
  document.querySelectorAll("[data-workspace-view]").forEach(b=>
    b.addEventListener("click",()=>setTab(b.dataset.workspaceView)));
  el("add-case").addEventListener("click",()=>updateAction(data=>addRows(data)));
  el("add-ten").addEventListener("click",()=>updateAction(data=>addRows(data,10)));
  el("add-column").addEventListener("click",()=>{updateAction(data=>addVariable(data));setTab("variables");});
  el("add-variable").addEventListener("click",()=>updateAction(data=>addVariable(data)));
  el("delete-case").addEventListener("click",()=>{
    if(state.selected!==null && confirm("Delete case "+(state.selected+1)+"?")){
      const row=state.selected;state.selected=null;updateAction(data=>removeRow(data,row));
    }
  });
  el("undo-data").addEventListener("click",()=>undoRedo("undo"));
  el("redo-data").addEventListener("click",()=>undoRedo("redo"));
  el("prev-page").addEventListener("click",()=>{state.page--;renderData();});
  el("next-page").addEventListener("click",()=>{state.page++;renderData();});
  el("case-search").addEventListener("input",event=>{
    state.search=event.target.value;state.page=0;renderData();
  });
  el("show-labels").addEventListener("change",event=>{state.labels=event.target.checked;renderData();});
  el("project-title").addEventListener("change",event=>updateAction(data=>renameProject(data,event.target.value)));
  el("new-project").addEventListener("click",()=>{
    if(confirm("Start a new blank research project? Export your current project first if needed.")){
      replaceProject(newWorkspace());state.search="";el("case-search").value="";
      setTab("data");
    }
  });
  el("load-demo").addEventListener("click",()=>{
    const industrial=el("example-kind").value==="industrial";
    const description=industrial?"machine quality":"Likert questionnaire";
    if(confirm("Load synthetic "+description+" example? This replaces your current project.")){
      replaceProject(industrial?industrialWorkspace():exampleWorkspace());
      state.search="";el("case-search").value="";setTab("data");
    }
  });
  el("menu-new").addEventListener("click",()=>el("new-project").click());
  el("menu-import").addEventListener("click",()=>el("import-data").click());
  el("menu-export").addEventListener("click",()=>el("export-data").click());
  el("menu-prepare").addEventListener("click",()=>setTab("variables"));
  el("menu-sample").addEventListener("click",()=>el("load-demo").click());
  el("menu-likert").addEventListener("click",()=>setTab("likert"));
  el("import-data").addEventListener("click",()=>el("file-picker").click());
  el("file-picker").addEventListener("change",event=>loadFromFile(event.target.files[0]));
  el("export-data").addEventListener("click",()=>downloadText("statlab-data.csv",exportCsv(state.data),"text/csv;charset=utf-8"));
  el("export-project").addEventListener("click",()=>downloadText("statlab-project.json",exportProject(state.data),"application/json"));
  el("export-dictionary").addEventListener("click",()=>downloadText("statlab-variable-dictionary.json",exportDictionary(state.data),"application/json"));
  el("clear-project").addEventListener("click",async()=>{
    if(!confirm("Delete saved project data from this browser and begin blank? Download a backup first."))return;
    await saveChain.catch(()=>{});
    try{
      await eraseDb();
      state.data=newWorkspace();clearHistory();renderAll();
      el("workspace-save").textContent="Browser copy cleared · unsaved blank project";
      showStatus("data-message","Saved browser project cleared. Your downloaded backups are unaffected.");
    }catch(e){showStatus("data-message",e.message,true);}
  });
  el("cancel-details").addEventListener("click",()=>el("variable-dialog").close());
  el("value-list-editor").addEventListener("change",selectLabelEntry);
  el("value-code-editor").addEventListener("input",refreshValueControls);
  el("value-text-editor").addEventListener("input",refreshValueControls);
  el("value-code-editor").addEventListener("keydown",event=>{
    if(event.key==="Enter"){event.preventDefault();el("value-text-editor").focus();}
  });
  el("value-text-editor").addEventListener("keydown",event=>{
    if(event.key==="Enter"){
      event.preventDefault();
      if(valueEditor.selected!==null)changeLabelEntry();else addLabelEntry();
    }
  });
  el("value-add").addEventListener("click",addLabelEntry);
  el("value-change").addEventListener("click",changeLabelEntry);
  el("value-remove").addEventListener("click",removeLabelEntry);
  for(const points of [4,5,7]){
    const name={4:"four",5:"five",7:"seven"}[points];
    el("value-preset-"+name).addEventListener("click",()=>useLikertPreset(points));
  }
  el("variable-details-form").addEventListener("submit",event=>{
    event.preventDefault();
    try{
      if(!valueEditor.draft||state.editVar===null)throw Error("Choose a variable first.");
      const patch=valueDraftPatch(valueEditor.draft,el("missing-editor").value,{
        likertPreset:el("value-ordinal").checked
      });
      // Verify the entire updated variable and its existing case values before closing.
      const checked=updateVariable(state.data,state.editVar,patch);
      updateAction(()=>checked);
      el("variable-dialog").close();
      valueEditor.draft=null;valueEditor.selected=null;
    }catch(error){valueError(error.message);}
  });
  el("send-to-frequency").addEventListener("click",()=>{
    try{
      const idx=Number(el("question-variable").value);
      const payload=frequencyFromColumn(state.data,idx);
      el("scale").value=payload.scale;el("counts").value=payload.counts;
      el("reverse").checked=false;setTab("frequency");el("analyze").click();
    }catch(e){showStatus("data-message",e.message,true);}
  });
}
async function start(){
  wire();
  try {
    state.db=await openDb();
    const stored=await readDb();
    if(stored)state.data=validateWorkspace(stored);
  }catch{
    el("workspace-save").textContent="Browser save unavailable · export backups";
  }
  state.ready=true;renderAll();setTab("data");
  if(state.db)el("workspace-save").textContent="Saved on this device when edited";
}
start();
