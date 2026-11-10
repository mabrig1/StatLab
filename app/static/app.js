(() => {
'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const METHODS = {
  questionnaire:{name:'Questionnaire Analysis Assistant',desc:'Summarize your questionnaire under each research objective, with raw frequencies, valid percentages and optional coded scores.',tip:'Choose only matching coded Likert items. Declare which codes mean a favourable answer, and manually mark any negatively worded items for reverse-keying. The report cannot establish causation or accept hypotheses.',fields:[]},
  descriptives:{name:'Descriptive statistics made simple',desc:'Choose questions, get an easy summary, and read what each result means.',tip:'Uses Variable View measurement levels: Scale → averages; Nominal/Ordinal → answer counts. Missing responses are excluded. Check your coding first.',fields:[]},
  frequencies:{name:'Frequencies',desc:'Counts, percentages, valid percentages and cumulative percentages.',tip:'Works with nominal categories, survey responses and numeric codes.',fields:[['a','Choose one variable','all','single']]},
  correlation:{name:'Correlations',desc:'Test strength and direction of linear or monotonic relationships.',tip:'Pearson requires approximately linear relationships; Spearman uses ranks.',fields:[['columns','Choose 2 or more variables','numeric','multi'],['method','Correlation method','method','single']]},
  regression:{name:'Multiple linear regression',desc:'Predict a continuous outcome with one or more numeric predictors.',tip:'Linear OLS requires appropriate model assumptions; coefficients are associations, not proof of causation.',fields:[['a','Dependent (outcome) variable','numeric','single'],['columns','Independent (predictor) variables','numeric','multi']]},
  crosstab:{name:'Crosstabs & chi-square',desc:'Cross-tabulate two categorical variables and test association.',tip:'Inspect expected cell counts. Chi-square approximation is less reliable for sparse tables.',fields:[['a','Row variable','all','single'],['b','Column variable','all','single']]},
  reliability:{name:"Cronbach’s alpha",desc:'Estimate internal consistency of a multi-item scale.',tip:'Ensure Likert items reflect the same construct and reverse-worded questions were correctly recoded.',fields:[['columns','Scale items (2 or more)','numeric','multi']]},
  efa:{name:'Exploratory Factor Analysis (principal axes)',desc:'Explore latent structure among observed, paired numeric or ordered questionnaire items.',tip:'Requires 4–25 numeric scale/ordinal items and enough real complete respondent rows (at least max(50, 5 × items)). Checks KMO and Bartlett; rejects singular or unsuitable data. Principal axes ≠ PCA. Factor count is researcher-selected.',fields:[['columns','Select 4–25 observed numeric scale/ordinal items','numeric','multi']]},
  ttest_ind:{name:'Independent-samples t-test',desc:'Compare the means of two independent groups (Welch test).',tip:'The grouping variable must contain exactly two nonmissing categories.',fields:[['a','Outcome (numeric)','numeric','single'],['b','Grouping variable (2 groups)','all','single']]},
  ttest_paired:{name:'Paired-samples t-test',desc:'Compare matched measurements from the same respondents.',tip:'Use paired observations: e.g., pre-test and post-test from the same individual.',fields:[['a','First measurement','numeric','single'],['b','Second measurement','numeric','single']]},
  anova:{name:'One-way ANOVA',desc:'Compare average outcome values across two or more groups.',tip:'Classical ANOVA assumes equal variances. Post-hoc tests are not included in this version.',fields:[['a','Outcome (numeric)','numeric','single'],['b','Group/category','all','single']]},
  normality:{name:'Normality (Shapiro–Wilk)',desc:'Evaluate the evidence against normality for continuous variables.',tip:'Available for variables with 3–5,000 valid observations.',fields:[['columns','Continuous variable(s)','numeric','multi']]}
};
const state={data:null,mode:'descriptives',run:null,history:[],file:null,view:'overview'};
let toastTimer;
function toast(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),5200)}
async function api(url,init){const r=await fetch(url,init);let parsed;try{parsed=await r.json()}catch{throw new Error('Server returned an invalid response. Is the local server running?')}if(!r.ok)throw new Error(typeof parsed.detail==='string'?parsed.detail:'Request failed.');return parsed}
function showView(view){state.view=view;for(const node of document.querySelectorAll('.view'))node.classList.toggle('active',node.id===`view-${view}`);for(const node of document.querySelectorAll('.navigation > [data-view]'))node.classList.toggle('active',node.dataset.view===view);$('crumb-current').textContent=({overview:'Overview',data:'Data & variables',analyze:'Analysis workbench',frequency:'Frequency-only analysis',results:'Output viewer',projects:'Research projects'})[view]||view;window.scrollTo({top:0,behavior:'smooth'})}
function changeMode(mode){if(!METHODS[mode])return;state.mode=mode;$('analysis-mode').value=mode;for(const node of document.querySelectorAll('[data-mode]'))node.classList.toggle('active',node.dataset.mode===mode);buildControls();showView('analyze')}
function openUpload(){state.file=null;$('file-input').value='';$('selected-file').hidden=true;$('submit-import').disabled=true;$('upload-modal').hidden=false}
function closeUpload(){$('upload-modal').hidden=true}
function openBlank(){if(state.data&&!confirm('Create a new dataset? Export the current observations and results first; this workspace will be replaced.'))return;$('blank-modal').hidden=false;$('blank-name').focus()}
function closeBlank(){$('blank-modal').hidden=true}
async function createBlankDataset(e){
 e.preventDefault();const button=$('create-blank');button.disabled=true;
 const payload={filename:$('blank-name').value.trim(),variable:$('blank-variable').value.trim(),type:$('blank-type').value,rows:Number($('blank-rows').value)};
 try{
  const changed=await api('/api/datasets/blank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(state.data)try{await api(caseBase(),{method:'DELETE'})}catch{}
  state.data=changed;state.run=null;state.history=[];resetCases();updateData();renderResults();closeBlank();showView('data');
  toast(`New blank dataset ready: ${changed.rows} cases × ${changed.columns} variable.`)
 }catch(err){toast(err.message,true)}finally{button.disabled=false}
}
function setSelectedFile(file){if(!file)return;state.file=file;$('selected-file').hidden=false;$('selected-file').textContent=`Selected: ${file.name} · ${(file.size/1024).toFixed(0)} KB`;$('submit-import').disabled=false}
function updateData(){
 const d=state.data,have=!!d;
 $('count-rows').textContent=have?Number(d.rows).toLocaleString():'—';
 $('count-cols').textContent=have?d.columns:'—';
 $('count-runs').textContent=state.history.length;
 $('project-state').textContent=have?d.filename:'No dataset loaded';
 $('analyze-dataset-pill').textContent=have?`● ${d.filename} · ${d.rows} cases`:'○ No dataset';
 $('run-analysis').disabled=!have;$('download-data').disabled=!have;
 $('discard-data').disabled=!have;$('export-dictionary').disabled=!have;$('import-dictionary').disabled=!have;$('add-variable').disabled=!have;
 $('preview-labels').disabled=!have;
 $('dataset-title').textContent=have?d.filename:'Dataset preview';
 $('data-subtitle').textContent=have?`${d.rows.toLocaleString()} cases × ${d.columns} variables. Edit, filter, sort, and export your observations.`:'No dataset imported.';
 $('dictionary-revision').textContent=`Revision ${have?d.revision:0}`;
 syncCaseSelectors();renderPreview();renderVariableTable();buildControls();
}
// Data View operates on a server-side page; imported cases are never silently reordered.
const cases={page:null,offset:0,size:50,search:'',filterColumn:'',operator:'contains',sort:'',descending:false,
  selectedRows:new Set(),selectedCell:null,anchor:null,range:null,loading:0,editing:false};
let caseSearchTimer;
const caseBase=()=>`/api/datasets/${encodeURIComponent(state.data.dataset_id)}`;
const dataJSON=(path,body,method='POST')=>api(`${caseBase()}${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function syncCaseSelectors(){
 const names=state.data?.variables||[];
 for(const id of ['case-filter-column','case-sort-column']){
  const node=$(id),current=node.value,base=id==='case-filter-column'?'All variables':'Original case order';
  node.innerHTML=`<option value="">${base}</option>`+names.map(v=>`<option value="${escapeHTML(v.name)}">${escapeHTML(v.name)}${v.label?' — '+escapeHTML(v.label):''}</option>`).join('');
  node.value=names.some(v=>v.name===current)?current:'';
 }
 cases.filterColumn=$('case-filter-column').value;
 cases.sort=$('case-sort-column').value;
 $('case-filter-operator').disabled=!cases.filterColumn;
 $('case-sort-direction').disabled=!cases.sort;
}
function caseControls(){
 const have=!!state.data,pg=cases.page||{filtered:0,total:0,rows:[]};
 $('add-case').disabled=!have; $('undo-data').disabled=!have||!state.data.can_undo;
 $('redo-data').disabled=!have||!state.data.can_redo;
 $('delete-cases').disabled=!have||!cases.selectedRows.size;
 $('data-revision').textContent=`Revision ${have?state.data.revision:0}`;
 $('case-page-size').disabled=!have;
 $('case-first').disabled=!have||cases.offset<=0; $('case-previous').disabled=!have||cases.offset<=0;
 $('case-next').disabled=!have||cases.offset+cases.size>=pg.filtered;
 $('case-last').disabled=!have||cases.offset+cases.size>=pg.filtered;
 $('case-page-info').textContent=have?`Page ${Math.floor(cases.offset/cases.size)+1} of ${Math.max(1,Math.ceil(pg.filtered/cases.size))}`:'Page 0 of 0';
 if(!have){$('case-status').textContent='No dataset loaded';return}
 const from=pg.filtered?cases.offset+1:0,to=Math.min(pg.filtered,cases.offset+pg.rows.length);
 $('case-status').textContent=`Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${pg.filtered.toLocaleString()} matching cases (${pg.total.toLocaleString()} total)${cases.selectedRows.size?' · '+cases.selectedRows.size+' selected':''}`;
}
async function loadCaseRows(){
 if(!state.data){cases.page=null;cases.selectedCell=null;cases.anchor=null;cases.range=null;cases.selectedRows.clear();renderCaseGrid();caseControls();return}
 const ticket=++cases.loading;
 const q=new URLSearchParams({offset:String(cases.offset),limit:String(cases.size),query:cases.search,
   column:cases.filterColumn,operator:cases.operator,sort:cases.sort,descending:String(cases.descending)});
 try{
  const page=await api(`${caseBase()}/rows?${q}`);
  if(ticket!==cases.loading)return;
  if(cases.offset && cases.offset>=page.filtered){cases.offset=Math.max(0,(Math.ceil(page.filtered/cases.size)-1)*cases.size);return loadCaseRows()}
  cases.page=page;
  cases.selectedRows=new Set([...cases.selectedRows].filter(x=>x<page.total));
  renderCaseGrid();caseControls();
 }catch(err){if(ticket===cases.loading){toast(err.message,true);$('case-status').textContent=err.message}}
}
function renderPreview(){return loadCaseRows()}
function renderCaseGrid(){
 const page=cases.page,d=state.data;
 if(!d||!page){$('data-preview').innerHTML='<thead><tr><th>Dataset not loaded</th></tr></thead><tbody><tr><td>Import CSV, XLSX, TSV or SPSS SAV to start entering observations.</td></tr></tbody>';return}
 const vars=d.variables;
 const header=`<thead><tr><th class="case-row-header case-check"><input type="checkbox" id="select-page-cases" aria-label="Select visible cases" ${page.rows.length&&page.rows.every(r=>cases.selectedRows.has(r.index))?'checked':''}></th><th class="case-row-header case-number">Case</th>${vars.map((v,j)=>{
  const label=$('case-column-labels').checked&&v.label?v.label:v.name;
  return `<th class="case-col-header" style="min-width:${Math.min(280,Math.max(106,v.columns*8))}px" title="${escapeHTML(v.name)} — ${escapeHTML(v.label||v.type)}"><button type="button" data-sort-header="${escapeHTML(v.name)}">${escapeHTML(label)} ${cases.sort===v.name?(cases.descending?'↓':'↑'):''}<small>${escapeHTML(v.type)} · ${escapeHTML(v.measure)}</small></button></th>`}).join('')}</tr></thead>`;
 const rows=page.rows.map((r,i)=>`<tr data-case-index="${r.index}" class="${cases.selectedRows.has(r.index)?'case-row-selected':''}"><td class="case-check"><input type="checkbox" data-case-check="${r.index}" aria-label="Select case ${r.index+1}" ${cases.selectedRows.has(r.index)?'checked':''}></td><th scope="row" class="case-number">${r.index+1}</th>${r.values.map((value,j)=>{
  const v=vars[j],miss=r.system_missing[j],userMiss=r.user_missing[j],labelMode=$('preview-labels').checked;
  const display=labelMode?r.labelled[j]:r.formatted[j];
  const className=[miss?'case-system-missing':'',userMiss?'case-user-missing':'',cases.selectedCell?.row===r.index&&cases.selectedCell?.column===v.name?'case-cell-active':''].join(' ');
  return `<td tabindex="0" role="gridcell" data-case-row="${r.index}" data-case-col="${j}" data-page-row="${i}" class="case-data-cell ${className}" style="text-align:${v.align};min-width:${Math.min(280,Math.max(106,v.columns*8))}px" title="${escapeHTML(v.name)}: ${escapeHTML(value===null?'System missing':value)}${userMiss?' (user-missing code)':''}">${miss?'<span class="missing-glyph">·</span>':escapeHTML(display)}</td>`}).join('')}</tr>`).join('');
 $('data-preview').innerHTML=header+`<tbody>${rows||`<tr><td colspan="${vars.length+2}" class="placeholder-cell">No cases match your search. Clear filters to see all observations.</td></tr>`}</tbody>`;
 highlightCaseRange();syncActiveCaseBar();
}
function syncActiveCaseBar(){
 const selection=cases.selectedCell,pg=cases.page;
 const index=selection?state.data?.variables.findIndex(v=>v.name===selection.column):-1;
 const row=selection&&pg?.rows.find(r=>r.index===selection.row);
 const active=!!row&&index>=0;
 $('case-active-label').textContent=active?`Case ${selection.row+1} · ${selection.column}`:'—';
 $('case-active-value').disabled=!active;
 $('case-apply-value').disabled=!active;
 if(active){const raw=row.values[index];$('case-active-value').value=raw??'';
  $('case-cell-hint').textContent=`${state.data.variables[index].type} · ${row.system_missing[index]?'system missing':row.user_missing[index]?'user-defined missing':'valid observation'}`;
 }else{$('case-active-value').value='';$('case-cell-hint').textContent='Select a cell to edit its raw code';}
}
function highlightCaseRange(){
 const {range}=cases;
 for(const cell of $('data-preview').querySelectorAll('.case-data-cell')){
  const r=Number(cell.dataset.pageRow),c=Number(cell.dataset.caseCol);
  cell.classList.toggle('case-range-selected',!!range&&r>=Math.min(range.r1,range.r2)&&r<=Math.max(range.r1,range.r2)&&c>=Math.min(range.c1,range.c2)&&c<=Math.max(range.c1,range.c2));
  cell.classList.toggle('case-cell-active',cases.selectedCell?.row===Number(cell.dataset.caseRow)&&cases.selectedCell?.column===state.data?.variables[c]?.name);
 }
}
function activateCaseCell(cell,extend=false){
 if(!cell||!state.data)return;
 const pos=Number(cell.dataset.pageRow),col=Number(cell.dataset.caseCol);
 const row=Number(cell.dataset.caseRow);
 if(!extend||!cases.anchor)cases.anchor={pageRow:pos,col};
 cases.range=extend?{r1:cases.anchor.pageRow,c1:cases.anchor.col,r2:pos,c2:col}:{r1:pos,c1:col,r2:pos,c2:col};
 cases.selectedCell={row,column:state.data.variables[col].name};
 highlightCaseRange();syncActiveCaseBar();
}
function caseCellAt(pageRow,col){return $('data-preview').querySelector(`.case-data-cell[data-page-row="${pageRow}"][data-case-col="${col}"]`)}
function focusCaseCell(pageRow,col){const next=caseCellAt(pageRow,col);if(next){activateCaseCell(next);next.focus();next.scrollIntoView({block:'nearest',inline:'nearest'});}return next}
function selectionAsTSV(){
 const range=cases.range,page=cases.page;if(!range||!page)return '';
 const rmin=Math.min(range.r1,range.r2),rmax=Math.max(range.r1,range.r2),cmin=Math.min(range.c1,range.c2),cmax=Math.max(range.c1,range.c2);
 return page.rows.slice(rmin,rmax+1).map(row=>row.values.slice(cmin,cmax+1).map(v=>v===null?'':String(v)).join('\t')).join('\n');
}
async function commitCaseEdit(row,col,value){
 if(!state.data)return;
 const r=cases.page?.rows.find(i=>i.index===row),i=state.data.variables.findIndex(v=>v.name===col);
 if(!r||i<0)return;
 const raw=r.values[i],typed=value===null?'':String(value);
 if(typed===(raw===null?'':String(raw)))return;
 try{
  const updated=await dataJSON('/rows/cells',{revision:state.data.revision,edits:[{row,column:col,value:typed}]},'PATCH');
  await acceptCaseMutation(updated,`Saved Case ${row+1} · ${col}.`);
 }catch(error){toast(error.message,true);throw error;}
}
async function acceptCaseMutation(updated,message){
 state.data=updated;state.run=null;state.history=[];
 updateData();renderResults();if(message)toast(message);
}
function beginCaseEditor(cell,initial=null){
 if(!cell||cases.editing)return;
 activateCaseCell(cell);cases.editing=true;
 const row=Number(cell.dataset.caseRow),colIndex=Number(cell.dataset.caseCol),col=state.data.variables[colIndex].name;
 const caseRow=cases.page?.rows.find(r=>r.index===row),old=caseRow?.values[colIndex];
 const input=document.createElement('input');input.type='text';input.className='case-inline-input';input.setAttribute('aria-label',`Edit Case ${row+1}, ${col}`);input.value=initial!==null?initial:(old??'');
 const oldMarkup=cell.innerHTML;cell.innerHTML='';cell.appendChild(input);input.focus();if(initial===null)input.select();
 let settled=false;
 async function complete(save){
  if(settled)return;settled=true;
  if(!save){cell.innerHTML=oldMarkup;cases.editing=false;cell.focus();return}
  input.disabled=true;
  try{await commitCaseEdit(row,col,input.value)}catch{if(cell.isConnected){cell.innerHTML=oldMarkup;cases.editing=false;cell.focus()}return}
  cases.editing=false;
 }
 input.addEventListener('keydown',async e=>{
  if(e.key==='Escape'){e.preventDefault();await complete(false)}
  if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();const nextRow=Number(cell.dataset.pageRow)+(e.key==='Enter'?1:0),nextCol=colIndex+(e.key==='Tab'?(e.shiftKey?-1:1):0);await complete(true);focusCaseCell(nextRow,nextCol)}
 });
 input.addEventListener('blur',()=>{if(!settled)complete(true)});
}
function decodeClipboard(text){
 const normalized=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
 const rows=normalized.split('\n');if(rows.length>1&&rows[rows.length-1]==='')rows.pop();
 return rows.map(line=>line.split('\t'));
}
async function pasteAtCell(text){
 const selected=cases.selectedCell,page=cases.page;
 if(!selected||!page)return;
 const matrix=decodeClipboard(text);
 if(!matrix.length||!matrix[0].length)return;
 const multivalued=matrix.length>1||matrix[0].length>1;
 if(multivalued&&(cases.search.trim()||cases.filterColumn||cases.sort))return toast('For multi-cell paste, reset filters and sorting first so consecutive cells are unambiguous.',true);
 try{
  if(multivalued){
   const updated=await dataJSON('/rows/paste',{revision:state.data.revision,row:selected.row,column:selected.column,values:matrix});
   await acceptCaseMutation(updated,`Pasted ${matrix.length} × ${matrix[0].length} cells.`);
  }else await commitCaseEdit(selected.row,selected.column,matrix[0][0]);
 }catch(error){toast(error.message,true)}
}
async function mutateCases(path,payload,message){
 try{const updated=await dataJSON(path,{revision:state.data.revision,...payload});await acceptCaseMutation(updated,message);return true}
 catch(e){toast(e.message,true);if(e.message.includes('changed after')){try{state.data=await api(caseBase());updateData()}catch{}}return false}
}
function resetCases(){cases.page=null;cases.offset=0;cases.search='';cases.filterColumn='';cases.operator='contains';cases.sort='';cases.descending=false;cases.selectedRows.clear();cases.selectedCell=null;cases.anchor=null;cases.range=null;cases.loading++;$('case-filter-column').value='';$('case-sort-column').value='';$('case-search').value='';$('case-filter-operator').value='contains';$('case-sort-direction').textContent='↑ Asc';}
function setupDataView(){
 $('case-search').addEventListener('input',e=>{clearTimeout(caseSearchTimer);caseSearchTimer=setTimeout(()=>{cases.search=e.target.value;cases.offset=0;cases.selectedRows.clear();loadCaseRows()},280)});
 $('case-filter-column').addEventListener('change',e=>{cases.filterColumn=e.target.value;$('case-filter-operator').disabled=!cases.filterColumn;if(!cases.filterColumn&&['is_missing','is_valid'].includes(cases.operator)){$('case-filter-operator').value='contains';cases.operator='contains'}cases.offset=0;cases.selectedRows.clear();loadCaseRows()});
 $('case-filter-operator').addEventListener('change',e=>{cases.operator=e.target.value;if(['is_missing','is_valid'].includes(cases.operator)&&!cases.filterColumn){toast('Choose a variable first.',true);e.target.value='contains';cases.operator='contains';return}cases.offset=0;loadCaseRows()});
 $('case-sort-column').addEventListener('change',e=>{cases.sort=e.target.value;$('case-sort-direction').disabled=!cases.sort;cases.offset=0;loadCaseRows()});
 $('case-sort-direction').addEventListener('click',()=>{cases.descending=!cases.descending;$('case-sort-direction').textContent=cases.descending?'↓ Desc':'↑ Asc';loadCaseRows()});
 $('case-clear-filter').addEventListener('click',()=>{cases.offset=0;cases.search='';cases.sort='';cases.filterColumn='';cases.operator='contains';cases.descending=false;cases.selectedRows.clear();cases.selectedCell=null;cases.range=null;$('case-search').value='';$('case-filter-column').value='';$('case-filter-operator').value='contains';$('case-sort-column').value='';$('case-sort-direction').textContent='↑ Asc';$('case-sort-direction').disabled=true;$('case-filter-operator').disabled=true;loadCaseRows()});
 $('case-page-size').addEventListener('change',e=>{cases.size=Number(e.target.value);cases.offset=0;cases.selectedRows.clear();loadCaseRows()});
 $('case-first').addEventListener('click',()=>{cases.offset=0;cases.selectedCell=null;cases.range=null;loadCaseRows()});
 $('case-previous').addEventListener('click',()=>{cases.offset=Math.max(0,cases.offset-cases.size);cases.selectedCell=null;cases.range=null;loadCaseRows()});
 $('case-next').addEventListener('click',()=>{cases.offset+=cases.size;cases.selectedCell=null;cases.range=null;loadCaseRows()});
 $('case-last').addEventListener('click',()=>{cases.offset=Math.max(0,(Math.ceil(cases.page.filtered/cases.size)-1)*cases.size);cases.selectedCell=null;cases.range=null;loadCaseRows()});
 $('preview-labels').addEventListener('change',renderCaseGrid);
 $('case-column-labels').addEventListener('change',renderCaseGrid);
 $('case-active-value').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('case-apply-value').click()}});
 $('case-apply-value').addEventListener('click',async()=>{const a=cases.selectedCell;if(a)await commitCaseEdit(a.row,a.column,$('case-active-value').value)});
 $('add-case').addEventListener('click',async()=>{if(!state.data)return;const ok=await mutateCases('/rows',{count:1},'Added one blank case.');if(ok){cases.offset=Math.max(0,(Math.ceil(state.data.rows/cases.size)-1)*cases.size);loadCaseRows()}});
 $('delete-cases').addEventListener('click',async()=>{const indexes=[...cases.selectedRows];if(!indexes.length)return;if(indexes.length>100)return toast('Delete up to 100 cases at a time.',true);if(!confirm(`Delete ${indexes.length} selected case(s)? Undo is available until you change variable definitions.`))return;const ok=await mutateCases('/rows/delete',{indexes},`Deleted ${indexes.length} case(s).`);if(ok){cases.selectedRows.clear();loadCaseRows()}});
 $('undo-data').addEventListener('click',()=>mutateCases('/history/undo',{},'Undid the last data operation.'));
 $('redo-data').addEventListener('click',()=>mutateCases('/history/redo',{},'Redid the last data operation.'));
 $('jump-data-view').addEventListener('click',()=>document.querySelector('.data-panel').scrollIntoView({behavior:'smooth'}));
 $('jump-variable-view').addEventListener('click',()=>document.querySelector('.variable-panel').scrollIntoView({behavior:'smooth'}));
 $('data-preview').addEventListener('change',e=>{
  const check=e.target.closest('[data-case-check]');if(check){const i=Number(check.dataset.caseCheck);if(check.checked)cases.selectedRows.add(i);else cases.selectedRows.delete(i);caseControls();renderCaseGrid();return}
  if(e.target.id==='select-page-cases'){for(const r of cases.page.rows){if(e.target.checked)cases.selectedRows.add(r.index);else cases.selectedRows.delete(r.index)}renderCaseGrid();caseControls()}
 });
 $('data-preview').addEventListener('click',e=>{
  const sort=e.target.closest('[data-sort-header]');if(sort){const v=sort.dataset.sortHeader;cases.descending=cases.sort===v?!cases.descending:false;cases.sort=v;$('case-sort-column').value=v;$('case-sort-direction').disabled=false;$('case-sort-direction').textContent=cases.descending?'↓ Desc':'↑ Asc';cases.offset=0;loadCaseRows();return}
  const cell=e.target.closest('.case-data-cell');if(cell&&!cases.editing)activateCaseCell(cell,e.shiftKey);
 });
 $('data-preview').addEventListener('dblclick',e=>{const cell=e.target.closest('.case-data-cell');if(cell)beginCaseEditor(cell)});
 $('data-preview').addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea'))return;
  const cell=e.target.closest('.case-data-cell');if(!cell)return;
  const r=Number(cell.dataset.pageRow),c=Number(cell.dataset.caseCol);
  if(['Enter','F2'].includes(e.key)){e.preventDefault();beginCaseEditor(cell);return}
  const directions={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Tab:[0,e.shiftKey?-1:1]};
  if(directions[e.key]){e.preventDefault();const [dr,dc]=directions[e.key];focusCaseCell(r+dr,c+dc)}
  if(e.key==='Delete'||e.key==='Backspace'){
   e.preventDefault();const range=cases.range;
   if(range){const selected=[];for(let row=Math.min(range.r1,range.r2);row<=Math.max(range.r1,range.r2);row++)for(let col=Math.min(range.c1,range.c2);col<=Math.max(range.c1,range.c2);col++){const v=state.data.variables[col];selected.push({row:cases.page.rows[row].index,column:v.name,value:null})}
    if(selected.length>2500)return toast('Select up to 2,500 cells per clearing action.',true);
    dataJSON('/rows/cells',{revision:state.data.revision,edits:selected},'PATCH').then(updated=>acceptCaseMutation(updated,`Cleared ${selected.length} cell(s).`)).catch(err=>toast(err.message,true));
   }
  }
  if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();beginCaseEditor(cell,e.key)}
 });
 $('case-grid-container').addEventListener('copy',e=>{if(e.target.matches('input,textarea'))return;const value=selectionAsTSV();if(value){e.preventDefault();e.clipboardData.setData('text/plain',value);toast('Selected cell values copied.')}});
 $('case-grid-container').addEventListener('paste',e=>{if(e.target.matches('input,textarea'))return;if(!cases.selectedCell)return;e.preventDefault();pasteAtCell(e.clipboardData.getData('text/plain'))});
}

function abbreviateValues(v){return v.value_labels.length?`${v.value_labels.length} label${v.value_labels.length===1?'':'s'}`:'—'}
function describeMissing(v){const codes=[...v.missing_values];if(v.missing_range)codes.push(`${v.missing_range.low}…${v.missing_range.high}`);return codes.length?codes.join(', '):'None'}
function renderVariableTable(){
 const d=state.data;
 const headers='<thead><tr><th>#</th><th>Name</th><th>Type</th><th>Width</th><th>Decimals</th><th>Label</th><th>Values</th><th>Missing</th><th>Columns</th><th>Align</th><th>Measure</th><th>Role</th><th>Valid</th><th>Missing N</th><th>Action</th></tr></thead>';
 if(!d){$('variable-table').innerHTML=headers+'<tbody><tr><td colspan="15" class="placeholder-cell">Upload a dataset to edit variable definitions.</td></tr></tbody>';$('variable-showing').textContent='0 variables';return}
 const search=$('variable-search').value.trim().toLowerCase(),measure=$('measure-filter').value;
 const matches=d.variables.map((v,i)=>({v,i})).filter(({v})=>(!measure||v.measure===measure)&&(!search||`${v.name} ${v.label} ${v.role}`.toLowerCase().includes(search)));
 $('variable-showing').textContent=`${matches.length} / ${d.variables.length} variables`;
 const rows=matches.map(({v,i})=>`<tr><td class="row-number">${i+1}</td><td class="variable-name-cell"><strong title="${escapeHTML(v.name)}">${escapeHTML(v.name)}</strong></td><td><span class="type-token type-${escapeHTML(v.type)}">${escapeHTML(v.type)}</span></td><td>${v.width}</td><td>${v.decimals}</td><td title="${escapeHTML(v.label||'No label')}"><span class="variable-label-cell">${escapeHTML(v.label||'—')}</span></td><td><span class="value-pill">${abbreviateValues(v)}</span></td><td title="${escapeHTML(describeMissing(v))}"><span class="variable-label-cell">${escapeHTML(describeMissing(v))}</span></td><td>${v.columns}</td><td>${escapeHTML(v.align)}</td><td><span class="measure measure-${escapeHTML(v.measure)}">${escapeHTML(v.measure)}</span></td><td>${escapeHTML(v.role)}</td><td>${v.valid}</td><td title="System missing: ${v.system_missing}; user-missing: ${v.user_missing}">${v.missing}</td><td><div class="row-actions"><button type="button" class="row-move" data-move-index="${i}" data-move-direction="-1" ${i===0?'disabled':''} aria-label="Move ${escapeHTML(v.name)} up" title="Move up">↑</button><button type="button" class="row-move" data-move-index="${i}" data-move-direction="1" ${i===d.variables.length-1?'disabled':''} aria-label="Move ${escapeHTML(v.name)} down" title="Move down">↓</button><button type="button" class="button button-outline button-small edit-variable" data-edit-index="${i}" aria-label="Edit ${escapeHTML(v.name)}">Edit ✎</button></div></td></tr>`).join('');
 $('variable-table').innerHTML=headers+`<tbody>${rows||'<tr><td colspan="15" class="placeholder-cell">No variables match the current search or filter.</td></tr>'}</tbody>`;
}
let editingVariable=null;
function appendValueRow(value='',label=''){
 const wrapper=document.createElement('div');wrapper.className='value-label-row';
 wrapper.innerHTML=`<input type="text" class="label-code" maxlength="128" placeholder="e.g. 1" aria-label="Stored value" value="${escapeHTML(value)}"/><input type="text" class="label-text" maxlength="128" placeholder="e.g. Strongly agree" aria-label="Display label" value="${escapeHTML(label)}"/><button type="button" class="remove-value-label" aria-label="Remove this value label">×</button>`;
 $('value-label-rows').appendChild(wrapper);
}
function showVariableEditor(index){
 const v=state.data?.variables[index];if(!v)return;
 editingVariable=v.name;
 $('variable-dialog-title').textContent=`Edit ${v.name}`;
 $('variable-dialog-subtitle').textContent=`${v.valid.toLocaleString()} valid · ${v.system_missing} system missing · ${v.user_missing} user-defined missing`;
 for(const key of ['name','type','width','decimals','label','columns','align','measure','role'])$(`v-${key}`).value=v[key];
 $('value-label-rows').innerHTML='';v.value_labels.forEach(item=>appendValueRow(item.value,item.label));
 $('label-preset').value='';
 $('v-missing').value=v.missing_values.join(', ');
 $('v-range-low').value=v.missing_range?.low||'';$('v-range-high').value=v.missing_range?.high||'';
 $('variable-editor-error').hidden=true;
 $('delete-variable').hidden=false;
 syncTypeFields();$('variable-modal').hidden=false;
 $('v-name').focus();
}
function showNewVariable(){
 if(!state.data)return;
 editingVariable='__new__';
 $('variable-dialog-title').textContent='Add a variable';
 $('variable-dialog-subtitle').textContent='Create a blank variable with one missing cell for each case. Define its properties below.';
 const existing=new Set(state.data.variables.map(v=>v.name.toLowerCase()));
 let n=state.data.variables.length+1;
 while(existing.has(`var_${n}`.toLowerCase()))n++;
 const defaults={name:`var_${n}`,type:'numeric',width:8,decimals:2,label:'',columns:12,align:'right',measure:'scale',role:'input'};
 for(const [key,val] of Object.entries(defaults))$(`v-${key}`).value=val;
 $('value-label-rows').innerHTML='';$('label-preset').value='';
 $('v-missing').value='';$('v-range-low').value='';$('v-range-high').value='';
 $('variable-editor-error').hidden=true;$('delete-variable').hidden=true;
 syncTypeFields();$('variable-modal').hidden=false;
 $('v-name').focus();$('v-name').select();
}
async function deleteCurrentVariable(){
 if(!state.data||!editingVariable||editingVariable==='__new__')return;
 const name=editingVariable;
 if(!window.confirm(`Delete ${name} and ALL of its observations? This cannot be undone in this session.`))return;
 const button=$('delete-variable');button.disabled=true;
 try{
  const changed=await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/variables/${encodeURIComponent(name)}`,{method:'DELETE'});
  state.data=changed;state.run=null;state.history=[];updateData();renderResults();closeVariableEditor();
  toast(`${name} deleted. The remaining dataset is ready.`);
 }catch(error){$('variable-editor-error').textContent=error.message;$('variable-editor-error').hidden=false}
 finally{button.disabled=false}
}
async function moveVariable(index,direction){
 if(!state.data)return;
 const names=state.data.variables.map(v=>v.name);
 const other=index+direction;
 if(other<0||other>=names.length)return;
 [names[index],names[other]]=[names[other],names[index]];
 try{
  const changed=await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/variables/order`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({order:names})});
  state.data=changed;state.run=null;state.history=[];updateData();renderResults();
  toast('Variable order updated.');
 }catch(error){toast(error.message,true)}
}
function closeVariableEditor(){$('variable-modal').hidden=true;editingVariable=null}
function syncTypeFields(){
 const type=$('v-type').value,nonNumeric=type!=='numeric';
 $('v-decimals').disabled=nonNumeric;if(nonNumeric)$('v-decimals').value='0';
 for(const id of ['v-range-low','v-range-high']){$(id).disabled=nonNumeric;if(nonNumeric)$(id).value=''}
}
function applyPreset(preset){
 const options={
  'yes-no':[['1','Yes'],['2','No']],
  'likert-4':[['1','Strongly disagree'],['2','Disagree'],['3','Agree'],['4','Strongly agree']],
  'likert-5':[['1','Strongly disagree'],['2','Disagree'],['3','Neutral'],['4','Agree'],['5','Strongly agree']]
 }[preset];
 if(!options)return;
 if($('value-label-rows').children.length&&!window.confirm('Replace existing value labels with this preset?'))return;
 $('value-label-rows').innerHTML='';options.forEach(([value,label])=>appendValueRow(value,label));
 if(preset.startsWith('likert'))$('v-measure').value='ordinal';
}
function variableEditPayload(){
 const payload={};
 for(const key of ['name','type','label','align','measure','role'])payload[key]=$(`v-${key}`).value;
 for(const key of ['width','decimals','columns'])payload[key]=Number($(`v-${key}`).value);
 payload.value_labels=[];
 for(const row of $('value-label-rows').querySelectorAll('.value-label-row')){
  const value=row.querySelector('.label-code').value.trim(),label=row.querySelector('.label-text').value.trim();
  if(value||label)payload.value_labels.push({value,label});
 }
 payload.missing_values=$('v-missing').value.split(',').map(s=>s.trim()).filter(Boolean);
 const low=$('v-range-low').value.trim(),high=$('v-range-high').value.trim();
 if(Boolean(low)!==Boolean(high))throw new Error('Provide both lower and upper values for a missing range.');
 payload.missing_range=low?{low,high}:null;
 return payload;
}
async function saveVariable(e){
 e.preventDefault();if(!state.data||!editingVariable)return;
 const btn=$('save-variable'),err=$('variable-editor-error');err.hidden=true;
 btn.disabled=true;btn.textContent='Validating & saving…';
 try{
  const patch=variableEditPayload();
  const root=`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/variables`;
  const creating=editingVariable==='__new__';
  const url=creating?root:`${root}/${encodeURIComponent(editingVariable)}`;
  const changed=await api(url,{method:creating?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
  state.data=changed;state.run=null;state.history=[];
  updateData();renderResults();closeVariableEditor();
  toast(`${patch.name} saved. Analyses will use updated variable settings.`);
 }catch(error){err.textContent=error.message;err.hidden=false;err.scrollIntoView({block:'nearest'})}
 finally{btn.disabled=false;btn.textContent='Save variable ✓'}
}
async function downloadDictionary(){
 if(!state.data)return;
 try{
  const data=await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/dictionary.json`);
  download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),'statlab-variable-dictionary.json');
  toast('Variable dictionary exported.');
 }catch(err){toast(err.message,true)}
}

