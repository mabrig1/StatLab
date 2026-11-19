import {syntheticTimeSeries} from "./advanced-demo.mjs";
// Standalone, opt-in pilot. No browser project is read, copied or auto-uploaded.
const byId=id=>document.getElementById(id);
const state={rows:[],headers:[],ready:false,output:null};
const say=(message,error=false)=>{byId("error").textContent=error?message:"";if(!error)byId("file-help").textContent=message};
function csvParse(csv) {
  const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
  const text=csv.replace(/^\uFEFF/,"");
  if(text.includes("\0"))throw Error("NUL bytes are not allowed.");
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(ch==='"'){quoted=false;afterQuote=true}
      else cell+=ch;
    }else if(ch==='"'&&!cell&&!afterQuote){quoted=true}
    else if(ch===','){row.push(cell);cell="";afterQuote=false}
    else if(ch==="\r"||ch==="\n"){
      if(ch==="\r"&&text[i+1]==="\n")i++;
      row.push(cell);if(row.some(s=>s.trim()))rows.push(row);
      if(rows.length>2502)throw Error("Only 2,500 data observations are supported.");
      row=[];cell="";afterQuote=false;
    }else if(afterQuote&&!/\s/.test(ch)){throw Error("Unexpected text after a closing quote in CSV.");}
    else if(ch!=='"'||afterQuote){cell+=ch}
    else throw Error("Unescaped quotation mark in CSV.");
  }
  if(quoted)throw Error("Unclosed CSV quoted field.");
  row.push(cell);if(row.some(s=>s.trim()))rows.push(row);
  if(rows.length<2)throw Error("Provide CSV headings and at least one data row.");
  const width=rows[0].length;
  if(width<1||width>30||rows[0].some(s=>!s.trim())||new Set(rows[0]).size!==width)
    throw Error("CSV requires unique, nonblank headings (up to 30 columns).");
  if(rows.slice(1).some(r=>r.length!==width))throw Error("All CSV rows must have the same number of columns.");
  return rows;
}
function periodKey(v){
  const s=String(v).trim();
  if(/^\d{4}-\d{2}$/.test(s)){
    const [y,m]=s.split("-").map(Number);
    if(m<1||m>12)return null;
    return {kind:"month",number:y*12+m};
  }
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const [y,m,d]=s.split("-").map(Number);
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
    return {kind:"day",number:Math.floor(date.getTime()/86400000)};
  }
  return null;
}
function checkTimeRows(rows,timeIndex) {
  if(timeIndex==="")return;
  const periods=rows.map(row=>periodKey(row[Number(timeIndex)]));
  if(periods.some(x=>!x))throw Error("Dates must be ISO YYYY-MM-DD or months YYYY-MM with no invalid or missing values.");
  const kind=periods[0].kind;
  if(periods.some(x=>x.kind!==kind))throw Error("Time-index format must be consistent.");
  const intervals=periods.slice(1).map((x,i)=>x.number-periods[i].number);
  const step=intervals[0];
  if(![1,7].includes(step)||kind==="month"&&step!==1 ||
     intervals.some(n=>n!==step))
    throw Error("Dates must be strictly consecutive with consistent daily, weekly or monthly frequency. No gaps or duplicates are allowed.");
}
function getValues(){
  if(!state.rows.length)throw Error("Select a CSV file first.");
  const col=byId("column").value;
  if(col==="")throw Error("Choose a numeric column.");
  const number=Number(col);
  const rows=state.rows.slice(1);
  checkTimeRows(rows,byId("time").value);
  const values=rows.map((row,i)=>{
    const input=row[number].trim();
    if(!input||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(input))
      throw Error("A numeric value is missing or invalid at data row "+(i+2)+".");
    const v=Number(input);
    if(!Number.isFinite(v))throw Error("A non-finite numeric value occurred at row "+(i+2)+".");
    return v;
  });
  const limit=byId("mode").value==="arima"?[50,1200]:[150,2500];
  if(values.length<limit[0]||values.length>limit[1])
    throw Error("Selected method requires "+limit[0]+"–"+limit[1]+" observations.");
  return values;
}
function setRows(parsed,label){
  state.rows=parsed;state.headers=parsed[0];state.output=null;byId("output").hidden=true;
  byId("ordered").checked=false;byId("consent").checked=false;
  for(const id of ["column","time"])byId(id).replaceChildren();
  for(const [i,h] of parsed[0].entries()){
    const opt=document.createElement("option");opt.value=String(i);opt.textContent=h;
    byId("column").append(opt);
  }
  const blank=document.createElement("option");blank.value="";blank.textContent="Manual chronology check (no date column)";
  byId("time").append(blank);
  parsed[0].forEach((h,i)=>{
    const opt=document.createElement("option");opt.value=String(i);opt.textContent=h;byId("time").append(opt);
  });
  const likely=state.headers.findIndex(h=>/^(value|price|returns?|close)$/i.test(h.trim()));
  if(likely!==-1)byId("column").value=String(likely);
  const time=state.headers.findIndex(h=>/^(date|month|day|period)$/i.test(h.trim()));
  if(time!==-1)byId("time").value=String(time);
  byId("column").disabled=false;byId("time").disabled=false;
  say(label);
}
async function importFile(){
  state.rows=[];state.headers=[];state.output=null;byId("output").hidden=true;
  byId("ordered").checked=false;byId("consent").checked=false;
  const file=byId("file").files[0];
  if(!file)return;
  if(file.size>180000){say("CSV exceeds the 180 KB browser import limit.",true);return}
  try{
    const parsed=csvParse(await file.text());
    setRows(parsed,(parsed.length-1)+" CSV observations loaded on your device. No file has been sent.");
  }catch(error){state.rows=[];say(error.message,true)}
}
function loadExample(kind){
  const data=syntheticTimeSeries(kind);
  byId("file").value="";
  byId("mode").value=kind;
  setMode();
  setRows(data,(data.length-1)+" SYNTHETIC observations generated in this browser. No external data transfer or calculation has occurred.");
  byId("kind").value="prices";
}

