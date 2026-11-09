import {DEFAULT_SCALE,DEFAULT_COUNTS,analyzeFrequencies,toSummaryCsv} from "./statistics.mjs";
const byId=id=>document.getElementById(id);
const scale=byId("scale"),counts=byId("counts"),error=byId("error");
let results=[];
function textNode(name,value,className){
  const el=document.createElement(name);el.textContent=String(value);
  if(className)el.className=className;return el;
}
function render(items){
  const table=byId("summary"),details=byId("details");table.replaceChildren();details.replaceChildren();
  for(const r of items){
    const row=document.createElement("tr");
    [r.item,r.N,r.mean.toFixed(3),r.sd===null?"N/A":r.sd.toFixed(3),r.median.toFixed(2),r.modes.join(" / "),r.top]
      .forEach(value=>row.append(textNode("td",value)));
    table.append(row);
    const section=textNode("section","","detail");
    section.append(textNode("h3",r.item),textNode("p",r.interpretation));
    for(const category of r.rows){
      const line=textNode("div","","bar");
      line.append(textNode("span",category.label));
      const track=textNode("div","","track"),fill=textNode("div","","fill");
      fill.style.width=category.percent.toFixed(2)+"%";track.append(fill);line.append(track);
      line.append(textNode("span",category.count+" ("+category.percent.toFixed(1)+"%)"));section.append(line);
    }
    const sdDivisor=r.sdMethod==="sample"?r.N-1:r.N;
    const formula="Mean = Σ(f × code)/N = "+r.weightedSum.toFixed(3)+"/"+r.N+" = "+r.mean.toFixed(3)+
      "; "+r.sdMethod+" SD = √[Σf(code − mean)² / "+sdDivisor+"] = "+
      (r.sd===null?"not defined for sample N < 2":r.sd.toFixed(3));
    section.append(textNode("p",formula,"formula"));details.append(section);
  }
  byId("results").hidden=false;
}
function run(){
  error.textContent="";
  try{
    results=analyzeFrequencies(counts.value,scale.value,{reversed:byId("reverse").checked,sdMethod:byId("method").value});
    render(results);
  }catch(err){byId("results").hidden=true;results=[];error.textContent=err.message;}
}
byId("analyze").addEventListener("click",run);
byId("sample").addEventListener("click",()=>{
  scale.value=DEFAULT_SCALE;counts.value=DEFAULT_COUNTS;
  byId("reverse").checked=false;byId("method").value="sample";run();
});
byId("csv").addEventListener("click",()=>{
  if(!results.length)return;
  const url=URL.createObjectURL(new Blob([toSummaryCsv(results)],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="statlab-frequency-summary.csv";link.click();
  URL.revokeObjectURL(url);
});
run();
