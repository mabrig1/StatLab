/* MABRIG StatLab — opt-in local research project manager (IndexedDB).
 * No requests are sent to a cloud service. Case-level data is never stored
 * here unless the user explicitly selects the opt-in checkbox.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SCHEMA='mabrig-statlab-project-v1';
  const MAX_IMPORT_BYTES=20*1024*1024;
  const MAX_STORED_PROJECTS=60;
  let dbPromise=null,activeId=null,activeProject=null,archived=null;
  const BROWSER_DB='MABRIG-StatLab-Projects';
  const STORE='research-projects';
  function status(message,error=false){
    $('project-status').textContent=message;
    $('project-status').classList.toggle('project-error',error);
  }
  function openDB(){
    if(!window.indexedDB) return Promise.reject(Error('This browser does not offer IndexedDB. You can still download a project backup.'));
    if(dbPromise) return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(BROWSER_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
      };
      req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};
      req.onerror=()=>reject(req.error||Error('Browser project storage unavailable.'));
      req.onblocked=()=>reject(Error('Close another open StatLab tab, then retry.'));
    }).catch(err=>{dbPromise=null;throw err;});
    return dbPromise;
  }
  async function storeOperation(mode,method,item){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      const object=tx.objectStore(STORE);
      const req = method==='all' ? object.getAll() :
                  method==='get' ? object.get(item) :
                  method==='put' ? object.put(item) : object.delete(item);
      let value;
      req.onsuccess=()=>{value=req.result;if(mode==='readonly')resolve(value);};
      req.onerror=()=>reject(req.error||Error('Could not access local project storage.'));
      tx.oncomplete=()=>{if(mode==='readwrite')resolve(value);};
      tx.onabort=()=>reject(tx.error||Error('Local project storage transaction failed.'));
    });
  }
  function download(name,contents,mime='application/json;charset=utf-8'){
    const blob=new Blob([contents],{type:mime});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
  }
  function nameFor(project){
    const slug=project.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'statlab-project';
    return `${slug}.statlab.json`;
  }
  function isObject(x){return x!==null && typeof x==='object' && !Array.isArray(x);}
  const string=(v,max,label)=>{
    if(typeof v!=='string'||v.length>max)throw Error(`${label} is invalid or too long.`);
    return v;
  };
  function validate(project){
    if(!isObject(project) || project.schema!==SCHEMA)throw Error('Not a supported MABRIG StatLab project file.');
    const title=string(project.title,120,'Project title').trim();
    if(!title)throw Error('Project needs a title.');
    const notes=string(project.notes||'',2000,'Project notes');
    if(typeof project.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(project.id))throw Error('Project ID is invalid.');
    if(!isObject(project.frequency)||!isObject(project.chapter_four))throw Error('Project is missing questionnaire settings.');
    const f=project.frequency,c=project.chapter_four;
    for(const [key,max] of [['text',100000],['labels',3000],['sd_method',20],['population',20],['sample',20]])
      string(f[key]??'',max,`Frequency ${key}`);
    if(typeof f.reversed!=='boolean')throw Error('Reversed scoring must be true or false.');
    if(!['sample','population'].includes(f.sd_method))throw Error('SD method is invalid.');
    for(const [key,max] of [['title',240],['source',200],['objectives',4400]])
      string(c[key]??'',max,`Chapter Four ${key}`);
    if(!isObject(c.assignments)||Object.keys(c.assignments).length>300)throw Error('Invalid research objective assignments.');
    for(const [key,value] of Object.entries(c.assignments)){
      if(key.length>500 || typeof value!=='string' || !/^([1-9]|1[0-2])?$/.test(value))
        throw Error('Invalid item-objective assignment.');
    }
    if(project.dataset!==null && project.dataset!==undefined){
      if(!isObject(project.dataset))throw Error('Dataset backup is malformed.');
      if(!isObject(project.dataset.dictionary)||project.dataset.dictionary.schema!=='mabrig-statlab-variable-dictionary-v1')
        throw Error('Dataset variable dictionary is invalid.');
      if(project.dataset.snapshot !== null && project.dataset.snapshot !== undefined &&
         (!isObject(project.dataset.snapshot)||project.dataset.snapshot.schema!=='mabrig-statlab-dataset-snapshot-v1'))
         throw Error('Dataset snapshot is invalid.');
    }
    if(project.reports!==null && project.reports!==undefined){
      if(!isObject(project.reports)) throw Error('Reports are invalid.');
      for(const type of ['descriptive','chapter_four','case_analysis']){
        const report=project.reports[type];
        if(report!==null && report!==undefined){
          if(!isObject(report))throw Error(`Invalid ${type} report.`);
          string(report.html,3000000,`${type} HTML report`);
          string(report.csv||'',1500000,`${type} CSV report`);
        }
      }
    }
    // Old v0.8 backups had no output history. New saved analysis history is
    // optional, bounded, sanitized on preview, and never treated as current.
    const history=project.output_history??[];
    if(!Array.isArray(history)||history.length>20)throw Error('Saved output history is invalid or too long.');
    const validatedHistory=history.map(x=>window.StatLabOutput.validate(x));
    if(new Set(validatedHistory.map(x=>x.id)).size!==validatedHistory.length)
      throw Error('Duplicate saved output identifiers.');
    // Also bounds total size, and fails on circular/incomplete objects.
    if(new Blob([JSON.stringify(project)]).size>MAX_IMPORT_BYTES)throw Error('Project exceeds the 20 MB backup limit.');
    return {schema:SCHEMA,id:project.id,title,notes,
      created_at:typeof project.created_at==='string'?project.created_at:'',
      updated_at:typeof project.updated_at==='string'?project.updated_at:'',
      frequency:{text:f.text||'',labels:f.labels||'',sd_method:f.sd_method,reversed:f.reversed,
                 population:f.population||'',sample:f.sample||''},
      chapter_four:{title:c.title||'',source:c.source||'',objectives:c.objectives||'',assignments:c.assignments},
      dataset:project.dataset||null,reports:project.reports||{},
      output_history:validatedHistory,
    };
  }
  function makeId(){return crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function getReports(){
    return {
      descriptive:window.StatLabFrequency?.capture().report || null,
      chapter_four:window.StatLabChapterFour?.capture().report || null,
    };
  }
  async function workspaceProject(copy=false){
    const title=$('project-name').value.trim();
    if(!title||title.length>120)throw Error('Enter a project title of 1–120 characters.');
    const freq=window.StatLabFrequency.capture();
    const chap=window.StatLabChapterFour.capture();
    let dataset=null;
    if(window.StatLabDataset.hasDataset())dataset=await window.StatLabDataset.capture($('project-include-cases').checked);
    const now=new Date().toISOString();
    const existing=!copy&&activeId?await storeOperation('readonly','get',activeId).catch(()=>activeProject):null;
    const id=existing?.id||(!copy&&activeId)||makeId();
    const reports=getReports();
    const oldProject=existing||activeProject;
    const storedReports=oldProject?.reports||{};
    // Retain historical reports only for unchanged questionnaire inputs.
    // Editing the frequencies or objective mapping invalidates archived drafts.
    const unchanged=oldProject && JSON.stringify(oldProject.frequency)===JSON.stringify({
      text:freq.text,labels:freq.labels,sd_method:freq.sd_method,reversed:freq.reversed,
      population:freq.population,sample:freq.sample}) &&
      JSON.stringify(oldProject.chapter_four)===JSON.stringify({
        title:chap.title,source:chap.source,objectives:chap.objectives,assignments:chap.assignments});
    if(unchanged)for(const kind of ['descriptive','chapter_four'])
      if(!reports[kind]&&storedReports[kind])reports[kind]=storedReports[kind];
    // Case analysis output is re-attached only when generated in the current session.
    if(dataset?.analysis_report)reports.case_analysis=dataset.analysis_report;
    // Saved report snapshots are archival; they are not presented as fresh
    // output on restoring questionnaire inputs.
    return validate({schema:SCHEMA,id,title,notes:$('project-notes').value,
      created_at:existing?.created_at||now,updated_at:now,
      frequency:freq,chapter_four:chap,dataset,reports,
      output_history:$('project-include-history').checked ? window.StatLabOutput.capture() : []});
  }
  function clearArchived(){archived=null;$('project-archived').hidden=true;$('project-report-preview').srcdoc='';$('project-report-switch').replaceChildren();}
  function selectArchive(type){
    if(!archived)return;
    // Imported HTML remains untrusted: sandbox + restrictive srcdoc CSP blocks
    // scripts, remote images, forms, network fetches and plugins.
    const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'; form-action \'none\'">';
    $('project-report-preview').srcdoc=csp+(archived.reports[type]?.html||'');
    $('project-archive-csv').disabled=!archived.reports[type]?.csv;
  }
  function showArchived(project){
    clearArchived();
    const reports=project.reports||{};
    const choices=[['chapter_four','Chapter Four draft'],['descriptive','Descriptive statistics'],['case_analysis','Case-level analysis']].filter(([key])=>reports[key]?.html);
    if(!choices.length)return;
    archived=project;
    const select=$('project-report-switch');
    for(const [value,label] of choices){const opt=document.createElement('option');opt.value=value;opt.textContent=label;select.append(opt);}
    $('project-archived').hidden=false;
    selectArchive(select.value);
  }
  function labelCount(project){
    const count=Object.values(project.reports||{}).filter(r=>r?.html).length;
    const value=project.dataset?.snapshot ? 'Case rows included' : project.dataset?.dictionary ? 'Codebook only' : 'Summary-only';
    return `${value} · ${count} archived report${count===1?'':'s'}`;
  }
  const date=value=>{const d=new Date(value);return Number.isNaN(+d)?'Date not provided':d.toLocaleString();};
  function button(label,action,id,classes='button button-outline button-small'){
    const node=document.createElement('button');node.type='button';node.className=classes;node.dataset.projectAction=action;node.dataset.projectId=id;node.textContent=label;return node;
  }
  async function refresh(){
    const list=$('project-list');
    list.replaceChildren();
    try {
      const projects=await storeOperation('readonly','all');
      projects.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
      if(!projects.length){const p=document.createElement('p');p.textContent='No projects saved yet. Enter your questionnaire counts, then click Save in this browser.';list.append(p);return;}
      for(const p of projects){
        const card=document.createElement('article');card.className='project-card'+(p.id===activeId?' project-card-current':'');
        const tag=document.createElement('span');tag.className='project-tag';tag.textContent=p.id===activeId?'CURRENT PROJECT':'SAVED LOCALLY';card.append(tag);
        const heading=document.createElement('h3');heading.textContent=p.title;card.append(heading);
        const meta=document.createElement('p');meta.textContent=`Updated: ${date(p.updated_at)}`;card.append(meta);
        const description=document.createElement('p');description.textContent=labelCount(p);card.append(description);
        if(p.notes){const note=document.createElement('p');note.textContent=p.notes.slice(0,140);card.append(note);}
        const actions=document.createElement('div');actions.className='project-card-actions';
        actions.append(button('Open','open',p.id,'button button-dark button-small'),button('⇩ Backup','export',p.id),button('Delete','delete',p.id,'button button-danger button-small'));
        card.append(actions);list.append(card);
      }
    }catch(err){const p=document.createElement('p');p.textContent=`Local storage unavailable: ${err.message}. You can still download a portable project JSON backup.`;list.append(p);status(p.textContent,true);}
  }
  async function save(copy=false,downloadOnly=false){
    const btn=$('project-save');btn.disabled=true;
    status('Collecting current inputs and checking the backup…');
    try{
      const project=await workspaceProject(copy);
      if(downloadOnly){download(nameFor(project),JSON.stringify(project,null,2));status(`Downloaded ${project.title}. Store the JSON file somewhere safe.`);return;}
      const items=await storeOperation('readonly','all');
      if(!items.some(i=>i.id===project.id) && items.length>=MAX_STORED_PROJECTS)
        throw Error(`Maximum ${MAX_STORED_PROJECTS} browser projects. Export and delete an older project first.`);
      await storeOperation('readwrite','put',project);
      activeId=project.id;activeProject=project;
      $('project-active-label').textContent=`Saved locally · ${date(project.updated_at)}`;
      showArchived(project);
      $('project-apply-dictionary').disabled=!project.dataset?.dictionary;
      status(`${project.title} saved in this browser. Download a backup if the work is important.`);
      await refresh();
    }catch(err){status(`Could not save: ${err.message}`,true);}
    finally{btn.disabled=false;}
  }
  async function openProject(id){
    const project=await storeOperation('readonly','get',id);
    if(!project)throw Error('Project is not available.');
    const verified=validate(project);
    const message='Open this saved project? Current unsaved questionnaire inputs and Data View cases may be replaced. Save the current work first if needed.';
    if(!window.confirm(message))return;
    // Restore the dataset before replacing form fields: on failure we keep the
    // current project visible so the user can export or repair their backup.
    if(verified.dataset?.snapshot) await window.StatLabDataset.restore(verified.dataset);
    else await window.StatLabDataset.detach();
    window.StatLabFrequency.restore(verified.frequency);
    window.StatLabChapterFour.restore(verified.chapter_four);
    activeId=verified.id;activeProject=verified;
    $('project-name').value=verified.title;$('project-notes').value=verified.notes;
    $('project-include-cases').checked=!!verified.dataset?.snapshot;
    $('project-include-history').checked=!!verified.output_history.length;
    window.StatLabOutput.restore(verified.output_history,verified.title);
    $('project-active-label').textContent=`Opened project · saved ${date(verified.updated_at)}`;
    $('project-apply-dictionary').disabled=!verified.dataset?.dictionary;
    showArchived(verified);await refresh();
    status(`Opened ${verified.title}. Original inputs restored; click Calculate to verify fresh statistics. Saved report snapshots are archival.`);
  }
  async function deleteProject(id){
    const current=await storeOperation('readonly','get',id);
    if(!current)return;
    if(!confirm(`Delete the local copy of "${current.title}"? External JSON backups will not be affected.`))return;
    await storeOperation('readwrite','delete',id);
    if(activeId===id){activeId=null;activeProject=null;$('project-active-label').textContent='Project is no longer saved in this browser.';$('project-apply-dictionary').disabled=true;clearArchived();}
    status('Local project deleted. Your currently open unsaved inputs are unchanged.');
    await refresh();
  }
  async function importFile(file){
    if(!file)return;
    if(file.size>MAX_IMPORT_BYTES)throw Error('Project file exceeds 20 MB.');
    let parsed;
    try {parsed=JSON.parse(await file.text());}catch(_) {throw Error('Backup is not valid JSON.');}
    const project=validate(parsed);
    const existing=await storeOperation('readonly','get',project.id);
    if(existing && !confirm(`Project "${existing.title}" already exists here. Import as a new copy?`))return;
    if(existing){project.id=makeId();project.created_at=new Date().toISOString();project.updated_at=project.created_at;}
    const projects=await storeOperation('readonly','all');
    if(projects.length>=MAX_STORED_PROJECTS)throw Error('Browser has reached the project limit. Export/delete an older project.');
    await storeOperation('readwrite','put',project);
    status(`Imported ${project.title}. Click Open on its card to restore the workspace.`);
    await refresh();
  }
  $('project-save').addEventListener('click',()=>save(false,false));
  $('project-save-copy').addEventListener('click',()=>save(true,false));
  $('project-download-current').addEventListener('click',()=>save(false,true));
  $('project-import').addEventListener('click',()=>{$('project-import-file').value='';$('project-import-file').click();});
  $('project-import-file').addEventListener('change',async event=>{
    try{await importFile(event.target.files[0]);}catch(err){status(`Import failed: ${err.message}`,true);}
  });
  $('project-list').addEventListener('click',async event=>{
    const target=event.target.closest('[data-project-action]');if(!target)return;
    try{
      const id=target.dataset.projectId,action=target.dataset.projectAction;
      if(action==='open')await openProject(id);
      else if(action==='delete')await deleteProject(id);
      else if(action==='export'){
        const project=validate(await storeOperation('readonly','get',id));
        download(nameFor(project),JSON.stringify(project,null,2));status(`Downloaded backup for ${project.title}.`);
      }
    }catch(err){status(err.message,true);}
  });
  $('project-apply-dictionary').addEventListener('click',async()=>{
    if(!activeProject?.dataset?.dictionary)return;
    if(!confirm('Apply the saved Variable View codebook to the currently loaded Data View dataset? This replaces existing variable definitions. Names must match exactly.'))return;
    try{await window.StatLabDataset.applyDictionary(activeProject.dataset.dictionary);status('Applied saved variable definitions. Validate the restored codebook before analysis.');}
    catch(err){status(`Codebook restore failed: ${err.message}`,true);}
  });
  $('project-report-switch').addEventListener('change',e=>selectArchive(e.target.value));
  $('project-archive-html').addEventListener('click',()=>{
    if(!archived)return;const selected=archived.reports[$('project-report-switch').value];
    if(selected?.html)download('statlab-archived-report.html',selected.html,'text/html;charset=utf-8');
  });
  $('project-archive-csv').addEventListener('click',()=>{
    if(!archived)return;const selected=archived.reports[$('project-report-switch').value];
    if(selected?.csv)download('statlab-archived-summary.csv',selected.csv,'text/csv;charset=utf-8');
  });
  window.StatLabProjects={openDB,validate,refresh};
  refresh();
})();
