import {
  CONTENT_LIMITS,newContentProject,contentDemo,validateContentProject,
  analyzeContent,saveUnitReview,unreviewUnit,addContentDocument,
  importContentCsv,exportContentProject,importContentProject,
  codedUnitsCsv,codesSummaryCsv,chapterFourContentHtml
} from "./content-analysis.mjs";

const el=id=>document.getElementById(id);
function element(tag,text=null,cls=""){
  const node=document.createElement(tag);
  if(text!==null)node.textContent=String(text);
  if(cls)node.className=cls;return node;
}
function button(text,fn,cls="secondary"){
  const b=element("button",text,cls);b.type="button";b.addEventListener("click",fn);return b;
}
const state={project:contentDemo(),report:null,selectedCode:null,selectedUnit:null,
  page:0,search:"",filter:"all"};
const PAGE_SIZE=16;
function showError(message=""){el("ca-error").textContent=message;}
function reviewError(message=""){el("ca-review-error").textContent=message;}
function nextId(prefix,entries){
  const existing=new Set(entries.map(e=>e.id.toLowerCase()));
  for(let i=1;i<10000;i++){
    const name=prefix+i;if(!existing.has(name.toLowerCase()))return name;
  }
  throw Error("No available ID.");
}
function download(filename,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=element("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1300);
}
function stale(){
  state.report=null;state.page=0;
  el("ca-results").hidden=true;
  el("ca-save-status").textContent="Unsaved browser session · export JSON to preserve changes";
}
function commit(next,{analyze=false}={}){
  try{
    state.project=validateContentProject(next);
    stale();renderDocuments();renderCodebook();showError("");
    if(analyze)renderReport();
    return true;
  }catch(error){showError(error.message);return false;}
}
function renderDocuments(){
  const list=el("ca-documents");list.replaceChildren();
  el("ca-title").value=state.project.title;
  el("ca-unit").value=state.project.unit;
  el("ca-doc-id").placeholder=nextId("D",state.project.documents);
  list.append(element("strong","Loaded documents ("+state.project.documents.length+")"));
  if(!state.project.documents.length){
    list.append(element("p","No documents yet. Paste a transcript or import a CSV.","ca-muted"));
    return;
  }
  for(const document of state.project.documents){
    const row=element("div",null,"ca-list-row");
    const text=element("div");
    text.append(element("b",document.id+" · "+document.title),
      element("small",document.text.length+" characters · "+
        (document.origin==="synthetic"?"SYNTHETIC DEMO":"User-supplied")));
    const remove=button("Remove",()=>{
      if(!confirm("Remove "+document.id+" and its coded passages? Export a backup first if needed."))return;
      const prefix=document.id+"::";
      const reviews=Object.fromEntries(Object.entries(state.project.reviews).
        filter(([id])=>!id.startsWith(prefix)));
      commit({...state.project,documents:state.project.documents.filter(d=>d.id!==document.id),reviews});
    });
    remove.setAttribute("aria-label","Remove document "+document.id);
    row.append(text,remove);list.append(row);
  }
}
function renderCodebook(){
  const list=el("ca-codebook");list.replaceChildren();
  list.append(element("strong","Codebook ("+state.project.codes.length+"/"+CONTENT_LIMITS.codes+")"));
  if(!state.project.codes.length){
    list.append(element("p","Add your first research code or load the synthetic demonstration.","ca-muted"));
  }
  for(const code of state.project.codes){
    const row=element("div",null,"ca-list-row");
    const detail=element("div");
    detail.append(element("b",code.id+" · "+code.name),
      element("small",code.keywords.length+" keyword(s) · "+(code.description||"No definition")));
    const edit=button("Edit",()=>selectCode(code.id));
    const remove=button("Delete",()=>{
      if(!confirm("Remove code "+code.id+" and its assignment from any reviewed passages?"))return;
      const reviews=Object.fromEntries(Object.entries(state.project.reviews).
        map(([id,r])=>[id,{...r,codes:r.codes.filter(c=>c!==code.id)}]));
      state.selectedCode=null;clearCodeFields();
      commit({...state.project,codes:state.project.codes.filter(c=>c.id!==code.id),reviews});
    });
    remove.setAttribute("aria-label","Delete code "+code.id);
    row.append(detail,edit,remove);list.append(row);
  }
}
function clearCodeFields(){
  state.selectedCode=null;
  for(const id of ["ca-code-id","ca-code-name","ca-code-description","ca-keywords"])el(id).value="";
  el("ca-code-id").disabled=false;
  el("ca-add-code").disabled=false;
  el("ca-update-code").disabled=true;
}
function selectCode(id){
  const c=state.project.codes.find(x=>x.id===id);
  if(!c)return;
  state.selectedCode=id;
  el("ca-code-id").value=c.id;el("ca-code-id").disabled=true;
  el("ca-code-name").value=c.name;
  el("ca-code-description").value=c.description;
  el("ca-keywords").value=c.keywords.join("\n");
  el("ca-add-code").disabled=true;el("ca-update-code").disabled=false;
  el("ca-code-name").focus();
}
function keywordsInput(){
  const items=el("ca-keywords").value.split(/[,\n]+/).map(s=>s.trim()).filter(Boolean);
  if(items.length>CONTENT_LIMITS.keywordsPerCode)throw Error("Use up to 30 phrases per code.");
  return items;
}
function currentCode(){
  return {id:el("ca-code-id").value.trim(),name:el("ca-code-name").value.trim(),
    description:el("ca-code-description").value.trim(),keywords:keywordsInput()};
}
function addCode(){
  try{
    if(state.project.codes.length>=CONTENT_LIMITS.codes)throw Error("Maximum 35 codes.");
    const next={...state.project,codes:[...state.project.codes,currentCode()]};
    if(commit(next))clearCodeFields();
  }catch(error){showError(error.message);}
}
function updateCode(){
  const id=state.selectedCode;if(!id)return;
  try{
    const next={...state.project,codes:state.project.codes.map(c=>c.id===id?currentCode():c)};
    if(commit(next))clearCodeFields();
  }catch(error){showError(error.message);}
}
function addDoc(){
  try{
    const document={id:el("ca-doc-id").value.trim()||nextId("D",state.project.documents),
      title:el("ca-doc-title").value.trim(),text:el("ca-text").value,origin:"user"};
    const next=addContentDocument(state.project,document);
    if(commit(next)){
      el("ca-doc-id").value="";el("ca-doc-title").value="";el("ca-text").value="";
    }
  }catch(error){showError(error.message);}
}
function newStudy(){
  if(!confirm("Start a blank content analysis project? Download your current project JSON first."))return;
  clearCodeFields();commit(newContentProject());
}
function loadDemo(){
  if(!confirm("Replace this session with clearly labelled synthetic example documents?"))return;
  clearCodeFields();commit(contentDemo(),{analyze:true});
}
function changeUnit(){
  const unit=el("ca-unit").value;
  if(unit===state.project.unit)return;
  if(Object.keys(state.project.reviews).length&&!confirm("Changing the coding unit will discard manual passage reviews. Continue?")){
    el("ca-unit").value=state.project.unit;return;
  }
  const next={...state.project,unit,reviews:{}};
  if(!commit(next))el("ca-unit").value=state.project.unit;
}
async function loadSource(file){
  if(!file)return;
  try{
    if(file.size>CONTENT_LIMITS.fileBytes)throw Error("Files must be smaller than 600 KB.");
    const raw=await file.text();
    if(file.name.toLowerCase().endsWith(".csv")){
      const documents=importContentCsv(raw);
      const next={...state.project,documents,reviews:{}};
      const validated=validateContentProject(next);
      if(!confirm("Replace the current document collection with "+documents.length+
        " CSV document(s)? Manual reviews will be cleared."))return;
      commit(validated);
    }else if(/\.(txt|md)$/i.test(file.name)){
      const doc={id:nextId("D",state.project.documents),title:file.name.slice(0,180),
        text:raw,origin:"user"};
      const next=addContentDocument(state.project,doc);
      commit(next);
    }else throw Error("Choose TXT, MD, or document CSV files.");
  }catch(err){showError(err.message);}
  finally{el("ca-source-file").value="";}
}
async function openProject(file){
  if(!file)return;
  try{
    if(file.size>CONTENT_LIMITS.projectBytes)throw Error("Project must be smaller than 1 MB.");
    const project=importContentProject(await file.text());
    if(confirm("Open this content analysis backup and replace the current session?")){
      clearCodeFields();commit(project,{analyze:true});
    }
  }catch(error){showError(error.message);}
  finally{el("ca-project-file").value="";}
}
function metric(title,value,sub){
  const box=element("article",null,"ca-kpi");
  box.append(element("small",title),element("strong",value),element("span",sub));
  return box;
}
function percent(n){return Number(n).toFixed(1)+"%";}
function buildBars(items,target,nameField,valueField,maxCount=12){
  const root=el(target);root.replaceChildren();
  if(!items.length){root.append(element("p","No matching categories to display.","ca-muted"));return;}
  const displayed=items.slice(0,maxCount);
  const max=Math.max(1,...displayed.map(i=>i[valueField]));
  for(const item of displayed){
    const row=element("div",null,"ca-bar-row");
    row.append(element("span",item[nameField],"ca-bar-name"));
    const track=element("div",null,"ca-bar-track"),fill=element("div",null,"ca-bar-fill");
    fill.style.width=(100*item[valueField]/max).toFixed(2)+"%";
    track.append(fill);row.append(track);
    row.append(element("span",item[valueField],"ca-bar-count"));root.append(row);
  }
}
function addTableRow(container,values){
  const row=element("tr");
  values.forEach(v=>row.append(element("td",v)));
  container.append(row);
}
function renderReport(){
  try{
    const report=analyzeContent(state.project);
    state.report=report;state.page=0;
    const kpi=el("ca-kpis");kpi.replaceChildren(
      metric("Source documents",report.metrics.documents,"Original records"),
      metric("Coding units",report.metrics.units,"Unit: "+state.project.unit),
      metric("Codes",report.metrics.codes,"Defined categories"),
      metric("Units with codes",report.metrics.codedUnits,"Suggested or reviewed"),
      metric("Reviewed passages",report.metrics.reviewedUnits,"Human-confirmed assignments")
    );
    el("ca-source-summary").textContent=(report.synthetic?"SYNTHETIC EXAMPLE INCLUDED · ":"")+
      report.metrics.documents+" source document(s), "+report.metrics.units+" unit(s), "+
      report.metrics.unreviewedUnits+" unit(s) still awaiting manual review.";
    buildBars(report.codeStats,"ca-bars","name","unitCount");
    buildBars(report.topWords,"ca-words","word","count",14);
    const table=el("ca-code-stats");table.replaceChildren();
    report.codeStats.forEach(c=>addTableRow(table,[
      c.name,c.unitCount,percent(c.percent),c.documentCount,c.keywordHits,c.reviewedUnits
    ]));
    const pairs=el("ca-pairs");pairs.replaceChildren();
    if(!report.cooccurrence.length)pairs.append(element("p","No co-occurring code pairs yet.","ca-muted"));
    else report.cooccurrence.slice(0,14).forEach(pair=>{
      pairs.append(element("p",pair.codes+" — "+pair.units+" units","ca-pair"));
    });
    const notes=el("ca-notes");notes.replaceChildren();
    report.notes.forEach(n=>notes.append(element("li",n)));
    el("ca-results").hidden=false;
    renderPassages();
    showError("");
  }catch(error){
    state.report=null;el("ca-results").hidden=true;showError(error.message);
  }
}
function filteredRows(){
  if(!state.report)return [];
  const q=state.search.toLowerCase().trim(),mode=state.filter;
  return state.report.units.filter(x=>{
    if(q&&!((x.text+" "+x.source+" "+x.assigned.join(" ")).toLowerCase().includes(q)))return false;
    if(mode==="reviewed"&&!x.reviewed)return false;
    if(mode==="unreviewed"&&x.reviewed)return false;
    if(mode==="coded"&&!x.assigned.length)return false;
    return true;
  });
}
function renderPassages(){
  const root=el("ca-passages");root.replaceChildren();
  const rows=filteredRows(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  state.page=Math.max(0,Math.min(state.page,pages-1));
  for(const row of rows.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE)){
    const article=element("article",null,"ca-passage");
    const heading=element("div",null,"ca-passage-head");
    heading.append(element("b",row.source+" · "+row.id),
      element("span",row.reviewed?"✓ Reviewed":"◌ Keyword suggestions",
        row.reviewed?"ca-review-done":"ca-review-pending"));
    article.append(heading,element("p",row.text,"ca-passage-text"));
    const codes=element("div",null,"ca-pill-row");
    if(row.assigned.length)row.assigned.forEach(id=>{
      codes.append(element("span",state.report.project.codes.find(c=>c.id===id)?.name||id,"ca-code-pill"));
    });
    else codes.append(element("span","No assigned codes","ca-muted"));
    article.append(codes);
    if(row.memo)article.append(element("p","Memo: "+row.memo,"ca-passage-memo"));
    article.append(button(row.reviewed?"Edit reviewed coding":"Review this passage",()=>openReview(row.id),"ca-review-button"));
    root.append(article);
  }
  if(!rows.length)root.append(element("p","No passages match your filters.","ca-muted"));
  el("ca-page").textContent="Page "+(state.page+1)+" of "+pages+" · "+rows.length+" matching units";
  el("ca-prev").disabled=state.page===0;el("ca-next").disabled=state.page>=pages-1;
}
function openReview(id){
  const row=state.report?.units.find(x=>x.id===id);
  if(!row)return;
  state.selectedUnit=id;
  el("ca-review-title").textContent="Review "+id;
  el("ca-review-context").textContent=row.source+" — "+
    (row.reviewed?"Previously reviewed":"Suggested codes require confirmation");
  el("ca-review-text").textContent=row.text;
  el("ca-review-memo").value=row.memo;
  const list=el("ca-review-checks");list.replaceChildren();
  for(const code of state.report.project.codes){
    const label=element("label",null,"ca-review-option");
    const check=element("input");check.type="checkbox";check.value=code.id;
    check.checked=row.assigned.includes(code.id);
    label.append(check,element("span",code.name),
      element("small","Suggested matches: "+(row.hitsByCode[code.id]?.length||0)));
    list.append(label);
  }
  reviewError("");
  el("ca-review-dialog").showModal();
}
function saveReview(){
  const codes=[...el("ca-review-checks").querySelectorAll('input:checked')].map(x=>x.value);
  try{
    const next=saveUnitReview(state.project,state.selectedUnit,codes,el("ca-review-memo").value);
    if(commit(next,{analyze:true})){
      el("ca-review-dialog").close();state.selectedUnit=null;
    }
  }catch(error){reviewError(error.message);}
}
function revertReview(){
  if(!state.selectedUnit)return;
  if(!confirm("Return this passage to unreviewed keyword suggestions?"))return;
  try{
    if(commit(unreviewUnit(state.project,state.selectedUnit),{analyze:true})){
      el("ca-review-dialog").close();state.selectedUnit=null;
    }
  }catch(error){reviewError(error.message);}
}
function setup(){
  el("ca-demo").addEventListener("click",loadDemo);
  el("ca-new").addEventListener("click",newStudy);
  el("ca-title").addEventListener("change",()=>commit({...state.project,title:el("ca-title").value}));
  el("ca-unit").addEventListener("change",changeUnit);
  el("ca-add-doc").addEventListener("click",addDoc);
  el("ca-add-code").addEventListener("click",addCode);
  el("ca-update-code").addEventListener("click",updateCode);
  el("ca-reset-code").addEventListener("click",clearCodeFields);
  el("ca-analyze").addEventListener("click",renderReport);
  el("ca-template").addEventListener("click",()=>
    download("statlab-content-documents-template.csv",
      "id,title,text\r\nD1,Interview One,\"Paste interview transcript here\"\r\n",
      "text/csv;charset=utf-8"));
  el("ca-upload-text").addEventListener("click",()=>{
    el("ca-source-file").accept=".txt,.md,text/plain,text/markdown";el("ca-source-file").click();
  });
  el("ca-upload-csv").addEventListener("click",()=>{
    el("ca-source-file").accept=".csv,text/csv";el("ca-source-file").click();
  });
  el("ca-source-file").addEventListener("change",event=>loadSource(event.target.files?.[0]));
  el("ca-backup").addEventListener("click",()=>{
    try{download("statlab-content-project.json",exportContentProject(state.project),"application/json");
      el("ca-save-status").textContent="Backup downloaded (contains source text; store privately)";
    }catch(error){showError(error.message);}
  });
  el("ca-open").addEventListener("click",()=>el("ca-project-file").click());
  el("ca-project-file").addEventListener("change",event=>openProject(event.target.files?.[0]));
  el("ca-export-units").addEventListener("click",()=>{
    if(state.report)download("statlab-coded-passages.csv",codedUnitsCsv(state.report),"text/csv;charset=utf-8");
  });
  el("ca-export-codes").addEventListener("click",()=>{
    if(state.report)download("statlab-content-code-summary.csv",codesSummaryCsv(state.report),"text/csv;charset=utf-8");
  });
  el("ca-export-chapter").addEventListener("click",()=>{
    if(state.report)download("statlab-content-chapter-four.html",chapterFourContentHtml(state.report),
      "text/html;charset=utf-8");
  });
  el("ca-search").addEventListener("input",event=>{
    state.search=event.target.value;state.page=0;renderPassages();
  });
  el("ca-filter").addEventListener("change",event=>{
    state.filter=event.target.value;state.page=0;renderPassages();
  });
  el("ca-prev").addEventListener("click",()=>{state.page--;renderPassages();});
  el("ca-next").addEventListener("click",()=>{state.page++;renderPassages();});
  el("ca-review-cancel").addEventListener("click",()=>el("ca-review-dialog").close());
  el("ca-review-save").addEventListener("click",saveReview);
  el("ca-review-revert").addEventListener("click",revertReview);
  clearCodeFields();renderDocuments();renderCodebook();renderReport();
}
setup();
