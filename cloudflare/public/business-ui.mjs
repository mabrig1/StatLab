// Business Analytics user interface: local CSV parsing and shareable infographic.
import {
  analyzeBusiness,parseBusinessCsv,syntheticBusinessData,
  csvTemplate,formatMoney,businessReportCsv
} from "./business-analytics.mjs";
import {createBusinessInfographic} from "./business-infographic.mjs";
const el=id=>document.getElementById(id);
const create=(tag,value,className)=>{
  const item=document.createElement(tag);
  if(value!==undefined&&value!==null)item.textContent=String(value);
  if(className)item.className=className;
  return item;
};
const state={dataset:syntheticBusinessData(),report:null,svg:"",mode:"transactions"};
function error(text=""){el("ba-error").textContent=text;}
function currentFilters(){
  return {currency:el("ba-currency").value,category:el("ba-category").value,
    region:el("ba-region").value,channel:el("ba-channel").value,
    from:el("ba-from").value,to:el("ba-to").value};
}
function download(name,text,mime){
  const url=URL.createObjectURL(new Blob([text],{type:mime}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function option(value,text){const opt=create("option",text);opt.value=value;return opt;}
function fillFilter(id,values,singular){
  const select=el(id),current=select.value;
  select.replaceChildren(option("all","All "+singular));
  [...values].sort((a,b)=>a.localeCompare(b)).forEach(value=>select.append(option(value,value)));
  select.value=[...select.options].some(x=>x.value===current)?current:"all";
}
function resetFilters(){
  for(const id of ["ba-category","ba-region","ba-channel"])el(id).value="all";
  el("ba-from").value="";el("ba-to").value="";
}
function updateFilterOptions(){
  if(!state.dataset)return;
  const rows=state.dataset.rows;
  fillFilter("ba-category",new Set(rows.map(x=>x.category)),"categories");
  fillFilter("ba-channel",new Set(rows.map(x=>x.channel)),"channels");
  fillFilter("ba-region",new Set(rows.map(x=>x.region)),"regions");
}
function setDataset(data){
  state.dataset=data;state.report=null;state.svg="";
  resetFilters();updateFilterOptions();
  el("ba-results").hidden=true;
  el("ba-import-summary").textContent=(data.synthetic?"SYNTHETIC EXAMPLE • ":"")+
    data.rows.length+" "+(data.mode==="transactions"?"transaction lines":"monthly summary rows")+
    " loaded locally. No data was uploaded to a server.";
  error("");
  render();
}
function metricCard(title,value,description,icon){
  const div=create("article",null,"ba-kpi-card");
  div.append(create("span",title,"ba-kpi-label"),create("strong",value,"ba-kpi-value"),
    create("small",description,"ba-kpi-explain"),create("span",icon,"ba-kpi-icon"));
  return div;
}
function addRows(target,rows,formatter){
  const body=el(target);body.replaceChildren();
  if(!rows.length){
    const tr=create("tr"),td=create("td","No records available for this breakdown.");
    td.colSpan=5;tr.append(td);body.append(tr);return;
  }
  rows.slice(0,10).forEach(record=>{
    const tr=create("tr");formatter(record).forEach(value=>tr.append(create("td",value)));
    body.append(tr);
  });
}
function displayPercent(value){return value===null?"N/A":(value*100).toFixed(1)+"%";}
function render(){
  const report=analyzeBusiness(state.dataset,currentFilters());
  state.report=report;state.svg=createBusinessInfographic(report,{
    title:"Business Performance",brand:"MABRIG StatLab"
  });
  el("ba-result-source").textContent=(report.synthetic?"SYNTHETIC DEMONSTRATION • ":"")+
    report.source+" • "+report.metrics.lineItems+" records match current filters"+
    " • no currency conversion";
  const metric=report.metrics,currency=report.currency;
  const cards=el("ba-kpis");cards.replaceChildren();
  cards.append(
    metricCard("Sales revenue",formatMoney(metric.revenue,currency),"Total sales in selected records","↗"),
    metricCard("Recorded costs",formatMoney(metric.cost,currency),"Unit cost × units, or reported costs","▤"),
    metricCard("Gross profit",formatMoney(metric.profit,currency),"Revenue minus recorded costs","◈"),
    metricCard("Gross margin",displayPercent(metric.margin),"Gross profit / revenue","%"),
    metricCard("Units",metric.units===null?"N/A":metric.units.toLocaleString(),
      metric.units===null?"Not provided in the summary":"Number of units reported","▥"),
    metricCard(metric.orders===null?"Sales lines":"Orders",
      (metric.orders??metric.lineItems).toLocaleString(),
      metric.orders===null?"Order IDs/counts not supplied":"Distinct IDs or sum of reported orders","◎"),
    metricCard("Average order value",metric.aov===null?"N/A":formatMoney(metric.aov,currency),
      "Requires an order count","≈")
  );
  el("ba-infographic").src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(state.svg);
  el("ba-infographic").alt="Business infographic for "+report.source+
    "; revenue "+formatMoney(metric.revenue,currency)+
    ", gross profit "+formatMoney(metric.profit,currency)+
    ", margin "+displayPercent(metric.margin)+". Monthly trend and segment rankings appear below.";
  const insights=el("ba-insights");insights.replaceChildren();
  report.insights.forEach(text=>insights.append(create("li",text)));
  const caveats=el("ba-caveats");caveats.replaceChildren();
  report.caveats.forEach(text=>caveats.append(create("p",text)));
  addRows("ba-month-rows",report.byMonth,r=>[
    r.name,formatMoney(r.revenue,currency),formatMoney(r.profit,currency),displayPercent(r.margin)
  ]);
  addRows("ba-category-rows",report.byCategory,r=>[
    r.name,formatMoney(r.revenue,currency),formatMoney(r.profit,currency)
  ]);
  addRows("ba-channel-rows",report.byChannel,r=>[
    r.name,formatMoney(r.revenue,currency),
    metric.revenue===0?"N/A":displayPercent(r.revenue/metric.revenue)
  ]);
  addRows("ba-product-rows",report.byProduct,r=>[
    r.name,formatMoney(r.revenue,currency),formatMoney(r.profit,currency)
  ]);
  el("ba-results").hidden=false;error("");
}
function switchMode(mode){
  state.mode=mode;
  const current=state.dataset;
  if(current?.mode!==mode){
    state.dataset=null;state.report=null;state.svg="";
    el("ba-results").hidden=true;
    el("ba-import-summary").textContent="Choose a "+(mode==="monthly"?"monthly summary":"transaction")+
      " CSV, or load the synthetic example for this mode.";
    resetFilters();error("");
  }
}
function exampleForMode(mode){
  const transactions=syntheticBusinessData();
  if(mode==="transactions")return transactions;
  const monthly=new Map();
  for(const row of transactions.rows){
    const m=monthly.get(row.month)||{month:row.month,category:"All categories",region:"All regions",
      channel:"All channels",revenue:0,cost:0,units:0,orders:0};
    m.revenue+=row.revenue;m.cost+=row.cost;m.units+=row.quantity;m.orders++;
    monthly.set(row.month,m);
  }
  return {mode:"monthly",rows:[...monthly.values()],synthetic:true,source:"Synthetic monthly summary"};
}
async function importFile(file){
  if(!file)return;
  try{
    if(file.size>2_000_000)throw Error("CSV file must be smaller than 2 MB.");
    const data=parseBusinessCsv(await file.text(),state.mode);
    data.source="Imported "+file.name.slice(0,90);
    setDataset(data);
  }catch(err){error(err.message);}
  finally{el("ba-file").value="";}
}
function usePasted(){
  try{
    const raw=el("ba-raw").value.trim();
    const data=parseBusinessCsv(raw,state.mode);
    data.source="Pasted CSV rows";
    setDataset(data);
    el("ba-paste-panel").open=false;
  }catch(err){error(err.message);}
}
async function downloadPng(){
  if(!state.svg)return;
  const svg=state.svg;
  try{
    const image=new Image();
    const src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
    await new Promise((resolve,reject)=>{
      image.onload=resolve;image.onerror=()=>reject(Error("SVG preview could not be rendered."));
      image.src=src;
    });
    const canvas=document.createElement("canvas");
    canvas.width=2400;canvas.height=2200;
    const ctx=canvas.getContext("2d");
    if(!ctx)throw Error("Canvas is not available in this browser.");
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!blob)throw Error("PNG export is unavailable in this browser. Download SVG instead.");
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="statlab-business-infographic.png";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    error("");
  }catch(err){error(err.message);}
}
function setup(){
  document.querySelectorAll('input[name="ba-mode"]').forEach(radio=>{
    radio.addEventListener("change",()=>switchMode(radio.value));
  });
  el("ba-demo").addEventListener("click",()=>setDataset(exampleForMode(state.mode)));
  el("ba-template").addEventListener("click",()=>download("statlab-"+state.mode+"-template.csv",
    csvTemplate(state.mode),"text/csv;charset=utf-8"));
  el("ba-import").addEventListener("click",()=>el("ba-file").click());
  el("ba-file").addEventListener("change",evt=>importFile(evt.target.files?.[0]));
  el("ba-use-pasted").addEventListener("click",usePasted);
  el("ba-analyze").addEventListener("click",()=>{
    if(!state.dataset){error("Import data or load a synthetic example first.");return;}
    try{render();el("ba-results").scrollIntoView({behavior:"smooth",block:"start"});}
    catch(err){state.report=null;state.svg="";el("ba-results").hidden=true;error(err.message);}
  });
  el("ba-clear-filters").addEventListener("click",()=>{
    resetFilters();if(state.dataset)render();
  });
  for(const id of ["ba-currency","ba-category","ba-channel","ba-region","ba-from","ba-to"]){
    el(id).addEventListener("change",()=>{
      if(!state.dataset)return;
      try{render();}catch(err){state.report=null;state.svg="";el("ba-results").hidden=true;error(err.message);}
    });
  }
  el("ba-export-svg").addEventListener("click",()=>{
    if(state.svg)download("statlab-business-infographic.svg",state.svg,"image/svg+xml;charset=utf-8");
  });
  el("ba-export-png").addEventListener("click",downloadPng);
  el("ba-export-csv").addEventListener("click",()=>{
    if(state.report)download("statlab-business-kpis.csv",businessReportCsv(state.report),"text/csv;charset=utf-8");
  });
  updateFilterOptions();render();
}
setup();