async function importDictionaryFile(file){
 if(!file||!state.data)return;
 if(file.size>1024*1024)return toast('Dictionary JSON must be under 1 MB.',true);
 try{
  const parsed=JSON.parse(await file.text());
  if(parsed.schema!=='mabrig-statlab-variable-dictionary-v1'||!Array.isArray(parsed.variables))throw new Error('This is not a valid StatLab variable dictionary.');
  if(!window.confirm('Apply these variable definitions to the current dataset? All existing definitions will be replaced; raw observations will remain unchanged unless a type is converted.'))return;
  const changed=await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/dictionary`,{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed)
  });
  state.data=changed;state.run=null;state.history=[];updateData();renderResults();
  toast('Variable dictionary imported and validated successfully.');
 }catch(err){toast(err instanceof SyntaxError?'The selected file is not valid JSON.':err.message,true)}
}
function fieldMarkup(field){const [key,title,type,kind]=field;const vars=state.data?.variables||[];const options=type==='method'?[{name:'pearson',label:'Pearson correlation'},{name:'spearman',label:'Spearman correlation'}]:vars.filter(v=>type==='all'||v.type==='numeric').map(v=>({name:v.name,label:v.name}));
  if(kind==='multi'){return `<div class="form-field"><div class="field-label">${escapeHTML(title)}</div><div class="multiselect" data-field="${key}">${options.length?options.map((opt,i)=>`<label><input type="checkbox" value="${escapeHTML(opt.name)}" ${i<2?'checked':''}/> ${escapeHTML(opt.label)}</label>`).join(''):'<div class="empty-variables">Import a dataset with numerical variables.</div>'}</div><div class="field-help">Tick the variables you want to include.</div></div>`}
  return `<div class="form-field"><label class="field-label" for="field-${key}">${escapeHTML(title)}</label><select class="input-select" id="field-${key}"><option value="">Select variable...</option>${options.map((opt,i)=>`<option value="${escapeHTML(opt.name)}" ${i===0?'selected':''}>${escapeHTML(opt.label)}</option>`).join('')}</select></div>`;
}
// v0.5: researcher-controlled questionnaire analysis; no inferred construct definitions.
function questionnaireObjectiveMarkup(number){
 const variables=(state.data?.variables||[]).filter(v=>v.type==='numeric');
 const choices=variables.map(v=>{
  const unavailable=v.measure==='nominal';
  return `<div class="questionnaire-item"><label class="q-item-name"><input type="checkbox" class="q-include" value="${escapeHTML(v.name)}" ${unavailable?'disabled':''}><span><b>${escapeHTML(v.name)}</b>${v.label?`<small>${escapeHTML(v.label)}</small>`:''}<small>${escapeHTML(v.measure)}${unavailable?' · set Measure to Ordinal in Variable View to enable':''}</small></span></label><label class="q-reverse-hint" title="Reverse scores for negatively worded questionnaire items"><input type="checkbox" class="q-reverse" value="${escapeHTML(v.name)}" disabled> Reverse-key</label></div>`
 }).join('');
 return `<section class="questionnaire-objective" aria-label="Research objective ${number}"><div class="questionnaire-objective-top"><span class="objective-number">OBJECTIVE ${number}</span><button class="button button-outline button-small q-remove" type="button" aria-label="Remove objective ${number}" ${number===1?'hidden':''}>Remove</button></div><label class="variable-field">Research objective or construct <input class="q-title" maxlength="120" value="Objective ${number}" placeholder="e.g. Employee motivation" required/><small>Use a short, specific objective. This title appears in your results.</small></label><div class="q-selection-top"><strong>Choose questionnaire items</strong><span class="q-selected">0 items</span></div><label class="summary-search-label">Find questionnaire variable<input class="q-search input-select" type="search" placeholder="Search code or questionnaire question…" autocomplete="off"></label><div class="q-item-list">${choices||'<p class="empty-variables">Import numeric, coded questionnaire items first and check Variable View.</p>'}</div><p class="q-remark">Reverse-key only negatively worded items; the original answers stay unchanged. Up to 15 items per objective.</p></section>`;
}
function questionnaireControls(){
 return `<div class="guide-step"><span class="guide-number">1</span><div><strong>Check your questionnaire coding</strong><p>Choose the response scale and state which end indicates a favourable response. Do not assume every questionnaire uses the same direction.</p></div></div>
 <div class="questionnaire-settings"><label class="variable-field">Response codes <select id="q-scale"><option value="">Choose your coding…</option><option value="5">1 to 5 · five-point scale</option><option value="4">1 to 4 · four-point scale</option></select></label><label class="variable-field">Which codes indicate a favourable answer? <select id="q-orientation"><option value="">Confirm answer direction…</option><option value="higher">Higher codes (e.g. 5 = strongly agree)</option><option value="lower">Lower codes (e.g. 1 = strongly agree)</option></select></label><label class="variable-field">Minimum questions answered for objective score <select id="q-threshold"><option value="50">At least 50%</option><option value="100">All selected questions (100%)</option></select></label></div>
 <p class="summary-guardrail"><strong>Important:</strong> Favourable means the response direction you choose—not an automatically judged good outcome. Check every item's wording before you interpret the percentages. If an item uses 99 for unanswered, set 99 as Missing in Variable View.</p>
 <div class="guide-step"><span class="guide-number">2</span><div><strong>Group questions by your research objectives</strong><p>Create an objective, tick its questions, and optionally reverse-key negatively worded items. Item counts and percentages use the original response codes.</p></div></div>
 <div id="q-objectives">${questionnaireObjectiveMarkup(1)}</div>
 <div class="q-footer"><button type="button" class="button button-outline button-small" id="q-add-objective">＋ Add another objective</button><span id="q-status" aria-live="polite" role="status"></span></div>
 <div class="guide-step"><span class="guide-number">3</span><div><strong>Generate an objective-by-objective report</strong><p>Get response frequencies, valid percentages, respondent-level exploratory scores, completeness checks, available Cronbach alpha, and a downloadable Chapter Four descriptive draft.</p></div></div>
 <p class="q-final-note">No scores are calculated for unsupported categories or out-of-range codes. Existing responses and variable definitions are never changed.</p>`;
}
function questionnaireUpdate(){
 const groups=[...document.querySelectorAll('.questionnaire-objective')];
 let ok=!!state.data && groups.length>0&&groups.length<=8, unique=new Set(), all=0;
 groups.forEach((g,i)=>{
  const selected=[...g.querySelectorAll('.q-include:checked')];
  selected.forEach(c=>unique.add(c.value));all+=selected.length;
  g.querySelector('.q-selected').textContent=`${selected.length} selected / 15 max`;
  g.querySelector('.q-selected').classList.toggle('summary-error',selected.length===0||selected.length>15);
  if(!selected.length||selected.length>15||!g.querySelector('.q-title').value.trim())ok=false;
  g.querySelector('.objective-number').textContent=`OBJECTIVE ${i+1}`;
  g.querySelector('.q-remove').hidden=groups.length===1;
 });
 if(unique.size>40)ok=false;
 const scale=$('q-scale'),orientation=$('q-orientation');if(!scale?.value||!orientation?.value)ok=false;
 const status=$('q-status');if(status){status.textContent=`${groups.length} objective(s) · ${all} item selections · ${unique.size} unique items`+(!ok?' · complete all required selections':' · ready to analyze');status.classList.toggle('summary-error',!ok)}
 const btn=$('run-analysis');if(btn)btn.disabled=!ok;
 const add=$('q-add-objective');if(add)add.disabled=groups.length>=8;
}
function questionnaireAction(event){
 const t=event.target,root=t.closest('.questionnaire-objective');
 if(t.closest('#q-add-objective')){
  const list=$('q-objectives'),number=list.children.length+1;if(number>8)return;
  list.insertAdjacentHTML('beforeend',questionnaireObjectiveMarkup(number));questionnaireUpdate();return;
 }
 if(t.closest('.q-remove')&&root){root.remove();questionnaireUpdate();return;}
 if(t.classList.contains('q-include')&&root){
  const rev=[...root.querySelectorAll('.q-reverse')].find(x=>x.value===t.value);
  if(rev){rev.disabled=!t.checked;if(!t.checked)rev.checked=false}
 }
 questionnaireUpdate();
}
function questionnaireSearch(input){
 const group=input.closest('.questionnaire-objective');if(!group)return;
 const q=input.value.toLocaleLowerCase().trim();
 for(const row of group.querySelectorAll('.questionnaire-item'))row.hidden=!!q&&!row.textContent.toLocaleLowerCase().includes(q);
}
function descriptiveControls(){
 const all=state.data?.variables||[];
 const vars=all.slice(0,all.length);
 const chosen=Math.min(5,vars.length);
 const group=(v)=>v.type==='date'?'Date':v.measure==='scale'&&v.type==='numeric'?'Scale':v.measure==='ordinal'?'Ordinal':'Nominal / categories';
 const list=vars.map((v,i)=>`<label class="summary-variable-choice"><input type="checkbox" class="summary-variable" value="${escapeHTML(v.name)}" ${i<chosen?'checked':''}><span class="summary-choice-info"><strong>${escapeHTML(v.name)}</strong>${v.label?`<small title="${escapeHTML(v.label)}">${escapeHTML(v.label)}</small>`:''}</span><span class="summary-measure">${escapeHTML(group(v))}</span></label>`).join('');
 return `<div class="guide-step"><span class="guide-number">1</span><div><strong>Choose the questions to summarize</strong><p>Start with five questions or select your own. For categorical questions, you’ll see counts and percentages; for scale measurements, averages and spread.</p></div></div>
 <div class="summary-pick-tools"><label class="summary-search-label" for="summary-variable-search">Find a variable<input id="summary-variable-search" class="input-select" type="search" placeholder="Search variable name or question…" autocomplete="off"></label><div class="summary-pick-buttons"><button type="button" class="button button-outline button-small" data-summary-action="recommended">First 5</button><button type="button" class="button button-outline button-small" data-summary-action="all">Select up to 30</button><button type="button" class="button button-outline button-small" data-summary-action="clear">Clear</button></div></div>
 <div class="summary-selection" role="group" aria-label="Select variables for descriptive statistics">${list||'<p class="empty-variables">Import or create data to start.</p>'}</div>
 <p class="summary-selection-status" id="summary-selection-status" role="status" aria-live="polite"></p>
 <div class="guide-step"><span class="guide-number">2</span><div><strong>Choose how much detail you need</strong><p>Simple is best for beginners. Detailed adds quartiles, variance, skewness and kurtosis for numeric scale variables.</p></div></div>
 <div class="summary-report-options" role="radiogroup" aria-label="Report detail"><label><input type="radio" name="detail-level" value="simple" checked><span><strong>Simple report</strong><small>Clear tables + explanations + chart when useful</small></span></label><label><input type="radio" name="detail-level" value="detailed"><span><strong>Detailed report</strong><small>Everything in Simple, plus advanced numeric indicators</small></span></label></div>
 <div class="guide-step"><span class="guide-number">3</span><div><strong>Get your results</strong><p>Click the button below. Read the headline numbers first, then the plain-language findings, and finally the tables. You can export the report.</p></div></div>
 <p class="summary-guardrail">ⓘ Questionnaire item codes such as 1–5 are not automatically true measurements. Set the correct <strong>Measure</strong> in Variable View before analysis.</p>`;
}
function summaryUpdateCount(){
 const picked=[...document.querySelectorAll('.summary-variable:checked')];
 const status=$('summary-selection-status');if(!status)return;
 status.textContent=`${picked.length} selected · up to 30 per report${picked.length>30?' — choose fewer variables':''}`;
 status.classList.toggle('summary-error',picked.length>30||picked.length===0);
 const btn=$('run-analysis');if(btn)btn.disabled=!state.data||picked.length>30||picked.length===0;
}
function summarySearch(){
 const input=$('summary-variable-search');if(!input)return;
 const q=input.value.trim().toLocaleLowerCase();
 for(const item of document.querySelectorAll('.summary-variable-choice'))item.hidden=!!q&&!item.textContent.toLocaleLowerCase().includes(q);
}
function summaryAction(action){
 const all=[...document.querySelectorAll('.summary-variable')];
 if(action==='clear')all.forEach(e=>e.checked=false);
 else if(action==='recommended')all.forEach((e,i)=>e.checked=i<5);
 else if(action==='all')all.forEach((e,i)=>e.checked=i<30);
 summaryUpdateCount();
}
function buildControls(){
 const m=METHODS[state.mode];$('form-heading').textContent=m.name;$('form-description').textContent=m.desc;$('method-note').textContent=m.tip;
 if(state.mode==='descriptives'){
  $('dynamic-controls').innerHTML=descriptiveControls();summaryUpdateCount();return;
 }
 if(state.mode==='questionnaire'){
  $('dynamic-controls').innerHTML=questionnaireControls();questionnaireUpdate();return;
 }
 $('dynamic-controls').innerHTML=m.fields.map(fieldMarkup).join('');
 if(state.mode==='efa'){
   const settings=document.createElement('section');
   settings.className='analysis-efa-options';
   settings.innerHTML=`<div class="form-note"><span>ⓘ</span><span><strong>Respondent-level EFA:</strong> select actual matched observations, not frequency-only counts. Use Variable View to mark text-free, numeric items as Scale or Ordinal; check reverse-worded items before fitting.</span></div>
      <label class="field-label" for="efa-count">Number of factors (set before examining loadings)</label>
      <select class="input-select" id="efa-count">
        <option value="1">1 factor</option><option value="2" selected>2 factors</option>
        <option value="3">3 factors</option><option value="4">4 factors</option>
        <option value="5">5 factors</option><option value="6">6 factors</option>
      </select>
      <label class="field-label" for="efa-rotation">Rotation</label>
      <select class="input-select" id="efa-rotation">
        <option value="varimax" selected>Varimax (orthogonal)</option>
        <option value="oblimin">Oblimin / quartimin (oblique; correlated factors)</option>
        <option value="none">None (unrotated)</option>
      </select>
      <label class="field-label" for="efa-parallel-simulations">Parallel analysis · simulated null datasets</label>
      <select class="input-select" id="efa-parallel-simulations">
        <option value="50">50 (faster, noisier)</option>
        <option value="100" selected>100 (default)</option>
        <option value="200">200 (more stable)</option>
      </select>
      <label class="field-label" for="efa-parallel-seed">Reproducibility seed</label>
      <input id="efa-parallel-seed" class="input-select" type="number" min="0" max="4294967295" step="1" value="20261110" required>
      <p class="method-note"><strong>Factor-retention guide:</strong> Horn-style comparison uses simulated <em>Pearson correlation component eigenvalues</em>, not an exact common-factor parallel analysis. The suggested count does not override your chosen number of principal-axis factors. Oblimin adds a pattern matrix, separate structure matrix, and factor correlations; it does not establish causality. Polychoric EFA and CFA remain unavailable.</p>`;
   $('dynamic-controls').append(settings);
 }
 const a=$('field-a'),b=$('field-b');if(a&&b&&a.value===b.value){const alternative=[...b.options].find(o=>o.value&&o.value!==a.value);if(alternative)b.value=alternative.value}
}
function readForm(){
 const out={dataset_id:state.data?.dataset_id,analysis:state.mode,columns:[]};
 if(state.mode==='questionnaire'){
  out.scale_points=Number($('q-scale').value);out.higher_is_favourable=$('q-orientation').value==='higher';
  out.min_answered_pct=Number($('q-threshold').value);
  out.objectives=[...document.querySelectorAll('.questionnaire-objective')].map(group=>({
    title:group.querySelector('.q-title').value.trim(),
    items:[...group.querySelectorAll('.q-include:checked')].map(e=>e.value),
    reverse_items:[...group.querySelectorAll('.q-reverse:checked')].map(e=>e.value)
  }));return out;
 }
 if(state.mode==='descriptives'){
  out.columns=[...document.querySelectorAll('.summary-variable:checked')].map(i=>i.value);
  out.detail_level=document.querySelector('input[name="detail-level"]:checked')?.value||'simple';
  return out;
 }
 for(const [key,title,type,kind] of METHODS[state.mode].fields){if(kind==='multi'){out[key]=[...document.querySelectorAll(`.multiselect[data-field="${key}"] input:checked`)].map(i=>i.value)}else{out[key]=$(`field-${key}`).value}}
 if(state.mode==='efa'){
    out.factor_count=Number($('efa-count').value);
    out.factor_rotation=$('efa-rotation').value;
    out.parallel_simulations=Number($('efa-parallel-simulations').value);
    const seedInput=$('efa-parallel-seed');
    if(!seedInput.value.trim()||!seedInput.checkValidity()){
      throw new Error('Enter a valid integer parallel-analysis seed.');
    }
    out.parallel_seed=Number(seedInput.value);
 }
 return out;
}
async function importFile(){if(!state.file)return toast('Select a file first.',true);if(state.data&&!window.confirm('Replace the current dataset? Export edited observations before importing a new file.'))return;const button=$('submit-import');button.disabled=true;button.textContent='Importing…';try{const fd=new FormData();fd.append('file',state.file);const res=await api('/api/datasets',{method:'POST',body:fd});if(state.data){try{await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}`,{method:'DELETE'})}catch{}}
  state.data=res;state.run=null;state.history=[];resetCases();updateData();renderResults();closeUpload();showView('data');toast(`Imported ${res.rows.toLocaleString()} cases and ${res.columns} variables.`)}catch(e){toast(e.message,true)}finally{button.textContent='Import dataset →';button.disabled=!state.file}}
