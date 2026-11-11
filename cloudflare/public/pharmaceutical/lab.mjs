import {analyze, methods} from './methods.mjs';

const byId = id => document.getElementById(id);
const make = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
const drafts = new Map();
let current, report, source;
function invalidate() {
  report = null;
  byId('results').hidden = true;
  byId('metrics').replaceChildren();
  byId('details').replaceChildren();
  byId('status').textContent = '';
  byId('status').className = '';
}
function selectMethod(id) {
  if (current) drafts.set(current, {input: byId('measurements').value, source});
  current = id;
  const method = methods[id];
  invalidate();
  for (const button of byId('methods').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.method === id));
  }
  for (const key of ['title', 'question', 'instructions', 'interpretation']) byId(key).textContent = method[key];
  byId('headers').textContent = method.headers.join(', ');
  const draft = drafts.get(id);
  byId('measurements').value = draft?.input ?? '';
  source = draft?.source ?? 'User-entered measurements';
  byId('sources').replaceChildren(...method.sources.map(([label, url]) => {
    const item = make('li'), link = make('a', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    return item;
  }));
}

for (const level of ['BSc', 'MSc', 'PhD']) {
  byId('methods').append(make('h3', level));
  for (const [id, method] of Object.entries(methods).filter(([, method]) => method.level === level)) {
    const button = make('button', method.title);
    button.type = 'button';
    button.dataset.method = id;
    button.addEventListener('click', () => selectMethod(id));
    byId('methods').append(button);
  }
}
selectMethod('calibration');
byId('measurements').addEventListener('input', () => {
  if (!byId('measurements').value.trim()) source = 'User-entered measurements';
  else if (source === 'Synthetic teaching example') source = 'User-edited teaching example';
  invalidate();
});
byId('example').addEventListener('click', () => {
  const input = byId('measurements'), method = methods[current];
  if (input.value.trim() && input.value !== method.sample && !window.confirm('Replace these measurements with the teaching example?')) return;
  invalidate();
  input.value = method.sample;
  source = 'Synthetic teaching example';
  byId('status').textContent = 'Synthetic teaching data loaded. Select Calculate to inspect the results.';
});
const numberFormat = new Intl.NumberFormat('en', {maximumSignificantDigits: 7});
const display = value => value === null ? 'Undefined' : numberFormat.format(value);
function resultTable(result) {
  const table = make('table');
  const headRow = table.createTHead().insertRow();
  for (const column of result.columns) {
    const th = make('th', column);
    th.scope = 'col';
    headRow.append(th);
  }
  const body = table.createTBody();
  for (const values of result.data) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value === null ? '—' : display(value);
  }
  return table;
}
byId('analysis').addEventListener('submit', event => {
  event.preventDefault();
  invalidate();
  const method = methods[current], input = byId('measurements').value;
  try {
    const result = analyze(current, input);
    report = {schema: 'statlab.pharmaceutical.v1', method: method.title, columns: method.headers,
      source, input, result, interpretation: method.interpretation, references: method.sources};
    for (const [label, value] of Object.entries(result.metrics)) {
      const card = make('div');
      card.className = 'metric';
      card.append(make('span', label), make('strong', display(value)));
      byId('metrics').append(card);
    }
    if (result.data) byId('details').append(resultTable(result));
    byId('results').hidden = false;
    byId('status').textContent = 'Analysis complete · ' + source;
  } catch (error) {
    byId('status').className = 'error';
    byId('status').textContent = error.message;
  }
});
byId('export').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}));
  const link = make('a');
  link.href = url;
  link.download = 'statlab-pharmaceutical-' + current + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
