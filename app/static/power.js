/* StatLab local power planning UI — no dataset uploads or cloud storage. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const methodText={
  one_sample_t:"Estimate the completed sample for a two-sided one-sample t test. Assumed effect is Cohen's d: expected mean difference / population SD.",
  paired_t:"Estimate the number of matched pairs needed. Cohen's d_z uses the mean within-person difference divided by the SD of differences.",
  independent_t:"Plan two independent groups using a pooled-variance t test and Cohen's d. This is NOT an exact Welch unequal-variance power calculation.",
  anova_one_way:"Plan a balanced, fixed-effects one-way ANOVA using assumed Cohen's f. Completed N is rounded to equal group sizes.",
  two_proportions:"Plan two independent proportions with an asymptotic normal z-test and Cohen's h derived from explicit assumed probabilities. Not valid as an exact rare-event test."
};
let currentPayload=null,currentResult=null;
function el(tag,content,className=""){
  const x=document.createElement(tag);
  if(content!==undefined&&content!==null)x.textContent=String(content);
  if(className)x.className=className;
  return x;
}
function setError(message=""){$("power-error").textContent=message;}
function invalidate(){
  currentResult=null;currentPayload=null;
  $("power-results").hidden=true;
  setError();
}
function toggle(){
  const family=$("power-family").value,prop=family==="two_proportions";
  $("power-effect-wrap").hidden=prop;
  $("power-proportion-1-wrap").hidden=!prop;
  $("power-proportion-2-wrap").hidden=!prop;
  $("power-ratio-wrap").hidden=!["independent_t","two_proportions"].includes(family);
  $("power-groups-wrap").hidden=family!=="anova_one_way";
  $("power-effect").required=!prop;
  $("power-proportion-1").required=prop;$("power-proportion-2").required=prop;
  $("power-method-help").textContent=methodText[family];
  $("power-effect-help").textContent=family==="anova_one_way"?
    "Cohen's f (not d or η²); justify the expected standardized spread in group means.":
    family==="paired_t"?
    "Paired Cohen's d_z = mean paired difference ÷ SD of paired differences.":
    family==="one_sample_t"?
    "Cohen's d = expected mean difference from null ÷ expected SD.":
    "Cohen's d = expected difference in means ÷ pooled within-group SD.";
  invalidate();
}
function readNumber(id,description){
  const input=$(id),raw=input.value.trim();
  if(!raw)throw Error("Enter "+description+".");
  const n=Number(raw);
  if(!Number.isFinite(n))throw Error("Use a finite number for "+description+".");
  if(!input.checkValidity())throw Error("Check the allowed range for "+description+".");
  return n;
}
function payload(){
  const test_family=$("power-family").value;
  const req={
    test_family,
    alpha:readNumber("power-alpha","alpha"),
    target_power:readNumber("power-target","target power"),
    attrition_percent:readNumber("power-attrition","attrition percentage")
  };
  if(test_family==="two_proportions"){
    req.proportion_1=readNumber("power-proportion-1","Group 1 assumed proportion");
    req.proportion_2=readNumber("power-proportion-2","Group 2 assumed proportion");
  }else req.effect_size=readNumber("power-effect","a justified effect size");
  if(["independent_t","two_proportions"].includes(test_family))
    req.allocation_ratio=readNumber("power-ratio","Group 2 / Group 1 allocation ratio");
  if(test_family==="anova_one_way")
    req.groups=readNumber("power-groups","ANOVA group count");
  return req;
}
function friendlyCount(n){return Number(n).toLocaleString();}
function metric(name,value,caption){
  const card=el("article",null,"power-kpi");
  card.append(el("small",name),el("strong",value),el("span",caption));
  return card;
}
function addGroupRows(container,obj,heading){
  container.append(el("h4",heading));
  const list=el("dl",null,"power-distribution");
  for(const [key,value] of Object.entries(obj)){
    const label={
      participants:"Participants",complete_pairs:"Complete matched pairs",
      group_1:"Group 1",group_2:"Group 2",per_group:"Participants per group",
      groups:"Number of groups"
    }[key]||key;
    list.append(el("dt",label),el("dd",friendlyCount(value)));
  }
  container.append(list);
}
function draw(result){
  const cards=$("power-kpis");cards.replaceChildren();
  cards.append(
    metric("Completed observations",friendlyCount(result.completed_total),
      "Minimum planned usable sample under assumptions"),
    metric("Recruitment target",friendlyCount(result.recruitment_total),
      "Includes assumed attrition, rounded by group"),
    metric("Target power",(100*result.target_power).toFixed(1)+"%",
      "Chosen design goal, not a study finding"),
    metric("Verified design power",(100*result.planned_power).toFixed(2)+"%",
      "Calculated for rounded completion targets")
  );
  $("power-assumptions-summary").textContent="Two-sided "+result.test_family.replaceAll("_"," ")+
    " • α = "+result.alpha+" • "+result.effect_size_definition+" = "+
    result.effect_size+" • Researcher-defined assumptions";
  const groups=$("power-group-summary");groups.replaceChildren();
  addGroupRows(groups,result.completed,"Completed sample distribution");
  addGroupRows(groups,result.recruitment,"Recruitment allocation with attrition");
  const notes=$("power-warnings");notes.replaceChildren();
  for(const warning of result.assumptions)notes.append(el("li",warning));
  $("power-results").hidden=false;
  $("power-results").scrollIntoView({behavior:"smooth",block:"start"});
}
function errorText(raw){
  if(typeof raw==="string")return raw;
  if(raw?.detail && typeof raw.detail==="string")return raw.detail;
  if(Array.isArray(raw?.detail))return raw.detail.map(d=>d.msg||"Invalid input").slice(0,5).join("; ");
  return "The plan could not be completed. Verify your study assumptions.";
}
async function request(url,settings){
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",...settings});
  if(!response.ok){
    let raw;try{raw=await response.json();}catch{raw=null;}
    throw Error(errorText(raw)||"Request failed ("+response.status+").");
  }
  return response;
}
async function calculate(event){
  event.preventDefault();
  const button=$("power-calculate");
  invalidate();
  try{
    const proposed=payload();
    button.disabled=true;button.textContent="Calculating validated sample size…";
    const response=await request("/api/power/sample-size",{body:JSON.stringify(proposed)});
    const result=await response.json();
    if(result.kind!=="a_priori_power_plan"||!Number.isFinite(result.completed_total)||
      !Number.isFinite(result.planned_power))
      throw Error("Unexpected planning response. Review the local server.");
    currentResult=result;currentPayload=proposed;
    draw(result);
  }catch(error){setError(error.message);}
  finally{button.disabled=false;button.textContent="Calculate proposed sample size →";}
}
async function download(){
  if(!currentPayload||!currentResult)return;
  $("power-download").disabled=true;
  try{
    const response=await request("/api/power/report.html",{body:JSON.stringify(currentPayload)});
    const blob=await response.blob();
    const objectUrl=URL.createObjectURL(blob),a=el("a");
    a.href=objectUrl;a.download="statlab-a-priori-power-plan.html";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1800);
  }catch(error){setError(error.message);}
  finally{$("power-download").disabled=false;}
}
$("power-form").addEventListener("submit",calculate);
$("power-form").addEventListener("input",invalidate);
$("power-family").addEventListener("change",toggle);
$("power-download").addEventListener("click",download);
toggle();
})();