async function discardData(){if(!state.data)return;const id=state.data.dataset_id;try{await api(`/api/datasets/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(e){toast(e.message,true)}state.data=null;state.run=null;state.history=[];resetCases();updateData();renderResults();toast('Dataset cleared from temporary memory.')}
async function runAnalysis(e){e.preventDefault();if(!state.data)return toast('Import a dataset first.',true);const recipe=readForm();if(state.mode==='descriptives'&&(!recipe.columns.length||recipe.columns.length>30))return toast('Choose between 1 and 30 variables to summarize.',true);const button=$('run-analysis');button.disabled=true;button.innerHTML='Calculating…';try{const outcome=await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recipe)});state.run={result:outcome,recipe};state.history.push(state.run);if(state.history.length>30)state.history.shift();$('count-runs').textContent=state.history.length;renderResults();window.dispatchEvent(new CustomEvent('statlab:case-result',{detail:{result:outcome,recipe,html:reportMarkup()}}));showView('results');toast('Analysis complete — results are ready.')}catch(error){toast(error.message,true)}finally{button.disabled=!state.data;button.innerHTML='Run analysis <span>→</span>';if(state.mode==='descriptives')summaryUpdateCount();if(state.mode==='questionnaire')questionnaireUpdate()}}
function renderFriendlySummary(r){
 const cards=$('results-summary');
 cards.hidden=!(r.summary_cards?.length);
 cards.innerHTML=(r.summary_cards||[]).map(c=>`<div class="summary-result-card"><span>${escapeHTML(c.label)}</span><strong>${escapeHTML(c.value)}</strong><small>${escapeHTML(c.hint)}</small></div>`).join('');
 const insights=$('results-insights');insights.hidden=!(r.insights?.length);
 insights.innerHTML=r.insights?.length?`<div class="friendly-heading"><div><span class="label-tag">START HERE</span><h3>What do these numbers mean?</h3><p>Plain-language explanations of the observed responses.</p></div></div><div class="insight-list">${r.insights.map(i=>`<article class="insight-card"><div><strong>${escapeHTML(i.variable)}</strong><span>${escapeHTML(i.kind)}</span></div><p>${escapeHTML(i.text)}</p></article>`).join('')}</div>`:'';
 const glossary=$('results-glossary');glossary.hidden=!(r.glossary?.length);
 glossary.innerHTML=r.glossary?.length?`<details><summary>Help me understand the terms (Mean, SD, Valid %, and more)</summary><dl>${r.glossary.map(g=>`<div><dt>${escapeHTML(g.term)}</dt><dd>${escapeHTML(g.meaning)}</dd></div>`).join('')}</dl></details>`:'';
}
function renderResults(){const current=state.run;$('download-chapter4').hidden=!(current?.recipe.analysis==='questionnaire');$('results-empty').hidden=!!current;$('results-content').hidden=!current;$('download-report').disabled=!current;$('download-recipe').disabled=!current;if(!current){window.dispatchEvent(new Event('statlab:case-stale'));for(const id of ['results-summary','results-insights','results-glossary'])$(id).hidden=true;return;}const r=current.result;$('run-number').textContent=`ANALYSIS OUTPUT · RUN ${state.history.length}`;$('results-title').textContent=r.title;$('results-method').textContent=r.method||'';$('narrative').textContent=r.narrative||'';
 renderFriendlySummary(r);
 $('results-warnings').innerHTML=(r.warnings||[]).map(w=>`<div class="warning-card">⚠ ${escapeHTML(w)}</div>`).join('');
 $('results-tables').innerHTML=(r.tables||[]).map(t=>`<section class="panel output-block"><h3>${escapeHTML(t.title)}</h3><div class="table-scroll"><table class="data-table output-table"><thead><tr>${t.columns.map(c=>`<th>${escapeHTML(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(row=>`<tr>${row.map(val=>`<td>${escapeHTML(val)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${t.note?`<p class="output-notes">${escapeHTML(t.note)}</p>`:''}</section>`).join('');
 const ch=r.chart;const chartable=ch&&ch.type==='bar'&&ch.labels?.length&&ch.values?.length;
 $('chart-panel').hidden=!chartable;
 if(chartable){const max=Math.max(1,...ch.values.map(x=>Math.abs(Number(x)||0)));$('visualization').innerHTML=`<div class="chart-bars">${ch.labels.map((label,i)=>{const v=Number(ch.values[i])||0;const h=Math.max(3,Math.round(Math.abs(v)/max*150));return `<div class="bar-column"><span class="bar-number">${escapeHTML(v)}</span><div class="bar" style="height:${h}px"></div><span class="bar-label" title="${escapeHTML(label)}">${escapeHTML(label)}</span></div>`}).join('')}</div><p class="output-notes">${escapeHTML(ch.note||'Visual overview only; see tables for exact numbers.')}</p>`}
 const p=r.provenance||{};$('provenance').textContent=`Data: ${p.file||'—'} · ${p.rows||0} cases · SHA-256: ${p.sha256||'unknown'} · Computed: ${p.analyzed_at_utc||'—'}`;
}
function download(blob,name){const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),4000)}
function downloadChapterFour(){
 if(!state.run||state.run.recipe.analysis!=='questionnaire')return;
 const r=state.run.result,groups=r.objectives||[];
 const text=['CHAPTER FOUR — DESCRIPTIVE QUESTIONNAIRE RESULTS (DRAFT)', '',
  'IMPORTANT: This is a computed descriptive draft, not a verified field survey, significance test, hypothesis decision or full Chapter Four.',
  `Source file: ${r.provenance?.file||'—'}`,`Analysis timestamp (UTC): ${r.provenance?.analyzed_at_utc||'—'}`,
  `Original file SHA-256: ${r.provenance?.sha256||'—'}`,`Dataset revision: ${r.provenance?.data_revision??'—'}`,
  `Method: ${r.method}`, '', '4.1 Presentation and descriptive analysis of questionnaire responses', ''];
 groups.forEach((g,i)=>{
  text.push(`4.${i+2} Objective ${g.number}: ${g.title}`);
  text.push(`The objective comprised ${g.item_count} selected questionnaire item(s). ${g.valid_item_answers} valid item-responses and ${g.missing_item_answers} missing item-responses were recorded across ${g.cases_total} cases. Responses classified as favourable under the supplied coding choices: ${g.favourable_item_answers}/${g.valid_item_answers} (${g.favourable_percent??'N/A'}%); the denominator is item-responses rather than unique people.`);
  text.push(`The exploratory composite mean was ${g.composite_mean??'not available'} among ${g.cases_eligible} eligible respondents, with a minimum of ${g.min_items_answered} items answered (SD: ${g.composite_sd??'not available'}; median: ${g.composite_median??'not available'}). ${g.complete_cases} respondents answered every item. Cronbach alpha: ${g.cronbach_alpha??'not available'}. Scores reflect the explicit keying choices and are not hypothesis tests.`);
  text.push(`Reverse-keyed items: ${g.reverse_items.length?g.reverse_items.join(', '):'none'}.`,`Selected items: ${g.items.join(', ')}.`,'');
 });
 text.push(`4.${groups.length+2} Interpretation limitations`,r.narrative,'',...(r.warnings||[]).map(x=>`CHECK: ${x}`));
 download(new Blob([text.join('\n')],{type:'text/plain;charset=utf-8'}),'statlab-chapter-four-descriptive-DRAFT.txt');
}
function downloadRecipe(){if(!state.run)return;const {recipe,result}=state.run;download(new Blob([JSON.stringify({schema:'mabrig-statlab-recipe-v1',recipe,provenance:result.provenance,method:result.method},null,2)],{type:'application/json'}),'statlab-analysis-recipe.json')}
function reportMarkup(){const r=state.run.result;return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHTML(r.title)} — MABRIG StatLab</title><style>body{font:13px/1.5 Arial,sans-serif;max-width:850px;padding:40px;margin:auto;color:#182737}h1{font:26px Georgia,serif;border-bottom:2px solid #1c5048;padding-bottom:12px}h2{font:19px Georgia,serif;margin-top:26px}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{padding:9px;text-align:left;border-bottom:1px solid #ddd;font-size:11px}thead th{border-top:2px solid #333;border-bottom:1px solid #333;background:#f5f7f6}.warning{color:#9a5b14;padding:10px;background:#fff8e8}.meta{font-size:11px;color:#677}.note{font-size:11px;color:#677}article{margin-top:25px}footer{margin:30px 0 0;border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#888}@media print{body{padding:15px}}</style></head><body><h1>${escapeHTML(r.title)}</h1><p><b>Method:</b> ${escapeHTML(r.method||'')}</p>${(r.warnings||[]).map(w=>`<p class="warning"><b>Warning:</b> ${escapeHTML(w)}</p>`).join('')}${r.insights?.length?`<article><h2>Easy-to-read findings</h2>${r.insights.map(i=>`<p><b>${escapeHTML(i.variable)}:</b> ${escapeHTML(i.text)}</p>`).join('')}</article>`:''}${r.tables.map(t=>`<article><h2>${escapeHTML(t.title)}</h2><table><thead><tr>${t.columns.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note?`<p class="note">${escapeHTML(t.note)}</p>`:''}<p class="note">Source: Computed from imported dataset; ${escapeHTML(r.provenance?.analyzed_at_utc||'')}.</p></article>`).join('')}<article><h2>Interpretation</h2><p>${escapeHTML(r.narrative)}</p></article><footer><div>Software: MABRIG StatLab 0.9 · Independent software (not IBM SPSS).</div><div class="meta">Input file: ${escapeHTML(r.provenance?.file)} · SHA-256: ${escapeHTML(r.provenance?.sha256)} · ${r.provenance?.rows} rows.</div><div>Interpretation must be verified against assumptions, design and original questionnaire.</div></footer></body></html>`}
function downloadReport(){if(!state.run)return;download(new Blob([reportMarkup()],{type:'text/html;charset=utf-8'}),'statlab-results-report.html')}
function setup(){
 for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>showView(el.dataset.view));
 for(const el of document.querySelectorAll('[data-mode]'))el.addEventListener('click',()=>changeMode(el.dataset.mode));
 for(const el of document.querySelectorAll('[data-step]'))el.addEventListener('click',()=>showView(el.dataset.step));
 $('analysis-mode').innerHTML=Object.entries(METHODS).map(([value,m])=>`<option value="${value}">${escapeHTML(m.name)}</option>`).join('');
 $('analysis-mode').addEventListener('change',e=>changeMode(e.target.value));
 ['top-import','hero-import','data-import'].forEach(id=>$(id).addEventListener('click',openUpload));
 $('new-dataset').addEventListener('click',openBlank);$('blank-form').addEventListener('submit',createBlankDataset);
 $('close-blank').addEventListener('click',closeBlank);$('cancel-blank').addEventListener('click',closeBlank);
 $('blank-modal').addEventListener('click',e=>{if(e.target===$('blank-modal'))closeBlank()});
 $('hero-methods').addEventListener('click',()=>showView('analyze'));
 $('close-upload').addEventListener('click',closeUpload);$('cancel-import').addEventListener('click',closeUpload);
 $('upload-modal').addEventListener('click',e=>{if(e.target===$('upload-modal'))closeUpload()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('variable-modal').hidden)closeVariableEditor();else if(!$('blank-modal').hidden)closeBlank();else closeUpload()}});
 $('file-input').addEventListener('change',e=>setSelectedFile(e.target.files[0]));
 $('submit-import').addEventListener('click',importFile);$('discard-data').addEventListener('click',discardData);
 $('analysis-form').addEventListener('submit',runAnalysis);
 $('dynamic-controls').addEventListener('input',e=>{
  if(e.target.id==='summary-variable-search')summarySearch();
  if(e.target.classList.contains('summary-variable'))summaryUpdateCount();
  if(e.target.classList.contains('q-search'))questionnaireSearch(e.target);
  if(e.target.closest('.questionnaire-objective')||e.target.id==='q-orientation'||e.target.id==='q-scale'||e.target.id==='q-threshold')questionnaireUpdate();
 });
 $('dynamic-controls').addEventListener('click',e=>{
  const button=e.target.closest('[data-summary-action]');if(button)summaryAction(button.dataset.summaryAction);
  if(e.target.closest('#q-add-objective')||e.target.closest('.q-remove')||e.target.classList.contains('q-include'))questionnaireAction(e);
 });
 $('download-data').addEventListener('click',()=>{if(!state.data)return;const a=document.createElement('a');a.href=`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/download.csv`;a.click()});
 setupDataView();
 $('variable-search').addEventListener('input',renderVariableTable);
 $('measure-filter').addEventListener('change',renderVariableTable);
 $('export-dictionary').addEventListener('click',downloadDictionary);
 $('import-dictionary').addEventListener('click',()=>{$('dictionary-file').value='';$('dictionary-file').click()});
 $('dictionary-file').addEventListener('change',e=>importDictionaryFile(e.target.files[0]));
 $('add-variable').addEventListener('click',showNewVariable);
 $('variable-table').addEventListener('click',e=>{
  const edit=e.target.closest('[data-edit-index]');if(edit){showVariableEditor(Number(edit.dataset.editIndex));return}
  const move=e.target.closest('[data-move-index]');if(move)moveVariable(Number(move.dataset.moveIndex),Number(move.dataset.moveDirection));
 });
 $('close-variable').addEventListener('click',closeVariableEditor);$('cancel-variable').addEventListener('click',closeVariableEditor);
 $('variable-modal').addEventListener('click',e=>{if(e.target===$('variable-modal'))closeVariableEditor()});
 $('v-type').addEventListener('change',syncTypeFields);
 $('delete-variable').addEventListener('click',deleteCurrentVariable);
 $('variable-form').addEventListener('submit',saveVariable);
 $('add-value-label').addEventListener('click',()=>appendValueRow());
 $('value-label-rows').addEventListener('click',e=>{if(e.target.closest('.remove-value-label'))e.target.closest('.value-label-row').remove()});
 $('label-preset').addEventListener('change',e=>applyPreset(e.target.value));
 $('empty-analyze').addEventListener('click',()=>showView('analyze'));
 $('download-report').addEventListener('click',downloadReport);$('download-recipe').addEventListener('click',downloadRecipe);$('download-chapter4').addEventListener('click',downloadChapterFour);
 $('copy-interpretation').addEventListener('click',async()=>{try{const r=state.run.result;await navigator.clipboard.writeText([r.narrative,...(r.insights||[]).map(i=>`${i.variable}: ${i.text}`)].join('\n\n'));toast('Interpretation copied.')}catch{toast('Clipboard permission denied.',true)}});
 const drop=$('dropzone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover')});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
 drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');setSelectedFile(e.dataTransfer.files[0])});
 updateData();renderResults();
}

