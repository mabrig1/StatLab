// Student-focused portable backups and thesis-ready descriptive tables.
// Browser-only: no networks, respondent simulation, or inferential claims.
import {scaleDefinition} from "./likert-engine.mjs";

export const DRAFT_SCHEMA="mabrig-statlab-likert-draft-v1";
export const MAX_DRAFT_BYTES=250_000;

function bytes(raw){return new TextEncoder().encode(raw).length;}
function plainObject(value){return value!==null&&typeof value==="object"&&!Array.isArray(value);}
function fail(message){throw Error(message);}
function safeString(value,max,field){
  if(typeof value!=="string"||value.length>max)fail(field+" must be text of at most "+max+" characters.");
  return value;
}
function safeWholeNumberOrEmpty(value,where){
  if(value===null||value===undefined||value==="")return "";
  if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)return value;
  if(typeof value==="string"&&/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value)))return value.trim();
  fail(where+" must be a whole number, zero, or blank while drafting.");
}
export function normalizeLikertDraft(input){
  if(!plainObject(input))fail("Likert project must be a JSON object.");
  const points=Number(input.points);
  if(![4,5,7].includes(points))fail("Choose a supported 4-, 5-, or 7-point scale.");
  const labels=safeString(input.scaleLabels,2500,"Scale labels");
  scaleDefinition(labels,points); // Validates codes and duplicates, without assuming custom label names.
  const title=safeString(input.title??"",260,"Study title");
  const sourceLabel=safeString(input.sourceLabel??"",200,"Source label");
  const sdMethod=input.sdMethod;
  if(!["sample","population"].includes(sdMethod))fail("Choose a sample or population standard deviation.");
  if(!Array.isArray(input.objectives)||input.objectives.length<1||input.objectives.length>12)
    fail("A project needs between 1 and 12 research objectives.");
  const objectives=input.objectives.map((objective,i)=>safeString(objective,240,"Objective "+(i+1)));
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>60)
    fail("A project needs between 1 and 60 questionnaire items.");
  const seen=new Set();
  const items=input.items.map((item,i)=>{
    if(!plainObject(item))fail("Item "+(i+1)+" is not a valid questionnaire record.");
    const id=safeString(item.id??"",40,"Question code");
    const question=safeString(item.question??"",300,"Questionnaire statement");
    if(id&&seen.has(id.toLowerCase()))fail("Duplicate item code: "+id);
    if(id)seen.add(id.toLowerCase());
    if(!Number.isInteger(item.objective)||item.objective<0||item.objective>=objectives.length)
      fail("Assign item "+(i+1)+" to a valid research objective.");
    if(typeof item.reversed!=="boolean")fail("Item "+(i+1)+" has an invalid reverse-score flag.");
    if(!Array.isArray(item.counts)||item.counts.length!==points)
      fail("Item "+(i+1)+" does not match the selected rating scale.");
    const counts=item.counts.map((f,k)=>safeWholeNumberOrEmpty(f,"Count "+(k+1)+" of item "+(i+1)));
    const declaredN=safeWholeNumberOrEmpty(item.declaredN??"", "Declared N of item "+(i+1));
    return {id,question,objective:item.objective,reversed:item.reversed,counts,
      declaredN:declaredN===""?null:declaredN};
  });
  // Count snapshots copied from Data View can be backed up, but opening them
  // does not recover the respondents or reauthorize case-level statistics.
  const wasDerivedFromCases=input.sourceType==="cases"||input.wasDerivedFromCases===true;
  return {schema:DRAFT_SCHEMA,title,sourceLabel,points,scaleLabels:labels,
    sdMethod,objectives,items,sourceType:"frequencies",wasDerivedFromCases};
}
export function exportLikertDraft(input){
  const data=normalizeLikertDraft(input);
  const raw=JSON.stringify(data,null,2);
  if(bytes(raw)>MAX_DRAFT_BYTES)fail("Likert backup exceeds the 250 KB safety limit.");
  return raw;
}
export function importLikertDraft(raw){
  if(typeof raw!=="string"||bytes(raw)>MAX_DRAFT_BYTES)fail("Likert backup must be a JSON file smaller than 250 KB.");
  let parsed;
  try{parsed=JSON.parse(raw);}catch{fail("Could not read the Likert JSON project.");}
  if(!plainObject(parsed)||parsed.schema!==DRAFT_SCHEMA)fail("Not a supported Likert Studio project backup.");
  return normalizeLikertDraft(parsed);
}
function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function spreadsheetText(value){
  const raw=String(value??"");
  // CSV quoting alone does not neutralize spreadsheets' formula interpretation.
  const unsafe=/^\s*[=+@-]/.test(raw)&&!/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(raw);
  return '"'+(unsafe?"'"+raw:raw).replace(/"/g,'""')+'"';
}
function sourceNote(report){
  const label=report.sourceLabel?
    report.sourceLabel+" (user-supplied; not independently verified)":
    report.sourceType==="cases"?"Data View entries (not independently verified)":
      "User-supplied frequency counts (not independently verified)";
  return label;
}
export function objectiveTables(report,{highestFirst=true}={}){
  if(!report||!Array.isArray(report.groups)||!Array.isArray(report.scale))fail("Analyze Likert items before exporting tables.");
  if(typeof highestFirst!=="boolean")fail("Table order must be ascending or descending.");
  const categories=highestFirst?[...report.scale].reverse():[...report.scale];
  const headers=["Item","Questionnaire statement",...categories.map(x=>x.label+" ("+x.code+") f (%)"),
    "Valid N","Mean","SD","Tendency"];
  const tables=report.groups.map(group=>{
    const rows=group.items.map(item=>{
      const cells=categories.map(scale=>{
        const row=item.rows.find(r=>r.code===scale.code);
        if(!row)fail("Results are missing response category "+scale.code+".");
        return row.frequency+" ("+row.percent.toFixed(1)+"%)";
      });
      const tendency=item.above==="above"?"Above midpoint":item.above==="below"?"Below midpoint":"At midpoint";
      return {id:item.id,question:item.question,reversed:item.reversed,
        cells:[item.id+(item.reversed?" †":""),item.question,...cells,
          item.N,item.mean.toFixed(2),item.sd===null?"N/A":item.sd.toFixed(2),tendency]};
    });
    return {number:group.index+1,objective:group.objective,rows,
      averageItemMean:group.averageItemMean};
  });
  return {headers,tables,source:sourceNote(report),scalePoints:categories.length,
    sdMethod:report.sdMethod,midpoint:report.midpoint,highestFirst};
}
export function objectiveTablesCsv(report,opts={}){
  const data=objectiveTables(report,opts);
  const lines=[["Research objective",...data.headers]];
  for(const table of data.tables){
    for(const row of table.rows)lines.push(["Objective "+table.number,row.cells[0],...row.cells.slice(1)]);
  }
  return lines.map(cells=>cells.map(spreadsheetText).join(",")).join("\r\n")+"\r\n";
}
export function objectiveTablesHtml(report,opts={}){
  const data=objectiveTables(report,opts);
  const heading=esc(report.studyTitle||"Likert descriptive statistics");
  const pages=data.tables.map(table=>{
    const headingRow=data.headers.map(h=>"<th scope=\"col\">"+esc(h)+"</th>").join("");
    const tableRows=table.rows.length?table.rows.map(row=>
      "<tr>"+row.cells.map((v,i)=>(i===0?"<th scope=\"row\">":"<td>")+esc(v)+(i===0?"</th>":"</td>")).join("")+"</tr>"
    ).join(""):"<tr><td colspan=\""+data.headers.length+"\">No items assigned.</td></tr>";
    const average=table.averageItemMean===null?
      "No item means available.":
      "Arithmetic average of item means: "+table.averageItemMean.toFixed(2)+
      " (descriptive only; NOT a respondent-level composite score).";
    return "<section><h2>Research Objective "+table.number+"</h2><p>"+esc(table.objective)+"</p>"+
      "<h3>Table 4."+table.number+": Likert descriptive responses</h3><div class=\"scroll\"><table><thead><tr>"+
      headingRow+"</tr></thead><tbody>"+tableRows+"</tbody></table></div><p><strong>"+esc(average)+
      "</strong></p><p class=\"source\">Source: "+esc(data.source)+"</p></section>";
  }).join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>StatLab Chapter Four Tables</title>'+
    '<style>body{font:12px/1.55 Georgia,"Times New Roman",serif;color:#222;margin:24px auto;max-width:1400px;padding:0 18px}'+
    'h1{text-align:center;font-size:22px}h2{font-size:18px;margin:24px 0 6px}h3{font-size:14px}.scroll{overflow-x:auto}'+
    'table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #777;padding:6px;text-align:left;vertical-align:top}'+
    'thead th{background:#eee}.source,.note{font-size:11px}section{break-inside:avoid;margin-bottom:24px}'+
    '@page{size:landscape;margin:14mm}@media print{body{max-width:none;margin:0;padding:0}}</style></head><body>'+
    '<h1>CHAPTER FOUR — DATA PRESENTATION</h1><p><strong>Study:</strong> '+heading+'</p>'+
    '<p class="note">Responses appear '+(data.highestFirst?"highest-to-lowest":"lowest-to-highest")+
    ' by their original codes. A dagger (†) marks a reverse-scored item. Each count uses its own item N as denominator. '+
    'Mean and '+esc(data.sdMethod)+' standard deviation describe coded scores; ordered categories are treated as approximately equally spaced.</p>'+
    pages+
    '<p class="note"><strong>Limitations:</strong> These are single-item descriptive findings. Comparing item means with the scale midpoint ('+
    esc(data.midpoint)+') is not a hypothesis test. Marginal counts cannot substantiate regression, correlation, paired tests, ANOVA or Cronbach alpha.</p>'+
    '</body></html>';
}
