/* Frequency-only analysis, intentionally isolated from case-level Data View. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const safe = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fix = (value, dp=2) => value == null ? 'Not defined' : Number(value).toFixed(dp);
  const presets = {
    five:'1 = Strongly Disagree\n2 = Disagree\n3 = Neutral\n4 = Agree\n5 = Strongly Agree',
    four:'1 = Strongly Disagree\n2 = Disagree\n3 = Agree\n4 = Strongly Agree',
    three:'1 = Disagree\n2 = Neutral\n3 = Agree',
  };
  const demo = `Item 5 (5-point scale):\nStrongly Disagree = 30\nDisagree = 23\nNeutral = 20\nAgree = 45\nStrongly Agree = 35\nTotal N = 153`;
  let current = null;
  let payload = null;
  function labelsFromText(text) {
    const labels = {};
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length > 11) throw Error('Provide 2–11 code = label lines.');
    for (const line of lines) {
      const match = line.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:=|:)\s*(.+)$/);
      if (!match) throw Error(`Cannot understand scale entry: ${line}. Write e.g. 1 = Disagree.`);
      if (Object.prototype.hasOwnProperty.call(labels,match[1])) throw Error(`Repeated scale code: ${match[1]}.`);
      labels[match[1]] = match[2].trim();
    }
    return labels;
  }
  function optionalInt(input) {
    if (!input.value.trim()) return null;
    const v = Number(input.value);
    if (!Number.isSafeInteger(v) || v < 1) throw Error(`${input.id}: enter a positive whole number.`);
    return v;
  }
  function requestBody() {
    return {
      text: el('frequency-paste').value,
      scale_labels: labelsFromText(el('freq-labels').value),
      reversed: el('freq-reverse-all').checked,
      sd_method: el('freq-sd').value,
      population_size: optionalInt(el('freq-population')),
      sample_size: optionalInt(el('freq-sample')),
    };
  }
  const date = () => new Date().toLocaleDateString(undefined, {year:'numeric', month:'long', day:'numeric'});
  function escapeCsv(value) {
    const valueText = String(value ?? '');
    const protectedText = /^[\s]*[=+@\-\t\r]/.test(valueText) ? '\'' + valueText : valueText;
    return '"' + protectedText.replace(/"/g, '""') + '"';
  }
  function csvFromResult(result) {
    const rows = [['Item', 'N', 'Mean', 'SD', 'Mode (scored code)', 'Top response (original)'],
      ...result.items.map(item => [item.item, item.n, fix(item.mean,4), item.sd == null ? '' : fix(item.sd,4), item.mode, item.top_response])];
    return rows.map(row=>row.map(escapeCsv).join(',')).join('\r\n') + '\r\n';
  }
  function makeTable(headers, rows) {
    return `<div class="table-scroll"><table class="data-table output-table"><thead><tr>${headers.map(x=>`<th>${safe(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${safe(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function render(result) {
    const meta=result.metadata;
    el('freq-result-method').textContent = `${result.items.length} item(s) · ${result.items.length===1?'One item':'Each item counted separately'} · ${date()}`;
    el('freq-summary').innerHTML = `<div class="panel freq-outbox"><div class="freq-outhead"><div><h3>Combined descriptive summary</h3><p>Each row represents one question, not one person.</p></div><span class="label-tag">FREQUENCY COUNTS</span></div>${makeTable(['Item','N','Mean','SD','Mode (scored code)','Top response'], result.items.map(x=>[x.item,x.n,fix(x.mean),fix(x.sd),x.mode,x.top_response]))}<div class="freq-outfoot">${safe(result.method)}${meta.population_size != null || meta.sample_size != null ? '<br/>Metadata only — population: '+safe(meta.population_size??'Not provided')+'; sample: '+safe(meta.sample_size??'Not provided')+'. Item results use the summed frequencies only.' : ''}</div></div>`;
    el('freq-item-blocks').innerHTML = result.items.map((x,i) => {
      const working=x.formula;
      const rows = x.table.map(e=>[e.code, e.label, e.frequency, fix(e.percentage)+'%', fix(e.score,2), fix(e.fx,2), fix(e.squared_term,3)]);
      rows.push(['—','TOTAL',x.n,'100.00%','—',fix(x.formula.fx_sum,2),fix(x.formula.squared_sum,3)]);
      const formula=`Mean = Σ(f×x) / N = ${fix(working.fx_sum,2)} / ${x.n} = ${fix(x.mean,4)}.`;
      const sd = x.sd == null
        ? 'Sample SD cannot be calculated from a single valid response (N = 1).'
        : `SD = √[Σf(x − mean)² / ${x.sd_method==='sample'?'(N − 1)':'N'}] = √(${fix(working.squared_sum,4)} / ${working.denominator}) = ${fix(x.sd,4)}.`;
      return `<article class="panel freq-outbox freq-item"><div class="freq-outhead"><div><div class="freq-step">ITEM ${i+1}</div><h3>${safe(x.item)}</h3><p>${x.n} valid response counts · ${x.reversed?'Reverse-scored':'Normal scoring'}</p></div><span class="freq-mean">Mean<br/><strong>${fix(x.mean)}</strong></span></div>
        <div class="freq-kpis"><div><small>Valid N</small><strong>${x.n.toLocaleString()}</strong></div><div><small>Sample / population SD</small><strong>${fix(x.sd)}</strong></div><div><small>Median (scored)</small><strong>${fix(x.median)}</strong></div><div><small>Mode (scored)</small><strong>${safe(x.mode)}</strong></div></div>
        <div class="freq-outhead freq-outsub"><div><h4>Frequency and percentage table</h4><p>Original labels stay unchanged; score is reversed only if specified.</p></div></div>
        ${makeTable(['Original code','Response category','Frequency (f)','Percentage','Scored code (x)','f × x','f(x − mean)²'], rows)}
        <div class="freq-interpret"><strong>What the result means</strong><p>${safe(x.interpretation)}</p></div>
        <details class="freq-working"><summary>Show calculation and working</summary><div><p><b>Mean formula:</b> Σ(fᵢ × xᵢ) / Σfᵢ</p><p><b>Substitution:</b> (${safe(working.mean_working)}) / ${x.n}</p><p>${safe(formula)}</p><p><b>${x.sd_method==='sample'?'Sample':'Population'} SD formula:</b> ${safe(working.sd)}</p><p>${safe(sd)}</p><p><b>Median:</b> ${fix(x.median,4)} calculated from cumulative weighted frequencies, without creating individual rows.</p><p><b>Mode:</b> ${safe(x.mode)}${x.mode_scores.length>1?' (tie)':''}, based on the highest original category frequency.</p></div></details>
        <div class="freq-outfoot">Interpretation is descriptive, not a significance test; the coded mean assumes approximately equal spacing of response categories.</div>
      </article>`;
    }).join('');
    el('freq-limits').innerHTML=`<strong>Limitations — summary-only data</strong><p>${safe(result.limitations)}</p><p>${result.notes.map(x=>safe(x)).join(' ')}</p>`;
    el('freq-results').hidden = false;
    el('freq-results').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function setStatus(message,isError=false){const status=el('freq-status');status.textContent=message;status.classList.toggle('freq-error',isError)}
  async function run(event){
    event.preventDefault();let candidate;
    try{candidate=requestBody()}catch(err){setStatus(err.message,true);return;}
    const button=el('freq-run');button.disabled=true;setStatus('Checking frequencies and calculating…');
    try{
      const response=await fetch('/api/frequency-only/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(candidate)});
      const result=await response.json();
      if(!response.ok){const message=typeof result.detail==='string'?result.detail:'Unable to analyze frequencies.';throw Error(message)}
      current=result;payload=candidate;render(result);window.dispatchEvent(new CustomEvent('statlab:frequency-results',{detail:{result,payload:candidate}}));setStatus(`Calculated ${result.items.length} item(s) from frequency counts. No case records created.`);
    }catch(err){setStatus(err.message||'Analysis failed.',true);current=null;payload=null;window.dispatchEvent(new Event('statlab:frequency-stale'));el('freq-results').hidden=true}
    finally{button.disabled=false;}
  }
  function stale(){if(current){current=null;payload=null;window.dispatchEvent(new Event('statlab:frequency-stale'));el('freq-results').hidden=true;setStatus('Inputs changed. Click Calculate to update the report.');}}
  function downloadFile(name,content,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
  function buildHtmlReport(){
    if(!current)return null;
    const style=`body{font:14px/1.6 Arial,sans-serif;margin:32px auto;max-width:1000px;color:#18313b;padding:0 15px}h1,h2,h3{color:#103c34}h1{border-bottom:3px solid #147963;padding-bottom:10px}table{border-collapse:collapse;width:100%;margin:15px 0 22px;font-size:12px}th,td{padding:9px;border-bottom:1px solid #cbd8d6;text-align:left}th{background:#eef7f3}article{break-inside:avoid;page-break-inside:avoid;margin:35px 0}small,p.note{color:#627c80}.warning{background:#fff4e4;border:1px solid #eed6a8;padding:16px}`;
    const combined=makeTable(['Item','N','Mean','SD','Mode (scored code)','Top response'],current.items.map(x=>[x.item,x.n,fix(x.mean),fix(x.sd),x.mode,x.top_response]));
    const sections=current.items.map(x=>`<article><h2>${safe(x.item)}</h2><p>${safe(x.interpretation)}</p>${makeTable(['Original code','Category','Frequency','Percentage','Scored x','f×x','f(x−mean)²'],[...x.table.map(e=>[e.code,e.label,e.frequency,fix(e.percentage)+'%',fix(e.score),fix(e.fx),fix(e.squared_term,4)]), ['—','TOTAL',x.n,'100.00%','—',fix(x.formula.fx_sum),fix(x.formula.squared_sum,4)]])}<p><b>Mean:</b> Σfx/N = ${fix(x.formula.fx_sum,4)} / ${x.n} = ${fix(x.mean,4)}.</p><p><b>SD:</b> ${safe(x.formula.sd)} = √(${fix(x.formula.squared_sum,4)}/${x.formula.denominator}) = ${fix(x.sd,4)}.</p><p><b>Median:</b> ${fix(x.median,4)} · <b>Mode:</b> ${safe(x.mode)} · <b>Top original response:</b> ${safe(x.top_response)}.</p></article>`).join('');
    const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>MABRIG StatLab — Frequency-only report</title><style>${style}</style><body><h1>Frequency-only descriptive statistics</h1><p class="note">Produced ${date()} · MABRIG StatLab 0.9 · No respondent-level records were supplied or reconstructed.</p><h2>Summary</h2>${combined}<p>${safe(current.method)}</p>${sections}<h2>Limitations</h2><p class="warning">${safe(current.limitations)}</p><p class="note">Population: ${safe(current.metadata.population_size??'Not stated')}; sample: ${safe(current.metadata.sample_size??'Not stated')} (metadata only). Verify source counts and scoring instructions before citing results.</p></body></html>`;
    return html;
  }
  function exportHtml(){const html=buildHtmlReport();if(html)downloadFile('statlab-frequency-only-report.html',html,'text/html;charset=utf-8');}

  window.StatLabFrequency = {
    capture() {
      return { text: el('frequency-paste').value, labels: el('freq-labels').value,
        reversed: el('freq-reverse-all').checked, sd_method: el('freq-sd').value,
        population: el('freq-population').value, sample: el('freq-sample').value,
        report:current ? {html:buildHtmlReport(),csv:csvFromResult(current),created_at:new Date().toISOString()} : null };
    },
    restore(data) {
      if (!data || typeof data !== 'object') return;
      el('frequency-paste').value=String(data.text ?? '');
      el('freq-labels').value=String(data.labels ?? presets.five);
      el('freq-reverse-all').checked=data.reversed === true;
      el('freq-sd').value=data.sd_method === 'population' ? 'population' : 'sample';
      el('freq-population').value=String(data.population ?? '');
      el('freq-sample').value=String(data.sample ?? '');
      current=null;payload=null;el('freq-results').hidden=true;
      window.dispatchEvent(new Event('statlab:frequency-stale'));
      setStatus('Project inputs restored. Choose Calculate to verify the saved frequencies.');
    },
    hasCurrentReport() {return !!current;},
  };

  el('frequency-form').addEventListener('submit',run);
  el('freq-load-example').addEventListener('click',()=>{
    el('frequency-paste').value=demo;el('freq-labels').value=presets.five;el('freq-reverse-all').checked=false;el('freq-sd').value='sample';
    el('freq-population').value='';el('freq-sample').value='';
    document.querySelectorAll('[data-freq-preset]').forEach(x=>x.classList.toggle('active',x.dataset.freqPreset==='five'));
    stale();setStatus('Example loaded. These are illustrative counts, not verified field survey data.');
  });
  for(const button of document.querySelectorAll('[data-freq-preset]'))button.addEventListener('click',()=>{
    el('freq-labels').value=presets[button.dataset.freqPreset];
    document.querySelectorAll('[data-freq-preset]').forEach(x=>x.classList.toggle('active',x===button));stale();
  });
  el('frequency-form').addEventListener('input',stale);
  el('frequency-form').addEventListener('change',stale);
  el('freq-export-csv').addEventListener('click',()=>{if(current)downloadFile('statlab-frequency-only-summary.csv',csvFromResult(current),'text/csv;charset=utf-8')});
  el('freq-export-html').addEventListener('click',exportHtml);
})();