function setMode(){
  const garch=byId("mode").value==="garch";
  byId("arima-settings").hidden=garch;byId("garch-settings").hidden=!garch;
  byId("method-help").textContent=garch
    ?"GARCH forecasts conditional variance/volatility of financial returns, not future prices."
    :"ARIMA forecasts numeric time-series values and evaluates held-out errors against a naive baseline.";
}
function renderTable(table){
  const section=document.createElement("section");section.className="result-card";
  const h=document.createElement("h3");h.textContent=table.title;section.append(h);
  const wrap=document.createElement("div");wrap.className="scroll";
  const t=document.createElement("table"),thead=document.createElement("thead"),tr=document.createElement("tr");
  for(const col of table.columns||[]){const th=document.createElement("th");th.textContent=String(col);tr.append(th)}
  thead.append(tr);t.append(thead);
  const tb=document.createElement("tbody");
  for(const row of table.rows||[]){
    const r=document.createElement("tr");
    for(const value of row){const td=document.createElement("td");td.textContent=value===null?"—":String(value);r.append(td)}
    tb.append(r);
  }
  t.append(tb);wrap.append(t);section.append(wrap);
  if(table.note){const p=document.createElement("p");p.textContent=table.note;section.append(p)}
  return section;
}
function renderResult(result){
  byId("report-title").textContent=result.title;
  byId("report-method").textContent=result.method||"";
  byId("report-text").textContent=result.narrative||"";
  byId("report-warnings").replaceChildren();
  for(const w of result.warnings||[]){
    const p=document.createElement("p");p.className="warning";p.textContent="Important: "+w;
    byId("report-warnings").append(p);
  }
  byId("report-tables").replaceChildren(...result.tables.map(renderTable));
  byId("output").hidden=false;byId("output").scrollIntoView({block:"start",behavior:"smooth"});
}
async function run(event){
  event.preventDefault();say("",true);
  if(!state.ready){say("Advanced web computing is not configured yet.",true);return}
  if(!byId("ordered").checked||!byId("consent").checked){
    say("Confirm the observed time order and explicit consent to remote numeric processing.",true);return;
  }
  let values;
  try{values=getValues()}catch(error){say(error.message,true);return}
  const mode=byId("mode").value, steps=Number(byId("steps").value);
  const payload={mode,steps,values,consent:true};
  if(mode==="arima"){payload.p=Number(byId("p").value);payload.d=Number(byId("d").value);payload.q=Number(byId("q").value)}
  else payload.input_type=byId("kind").value;
  const button=byId("run");button.disabled=true;button.textContent="Calculating…";
  try{
    const response=await fetch("/api/advanced/run",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),cache:"no-store",credentials:"same-origin"});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||"Remote computing request was refused.");
    state.output=result;renderResult(result);
  }catch(error){say(error.message,true)}
  finally{button.disabled=!state.ready;button.textContent="Run validated analysis →"}
}
async function status(){
  try{
    const response=await fetch("/api/advanced/status",{cache:"no-store"});
    if(!response.ok)throw Error("Unavailable");
    const payload=await response.json();state.ready=payload.available===true;
    byId("availability").textContent=state.ready
      ?"Access-protected pilot configured. You may submit an approved numeric series."
      :"Pilot computing is disabled. Local browser research tools remain available.";
  }catch{state.ready=false;byId("availability").textContent="Pilot computing status could not be verified."}
  byId("run").disabled=!state.ready;
}
byId("file").addEventListener("change",importFile);
byId("example-arima").addEventListener("click",()=>loadExample("arima"));
byId("example-garch").addEventListener("click",()=>loadExample("garch"));
byId("mode").addEventListener("change",()=>{setMode();byId("ordered").checked=false;byId("consent").checked=false;});
for(const id of ["column","time","kind"]){
  byId(id).addEventListener("change",()=>{
    byId("consent").checked=false;
    if(id==="time")byId("ordered").checked=false;
  });
}
byId("analysis").addEventListener("submit",run);
byId("export").addEventListener("click",()=>{
  if(!state.output)return;
  const object=new Blob([JSON.stringify(state.output,null,2)],{type:"application/json"});
  const link=document.createElement("a");link.href=URL.createObjectURL(object);
  link.download="statlab-advanced-results.json";link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),3000);
});
setMode();status();
