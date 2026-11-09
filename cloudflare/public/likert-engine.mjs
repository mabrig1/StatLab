// MABRIG Likert Studio: evidence-preserving survey descriptives.
// Frequency-only input is never converted to fabricated respondent records.
import {parseScale} from "./statistics.mjs";

export const LIKERT_PRESETS={
  "4":["Strongly Disagree","Disagree","Agree","Strongly Agree"],
  "5":["Strongly Disagree","Disagree","Neutral","Agree","Strongly Agree"],
  "7":["Strongly Disagree","Disagree","Somewhat Disagree","Neither Agree nor Disagree","Somewhat Agree","Agree","Strongly Agree"]
};
export const LIMIT_ITEMS=60;
export const EXAMPLE_STUDY="Digital Skills and Graduate Employability (Synthetic Demonstration)";
export const EXAMPLE_OBJECTIVES=[
  "To assess perceived digital-skills readiness",
  "To examine perceived employability preparedness"
];
export function presetLabels(points){
  const a=LIKERT_PRESETS[String(points)];
  if(!a)throw Error("Choose a four-, five-, or seven-point scale.");
  return a.map((name,index)=>(index+1)+" = "+name).join("\n");
}
export function scaleDefinition(raw,points){
  const scale=parseScale(raw),n=Number(points);
  if(!LIKERT_PRESETS[String(points)]||scale.length!==n||scale.some((s,i)=>s.code!==i+1))
    throw Error("Use exactly "+n+" numbered scale codes: 1 through "+n+".");
  return scale;
}
export function emptyItem(points=5,index=1){
  const count=Number(points);
  return {id:"Q"+index,question:"Question "+index,objective:0,reversed:false,
    counts:Array.from({length:count},()=>0),declaredN:null};
}
export function exampleItems(){
  return [
    {id:"Q1",question:"Digital skills can improve my employment opportunities.",objective:0,reversed:false,
      counts:[30,23,20,45,35],declaredN:153},
    {id:"Q2",question:"I can use digital tools to complete academic tasks.",objective:0,reversed:false,
      counts:[12,18,24,57,42],declaredN:153},
    {id:"Q3",question:"I feel prepared for the digital workplace.",objective:1,reversed:false,
      counts:[23,28,37,42,23],declaredN:153}
  ];
}
function finiteCount(value,where){
  if(typeof value==="string"&&!/^\d+$/.test(value.trim()))
    throw Error(where+" must be a whole number (0 or greater).");
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw Error(where+" must be a whole number (0 or greater).");
  return n;
}
export function validateItems(items,scale,objectives){
  if(!Array.isArray(items)||items.length===0||items.length>LIMIT_ITEMS)
    throw Error("Add between 1 and "+LIMIT_ITEMS+" questionnaire items.");
  if(!Array.isArray(objectives)||objectives.length<1||objectives.length>12)
    throw Error("Define between 1 and 12 research objectives.");
  const questions=new Set(),ids=new Set(),seen=[];
  for(const [index,item] of items.entries()){
    const name=String(item.id||"").trim(),question=String(item.question||"").trim();
    if(!name||name.length>40||!question||question.length>300)throw Error("Item "+(index+1)+" needs a code and questionnaire statement.");
    if(ids.has(name.toLowerCase()))throw Error("Each item code must be unique: "+name);
    ids.add(name.toLowerCase());
    if(questions.has(question.toLowerCase()))throw Error("Duplicate questionnaire statement: "+name);
    questions.add(question.toLowerCase());
    if(!Number.isInteger(item.objective)||item.objective<0||item.objective>=objectives.length)
      throw Error(name+" needs a valid research objective.");
    if(typeof item.reversed!=="boolean")throw Error(name+" has an invalid reverse-code setting.");
    if(!Array.isArray(item.counts)||item.counts.length!==scale.length)
      throw Error(name+" needs exactly "+scale.length+" frequency cells.");
    const counts=item.counts.map((x,i)=>finiteCount(x,name+" response "+(i+1)));
    const n=counts.reduce((a,b)=>a+b,0);
    if(n===0)throw Error(name+": enter at least one response.");
    if(item.declaredN!==null&&item.declaredN!==undefined&&item.declaredN!==""){
      const declared=finiteCount(item.declaredN,name+" declared N");
      if(declared!==n)throw Error(name+": total N "+declared+" does not match frequency sum "+n+".");
    }
    seen.push({...item,id:name,question,counts,declaredN:n});
  }
  return seen;
}
function weightedMedian(rows,N){
  let cumulative=0,lo=NaN,hi=NaN;
  const first=Math.floor((N+1)/2),last=Math.ceil((N+1)/2);
  for(const row of [...rows].sort((a,b)=>a.scoredCode-b.scoredCode)){
    cumulative+=row.frequency;
    if(Number.isNaN(lo)&&cumulative>=first)lo=row.scoredCode;
    if(cumulative>=last){hi=row.scoredCode;break;}
  }
  return (lo+hi)/2;
}
export function analyzeLikert(items,rawScale,points,objectives,{sdMethod="sample",studyTitle="",sourceType="frequencies"}={}){
  const scale=scaleDefinition(rawScale,points);
  if(!["sample","population"].includes(sdMethod))throw Error("Choose sample or population SD.");
  if(!["frequencies","cases"].includes(sourceType))throw Error("Unknown source type.");
  if(typeof studyTitle!=="string"||studyTitle.length>260)throw Error("Study title is too long.");
  if(!objectives.every(x=>typeof x==="string"&&x.trim().length>0&&x.length<=240))
    throw Error("Research objectives must be clearly stated (maximum 240 characters each).");
  const checked=validateItems(items,scale,objectives);
  const midpoint=(1+scale.length)/2;
  const results=checked.map(item=>{
    const rows=scale.map((s,i)=>({
      code:s.code,label:s.label,frequency:item.counts[i],
      scoredCode:item.reversed?scale.length-i:s.code,
      percent:100*item.counts[i]/item.declaredN
    }));
    const n=item.declaredN;
    const sum=rows.reduce((v,r)=>v+r.frequency*r.scoredCode,0);
    const mean=sum/n;
    const square=rows.reduce((v,r)=>v+r.frequency*(r.scoredCode-mean)**2,0);
    const denominator=sdMethod==="sample"?n-1:n;
    const sd=denominator>0?Math.sqrt(square/denominator):null;
    const modeCount=Math.max(...item.counts);
    const modes=rows.filter(r=>r.frequency===modeCount).map(r=>r.label);
    const median=weightedMedian(rows,n);
    const above=mean>midpoint+1e-10?"above":mean<midpoint-1e-10?"below":"at";
    return {...item,N:n,mean,sd,median,mode:modes,topCount:modeCount,topPercent:100*modeCount/n,
      topResponse:modes.join(" / "),midpoint,above,weightedSum:sum,weightedSquare:square,
      denominator,sdMethod,rows,
      explanation:"Mean "+mean.toFixed(2)+" is "+above+" the scale midpoint ("+midpoint+
        "). Most selected response: "+modes.join(" / ")+" ("+(100*modeCount/n).toFixed(1)+"%)."+
        (item.reversed?" This item was reverse-scored for its mean and SD.":"")
    };
  });
  const groups=objectives.map((objective,index)=>{
    const entries=results.filter(x=>x.objective===index);
    const averageItemMean=entries.length?entries.reduce((v,x)=>v+x.mean,0)/entries.length:null;
    return {objective:objective.trim(),index,items:entries,
      averageItemMean,numberOfItems:entries.length};
  });
  return {studyTitle:studyTitle.trim(),sourceType,scale,sdMethod,midpoint,results,groups,
    unequalNs:new Set(results.map(x=>x.N)).size>1,
    warnings:[
      "Frequency distributions support descriptive, single-item statistics only. They do not establish correlations, regression, t-tests, ANOVA, or Cronbach's alpha.",
      "The objective figure is an unweighted arithmetic average of item means, NOT a respondent-level composite score or its standard deviation.",
      "The mean treats ordered response codes as approximately equally spaced. Report frequencies and percentages alongside it.",
      "The examples are synthetic; do not label them as genuine field-survey observations."
    ]};
}
export function casesToItems(project,rawScale,points,objectiveIndex=0){
  const scale=scaleDefinition(rawScale,points);
  if(!project||!Array.isArray(project.variables)||!Array.isArray(project.rows))throw Error("Open a Data View project first.");
  const candidates=project.variables.map((v,i)=>({v,i}))
    .filter(({v})=>v.type==="numeric" && v.measure==="ordinal");
  if(!candidates.length)throw Error("No numeric ordinal variables found. Define Likert variables in Variable View first.");
  return candidates.slice(0,LIMIT_ITEMS).map(({v,i})=>{
    const counts=Array.from({length:scale.length},()=>0);
    for(const [rowNumber,row] of project.rows.entries()){
      const raw=row[i];
      if(raw===null||raw===undefined||raw===""||v.missing?.includes(String(raw)))continue;
      const code=Number(raw);
      if(!Number.isInteger(code)||code<1||code>scale.length)
        throw Error("Case "+(rowNumber+1)+", "+v.name+": value "+raw+" is outside 1–"+scale.length+". Correct or mark it missing in Variable View.");
      counts[code-1]++;
    }
    return {id:v.name,question:v.label||v.name,objective:objectiveIndex,reversed:false,
      counts,declaredN:counts.reduce((a,b)=>a+b,0)};
  });
}
function csvEscape(value){
  return '"'+String(value??"").replace(/"/g,'""')+'"';
}
export function summaryCsv(report){
  const labels=report.scale.map(s=>s.label);
  const lines=[["Objective","Item","Question","N",...labels.map(s=>"Frequency: "+s),
    ...labels.map(s=>"Percentage: "+s),"Mean","Sample/Population SD","Median","Mode","Top response","Reversed"]];
  for(const x of report.results)lines.push([
    report.groups[x.objective].objective,x.id,x.question,x.N,
    ...x.rows.map(r=>r.frequency),...x.rows.map(r=>r.percent.toFixed(2)),
    x.mean.toFixed(3),x.sd===null?"":x.sd.toFixed(3),x.median.toFixed(2),
    x.mode.join(" / "),x.topResponse,x.reversed?"Yes":"No"
  ]);
  return lines.map(line=>line.map(csvEscape).join(",")).join("\r\n")+"\r\n";
}
export function chapterFourText(report){
  const out=["CHAPTER FOUR","DATA PRESENTATION, ANALYSIS AND DISCUSSION OF FINDINGS",""];
  if(report.studyTitle)out.push("Study: "+report.studyTitle,"");
  out.push("4.1 Introduction","This chapter presents descriptive findings calculated directly from "+
    (report.sourceType==="cases"?"the respondent-level data presently available in Data View.":"user-supplied questionnaire frequency counts.")+
    " A "+report.scale.length+"-point rating scale was used. The table reports valid responses for each item and "+
    (report.sdMethod==="sample"?"sample":"population")+" standard deviation.","");
  let number=0;
  for(const g of report.groups){
    out.push("Research Objective "+(g.index+1)+": "+g.objective);
    if(!g.items.length){out.push("No questionnaire items were assigned to this objective.","");continue;}
    number++;
    out.push("Table 4."+number+": Descriptive statistics for Objective "+(g.index+1),
      "Item | Valid N | Mean | SD | Modal answer");
    for(const item of g.items)out.push(item.id+" | "+item.N+" | "+item.mean.toFixed(2)+" | "+
      (item.sd===null?"N/A":item.sd.toFixed(2))+" | "+item.topResponse);
    out.push("Source: "+(report.sourceType==="cases"?"values entered in Data View; not independently verified.":
      "user-supplied frequency counts; not independently verified."),"");
    for(const item of g.items){
      out.push(item.id+" — "+item.question);
      out.push(report.scale.map((r,i)=>r.label+": "+item.counts[i]+" ("+item.rows[i].percent.toFixed(1)+"%)").join("; ")+".");
      out.push(item.explanation);
    }
    out.push("Average of item means (descriptive only): "+g.averageItemMean.toFixed(2)+
      ". This is not a respondent-level composite score.","");
  }
  out.push("4.4 Limitations");
  out.push(...report.warnings);
  if(report.unequalNs)out.push("Valid response totals differ across items; compare their percentages and denominators carefully.");
  out.push("All conclusions above are descriptive; they do not support causal or inferential claims.");
  return out.join("\n");
}
export function reportHtml(report){
  const escaped=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const text=chapterFourText(report);
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>StatLab Likert Chapter Four</title>'+
    '<style>body{font:12pt/1.6 Georgia,serif;max-width:850px;margin:35px auto;padding:20px;color:#172b3e}'+
    'h1{text-align:center}pre{font:inherit;white-space:pre-wrap;overflow-wrap:break-word}</style></head><body>'+
    '<h1>MABRIG StatLab — Likert Analysis Report</h1><pre>'+escaped(text)+'</pre></body></html>';
}
export function itemsFromPasted(raw,scale,objective=0){
  if(typeof raw!=="string"||!raw.trim())throw Error("Paste frequencies first.");
  if(raw.length>80000)throw Error("Paste at most 80,000 characters.");
  const labels=scale.map(s=>s.label),items=[],used=new Set();
  let current=null;
  function end(){
    if(!current)return;
    if(current.counts.every(n=>n===0))throw Error(current.id+": response counts are empty.");
    items.push(current);
  }
  const lines=raw.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const delim=lines[0].includes("\t")?"\t":",";
  if(/^(item|question)\s*[,	]/i.test(lines[0])&&lines[0].includes(delim)){
    const head=lines[0].split(delim).map(x=>x.trim());
    const codes=head.slice(1).map(x=>scale.findIndex(s=>s.label.toLowerCase()===x.toLowerCase()||String(s.code)===x));
    if(codes.some(x=>x<0)||new Set(codes).size!==scale.length||codes.length!==scale.length)
      throw Error("Pasted table needs one column for every scale category, in any order.");
    for(const [i,line] of lines.slice(1).entries()){
      const cells=line.split(delim).map(x=>x.trim());
      if(cells.length!==head.length)throw Error("Pasted table row "+(i+2)+" has the wrong number of cells.");
      const counts=Array.from({length:scale.length},()=>0);
      cells.slice(1).forEach((v,j)=>{counts[codes[j]]=finiteCount(v,"Row "+(i+2));});
      items.push({id:cells[0],question:cells[0],objective,reversed:false,counts,
        declaredN:counts.reduce((a,b)=>a+b,0)});
    }
  }else{
    for(const line of lines){
      const heading=line.match(/^((?:Item|Question|Q)\s*[\w.-]+)(?:\s*\([^)]*\))?\s*:?\s*$/i);
      if(heading){end();current={id:heading[1].replace(/\s+/g,""),question:heading[1],objective,reversed:false,
        counts:Array.from({length:scale.length},()=>0),declaredN:null};used.clear();continue;}
      if(!current)throw Error('Start each question with a heading such as "Item 1:".');
      const value=line.match(/^(.+?)\s*(?:=|:)\s*(\d+)\s*$/);
      if(!value)throw Error("Cannot parse "+line.slice(0,70)+'. Use "Agree = 45".');
      const name=value[1].trim(),count=finiteCount(value[2],name);
      if(/^total(?:\s*n)?$/i.test(name)){current.declaredN=count;continue;}
      const idx=scale.findIndex(s=>s.label.toLowerCase()===name.toLowerCase()||String(s.code)===name);
      if(idx<0)throw Error('Unrecognized response label "'+name+'".');
      if(used.has(idx))throw Error("Response "+name+" repeated in "+current.id+".");
      used.add(idx);current.counts[idx]=count;
    }
    end();
  }
  if(items.length===0||items.length>LIMIT_ITEMS)throw Error("Paste between 1 and "+LIMIT_ITEMS+" items.");
  return items;
}
