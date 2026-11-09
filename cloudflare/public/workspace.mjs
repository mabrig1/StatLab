// Standalone browser data editor model. No network calls or case synthesis.
export const SCHEMA = "mabrig-statlab-browser-project-v1";
export const LIMITS = Object.freeze({rows:5000, variables:80, cellsPerPaste:2500, importBytes:4000000, history:25});
export const DEFAULT_LIKERT = Object.freeze({"1":"Strongly Disagree","2":"Disagree","3":"Neutral","4":"Agree","5":"Strongly Agree"});

export function makeVariable(name="VAR001", overrides={}) {
  return {name,type:"numeric",width:8,decimals:0,label:"",values:{},
    missing:[],columns:13,align:"right",measure:"scale",role:"input",...overrides};
}
export function newWorkspace() {
  return {schema:SCHEMA,title:"Untitled survey",variables:[makeVariable("VAR001")],
    rows:Array.from({length:10},()=>[null])};
}
export function exampleWorkspace() {
  const variables=[
    makeVariable("ID",{label:"Respondent ID",decimals:0,measure:"nominal"}),
    makeVariable("Gender",{label:"Gender",measure:"nominal",values:{"1":"Female","2":"Male"}}),
    makeVariable("Age",{label:"Age in years",decimals:0}),
    makeVariable("Q1",{label:"I am satisfied with the service",measure:"ordinal",values:{...DEFAULT_LIKERT}}),
    makeVariable("Q2",{label:"The service meets my needs",measure:"ordinal",values:{...DEFAULT_LIKERT}})
  ];
  const rows=[[1,1,21,4,5],[2,2,26,3,4],[3,1,29,5,4],[4,2,33,2,3],
    [5,1,24,4,4],[6,2,31,5,5],[7,1,28,3,4],[8,2,36,4,3]];
  return {schema:SCHEMA,title:"Synthetic questionnaire demo",variables,rows};
}
export function validName(name) {
  return typeof name==="string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name);
}
function checkVariable(v, peers=[]) {
  if(!v || typeof v!=="object" || !validName(v.name))throw Error("Variable names must start with a letter and use only letters, digits, or underscores (up to 64 characters).");
  if(peers.some(x=>x.name.toLowerCase()===v.name.toLowerCase()))throw Error("A variable with this name already exists.");
  if(!["numeric","string","date"].includes(v.type))throw Error("Choose Numeric, String or Date.");
  if(!Number.isInteger(v.width)||v.width<1||v.width>100)throw Error("Width must be 1 to 100.");
  if(!Number.isInteger(v.decimals)||v.decimals<0||v.decimals>8)throw Error("Decimals must be 0 to 8.");
  if(typeof v.label!=="string"||v.label.length>500)throw Error("Variable labels can contain up to 500 characters.");
  if(!Number.isInteger(v.columns)||v.columns<6||v.columns>50)throw Error("Columns must be 6 to 50.");
  if(!["left","center","right"].includes(v.align))throw Error("Invalid alignment.");
  if(!["nominal","ordinal","scale"].includes(v.measure))throw Error("Choose Nominal, Ordinal, or Scale.");
  if(!["input","target","both","none"].includes(v.role))throw Error("Choose a supported variable role.");
  if(!v.values||typeof v.values!=="object"||Array.isArray(v.values) || Object.keys(v.values).length>100)throw Error("Value labels must be a dictionary of up to 100 codes.");
  if(!Array.isArray(v.missing)||v.missing.length>20)throw Error("Define at most 20 missing-value codes.");
  const seenMissing=new Set();
  for(const key of v.missing) {
    if(typeof key!=="string"||key.length>100||seenMissing.has(key))throw Error("Missing values must be unique codes.");
    seenMissing.add(key);
  }
  for(const [code,label] of Object.entries(v.values)){
    if(!code||code.length>100||typeof label!=="string"||!label.trim()||label.length>200)throw Error("Every value label needs a code and a short, nonempty description.");
    if(v.type==="numeric"&&!Number.isFinite(Number(code)))throw Error("Numeric value labels must have numeric codes.");
  }
  return v;
}
function validateCell(value,variable) {
  if(value===null||value===undefined||value==="")return null;
  if(typeof value==="object"||typeof value==="boolean")throw Error(variable.name+": cell must be a single value.");
  const str=String(value).trim();
  if(!str)return null;
  if(str.length>100)throw Error(variable.name+": value must contain at most 100 characters.");
  if(variable.type==="numeric"){
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(str))throw Error(variable.name+": enter a number or leave the cell blank.");
    const num=Number(str);
    if(!Number.isFinite(num))throw Error(variable.name+": number is not finite.");
    return num;
  }
  if(variable.type==="date") {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(str))throw Error(variable.name+": dates must use YYYY-MM-DD.");
    const d=new Date(str+"T00:00:00Z");
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==str)throw Error(variable.name+": invalid calendar date.");
  }
  return str;
}
function duplicate(data) {return structuredClone(data);}
export function validateWorkspace(input) {
  if(!input||input.schema!==SCHEMA||!Array.isArray(input.variables)||!Array.isArray(input.rows))throw Error("Not a supported StatLab browser project.");
  if(input.variables.length<1||input.variables.length>LIMITS.variables)throw Error("This project has too many or no variables.");
  if(input.rows.length>LIMITS.rows)throw Error("Project exceeds the 5,000-row browser limit.");
  if(typeof input.title!=="string"||input.title.length>120)throw Error("Project title is too long.");
  const variables=[];
  for(const v of input.variables){checkVariable(v,variables);variables.push(v);}
  const rows=input.rows.map((row,i)=>{
    if(!Array.isArray(row)||row.length!==variables.length)throw Error("Row "+(i+1)+" does not match the number of variables.");
    return row.map((value,j)=>validateCell(value,variables[j]));
  });
  return {...input,variables:duplicate(variables),rows};
}
export function renameProject(data,title){
  if(typeof title!=="string"||!title.trim()||title.trim().length>120)throw Error("Project title must be between 1 and 120 characters.");
  return {...data,title:title.trim()};
}
export function changeCell(data,row,col,value){
  if(!Number.isInteger(row)||row<0||row>=data.rows.length)throw Error("Choose an existing case.");
  if(!Number.isInteger(col)||col<0||col>=data.variables.length)throw Error("Choose an existing variable.");
  const next=duplicate(data);
  next.rows[row][col]=validateCell(value,next.variables[col]);
  return next;
}
export function addRows(data,amount=1) {
  if(!Number.isInteger(amount)||amount<1||data.rows.length+amount>LIMITS.rows)throw Error("Maximum 5,000 cases per project.");
  const next=duplicate(data);
  for(let i=0;i<amount;i++)next.rows.push(next.variables.map(()=>null));
  return next;
}
export function removeRow(data,index){
  if(!Number.isInteger(index)||index<0||index>=data.rows.length)throw Error("Select a valid row to delete.");
  const next=duplicate(data);next.rows.splice(index,1);return next;
}
export function addVariable(data,partial={}){
  if(data.variables.length>=LIMITS.variables)throw Error("Maximum 80 variables per project.");
  const names=new Set(data.variables.map(v=>v.name.toLowerCase()));
  let n=1;while(names.has(("VAR"+String(n).padStart(3,"0")).toLowerCase()))n++;
  const v=makeVariable("VAR"+String(n).padStart(3,"0"),partial);
  checkVariable(v,data.variables);
  const next=duplicate(data);next.variables.push(v);
  next.rows.forEach(row=>row.push(null));return next;
}
export function updateVariable(data,index,patch){
  if(!Number.isInteger(index)||index<0||index>=data.variables.length)throw Error("Variable not found.");
  if(!patch||typeof patch!=="object")throw Error("Invalid variable settings.");
  const next=duplicate(data),old=next.variables[index],updated={...old,...patch};
  checkVariable(updated,next.variables.filter((_,i)=>i!==index));
  next.rows.forEach((row,rowIndex)=>{
    try {row[index]=validateCell(row[index],updated);}
    catch {throw Error("Case "+(rowIndex+1)+" conflicts with the new type of "+updated.name+". Clear or recode the data first.");}
  });
  next.variables[index]=updated;return next;
}
export function deleteVariable(data,index){
  if(data.variables.length<=1)throw Error("Keep at least one variable in the project.");
  if(!Number.isInteger(index)||index<0||index>=data.variables.length)throw Error("Invalid variable.");
  const next=duplicate(data);next.variables.splice(index,1);
  next.rows.forEach(row=>row.splice(index,1));return next;
}
export function moveVariable(data,index,direction){
  const target=index+direction;
  if(![-1,1].includes(direction)||index<0||target<0||target>=data.variables.length)throw Error("Variable cannot move further.");
  const next=duplicate(data);
  [next.variables[index],next.variables[target]]=[next.variables[target],next.variables[index]];
  next.rows.forEach(row=>{[row[index],row[target]]=[row[target],row[index]];});
  return next;
}
export function pasteCells(data,startRow,startCol,table){
  if(!Array.isArray(table)||!table.length||!Array.isArray(table[0])||!table[0].length)throw Error("Clipboard has no tabular data.");
  const width=table[0].length;
  if(!table.every(r=>Array.isArray(r)&&r.length===width))throw Error("Pasted rows must have the same number of columns.");
  if(table.length*width>LIMITS.cellsPerPaste)throw Error("Paste up to 2,500 cells at a time.");
  if(startRow<0||startCol<0||startRow+table.length>LIMITS.rows||startCol+width>data.variables.length)throw Error("Paste exceeds the available variables or 5,000-case limit.");
  const next=duplicate(data);
  while(next.rows.length<startRow+table.length)next.rows.push(next.variables.map(()=>null));
  table.forEach((row,i)=>row.forEach((value,j)=>{next.rows[startRow+i][startCol+j]=validateCell(value,next.variables[startCol+j]);}));
  return next;
}
export function parseCsv(raw) {
  if(typeof raw!=="string"||new TextEncoder().encode(raw).length>LIMITS.importBytes)throw Error("Maximum CSV size is 4 MB.");
  const text=raw.replace(/^\uFEFF/,"");
  const rows=[];let row=[],value="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}
      else if(quoted){quoted=false;}
      else if(!value){quoted=true;}
      else throw Error("Malformed CSV quoting.");
    }else if(c===","&&!quoted){row.push(value);value="";}
    else if((c==="\n"||c==="\r")&&!quoted){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(value);rows.push(row);row=[];value="";
    }else{value+=c;}
  }
  if(quoted)throw Error("Unclosed quotation mark in CSV.");
  if(value!==""||row.length){row.push(value);rows.push(row);}
  return rows.filter(r=>r.length>1||r[0]!=="");
}
function safeHeader(header,index,used){
  let name=String(header||"").trim().replace(/[^A-Za-z0-9_]/g,"_");
  if(!/^[A-Za-z]/.test(name))name="VAR"+String(index+1).padStart(3,"0")+(name?"_"+name:"");
  name=name.slice(0,60);
  const original=name;let suffix=2;
  while(used.has(name.toLowerCase()))name=original.slice(0,57)+"_"+suffix++;
  used.add(name.toLowerCase());return name;
}
export function importCsv(raw,filename="Imported survey"){
  const table=parseCsv(raw);
  if(table.length<1)throw Error("CSV has no header row.");
  const header=table[0],rows=table.slice(1);
  if(header.length<1||header.length>LIMITS.variables||rows.length>LIMITS.rows)throw Error("CSV exceeds the row or variable limits.");
  if(rows.some(row=>row.length!==header.length))throw Error("CSV rows contain inconsistent column counts.");
  const used=new Set();
  const variables=header.map((h,i)=>{
    const values=rows.map(row=>row[i]).filter(x=>x.trim()!=="");
    const numeric=values.length>0&&values.every(x=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x)&&Number.isFinite(Number(x)));
    return makeVariable(safeHeader(h,i,used),{label:h&&h.trim()?h.trim().slice(0,500):"",type:numeric?"numeric":"string",
      measure:numeric?"scale":"nominal",align:numeric?"right":"left",decimals:numeric?2:0});
  });
  return validateWorkspace({schema:SCHEMA,title:String(filename).slice(0,120),variables,rows});
}
export function displayValue(value,variable,labels=false) {
  if(value===null||value===undefined)return "";
  const code=String(value);
  if(labels&&Object.hasOwn(variable.values,code))return variable.values[code];
  if(variable.type==="numeric"&&variable.decimals>0) return Number(value).toFixed(variable.decimals);
  return code;
}
export function isUserMissing(value,variable){
  return value!==null&&variable.missing.includes(String(value));
}
function csvCell(raw,escapeFormulas=false){
  if(raw===null||raw===undefined)return "";
  let value=String(raw);
  if(escapeFormulas && /^[\s]*[=+@-]/.test(value) && !/^-?(?:\d+(\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))value="'"+value;
  return '"'+value.replace(/"/g,'""')+'"';
}
export function exportCsv(data){
  return [data.variables.map(v=>csvCell(v.name)).join(","),
    ...data.rows.map(row=>row.map((v,i)=>csvCell(v,data.variables[i].type==="string")).join(","))].join("\r\n")+"\r\n";
}
export function exportDictionary(data){
  return JSON.stringify({schema:"mabrig-statlab-variable-dictionary-v1",title:data.title,variables:data.variables},null,2);
}
export function exportProject(data){return JSON.stringify(validateWorkspace(data),null,2);}
export function importProject(raw){
  if(typeof raw!=="string"||new TextEncoder().encode(raw).length>LIMITS.importBytes)throw Error("Project backup exceeds 4 MB.");
  let parsed;try{parsed=JSON.parse(raw);}catch{throw Error("Invalid project JSON file.");}
  return validateWorkspace(parsed);
}
export function frequencyFromColumn(data,index){
  const v=data.variables[index];
  if(!v||v.type!=="numeric"||!["ordinal","scale"].includes(v.measure))
    throw Error("Choose a numeric Ordinal or Scale variable; nominal codes must not be averaged.");
  const counts=new Map();
  for(const row of data.rows){
    const value=row[index];if(value===null||isUserMissing(value,v))continue;
    const code=String(value);counts.set(code,(counts.get(code)||0)+1);
  }
  const codes=new Set([...Object.keys(v.values),...counts.keys()]);
  const sorted=[...codes].sort((a,b)=>Number(a)-Number(b));
  if(sorted.length<2||sorted.length>11)throw Error("Frequency-only calculator requires 2 to 11 numeric response codes.");
  if(!sorted.every(code=>Number.isFinite(Number(code))))throw Error("All response codes must be numeric.");
  const labelMap=new Map(sorted.map(code=>[code,v.values[code]||"Response "+code]));
  if(new Set([...labelMap.values()].map(x=>x.toLowerCase())).size!==labelMap.size)throw Error("Response labels must be unique.");
  return {scale:sorted.map(code=>code+" = "+labelMap.get(code)).join("\n"),
    counts:v.name+":\n"+sorted.map(code=>labelMap.get(code)+" = "+(counts.get(code)||0)).join("\n")+
      "\nTotal N = "+[...counts.values()].reduce((a,b)=>a+b,0),
    variable:v.name};
}
