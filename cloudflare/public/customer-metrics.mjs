// Customer survey measures from aggregate frequencies.
// These calculations never infer respondent pairings or fabricate missing records.
export const CUSTOMER_SCALES=Object.freeze({
  csat:Object.freeze(["Very dissatisfied","Dissatisfied","Neutral",
    "Satisfied","Very satisfied"]),
  nps:Object.freeze(Array.from({length:11},(_,i)=>
    i<=6?"Detractor":i<=8?"Passive":"Promoter"))
});
const fail=message=>{throw Error(message);};
function count(raw,label){
  if(typeof raw==="string"&&!/^\d+$/.test(raw.trim()))fail(label+" must be a non-negative integer.");
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<0||n>1_000_000_000)
    fail(label+" must be a whole number between 0 and 1,000,000,000.");
  return n;
}
function round(value){return Math.round((value+Number.EPSILON)*1_000_000)/1_000_000;}
export function customerExample(mode="csat"){
  if(mode==="csat")return [10,15,20,35,20];
  if(mode==="nps")return [2,1,1,2,3,5,6,10,20,30,20];
  fail("Choose CSAT or NPS.");
}
export function analyzeCustomerCounts(mode,counts){
  if(!Object.hasOwn(CUSTOMER_SCALES,mode))fail("Choose CSAT or NPS.");
  const labels=CUSTOMER_SCALES[mode];
  if(!Array.isArray(counts)||counts.length!==labels.length)
    fail(mode.toUpperCase()+" requires exactly "+labels.length+" response frequencies.");
  const values=counts.map((raw,i)=>count(raw,"Rating "+(mode==="csat"?i+1:i)));
  const N=values.reduce((sum,f)=>sum+f,0);
  if(!Number.isSafeInteger(N)||N<=0)fail("Enter at least one valid customer response.");
  const rows=values.map((frequency,i)=>({code:mode==="csat"?i+1:i,
    label:labels[i],frequency,percent:round(frequency*100/N)}));
  const warnings=["Only supplied response frequencies were used; no individual customer records were reconstructed.",
    "This is a descriptive score, not a significance test, a causal explanation, or a representative population estimate.",
    "Missing or unanswered responses are not in this denominator. Report any exclusions and data-collection bias separately."];
  if(mode==="csat"){
    const satisfied=values[3]+values[4],dissatisfied=values[0]+values[1],
      neutral=values[2],score=round(100*satisfied/N);
    return {mode,N,score,measure:"CSAT",range:[0,100],rows,
      groups:{satisfied,dissatisfied,neutral},formula:"CSAT = (rating 4 + rating 5) ÷ valid N × 100",
      interpretation:score.toFixed(1)+"% of valid responses selected Satisfied or Very satisfied.",
      warnings:[...warnings,"CSAT here uses top-two-box ratings (4–5 of 5); other survey scales require a different validated definition."]};
  }
  const detractors=values.slice(0,7).reduce((a,b)=>a+b,0),
    passives=values[7]+values[8],promoters=values[9]+values[10];
  const promoterPercent=100*promoters/N,detractorPercent=100*detractors/N;
  const score=round(promoterPercent-detractorPercent);
  return {mode,N,score,measure:"NPS",range:[-100,100],rows,
    groups:{promoters,passives,detractors},
    groupPercent:{promoters:round(promoterPercent),passives:round(passives*100/N),
      detractors:round(detractorPercent)},
    formula:"NPS = (% rating 9–10 promoters) − (% rating 0–6 detractors)",
    interpretation:"NPS "+(score>0?"+":"")+score.toFixed(1)+" points ("+
      round(promoterPercent).toFixed(1)+"% promoters minus "+
      round(detractorPercent).toFixed(1)+"% detractors).",
    warnings:[...warnings,"NPS is a score in points (−100 to +100), not a percent. Ratings 7–8 are passives."]};
}
function csvEscape(raw){
  const s=String(raw??"");
  const needsProtection=/^\s*[=+@-]/.test(s)&&
    !/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(s);
  return '"'+(needsProtection?"'":"")+s.replace(/"/g,'""')+'"';
}
export function customerMetricsCsv(report){
  if(!report||!["csat","nps"].includes(report.mode)||!Array.isArray(report.rows))
    fail("Run a customer score analysis before exporting.");
  const lines=[["Metric",report.measure],["Valid N",report.N],["Score",report.score],
    ["Calculation",report.formula],["Rating","Label","Frequency","Percent of valid N"],
    ...report.rows.map(r=>[r.code,r.label,r.frequency,r.percent.toFixed(2)+"%"]),
    ["Limitations",report.warnings.join(" ")],["Data source","User-entered frequencies; not independently verified"]];
  return lines.map(x=>x.map(csvEscape).join(",")).join("\r\n")+"\r\n";
}
