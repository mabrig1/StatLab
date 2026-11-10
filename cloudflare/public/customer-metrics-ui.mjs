import {CUSTOMER_SCALES,customerExample,analyzeCustomerCounts,
  customerMetricsCsv} from "./customer-metrics.mjs";
const byId=id=>document.getElementById(id);
const element=(tag,text,cls)=>{
  const node=document.createElement(tag);
  if(text!==undefined&&text!==null)node.textContent=String(text);
  if(cls)node.className=cls;
  return node;
};
const state={mode:"csat",report:null,inputs:[]};
function clearResult(){
  state.report=null;byId("cm-results").hidden=true;
  byId("cm-error").textContent="";
}
function drawFields(counts=null){
  clearResult();
  const labels=CUSTOMER_SCALES[state.mode];
  const grid=byId("cm-entry-grid");grid.replaceChildren();state.inputs=[];
  labels.forEach((label,i)=>{
    const row=element("label",null,"cm-field");
    const code=state.mode==="csat"?i+1:i;
    const text=state.mode==="csat"?code+" — "+label:code+" — "+label;
    row.append(element("span",text));
    const input=element("input");
    input.type="number";input.min="0";input.step="1";input.inputMode="numeric";
    input.placeholder="0";input.value=counts?String(counts[i]):"";
    input.setAttribute("aria-label","Number of responses with rating "+code);
    input.addEventListener("input",clearResult);
    state.inputs.push(input);row.append(input);grid.append(row);
  });
  byId("cm-explain").textContent=state.mode==="csat"?
    "Count how many selected each answer from Very dissatisfied (1) to Very satisfied (5).":
    "Enter how many rated likelihood to recommend from 0 to 10. Ratings 0–6 are detractors; 7–8 passives; 9–10 promoters.";
}
function calculate(){
  try{
    const counts=state.inputs.map((input,i)=>{
      if(!input.value.trim())throw Error("Enter each rating count, including 0 when nobody chose it (rating "+
        (state.mode==="csat"?i+1:i)+").");
      return input.value.trim();
    });
    const report=analyzeCustomerCounts(state.mode,counts);
    state.report=report;byId("cm-error").textContent="";
    byId("cm-result-title").textContent=report.measure+" = "+
      (report.measure==="NPS"?(report.score>0?"+":"")+report.score.toFixed(1)+" points":
        report.score.toFixed(1)+"%");
    byId("cm-result-interpretation").textContent=report.interpretation;
    const cards=byId("cm-metrics");cards.replaceChildren();
    const metrics=report.mode==="csat"?
      [["Valid responses",report.N],["Satisfied (4–5)",report.groups.satisfied],
       ["Neutral (3)",report.groups.neutral],["Dissatisfied (1–2)",report.groups.dissatisfied]]:
      [["Valid responses",report.N],["Promoters (9–10)",report.groups.promoters],
       ["Passives (7–8)",report.groups.passives],["Detractors (0–6)",report.groups.detractors]];
    for(const [label,value] of metrics){
      const card=element("div",null,"cm-metric");
      card.append(element("span",label),element("strong",value.toLocaleString()));cards.append(card);
    }
    const tbody=byId("cm-breakdown");tbody.replaceChildren();
    for(const row of report.rows){
      const tr=element("tr");
      for(const value of [row.code,row.label,row.frequency,row.percent.toFixed(1)+"%"])
        tr.append(element("td",value));
      tbody.append(tr);
    }
    byId("cm-limitations").textContent=report.formula+". "+
      report.warnings.join(" ");
    byId("cm-results").hidden=false;
    byId("cm-results").scrollIntoView({behavior:"smooth",block:"nearest"});
  }catch(error){clearResult();byId("cm-error").textContent=error.message;}
}
function downloadCsv(){
  if(!state.report)return;
  const blob=new Blob([customerMetricsCsv(state.report)],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=element("a");
  link.href=url;link.download="statlab-"+state.report.mode+"-scorecard.csv";
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelectorAll('input[name="cm-mode"]').forEach(input=>{
  input.addEventListener("change",()=>{
    if(input.checked){state.mode=input.value;drawFields();}
  });
});
byId("cm-calculate").addEventListener("click",calculate);
byId("cm-clear").addEventListener("click",()=>drawFields());
byId("cm-example").addEventListener("click",()=>drawFields(customerExample(state.mode)));
byId("cm-export").addEventListener("click",downloadCsv);
drawFields();
