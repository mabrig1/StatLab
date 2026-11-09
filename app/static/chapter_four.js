/* Research objective-aware Chapter Four drafting from marginal frequencies only. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const panel = el('chapter4-builder');
  let source = null;
  let result = null;
  let request = null;
  const itemSelections = new Map();
  const manualSelections = new Map();
  let restoreAssignmentsOnNextResult = false;

  const setStatus = (msg, error=false) => {
    const status = el('chapter4-status');
    status.textContent = msg;
    status.classList.toggle('freq-error', error);
  };
  function objectives() {
    const values = el('chapter4-objectives').value.split(/\r?\n/)
      .map(x => x.trim()).filter(Boolean)
      .map(x => x.replace(/^\d+[.)]\s*/, '').trim());
    if (values.length > 12) throw Error('Enter no more than 12 objectives.');
    if (values.some(x => !x || x.length > 350)) throw Error('An objective is blank or too long.');
    return values;
  }
  function invalidate() {
    if (result) window.dispatchEvent(new Event('statlab:chapter-stale'));
    result = null;
    request = null;
    el('chapter4-output').hidden = true;
    el('chapter4-download-docx').disabled = true;
    setStatus(source ? 'Choose item assignments, then generate your draft.' : 'Calculate frequencies first.');
  }
  function redrawAssignments() {
    if (!source) return;
    const names = objectives();
    const container = el('chapter4-assignments');
    // Save existing selections before re-rendering.
    for (const select of container.querySelectorAll('select[data-item]')) {
      itemSelections.set(select.dataset.item, select.value);
    }
    container.replaceChildren();
    for (const item of source.result.items) {
      const row = document.createElement('label');
      row.className = 'chapter4-map-row';
      const label = document.createElement('span');
      label.textContent = item.item;
      label.title = item.item;
      const select = document.createElement('select');
      select.dataset.item = item.item;
      select.setAttribute('aria-label', `Objective for ${item.item}`);
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Unassigned (report separately)';
      select.append(blank);
      for (const [idx, title] of names.entries()) {
        const option = document.createElement('option');
        option.value = String(idx+1);
        option.textContent = `Objective ${idx+1}: ${title}`;
        select.append(option);
      }
      if (manualSelections.has(item.item) && (!manualSelections.get(item.item) || Number(manualSelections.get(item.item)) <= names.length)) {
        select.value = manualSelections.get(item.item);
      } else if (itemSelections.get(item.item) && Number(itemSelections.get(item.item)) <= names.length) {
        select.value = itemSelections.get(item.item);
      } else if (names.length === 1) {
        // Explicit visible default: the single entered objective groups all items.
        select.value = '1';
      }
      itemSelections.set(item.item, select.value);
      select.addEventListener('change', () => {manualSelections.set(item.item, select.value);itemSelections.set(item.item, select.value); invalidate();});
      row.append(label,select);
      container.append(row);
    }
    invalidate();
  }
  function prepareRequest() {
    if (!source) throw Error('Calculate item frequencies first.');
    const selected = {};
    for (const select of el('chapter4-assignments').querySelectorAll('select[data-item]')) {
      if (select.value) selected[select.dataset.item] = Number(select.value);
    }
    return {
      analysis: source.payload,
      research_title: el('chapter4-title').value.trim(),
      objectives: objectives(),
      item_objectives: selected,
      source_label: el('chapter4-source').value.trim(),
    };
  }
  async function post(endpoint, body) {
    const response = await fetch(endpoint, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    if (!response.ok) {
      let detail = 'The report could not be generated.';
      try {const data = await response.json(); detail = typeof data.detail === 'string' ? data.detail : detail;}
      catch (_) { /* unexpected server response */ }
      throw Error(detail);
    }
    return response;
  }
  function download(name, contents, mime) {
    const blob = contents instanceof Blob ? contents : new Blob([contents], {type:mime});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }
  window.addEventListener('statlab:frequency-results', event => {
    source = event.detail;
    itemSelections.clear();
    if (!restoreAssignmentsOnNextResult) manualSelections.clear();
    restoreAssignmentsOnNextResult = false;
    panel.hidden = false;
    redrawAssignments();
  });
  window.addEventListener('statlab:frequency-stale', () => {
    source = null;
    result = null;
    request = null;
    panel.hidden = true;
    el('chapter4-output').hidden = true;
  });

  window.StatLabChapterFour = {
    capture() {
      const mapping=Object.fromEntries(manualSelections);
      for (const selector of el('chapter4-assignments').querySelectorAll('select[data-item]'))
        mapping[selector.dataset.item]=selector.value;
      return {
        title:el('chapter4-title').value, source:el('chapter4-source').value,
        objectives:el('chapter4-objectives').value, assignments:mapping,
        report:result ? {html:result.html, csv:result.csv, created_at:new Date().toISOString()} : null,
      };
    },
    restore(data) {
      const d = data || {};
      el('chapter4-title').value=String(d.title ?? '');
      el('chapter4-source').value=String(d.source ?? '');
      el('chapter4-objectives').value=String(d.objectives ?? '');
      manualSelections.clear();itemSelections.clear();
      restoreAssignmentsOnNextResult = true;
      for (const [item, index] of Object.entries(d.assignments || {}))
        if (typeof index === 'string' && /^([1-9]|1[0-2])?$/.test(index)) manualSelections.set(item,index);
      result=null;request=null;el('chapter4-output').hidden=true;
      el('chapter4-download-docx').disabled=true;
      if (source) redrawAssignments();
    },
  };

  el('chapter4-objectives').addEventListener('input', () => {
    try {redrawAssignments();}
    catch(err) {invalidate();setStatus(err.message, true);}
  });
  for (const id of ['chapter4-title','chapter4-source']) el(id).addEventListener('input', invalidate);
  el('chapter4-form').addEventListener('submit', async event => {
    event.preventDefault();
    let prepared;
    try {prepared = prepareRequest();} catch(err) {setStatus(err.message, true);return;}
    const button = el('chapter4-generate');
    button.disabled = true;
    setStatus('Rechecking all frequency totals and preparing Chapter Four…');
    try {
      const response = await post('/api/frequency-only/chapter-four', prepared);
      result = await response.json();
      request = prepared;
      window.dispatchEvent(new CustomEvent('statlab:chapter-result', {detail:{result,request:prepared}}));
      el('chapter4-preview').srcdoc = result.html;
      el('chapter4-output').hidden = false;
      el('chapter4-download-docx').disabled = false;
      setStatus(`Draft ready: ${result.report.n_items} verified item(s). Review the narrative and source attribution.`);
      el('chapter4-output').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(err) {invalidate();setStatus(err.message, true);}
    finally {button.disabled = false;}
  });
  el('chapter4-download-html').addEventListener('click', () => {
    if (result) download('statlab-chapter-four-draft.html',result.html,'text/html;charset=utf-8');
  });
  el('chapter4-download-csv').addEventListener('click', () => {
    if (result) download('statlab-chapter-four-summary.csv',result.csv,'text/csv;charset=utf-8');
  });
  el('chapter4-download-docx').addEventListener('click', async event => {
    if (!request || !result) return;
    const button=event.currentTarget;
    button.disabled=true;
    setStatus('Creating editable Word draft…');
    try {
      const response = await post('/api/frequency-only/chapter-four.docx', request);
      download('statlab-chapter-four-draft.docx',await response.blob(),
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      setStatus('Word draft exported. Verify questionnaire wording, objective assignments and data source.');
    } catch(err) {setStatus(err.message,true);}
    finally {button.disabled=false;}
  });
})();