// Explicit project backup bridge. Case data stays in memory unless the user
// elects to include it in a local project file or browser project.
window.StatLabDataset = {
  async capture(includeCases=false) {
    if (!state.data) return null;
    const id = encodeURIComponent(state.data.dataset_id);
    const dictionary = await api(`/api/datasets/${id}/dictionary.json`);
    const snapshot = includeCases ? await api(`/api/datasets/${id}/snapshot`) : null;
    return { dictionary, snapshot, has_cases: !!snapshot,
      filename: state.data.filename, case_count: state.data.rows,
      analysis_report: state.run ? {html:reportMarkup(),created_at:new Date().toISOString()} : null };
  },
  async restore(saved) {
    if (!saved?.snapshot) return false;
    const restored = await api('/api/datasets/from-snapshot', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(saved.snapshot)
    });
    const priorId = state.data?.dataset_id;
    state.data = restored; state.run = null; state.history = [];
    resetCases(); updateData(); renderResults();
    if (priorId && priorId !== restored.dataset_id) {
      try {await api(`/api/datasets/${encodeURIComponent(priorId)}`, {method:'DELETE'});} catch(_){}
    }
    toast(`Restored ${restored.rows.toLocaleString()} saved cases and ${restored.columns} variable definitions.`);
    return true;
  },
  async detach() {
    const oldId=state.data?.dataset_id;
    state.data=null;state.run=null;state.history=[];resetCases();updateData();renderResults();
    if(oldId)try{await api(`/api/datasets/${encodeURIComponent(oldId)}`, {method:'DELETE'});}catch(_){}
  },
  async applyDictionary(dictionary) {
    if (!state.data) throw Error('Import the matching dataset in Data View before applying its saved variable definitions.');
    const result = await api(`/api/datasets/${encodeURIComponent(state.data.dataset_id)}/dictionary`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dictionary)
    });
    state.data=result;state.run=null;state.history=[];resetCases();updateData();renderResults();
    toast('Saved Variable View definitions applied.');
  },
  hasDataset() {return !!state.data;},
};

setup();
})();
