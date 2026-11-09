/* MABRIG StatLab v0.9 — unified, reviewable analysis history.
 * Reports live in this tab's memory. They are saved only when a researcher
 * explicitly opts into including analysis history in a project backup.
 * Archived results are never represented as freshly recalculated output.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const MAX_RUNS=30;
  const MAX_SAVE=20;
  const MAX_HTML=700000, MAX_CSV=300000, MAX_RECIPE=200000;
  const allowed=new Set(['case','frequency','chapter_four']);
  let runs=[],chosen=null,seq=0;
  const safeText=x=>String(x??'');
  const time=stamp=>{const d=new Date(stamp);return Number.isFinite(d.getTime())?d.toLocaleString():'Unknown date';};
  const fileSlug=x=>safeText(x).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'analysis';
  const download=(name,content,mime)=>{
    const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),4000);
  };
  const csvCell=value=>{
    const valueString=safeText(value);
    // Excel/LibreOffice can interpret quoted CSV text starting with one of
    // these characters as a formula; prepend a literal apostrophe to disable.
    const protectedText=/^[\s\r\n]*[=+@-]/.test(valueString)?`'${valueString}`:valueString;
    return `"${protectedText.replace(/"/g,'""')}"`;
  };
  function csvForCase(result){
    const blocks=[];
    for(const table of result.tables||[]){
      blocks.push([csvCell(table.title)].join(','));
      blocks.push((table.columns||[]).map(csvCell).join(','));
      for(const row of table.rows||[])blocks.push(row.map(csvCell).join(','));
      if(table.note)blocks.push(csvCell(`Note: ${table.note}`));
      blocks.push('');
    }
    return blocks.join('\r\n');
  }
  function validate(entry){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Invalid saved output entry.');
    const str=(key,max)=>{
      if(typeof entry[key]!=='string'||entry[key].length>max)throw Error(`Invalid saved output ${key}.`);
      return entry[key];
    };
    const id=str('id',80);
    if(!/^run-[a-z0-9_-]{6,72}$/i.test(id))throw Error('Invalid output identifier.');
    if(!allowed.has(entry.kind))throw Error('Unsupported output type.');
    const title=str('title',240),method=str('method',700),created_at=str('created_at',40);
    if(!title.trim()||!Number.isFinite(Date.parse(created_at)))throw Error('Output title or timestamp is invalid.');
    const html=str('html',MAX_HTML),csv=str('csv',MAX_CSV),recipe=str('recipe',MAX_RECIPE);
    const source=str('source',240);
    if(!html.trim())throw Error('Saved output has no report content.');
    // Reject active HTML in a backup before allowing a standalone HTML export.
    // The iframe also applies sandbox/CSP, including for locally generated reports.
    if(/<(?:script|iframe|object|embed|form|base|link|svg|math)\b|\son[a-z]+\s*=|javascript:|data:text\/html|\ssrcdoc\s*=/i.test(html))
      throw Error('Saved HTML report contains executable or unsupported content.');
    // Never trust imported status: restored content is always archival.
    return {id,kind:entry.kind,title,method,created_at,html,csv,recipe,source,status:'archived'};
  }
  function capture(){
    // No automatic storage; only called from the user's explicit project save.
    return runs.slice(-MAX_SAVE).map(r=>({id:r.id,kind:r.kind,title:r.title,method:r.method,
      created_at:r.created_at,html:r.html,csv:r.csv,recipe:r.recipe,source:r.source}));
  }
  function restore(entries,projectTitle=''){
    if(!Array.isArray(entries)||entries.length>MAX_SAVE)throw Error('Project output history is invalid.');
    const verified=entries.map(validate);
    const ids=new Set(verified.map(x=>x.id));
    if(ids.size!==verified.length)throw Error('Duplicate output identifiers.');
    runs=verified.map(x=>({...x,project:projectTitle}));
    chosen=runs.at(-1)?.id||null;
    render();
  }
  function add(kind,data){
    const title=safeText(data.title).slice(0,240)||'Untitled analysis';
    const method=safeText(data.method).slice(0,700);
    const html=safeText(data.html),csv=safeText(data.csv),recipe=safeText(data.recipe);
    if(!html||html.length>MAX_HTML||csv.length>MAX_CSV||recipe.length>MAX_RECIPE){
      $('output-message').textContent='The result was calculated, but at least one report component is too large for session history. Export it directly from its analysis panel.';
      return;
    }
    $('output-message').textContent='';
    seq+=1;
    const id=`run-${Date.now().toString(36)}-${seq.toString(36).padStart(6,'0')}`;
    const item={id,kind,title,method,html,csv,
      recipe,source:safeText(data.source).slice(0,240),
      created_at:new Date().toISOString(),status:'current',project:''};
    // Older results of the same kind remain reviewable but are clearly historical.
    for(const r of runs)if(r.kind===kind && r.status==='current')r.status='outdated';
    runs.push(item);if(runs.length>MAX_RUNS)runs=runs.slice(-MAX_RUNS);
    chosen=id;render();
  }
  function stale(kinds){
    const target=new Set(kinds);
    for(const r of runs)if(target.has(r.kind)&&r.status==='current')r.status='outdated';
    render();
  }
  function match(row){
    const q=$('output-search').value.toLowerCase().trim();
    const type=$('output-type').value;
    if(type!=='all'&&row.kind!==type)return false;
    return !q||[row.title,row.method,row.source,row.kind,row.project].join(' ').toLowerCase().includes(q);
  }
  const kindLabel={case:'Dataset analysis',frequency:'Frequency-only statistics',chapter_four:'Chapter Four draft'};
  function render(){
    const pane=$('output-history-list');pane.replaceChildren();
    const rows=runs.filter(match).slice().reverse();
    $('output-count').textContent=`${runs.length} result${runs.length===1?'':'s'} in this workspace`;
    $('count-runs').textContent=runs.filter(r=>r.status!=='archived').length;
    if(!rows.length){const msg=document.createElement('p');msg.className='output-no-runs';msg.textContent=runs.length?'No matching results. Try clearing the search or filter.':'No results yet. Run an analysis or open a saved research project.';pane.append(msg);}
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className=`output-run${chosen===row.id?' selected':''}`;
      button.dataset.outputId=row.id;button.setAttribute('aria-pressed',String(chosen===row.id));
      const label=document.createElement('span');label.className='output-run-kind';label.textContent=kindLabel[row.kind];
      const title=document.createElement('strong');title.textContent=row.title;
      const meta=document.createElement('small');meta.textContent=`${time(row.created_at)} · ${row.status==='current'?'Calculated in this session':row.status==='archived'?'Saved snapshot':'Older / input changed'}`;
      button.append(label,title,meta);pane.append(button);
    }
    // A filter doesn't erase selection; it only changes which rows are listed.
    showSelected();
  }
  function showSelected(){
    const row=runs.find(x=>x.id===chosen);
    const empty=$('output-preview-empty'),box=$('output-selected'),frame=$('output-preview');
    empty.hidden=!!row;box.hidden=!row;
    for(const id of ['output-html','output-csv','output-recipe','output-remove'])$(id).disabled=!row;
    if(!row){frame.removeAttribute('srcdoc');return;}
    $('output-selected-title').textContent=row.title;
    $('output-selected-method').textContent=row.method||'Method not specified';
    $('output-selected-source').textContent=row.source?`Source: ${row.source}`:'Source was not specified';
    const status=$('output-selected-status');
    status.textContent=row.status==='current'?'✓ Latest calculation':row.status==='archived'?'Archived snapshot — recalculate to verify':'Historical result — may be stale';
    status.className=`output-result-tag ${row.status}`;
    $('output-review-note').textContent=row.status==='current'
      ?'Review the statistical assumptions, scale coding, and questionnaire wording before using this report.'
      :'This saved result is for review only. It may no longer match the active inputs. Return to the analysis page and calculate again before citing.';
    $('output-csv').disabled=!row.csv;$('output-recipe').disabled=!row.recipe;
    // No scripts, no same-origin, no navigation and no remote fetches. HTML
    // in imported project files must be treated as untrusted user content.
    const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
    frame.srcdoc=csp+row.html;
    frame.title=`Safe preview: ${row.title}`;
  }
  window.addEventListener('statlab:case-result',evt=>{
    const {result,recipe,html}=evt.detail;
    add('case',{title:result.title,method:result.method,html,csv:csvForCase(result),
      recipe:JSON.stringify({schema:'mabrig-statlab-recipe-v1',recipe,provenance:result.provenance,method:result.method},null,2),
      source:result.provenance?.file||'Dataset'});
  });
  window.addEventListener('statlab:case-stale',()=>stale(['case']));
  window.addEventListener('statlab:frequency-results',evt=>{
    const report=window.StatLabFrequency?.capture().report;
    if(!report)return;
    const data=evt.detail.result;
    add('frequency',{title:`Descriptive statistics · ${data.items.length} item(s)`,method:data.method,
      html:report.html,csv:report.csv,source:'Frequency counts (no respondent records)',
      recipe:JSON.stringify({schema:'mabrig-statlab-frequency-recipe-v1',input:evt.detail.payload},null,2)});
  });
  window.addEventListener('statlab:frequency-stale',()=>stale(['frequency','chapter_four']));
  window.addEventListener('statlab:chapter-result',evt=>{
    const {result,request}=evt.detail;
    add('chapter_four',{title:request.research_title||'Chapter Four descriptive draft',
      method:'Objective-by-objective descriptive report from frequency counts only',
      html:result.html,csv:result.csv,source:'Entered questionnaire frequency counts',
      recipe:JSON.stringify({schema:'mabrig-statlab-chapter-four-recipe-v1',request},null,2)});
  });
  window.addEventListener('statlab:chapter-stale',()=>stale(['chapter_four']));
  $('output-history-list').addEventListener('click',e=>{
    const row=e.target.closest('[data-output-id]');if(!row)return;chosen=row.dataset.outputId;render();
  });
  $('output-search').addEventListener('input',render);
  $('output-type').addEventListener('change',render);
  $('output-html').addEventListener('click',()=>{const r=runs.find(x=>x.id===chosen);if(r)download(`statlab-${fileSlug(r.title)}.html`,r.html,'text/html;charset=utf-8');});
  $('output-csv').addEventListener('click',()=>{const r=runs.find(x=>x.id===chosen);if(r?.csv)download(`statlab-${fileSlug(r.title)}.csv`,r.csv,'text/csv;charset=utf-8');});
  $('output-recipe').addEventListener('click',()=>{const r=runs.find(x=>x.id===chosen);if(r?.recipe)download(`statlab-${fileSlug(r.title)}-recipe.json`,r.recipe,'application/json;charset=utf-8');});
  $('output-remove').addEventListener('click',()=>{
    const row=runs.find(x=>x.id===chosen);if(!row||!confirm(`Remove "${row.title}" from this tab's output history? This does not delete saved projects.`))return;
    runs=runs.filter(r=>r.id!==chosen);chosen=runs.at(-1)?.id||null;render();
  });
  $('output-clear').addEventListener('click',()=>{
    if(!runs.length||!confirm('Clear all results from this tab? Previously saved project backups are not affected.'))return;
    runs=[];chosen=null;render();
  });
  window.StatLabOutput={capture,restore,validate,getCount:()=>runs.length};
  render();
})();
