import {
  LIMIT_ITEMS, EXAMPLE_STUDY, EXAMPLE_OBJECTIVES,
  presetLabels, scaleDefinition, emptyItem, exampleItems, analyzeLikert,
  casesToItems, itemsFromPasted, summaryCsv, chapterFourText, reportHtml
} from "./likert-engine.mjs";
import {
  exportLikertDraft, importLikertDraft, objectiveTables, objectiveTablesCsv, objectiveTablesHtml
} from "./likert-student.mjs";

const e=id=>document.getElementById(id);
const state={points:5,items:exampleItems(),objectives:[...EXAMPLE_OBJECTIVES],
  project:null,sourceType:"frequencies",report:null,version:0,restoredCaseSnapshot:false};
const LIKERT_STORAGE_KEY="mabrig.statlab.likert.project.v1";
let draftReady=false, saveTimer=null;
const el=(tag,text,className)=>{
  const result=document.createElement(tag);
  if(text!==undefined&&text!==null)result.textContent=String(text);
  if(className)result.className=className;
  return result;
};
function showError(message){
  e("li-error").textContent=message||"";
  if(message)e("li-error").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function markStale(){
  state.report=null;e("li-results").hidden=true;
  state.version++;
  e("li-copy-result").textContent="";
  if(draftReady)scheduleDraftSave();
}
function currentScale(){return scaleDefinition(e("li-labels").value,state.points);}
function addOption(select,value,label){
  const option=el("option",label);option.value=String(value);select.append(option);
}
function renderObjectives(){
  const parent=e("li-objectives");parent.replaceChildren();
  state.objectives.forEach((objective,i)=>{
    const row=el("div",null,"li-objective-line");
    row.append(el("span","Objective "+(i+1),"li-objective-counter"));
    const field=el("input");field.type="text";field.maxLength=240;
    field.value=objective;field.setAttribute("aria-label","Research objective "+(i+1));
    field.addEventListener("input",()=>{state.objectives[i]=field.value;markStale();});
    row.append(field);
    const remove=el("button","×");remove.type="button";remove.title="Remove objective";
    remove.setAttribute("aria-label","Remove objective "+(i+1));
    remove.disabled=state.objectives.length===1;
    remove.addEventListener("click",()=>{
      if(!confirm("Delete objective "+(i+1)+"? Assigned items will move to Objective 1."))return;
      state.objectives.splice(i,1);
      state.items.forEach(item=>{
        if(item.objective===i)item.objective=0;
        else if(item.objective>i)item.objective--;
      });
      markStale();renderObjectives();renderItems();
    });
    row.append(remove);parent.append(row);
  });
  e("li-add-objective").disabled=state.objectives.length>=12;
}
function mkInput(value,fieldLabel,change,{type="text",width=""}={}){
  const input=el("input");input.type=type;input.value=String(value??"");
  input.setAttribute("aria-label",fieldLabel);
  if(width)input.className=width;
  if(type==="number"){input.min="0";input.step="1";input.inputMode="numeric";}
  input.addEventListener("change",()=>change(input.value));
  return input;
}
function updateComputedTotal(row,index){
  const cells=state.items[index].counts;
  const total=cells.every(x=>/^\d+$/.test(String(x).trim()))?
    cells.reduce((a,b)=>a+Number(b),0):null;
  row.querySelector(".li-total").textContent=total===null?"Check counts":String(total);
}
function renderItems(){
  const head=e("li-editor-head"),body=e("li-editor-body");
  head.replaceChildren();body.replaceChildren();
  const tr=el("tr");
  ["Code","Questionnaire statement","Objective","Reverse?",
    ...currentScale().map(s=>s.label+" ("+s.code+")"),"Valid N","Declared N",""].forEach(name=>tr.append(el("th",name)));
  head.append(tr);
  state.items.forEach((item,i)=>{
    const row=el("tr");
    const code=el("td");
    code.append(mkInput(item.id,"Question code, row "+(i+1),value=>{item.id=value.trim();markStale();},{width:"li-code"}));row.append(code);
    const question=el("td");
    const text=el("textarea");text.rows=2;text.value=item.question;
    text.maxLength=300;text.setAttribute("aria-label","Questionnaire statement "+(i+1));
    text.addEventListener("change",()=>{item.question=text.value;markStale();});
    question.append(text);row.append(question);
    const objective=el("td");
    const select=el("select");select.setAttribute("aria-label","Research objective for "+item.id);
    state.objectives.forEach((o,index)=>addOption(select,index,"Objective "+(index+1)));
    select.value=String(item.objective);
    select.addEventListener("change",()=>{item.objective=Number(select.value);markStale();});
    objective.append(select);row.append(objective);
    const reversed=el("td",null,"li-center");
    const check=el("input");check.type="checkbox";check.checked=item.reversed;
    check.setAttribute("aria-label","Reverse score "+item.id);
    check.addEventListener("change",()=>{item.reversed=check.checked;markStale();});
    reversed.append(check);row.append(reversed);
    item.counts.forEach((count,j)=>{
      const cell=el("td");
      const input=mkInput(count,item.id+" "+currentScale()[j].label,
        value=>{
          item.counts[j]=value;
          if(state.sourceType==="cases")changedCaseCounts();
          markStale();updateComputedTotal(row,i);
        },{type:"number",width:"li-count"});
      cell.append(input);row.append(cell);
    });
    row.append(el("td",null,"li-total"));
    const declared=el("td");
    declared.append(mkInput(item.declaredN??"",item.id+" declared total N",
      value=>{item.declaredN=value.trim()===""?null:value;markStale();},{type:"number",width:"li-count"}));
    row.append(declared);
    const action=el("td");
    const remove=el("button","×","li-remove");
    remove.type="button";remove.setAttribute("aria-label","Delete "+item.id);
    remove.disabled=state.items.length===1;
    remove.addEventListener("click",()=>{
      state.items.splice(i,1);markStale();renderItems();
    });
    action.append(remove);row.append(action);
    body.append(row);updateComputedTotal(row,i);
  });
  e("li-add-item").disabled=state.items.length>=LIMIT_ITEMS;
}
function changedCaseCounts(){
  state.sourceType="frequencies";state.restoredCaseSnapshot=false;
  document.querySelector('input[name="li-source"][value="frequencies"]').checked=true;
  e("li-source-note").textContent="Counts manually edited. Results will be labelled frequency-only, not Data View cases.";
}
function selectSource(type){
  if(type==="cases"){
    e("li-source-note").textContent="Click Import ordinal columns from Data View to use actual respondent counts.";
  }else{
    state.sourceType="frequencies";
    e("li-source-note").textContent="Frequency-only: no individual response rows are required.";
  }
  markStale();
}
function applyPreset(n){
  const old=state.points;
  if(n===old)return;
  if(state.items.some(item=>item.counts.some(x=>Number(x)>0)) &&
     !confirm("Changing the rating scale will clear the current item counts. Export your results first if needed.")){
    e("li-scale").value=String(old);return;
  }
  state.points=n;e("li-labels").value=presetLabels(n);
  state.items=[emptyItem(n,1)];
  changedCaseCounts();markStale();renderItems();
}
function resetExample(){
  state.restoredCaseSnapshot=false;
  state.points=5;state.items=exampleItems();state.objectives=[...EXAMPLE_OBJECTIVES];
  state.sourceType="frequencies";
  e("li-title").value=EXAMPLE_STUDY;
  e("li-source-label").value="";
  e("li-scale").value="5";e("li-labels").value=presetLabels(5);
  e("li-sd").value="sample";
  document.querySelector('input[name="li-source"][value="frequencies"]').checked=true;
  e("li-source-note").textContent="Synthetic example: no actual field survey or respondents are represented.";
  markStale();renderObjectives();renderItems();showError("");
}
function resetBlank(){
  if(!confirm("Start a blank Likert analysis? Your current unsaved Likert inputs will be replaced."))return;
  state.restoredCaseSnapshot=false;
  state.points=5;state.items=[emptyItem(5,1)];
  state.objectives=["Research objective 1"];
  state.sourceType="frequencies";
  e("li-title").value="";
  e("li-source-label").value="";
  e("li-scale").value="5";e("li-labels").value=presetLabels(5);
  e("li-sd").value="sample";
  document.querySelector('input[name="li-source"][value="frequencies"]').checked=true;
  e("li-source-note").textContent="Frequency-only: enter actual response counts in the table.";
  markStale();renderObjectives();renderItems();showError("");
}
function download(fileName,content,mime){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=el("a");a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function metric(label,value,description){
  const card=el("div",null,"li-metric");
  card.append(el("span",label),el("strong",value),el("small",description));return card;
}
function makeRows(group,data){
  const row=el("tr");
  for(const value of data)row.append(el("td",value));
  group.append(row);
}
function renderReport(report){
  e("li-results").hidden=false;
  const cards=e("li-stat-cards");cards.replaceChildren();
  const total=report.results.reduce((a,r)=>a+r.N,0);
  cards.append(
    metric("Items analyzed",report.results.length,"Individual questionnaire statements"),
    metric("Valid item responses",total.toLocaleString(),"Sum across items, not unique respondents"),
    metric("Scale midpoint",report.midpoint,"Used for descriptive comparison"),
    metric("Items above midpoint",report.results.filter(r=>r.above==="above").length+"/"+report.results.length,"Not a statistical hypothesis test")
  );
  const tbody=e("li-summary-body");tbody.replaceChildren();
  report.results.forEach(item=>{
    makeRows(tbody,["Objective "+(item.objective+1),item.id,item.N,item.mean.toFixed(2),
      item.sd===null?"N/A":item.sd.toFixed(2),item.median.toFixed(2),
      item.mode.join(" / "),item.topResponse]);
  });
  const plots=e("li-item-cards");plots.replaceChildren();
  report.results.forEach(item=>{
    const article=el("article",null,"li-item-card");
    const heading=el("h4",item.id+" · "+item.question);
    article.append(heading);
    const stats=el("p","N = "+item.N+" · Mean = "+item.mean.toFixed(2)+
      " · "+(item.sdMethod==="sample"?"Sample":"Population")+" SD = "+
      (item.sd===null?"not available (N < 2)":item.sd.toFixed(2)));
    article.append(stats);
    const bars=el("div",null,"li-bars");
    item.rows.forEach(r=>{
      const line=el("div",null,"li-chart-row");
      line.append(el("span",r.label,"li-bar-label"));
      const rail=el("div",null,"li-rail");
      const fill=el("div",null,"li-fill");fill.style.width=r.percent.toFixed(2)+"%";rail.append(fill);
      line.append(rail,el("span",r.frequency+" ("+r.percent.toFixed(1)+"%)","li-bar-value"));
      bars.append(line);
    });
    article.append(bars,el("p",item.explanation,"li-interpretation"));
    const method=item.sdMethod==="sample"?"N − 1":"N";
    article.append(el("p","Working: Mean = Σ(f × coded score)/N = "+item.weightedSum+
      "/"+item.N+" = "+item.mean.toFixed(3)+
      "; SD = √[Σf(score − mean)² / "+method+"] = "+
      (item.sd===null?"N/A":item.sd.toFixed(3))+".","li-working"));
    plots.append(article);
  });
  const groups=e("li-group-cards");groups.replaceChildren();
  report.groups.forEach(group=>{
    const card=el("div",null,"li-group-card");
    card.append(el("h4","Research Objective "+(group.index+1)),el("p",group.objective));
    if(group.items.length){
      card.append(el("strong","Average of item means: "+group.averageItemMean.toFixed(2)));
      card.append(el("small","Based on "+group.numberOfItems+" item(s). This is NOT an individual respondent composite or its SD."));
    }else card.append(el("small","No items assigned to this objective."));
    groups.append(card);
  });
  const list=e("li-warnings");list.replaceChildren();
  report.warnings.forEach(x=>list.append(el("li",x)));
  if(report.unequalNs)list.append(el("li","Valid N differs between items; percentages use each item's own denominator."));
  renderObjectiveTables(report);
  e("li-results").scrollIntoView({behavior:"smooth",block:"start"});
}

function draftSnapshot(){
  return {
    title:e("li-title").value,sourceLabel:e("li-source-label").value,
    points:state.points,scaleLabels:e("li-labels").value,
    sdMethod:e("li-sd").value,objectives:state.objectives,
    items:state.items,sourceType:state.sourceType,
    wasDerivedFromCases:state.restoredCaseSnapshot
  };
}
function scheduleDraftSave(){
  clearTimeout(saveTimer);
  e("li-save-status").textContent="Unsaved changes";
  saveTimer=setTimeout(()=>{
    try{
      const json=exportLikertDraft(draftSnapshot());
      localStorage.setItem(LIKERT_STORAGE_KEY,json);
      e("li-save-status").textContent="Saved on this device";
    }catch{
      e("li-save-status").textContent="Browser save unavailable · download JSON backup";
    }
  },500);
}
function loadDraft(data,{fromBrowser=false}={}){
  // Saved projects contain item frequencies and metadata, never paired respondents.
  state.points=data.points;
  state.items=structuredClone(data.items);
  state.objectives=[...data.objectives];
  state.sourceType="frequencies";
  state.restoredCaseSnapshot=Boolean(data.wasDerivedFromCases);
  e("li-title").value=data.title;
  e("li-source-label").value=data.sourceLabel;
  e("li-scale").value=String(data.points);
  e("li-labels").value=data.scaleLabels;
  e("li-sd").value=data.sdMethod;
  document.querySelector('input[name="li-source"][value="frequencies"]').checked=true;
  e("li-source-note").textContent=data.wasDerivedFromCases?
    "Restored a frequency snapshot derived from Data View. Case pairings are NOT in this backup. Use Data View again for case-based methods.":
    "Restored frequency counts from your saved questionnaire project.";
  markStale();renderObjectives();renderItems();showError("");
  e("li-save-status").textContent=fromBrowser?"Restored browser project":"Opened portable JSON backup";
}
function restoreBrowserDraft(){
  try{
    const raw=localStorage.getItem(LIKERT_STORAGE_KEY);
    if(!raw)return;
    const project=importLikertDraft(raw);
    loadDraft(project,{fromBrowser:true});
  }catch{
    e("li-save-status").textContent="Could not restore local draft; export current work";
  }
}
function tableColumn(tag,text){
  const td=el(tag,text);if(tag==="th")td.scope="col";
  return td;
}
function renderObjectiveTables(report){
  const model=objectiveTables(report,{highestFirst:e("li-table-order").value==="high"});
  const container=e("li-thesis-tables");container.replaceChildren();
  for(const part of model.tables){
    const article=el("article",null,"li-thesis-table");
    article.append(el("h4","Research Objective "+part.number),
      el("p",part.objective));
    const scroller=el("div",null,"li-table-scroll");
    const table=el("table",null,"li-summary-table");
    const thead=el("thead"),heading=el("tr");
    model.headers.forEach(header=>heading.append(tableColumn("th",header)));
    thead.append(heading);
    const tbody=el("tbody");
    for(const record of part.rows){
      const tr=el("tr");
      record.cells.forEach((cell,i)=>tr.append(tableColumn(i===0?"th":"td",cell)));
      tbody.append(tr);
    }
    if(!part.rows.length){
      const tr=el("tr"),td=tableColumn("td","No questionnaire items assigned.");
      td.colSpan=model.headers.length;tr.append(td);tbody.append(tr);
    }
    table.append(thead,tbody);scroller.append(table);article.append(scroller);
    if(part.averageItemMean!==null)article.append(el("p",
      "Arithmetic average of item means: "+part.averageItemMean.toFixed(2)+
      " (not a respondent-level composite or hypothesis test).","li-thesis-note"));
    article.append(el("p","Source: "+model.source,"li-thesis-note"));
    container.append(article);
  }
}

function wire(){
  e("li-labels").value=presetLabels(state.points);
  e("li-example").addEventListener("click",()=>{
    if(confirm("Load the synthetic Likert example? It will replace the current Likert items."))resetExample();
  });
  e("li-blank").addEventListener("click",resetBlank);
  e("li-scale").addEventListener("change",()=>applyPreset(Number(e("li-scale").value)));
  e("li-apply-labels").addEventListener("click",()=>{
    try{currentScale();markStale();renderItems();showError("");}
    catch(err){showError(err.message);}
  });
  e("li-add-objective").addEventListener("click",()=>{
    if(state.objectives.length>=12)return;
    state.objectives.push("Research objective "+(state.objectives.length+1));
    markStale();renderObjectives();renderItems();
  });
  e("li-add-item").addEventListener("click",()=>{
    if(state.items.length>=LIMIT_ITEMS)return;
    let next=1;while(state.items.some(x=>x.id.toLowerCase()===("q"+next)))next++;
    state.items.push(emptyItem(state.points,next));markStale();renderItems();
  });
  document.querySelectorAll('input[name="li-source"]').forEach(radio=>{
    radio.addEventListener("change",()=>selectSource(radio.value));
  });
  e("li-pull-cases").addEventListener("click",()=>{
    try{
      const items=casesToItems(state.project,e("li-labels").value,state.points);
      if(!confirm("Import "+items.length+" ordinal column(s) from Data View? This replaces the Likert items shown here."))return;
      state.items=items;state.sourceType="cases";state.restoredCaseSnapshot=false;
      document.querySelector('input[name="li-source"][value="cases"]').checked=true;
      e("li-source-note").textContent="Imported numeric ordinal columns from Data View. User-missing codes are excluded.";
      markStale();renderItems();showError("");
    }catch(err){showError(err.message);}
  });
  e("li-import-paste").addEventListener("click",()=>{
    try{
      const imported=itemsFromPasted(e("li-paste").value,currentScale());
      if(!confirm("Replace the Likert item table with "+imported.length+" pasted item(s)?"))return;
      state.items=imported;changedCaseCounts();markStale();renderItems();showError("");
    }catch(err){showError(err.message);}
  });
  e("li-title").addEventListener("input",markStale);
  e("li-backup-export").addEventListener("click",()=>{
    try{
      download("statlab-likert-project.json",exportLikertDraft(draftSnapshot()),"application/json");
      e("li-save-status").textContent="Portable backup downloaded";
    }catch(err){showError(err.message);}
  });
  e("li-backup-open").addEventListener("click",()=>e("li-backup-file").click());
  e("li-backup-file").addEventListener("change",async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>250000)throw Error("Likert project backup must be smaller than 250 KB.");
      const data=importLikertDraft(await file.text());
      if(confirm("Replace your current Likert questions with the selected project backup?"))loadDraft(data);
    }catch(err){showError(err.message);}
    finally{e("li-backup-file").value="";}
  });
  e("li-table-order").addEventListener("change",()=>{
    if(state.report)renderObjectiveTables(state.report);
  });
  e("li-tables-html").addEventListener("click",()=>{
    if(!state.report)return;
    const high=e("li-table-order").value==="high";
    download("statlab-chapter-four-tables.html",
      objectiveTablesHtml(state.report,{highestFirst:high}),"text/html;charset=utf-8");
  });
  e("li-tables-csv").addEventListener("click",()=>{
    if(!state.report)return;
    download("statlab-chapter-four-tables.csv",
      objectiveTablesCsv(state.report,{highestFirst:e("li-table-order").value==="high"}),
      "text/csv;charset=utf-8");
  });
  e("li-source-label").addEventListener("input",markStale);
  e("li-sd").addEventListener("change",markStale);
  e("li-run").addEventListener("click",()=>{
    try{
      const preferred=document.querySelector('input[name="li-source"]:checked')?.value;
      if(preferred==="cases"&&state.sourceType!=="cases")throw Error("First click Import ordinal columns from Data View, or switch to Frequency counts.");
      if(state.sourceType==="cases"){
        const fresh=casesToItems(state.project,e("li-labels").value,state.points);
        if(fresh.length!==state.items.length||fresh.some((item,i)=>item.id!==state.items[i].id||
          item.counts.some((count,j)=>count!==Number(state.items[i].counts[j]))))
          throw Error("Data View counts, item codes or scale labels changed since import. Import ordinal columns again before analysis.");
      }
      const report=analyzeLikert(state.items,e("li-labels").value,state.points,state.objectives,{
        sdMethod:e("li-sd").value,studyTitle:e("li-title").value,
        sourceType:state.sourceType,sourceLabel:e("li-source-label").value
      });
      state.report=report;showError("");renderReport(report);
    }catch(err){showError(err.message);}
  });
  e("li-csv").addEventListener("click",()=>{
    if(!state.report)return;
    download("statlab-likert-summary.csv",summaryCsv(state.report),"text/csv;charset=utf-8");
  });
  e("li-html").addEventListener("click",()=>{
    if(!state.report)return;
    download("statlab-chapter-four-draft.html",reportHtml(state.report),"text/html;charset=utf-8");
  });
  e("li-copy").addEventListener("click",async()=>{
    if(!state.report)return;
    try{
      await navigator.clipboard.writeText(chapterFourText(state.report));
      e("li-copy-result").textContent="Chapter Four draft copied to clipboard.";
    }catch{e("li-copy-result").textContent="Clipboard access blocked. Use Download Chapter Four instead.";}
  });
  window.addEventListener("statlab:likert-open",event=>{
    state.project=event.detail?.project||null;
  });
  resetExample();renderObjectives();renderItems();
  restoreBrowserDraft();
  draftReady=true;
}
wire();
