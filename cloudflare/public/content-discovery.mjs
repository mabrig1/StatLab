// Assisted Content Analysis: local recurring phrase discovery and source-code matrix.
// No inference model, external API calls or hidden document uploads.
import {validateContentProject} from "./content-analysis.mjs";

const STOPWORDS=new Set(("a an the and but or in on for of at to with by as from into across after before between"+
" this that these those they them their we our us you your my his her she he it its is are was were be been"+
" being have has had do does did could would should may might can will nor not no yes some any all each many"+
" much very one two more most such then than so if who which whose what where when how why i me am"+
" about during over under out up down here there using used use via per now today tomorrow yesterday"+
" said says say like also just only already through however therefore both either neither"+
" themself ourselves itself yourself themselves something nothing things thing").split(/\s+/));
const MAX_CANDIDATES=100, MAX_NGRAMS=30000, MAX_UNIT_TOKENS=6000;
const fail=message=>{throw Error(message);};
const escCsv=value=>{
  const v=String(value??"");
  const possibleFormula=/^\s*[=+@-]/.test(v)&&!/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(v);
  return '"'+(possibleFormula?"'":"")+v.replace(/"/g,'""')+'"';
};
const words=text=>[...String(text).toLowerCase().matchAll(/[\p{L}][\p{L}\p{M}\p{N}'’-]*/gu)]
  .map(match=>({token:match[0].replace(/^['’\-]+|['’\-]+$/g,""),start:match.index}));
const meaningful=s=>s.length>=3&&!STOPWORDS.has(s)&&/[\p{L}]/u.test(s)&&
  !/^\d+$/.test(s)&&!/\d{6,}/.test(s)&&!s.includes("@");

function validOptions(options={}){
  const minUnits=Number(options.minUnits??2),
    minDocuments=Number(options.minDocuments??1),
    maxWords=Number(options.maxWords??3),
    limit=Number(options.limit??24);
  for(const [name,n,min,max] of [["Minimum units",minUnits,1,1000],
    ["Minimum documents",minDocuments,1,150],["Words per phrase",maxWords,1,3],
    ["Result limit",limit,1,MAX_CANDIDATES]]){
    if(!Number.isInteger(n)||n<min||n>max)fail(name+" must be between "+min+" and "+max+".");
  }
  return {minUnits,minDocuments,maxWords,limit,
    excludeExisting:options.excludeExisting!==false};
}
function snippetAround(text,phrase){
  const source=String(text),index=source.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  if(index<0)return source.slice(0,210);
  const start=Math.max(0,index-65),end=Math.min(source.length,index+phrase.length+95);
  return (start>0?"…":"")+source.slice(start,end)+(end<source.length?"…":"");
}
export function discoverPhrases(report,options={}){
  if(!report||!Array.isArray(report.units)||!report.project||!Array.isArray(report.project.codes))
    fail("Analyze the document collection before discovering phrases.");
  const config=validOptions(options);
  const current=new Set(report.project.codes.flatMap(c=>c.keywords.map(k=>k.toLowerCase().trim())));
  const bag=new Map();
  let reachedLimit=false;
  for(const unit of report.units){
    const tokens=words(unit.text).slice(0,MAX_UNIT_TOKENS),once=new Set();
    for(let i=0;i<tokens.length;i++){
      if(!meaningful(tokens[i].token))continue;
      for(let n=1;n<=config.maxWords&&i+n<=tokens.length;n++){
        const window=tokens.slice(i,i+n);
        if(window.some(w=>!meaningful(w.token)))break;
        const phrase=window.map(w=>w.token).join(" ");
        if(config.excludeExisting&&current.has(phrase))continue;
        if(phrase.length>85)continue;
        if(!bag.has(phrase)){
          if(bag.size>=MAX_NGRAMS){reachedLimit=true;break;}
          bag.set(phrase,{phrase,unitIds:new Set(),documentIds:new Set(),
            evidence:[],occurrences:0,words:n});
        }
        const entry=bag.get(phrase);
        entry.occurrences++;
        if(!once.has(phrase)){
          entry.unitIds.add(unit.id);entry.documentIds.add(unit.docId);
          if(entry.evidence.length<3)entry.evidence.push({
            documentId:unit.docId,unitId:unit.id,source:unit.source,
            excerpt:snippetAround(unit.text,phrase)
          });
          once.add(phrase);
        }
      }
      if(reachedLimit)break;
    }
    if(reachedLimit)break;
  }
  const candidates=[...bag.values()]
    .filter(c=>c.unitIds.size>=config.minUnits&&c.documentIds.size>=config.minDocuments)
    .map(c=>({phrase:c.phrase,unitCount:c.unitIds.size,
      documentCount:c.documentIds.size,occurrences:c.occurrences,
      words:c.words,evidence:c.evidence,
      // Not a statistical model: prioritize cross-source and multi-unit recurrence.
      rank:c.unitIds.size*2+c.documentIds.size*3+Math.min(c.words,3)*0.5}))
    .sort((a,b)=>b.rank-a.rank||b.documentCount-a.documentCount||
      b.unitCount-a.unitCount||a.phrase.localeCompare(b.phrase))
    .slice(0,config.limit);
  return {candidates,config,scannedUnits:report.units.length,
    totalCandidates:bag.size,partialScan:reachedLimit,
    notes:"Literal recurring phrases only. Candidate recurrence does not establish an emergent theme, sentiment or meaning."};
}
function codeId(phrase,codes){
  const base="T_"+phrase.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,54)||"TOPIC";
  const existing=new Set(codes.map(c=>c.id.toUpperCase()));
  if(!existing.has(base))return base;
  for(let i=2;i<10000;i++){
    const name=base.slice(0,54)+"_"+i;
    if(!existing.has(name))return name;
  }
  fail("No available code ID.");
}
export function addDiscoveredPhraseAsCode(project,candidate){
  const valid=validateContentProject(project);
  if(!candidate||typeof candidate.phrase!=="string"||!candidate.phrase.trim()||
    candidate.phrase.length>85)fail("Choose a valid recurring phrase.");
  if(valid.codes.length>=35)fail("The codebook already has 35 codes.");
  const phrase=candidate.phrase.trim().toLowerCase();
  if(valid.codes.some(c=>c.keywords.some(k=>k.toLowerCase()===phrase)))
    fail("This phrase is already defined in the codebook.");
  const newCode={id:codeId(phrase,valid.codes),name:phrase.replace(/^./,c=>c.toUpperCase()),
    description:"Draft category from repeated literal phrasing; researcher must define the meaning and review passages.",
    keywords:[phrase]};
  const revised=validateContentProject({...valid,codes:[...valid.codes,newCode]});
  return {project:revised,code:newCode};
}
export function sourceCodeMatrix(report){
  if(!report||!report.project||!Array.isArray(report.units)||!Array.isArray(report.project.documents))
    fail("Analyze content before building a source-code matrix.");
  const codes=report.project.codes.map(c=>({id:c.id,name:c.name}));
  const rows=report.project.documents.map(d=>{
    const units=report.units.filter(u=>u.docId===d.id);
    const stats=Object.fromEntries(codes.map(c=>[c.id,
      units.filter(u=>u.assigned.includes(c.id)).length]));
    return {documentId:d.id,title:d.title,origin:d.origin,units:units.length,
      reviewed:units.filter(u=>u.reviewed).length,
      counts:stats};
  });
  return {codes,rows,unit:report.project.unit,
    note:"Counts show coded units per source, not numbers of people or statistical effects."};
}
export function sourceMatrixCsv(report){
  const matrix=sourceCodeMatrix(report),head=["Source ID","Title","Origin","Units","Reviewed units",
    ...matrix.codes.map(c=>"Code: "+c.name)];
  const records=matrix.rows.map(row=>[row.documentId,row.title,row.origin,row.units,row.reviewed,
    ...matrix.codes.map(c=>row.counts[c.id]||0)]);
  return [head,...records].map(row=>row.map(escCsv).join(",")).join("\r\n")+"\r\n";
}
export function discoveredPhrasesCsv(discovery){
  if(!discovery||!Array.isArray(discovery.candidates))fail("Find phrases before exporting them.");
  const head=["Suggested phrase (UNREVIEWED)","Units containing phrase","Distinct documents",
    "Literal occurrences","Example source","Example unit"];
  const rows=discovery.candidates.map(c=>[c.phrase,c.unitCount,c.documentCount,
    c.occurrences,c.evidence[0]?.source||"",c.evidence[0]?.unitId||""]);
  return [head,...rows].map(row=>row.map(escCsv).join(",")).join("\r\n")+"\r\n";
}
export function buildOptionalAiPrompt(report,{includePhrases=false,discovery=null}={}){
  if(!report?.metrics||!Array.isArray(report.codeStats))fail("Run content analysis before drafting the prompt.");
  if(typeof includePhrases!=="boolean")fail("Choose whether to include recurring phrases.");
  const safeStats=report.codeStats.slice(0,25).map(s=>
    "- "+s.id+" ("+s.name+"): "+s.unitCount+" assigned units; "+
    s.percent.toFixed(1)+"% of coding units; "+s.reviewedUnits+" manually reviewed units.").join("\n");
  let prompt="You are a qualitative research methodology assistant. Use ONLY the summary below. "+
    "Provide a cautious interpretation of distribution patterns, methodological limitations, "+
    "and specific questions the researcher should check against actual source documents. "+
    "Do NOT fabricate quotes, themes, respondent identities, reliability statistics, causal effects, "+
    "p-values, or verified claims. Unreviewed keyword suggestions are not validated human coding.\n\n"+
    "SOURCE: An aggregate count summary manually copied from MABRIG StatLab. "+
    "This prompt excludes complete transcripts and original excerpts.\n"+
    "Unit of analysis: "+report.project.unit+"\n"+
    "Number of source documents: "+report.metrics.documents+"\n"+
    "Number of coding units: "+report.metrics.units+"\n"+
    "Manually reviewed units: "+report.metrics.reviewedUnits+"\n"+
    "Units still unreviewed: "+report.metrics.unreviewedUnits+"\n"+
    "Researcher-defined code frequencies:\n"+safeStats+"\n";
  if(includePhrases){
    if(!discovery||!Array.isArray(discovery.candidates))
      fail("Discover phrases before choosing to include them in an optional AI prompt.");
    prompt+="\nOPTIONAL UNREVIEWED PHRASES (may contain sensitive source details; inspect before sharing):\n"+
      discovery.candidates.slice(0,12).map(c=>"- "+c.phrase+" ("+c.unitCount+
        " units; "+c.documentCount+" sources)").join("\n")+"\n";
  }
  prompt+="\nReturn an evidence-aware checklist and suggestions for strengthening manual coding. "+
    "State that these numbers are descriptive, and recommend further review before reporting themes.";
  if(prompt.length>11000)fail("AI prompt is too large.");
  return prompt;
}
