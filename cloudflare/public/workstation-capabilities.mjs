// StatLab v1 foundations — explicit capability registry for the Cloudflare browser edition.
// This is a descriptive product boundary, not a license or claim of IBM SPSS equivalence.
export const WORKSTATION_VERSION="v1.0 foundation";
export const EXECUTION_MODES=Object.freeze({
  browser:"Runs in this browser without sending analysis data to a server.",
  local_python:"Available only when the separate FastAPI application is run locally; not in the Cloudflare Worker.",
  planned:"Design target; not implemented or usable yet."
});
export const WORKSTATION_FEATURES=Object.freeze([
  {id:"data",title:"Data View & Variable View",category:"academic",status:"browser",
    description:"Edit respondent records, define variables and save local browser projects.",
    action:"Open Data View",view:"data"},
  {id:"likert",title:"Likert Scale Studio",category:"academic",status:"browser",
    description:"Analyze counts or valid coded columns with honest single-item descriptives.",
    action:"Analyze a questionnaire",view:"likert"},
  {id:"frequency",title:"Frequency-only analysis",category:"academic",status:"browser",
    description:"Use response counts directly; never reconstruct respondent records.",
    action:"Analyze frequency counts",view:"frequency"},
  {id:"content",title:"Content Analysis Studio",category:"academic",status:"browser",
    description:"Code text, review passages and export documented theme frequencies.",
    action:"Code research documents",view:"content"},
  {id:"apa",title:"APA-style Likert tables",category:"academic",status:"browser",
    description:"Export research-objective tables with APA-inspired rules and methodology notes.",
    action:"Open Likert tables",view:"likert"},
  {id:"business",title:"Business Analytics",category:"business",status:"browser",
    description:"Import sales totals, inspect revenue, gross profit and export infographics.",
    action:"Open business dashboard",view:"business"},
  {id:"customer",title:"CSAT & NPS scorecards",category:"business",status:"browser",
    description:"Compute satisfaction and recommendation scores from supplied frequency counts.",
    action:"Open customer metrics",view:"business"},
  {id:"inferential",title:"Correlations, regression & group tests",category:"academic",status:"local_python",
    description:"Available in the separate local FastAPI workstation with real paired records."},
  {id:"factor",title:"Factor analysis & validated power calculations",category:"academic",status:"planned",
    description:"Proposed advanced methods with assumption checks and independent references."},
  {id:"desktop",title:"Native offline desktop package",category:"shared",status:"planned",
    description:"Tauri/Electron package, update signing and local Python lifecycle need further work."},
  {id:"sync",title:"Encrypted optional multi-device sync",category:"shared",status:"planned",
    description:"Optional future feature; no default cloud storage or unencrypted sync."},
  {id:"plugins",title:"Versioned analysis plugins",category:"shared",status:"planned",
    description:"Future capability manifest and isolated extension API with regression fixtures."}
]);
export function capabilitiesFor(category){
  if(!["academic","business","shared"].includes(category))throw Error("Unknown workspace category.");
  return WORKSTATION_FEATURES.filter(f=>f.category===category);
}
export function featureById(id){return WORKSTATION_FEATURES.find(x=>x.id===id)||null;}
export function capabilityCounts(){
  return WORKSTATION_FEATURES.reduce((o,f)=>(o[f.status]++,o),
    {browser:0,local_python:0,planned:0});
}
