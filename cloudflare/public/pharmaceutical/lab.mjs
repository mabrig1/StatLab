import {resultTableCsv} from './table-export.mjs';
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
  for (const id of ['details', 'diagnostic', 'intervals', 'plot']) byId(id).replaceChildren();
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
function display(value) {
  if (value === null) return 'Undefined';
  if (typeof value === 'string') return value;
  if (value !== 0 && Math.abs(value) < 1e-5) return value.toExponential(3);
  return numberFormat.format(value);
}
function residualPlot(data) {
  const svgNode = (tag, attrs, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const figure = make('figure');
  figure.append(make('figcaption', 'Calibration residuals (AU) by standard concentration (mg/L)'));
  const svg = svgNode('svg', {viewBox:'0 0 560 180', role:'img', 'aria-label':'Residual scatterplot. Each point is an observed minus fitted response. Exact values follow in the table.'});
  const xs = data.map(row => row[0]);
  const min = Math.min(...xs), max = Math.max(...xs);
  const maxResidual = Math.max(...data.map(row => Math.abs(row[3])));
  const extent = maxResidual || 1;
  svg.append(svgNode('line', {x1:85,y1:78,x2:510,y2:78,stroke:'#748d98','stroke-dasharray':'4 3'}),
    svgNode('line', {x1:85,y1:18,x2:85,y2:138,stroke:'#748d98'}));
  for (const [value, y] of [[maxResidual,18],[0,78],[-maxResidual,138]]) {
    if (!maxResidual && y !== 78) continue;
    svg.append(svgNode('text', {x:78,y:y+4,'text-anchor':'end'}, display(value)));
  }
  for (const [value, x] of [[min,85],[max,510]]) {
    svg.append(svgNode('text', {x,y:161,'text-anchor':'middle'}, display(value)));
  }
  for (const [x,,,residual] of data) {
    svg.append(svgNode('circle', {cx:85+(x-min)/(max-min)*425,cy:78-residual/extent*60,r:3,fill:'#11595a',opacity:0.72}));
  }
  figure.append(svg);
  return figure;
}
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
    byId('diagnostic').textContent = result.note ?? '';
    if (result.intervals?.length) {
      const data = result.intervals.map(row => [row.label, row.estimate, row.standardError, row.df, row.lower, row.upper]);
      byId('intervals').append(make('h3', '95% confidence intervals'), resultTable({
        columns: ['Quantity', 'Estimate', 'SE', 'df', 'Lower', 'Upper'], data
      }));
    }
    if (current === 'calibration') byId('plot').append(residualPlot(result.data));
    if (result.data) byId('details').append(resultTable(result));
    byId('results').hidden = false;
    byId('status').textContent = 'Analysis complete · ' + source;
  } catch (error) {
    byId('status').className = 'error';
    byId('status').textContent = error.message;
  }
});
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = make('a');
  link.href = url;
  link.download = 'statlab-pharmaceutical-' + current + '.' + extension;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
byId('export').addEventListener('click', () => {
  if (report) download(JSON.stringify(report, null, 2), 'application/json', 'json');
});
byId('table-export').addEventListener('click', () => {
  if (report) download(resultTableCsv(report), 'text/csv;charset=utf-8', 'csv');
});
