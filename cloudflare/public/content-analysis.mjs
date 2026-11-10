// MABRIG StatLab content analysis — browser-local, transparent coding.
import {parseCsv} from "./workspace.mjs";
export const CONTENT_SCHEMA="mabrig-statlab-content-v1";
export const CONTENT_LIMITS={documents:150,codes:35,documentChars:20000,totalChars:450000,
  units:5500,reviewMemoChars:1200,keywordsPerCode:30,fileBytes:600000,projectBytes:1000000};
const MODES=new Set(["paragraph","sentence","document"]);
const STOPWORDS=new Set(("a an the and or to in of on at for by with from as is are was were be been being"+
" it its this that these those we you they he she i me my our your their them his her us"+
" do does did have has had can could would should will may might not no yes so if then"+
" than but because about into over under across between during after before also very"+
" one two many much some any all each more most such which what when where who how why"+
" am up down out there here said says say per via using use used").split(/\s+/));
const fail=m=>{throw Error(m);};
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const byteLength=x=>new TextEncoder().encode(x).length;
function textField(raw,max,label,required=true){
  if(typeof raw!=="string")fail(label+" must be text.");
  const s=raw.trim();
  if(s.length>max)fail(label+" exceeds "+max+" characters.");
  if(required&&!s)fail(label+" cannot be empty.");
  return s;
}
function idField(s,label){
  const id=textField(s,70,label);
  if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))
    fail(label+" must begin with a letter and contain only letters, numbers, - or _.");
  return id;
}
function unique(values,label){
  const seen=new Set();
  for(const x of values){const value=x.toLowerCase();if(seen.has(value))fail("Duplicate "+label+": "+x);seen.add(value);}
}
export function newContentProject(){
  return {schema:CONTENT_SCHEMA,title:"Untitled content study",unit:"paragraph",documents:[],codes:[],reviews:{}};
}
export function contentDemo(){
  return {schema:CONTENT_SCHEMA,title:"Students' Digital Learning Experiences (SYNTHETIC DEMO)",unit:"paragraph",
    documents:[
      {id:"D1",title:"Synthetic interview A",origin:"synthetic",
        text:"Internet access is unreliable during online lessons. Poor connectivity interrupts live discussions.\n\nThe training is useful because tutorials explain complicated topics clearly."},
      {id:"D2",title:"Synthetic interview B",origin:"synthetic",
        text:"High data costs make it difficult to join online classes regularly. Sometimes there is no affordable data bundle.\n\nI appreciate patient tutors and practical examples."},
      {id:"D3",title:"Synthetic interview C",origin:"synthetic",
        text:"The digital platform is easy to navigate, but the internet connection is unstable.\n\nWe need affordable internet access and more support from instructors."}
    ],codes:[
      {id:"ACCESS",name:"Internet accessibility",description:"Mentions connectivity and access",
        keywords:["internet","connectivity","connection"]},
      {id:"COST",name:"Affordability",description:"Mentions cost barriers",
        keywords:["cost","costs","affordable","data bundle"]},
      {id:"SUPPORT",name:"Teaching support",description:"Mentions tutor support and training",
        keywords:["tutor","tutors","instructor","instructors","tutorials","training"]}
    ],reviews:{}};
}
export function segmentDocuments(documents,mode){
  if(!MODES.has(mode))fail("Choose a valid unit of analysis.");
  const result=[];
  for(const doc of documents){
    let parts;
    if(mode==="document")parts=[doc.text.trim()];
    else if(mode==="paragraph")parts=doc.text.split(/\n[\s]*\n/).map(x=>x.trim()).filter(Boolean);
    else parts=doc.text.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map(x=>x.trim()).filter(Boolean)||[];
    if(!parts.length)parts=[doc.text.trim()];
    parts.forEach((text,index)=>result.push({id:doc.id+"::"+(index+1),
      docId:doc.id,source:doc.title,origin:doc.origin,position:index+1,text}));
    if(result.length>CONTENT_LIMITS.units)fail("Too many text segments. Use paragraphs or documents.");
  }
  return result;
}
export function validateContentProject(project){
  if(!isObject(project)||project.schema!==CONTENT_SCHEMA)fail("Not a supported content analysis project.");
  const title=textField(project.title,220,"Study title",false);
  if(!MODES.has(project.unit))fail("Choose paragraph, sentence or document as coding unit.");
  if(!Array.isArray(project.documents)||project.documents.length>CONTENT_LIMITS.documents)
    fail("A project can hold at most 150 documents.");
  if(!Array.isArray(project.codes)||project.codes.length>CONTENT_LIMITS.codes)
    fail("A project can hold at most 35 codes.");
  let total=0;
  const documents=project.documents.map(doc=>{
    if(!isObject(doc))fail("Invalid document.");
    const id=idField(doc.id,"Document ID"),title=textField(doc.title,180,"Document title"),
      text=textField(doc.text,CONTENT_LIMITS.documentChars,"Document text");
    if(!["synthetic","user"].includes(doc.origin))fail("Document origin must be user or synthetic.");
    total+=text.length;
    return {id,title,text,origin:doc.origin};
  });
  if(total>CONTENT_LIMITS.totalChars)fail("Combined source text is too long for this browser project.");
  unique(documents.map(d=>d.id),"document ID");
  const codes=project.codes.map(c=>{
    if(!isObject(c))fail("Invalid code.");
    const id=idField(c.id,"Code ID"),name=textField(c.name,100,"Code name"),
      description=textField(c.description??"",350,"Code description",false);
    if(!Array.isArray(c.keywords)||c.keywords.length>CONTENT_LIMITS.keywordsPerCode)
      fail("A code can have at most 30 search phrases.");
    const keywords=c.keywords.map(k=>textField(k,100,"Keyword"));
    unique(keywords,"keyword");return {id,name,description,keywords};
  });
  unique(codes.map(c=>c.id),"code ID");
  const units=segmentDocuments(documents,project.unit),ids=new Set(units.map(u=>u.id)),
    codeIds=new Set(codes.map(c=>c.id));
  if(!isObject(project.reviews)||Object.keys(project.reviews).length>CONTENT_LIMITS.units)
    fail("Invalid review records.");
  const reviews={};
  for(const [unitId,review] of Object.entries(project.reviews)){
    if(!ids.has(unitId))fail("A reviewed unit no longer exists: "+unitId);
    if(!isObject(review)||!Array.isArray(review.codes))fail("Invalid review.");
    if(new Set(review.codes).size!==review.codes.length||
      review.codes.some(code=>!codeIds.has(code)))fail("Review contains an unknown code.");
    reviews[unitId]={codes:[...review.codes],memo:textField(review.memo??"",
      CONTENT_LIMITS.reviewMemoChars,"Research memo",false)};
  }
  return {schema:CONTENT_SCHEMA,title,unit:project.unit,documents,codes,reviews};
}
function escapeRegex(s){
  const special=[".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"];
  return [...s].map(c=>special.includes(c)?"\\"+c:c).join("");
}
export function keywordMatches(text,keywords){
  const seen=new Set(),hits=[];
  for(const phrase of keywords){
    const expression=escapeRegex(phrase.trim()).replace(/\s+/g,"\\s+");
    const regex=new RegExp("(?<![\\p{L}\\p{N}_])"+expression+"(?![\\p{L}\\p{N}_])","giu");
    for(const m of text.matchAll(regex)){
      const key=m.index+":"+m[0].length;
      if(seen.has(key))continue;
      seen.add(key);hits.push({start:m.index,match:m[0],keyword:phrase});
      if(hits.length>=500)break;
    }
  }
  return hits.sort((a,b)=>a.start-b.start);
}
export function analyzeContent(rawProject){
  const project=validateContentProject(rawProject),units=segmentDocuments(project.documents,project.unit);
  const stats=new Map(project.codes.map(c=>[c.id,{id:c.id,name:c.name,unitCount:0,
    docIds:new Set(),keywordHits:0,reviewedUnits:0}]));
  const rows=units.map(unit=>{
    const suggested=[],hitsByCode={};
    for(const code of project.codes){
      const hits=keywordMatches(unit.text,code.keywords);
      hitsByCode[code.id]=hits;stats.get(code.id).keywordHits+=hits.length;
      if(hits.length)suggested.push(code.id);
    }
    const review=project.reviews[unit.id]??null,assigned=review?[...review.codes]:[...suggested];
    for(const codeId of assigned){
      const s=stats.get(codeId);s.unitCount++;s.docIds.add(unit.docId);
      if(review)s.reviewedUnits++;
    }
    return {...unit,suggested,assigned,reviewed:review!==null,
      memo:review?.memo??"",hitsByCode};
  });
  const codeStats=[...stats.values()].map(s=>({
    id:s.id,name:s.name,unitCount:s.unitCount,percent:rows.length?100*s.unitCount/rows.length:0,
    documentCount:s.docIds.size,keywordHits:s.keywordHits,reviewedUnits:s.reviewedUnits
  })).sort((a,b)=>b.unitCount-a.unitCount||a.name.localeCompare(b.name));
  const words=new Map();
  for(const unit of units){
    for(const raw of unit.text.toLowerCase().match(/[\p{L}][\p{L}\p{M}'-]*/gu)||[]){
      const w=raw.replace(/^['-]+|['-]+$/g,"");
      if(w.length<3||STOPWORDS.has(w))continue;
      words.set(w,(words.get(w)||0)+1);
    }
  }
  const topWords=[...words].map(([word,count])=>({word,count})).
    sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word)).slice(0,20);
  const pairs=new Map();
  for(const row of rows){
    const assigned=[...row.assigned].sort();
    for(let i=0;i<assigned.length;i++)for(let j=i+1;j<assigned.length;j++){
      const key=assigned[i]+" + "+assigned[j];
      pairs.set(key,(pairs.get(key)||0)+1);
    }
  }
  const cooccurrence=[...pairs].map(([codes,units])=>({codes,units})).
    sort((a,b)=>b.units-a.units||a.codes.localeCompare(b.codes));
  const reviewedUnits=rows.filter(r=>r.reviewed).length;
  return {project,units:rows,codeStats,topWords,cooccurrence,
    metrics:{documents:project.documents.length,units:rows.length,codes:project.codes.length,
      codedUnits:rows.filter(r=>r.assigned.length>0).length,reviewedUnits,
      unreviewedUnits:rows.length-reviewedUnits},
    synthetic:project.documents.some(d=>d.origin==="synthetic"),
    notes:[
      "Automatic keyword matches are coding suggestions, not verified themes, validated sentiment, or proof of meaning.",
      "Percentages use all coding units as denominator. A unit may receive multiple codes; code percentages may exceed 100% in total.",
      "Document coverage counts distinct sources with an assigned code; keyword hits count literal matched phrases.",
      "Manual review overrides automatic suggestions for that unit, including when all suggestions are rejected.",
      "No intercoder reliability, causal inference, statistical significance or AI sentiment claims are produced.",
      "Sentence splitting uses approximate punctuation rules and should be reviewed."
    ]};
}
export function saveUnitReview(project,unitId,codes,memo=""){
  const validated=validateContentProject(project),units=segmentDocuments(validated.documents,validated.unit);
  if(!units.some(u=>u.id===unitId))fail("Choose a valid passage.");
  if(!Array.isArray(codes)||new Set(codes).size!==codes.length||
      codes.some(id=>!validated.codes.some(c=>c.id===id)))fail("Review contains invalid codes.");
  validated.reviews[unitId]={codes:[...codes],
    memo:textField(memo,CONTENT_LIMITS.reviewMemoChars,"Research memo",false)};
  return validateContentProject(validated);
}
export function unreviewUnit(project,unitId){
  const validated=validateContentProject(project);
  delete validated.reviews[unitId];return validated;
}
export function addContentDocument(project,doc){
  const validated=validateContentProject(project);
  return validateContentProject({...validated,documents:[...validated.documents,{...doc,origin:doc.origin??"user"}]});
}
export function importContentCsv(raw){
  if(typeof raw!=="string"||byteLength(raw)>CONTENT_LIMITS.fileBytes)fail("CSV must be smaller than 600 KB.");
  const matrix=parseCsv(raw);
  if(matrix.length<2||matrix.length-1>CONTENT_LIMITS.documents)fail("CSV needs a header and 1–150 documents.");
  const header=matrix[0].map(s=>s.trim().toLowerCase().replace(/[\s-]+/g,"_"));
  const find=keys=>header.findIndex(k=>keys.includes(k));
  const idIndex=find(["id","document_id","source_id"]),
    titleIndex=find(["title","document","source","source_title"]),
    textIndex=find(["text","content","transcript","body"]);
  if(textIndex<0)fail("CSV needs a text, content or transcript column.");
  const docs=matrix.slice(1).map((row,i)=>{
    if(row.length!==header.length)fail("CSV row "+(i+2)+" has inconsistent columns.");
    return {id:idIndex>=0&&row[idIndex].trim()?row[idIndex]:"D"+(i+1),
      title:titleIndex>=0&&row[titleIndex].trim()?row[titleIndex]:"Document "+(i+1),
      text:row[textIndex],origin:"user"};
  });
  unique(docs.map(d=>idField(d.id,"Document ID")),"document ID");
  return docs;
}
export function exportContentProject(project){
  const raw=JSON.stringify(validateContentProject(project),null,2);
  if(byteLength(raw)>CONTENT_LIMITS.projectBytes)fail("Project JSON exceeds 1 MB.");
  return raw;
}
export function importContentProject(raw){
  if(typeof raw!=="string"||byteLength(raw)>CONTENT_LIMITS.projectBytes)fail("Project JSON must be below 1 MB.");
  let obj;try{obj=JSON.parse(raw);}catch{fail("Invalid JSON backup.");}
  return validateContentProject(obj);
}
function csvCell(value){
  const s=String(value??""),isFormula=/^\s*[=+@-]/.test(s)&&
    !/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(s);
  return '"'+(isFormula?"'":"")+s.replace(/"/g,'""')+'"';
}
export function codedUnitsCsv(report){
  const header=["Unit ID","Document ID","Source","Unit #","Origin","Text",
    "Suggested codes","Assigned codes","Review status","Research memo"];
  const rows=report.units.map(u=>[u.id,u.docId,u.source,u.position,u.origin,u.text,
    u.suggested.join("; "),u.assigned.join("; "),u.reviewed?"Reviewed":"Suggested only",u.memo]);
  return [header,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
export function codesSummaryCsv(report){
  const header=["Code","Description","Assigned units","% of all units","Documents","Keyword hits","Reviewed units"];
  const rows=report.codeStats.map(x=>[x.name,report.project.codes.find(c=>c.id===x.id)?.description||"",
    x.unitCount,x.percent.toFixed(2)+"%",x.documentCount,x.keywordHits,x.reviewedUnits]);
  return [header,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
function htmlEscape(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
export function chapterFourContentHtml(report){
  const h=htmlEscape;
  const table=report.codeStats.map(s=>"<tr><td>"+h(s.name)+"</td><td>"+s.unitCount+
    "</td><td>"+s.percent.toFixed(1)+"%</td><td>"+s.documentCount+"</td><td>"+
    s.keywordHits+"</td><td>"+s.reviewedUnits+"</td></tr>").join("");
  const excerpts=report.units.filter(u=>u.assigned.length).slice(0,30).map(u=>
    "<p><b>"+h(u.source)+" / "+h(u.id)+"</b> ["+h(u.reviewed?"Reviewed":"Keyword suggestion")+
    "]: "+h(u.assigned.join(", "))+"</p><blockquote>"+h(u.text.slice(0,500))+"</blockquote>").join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>StatLab Content Analysis</title>'+
    '<style>body{font:12pt/1.55 Georgia,serif;max-width:1050px;margin:28px auto;padding:18px;color:#223}'+
    'h1,h2{color:#16425a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:8px;text-align:left}'+
    'blockquote{border-left:3px solid #6a9;padding:8px 14px;background:#f4f8f8}.note{font-size:10pt;color:#567}'+
    '</style></head><body><h1>CHAPTER FOUR — CONTENT ANALYSIS</h1>'+
    '<h2>4.1 Study and Coding Procedure</h2><p>Study: '+h(report.project.title)+
    '</p><p>Unit: '+h(report.project.unit)+'. Documents: '+report.metrics.documents+
    '. Coding units: '+report.metrics.units+'. Manually reviewed: '+report.metrics.reviewedUnits+'.</p>'+
    (report.synthetic?'<p><b>SYNTHETIC EXAMPLE INCLUDED — NOT FIELD DATA.</b></p>':'')+
    '<h2>4.2 Frequencies</h2><table><thead><tr><th>Code</th><th>Coded units</th><th>% of units</th>'+
    '<th>Documents</th><th>Keyword hits</th><th>Reviewed units</th></tr></thead><tbody>'+table+'</tbody></table>'+
    '<h2>4.3 Illustrative Coded Extracts</h2>'+excerpts+
    '<h2>4.4 Limitations</h2>'+report.notes.map(t=>'<p class="note">'+h(t)+'</p>').join("")+
    '<p class="note">All coding suggestions require researcher verification. No reliability or inferential claims.</p></body></html>';
}
