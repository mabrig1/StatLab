// Workstation home renders capability boundaries from a single explicit registry.
// Navigation is delegated to the existing browser workspace tabs.
import {WORKSTATION_VERSION,EXECUTION_MODES,capabilitiesFor} from "./workstation-capabilities.mjs";

const byId=id=>document.getElementById(id);
const node=(tag,text,cls)=>{
  const e=document.createElement(tag);
  if(text!==undefined&&text!==null)e.textContent=String(text);
  if(cls)e.className=cls;
  return e;
};
const STATUS={browser:["Available here","ws-available"],
  local_python:["Local Python only","ws-local"],
  planned:["Planned","ws-planned"]};
const CATEGORIES={
  academic:{title:"Academic research tools",description:"Workflows for questionnaire research, codebooks, and responsibly presented findings."},
  business:{title:"Business and consulting tools",description:"Evidence-based performance and customer feedback, without invented records or claims."}
};
function navigate(view){
  const tab=document.querySelector('[data-workspace-view="'+view+'"]');
  if(!tab)throw Error("Requested tool is unavailable in this browser.");
  tab.click();
}
function render(category){
  const setting=CATEGORIES[category];
  if(!setting)throw Error("Unknown work area.");
  byId("ws-tools-title").textContent=setting.title;
  byId("ws-tools-description").textContent=setting.description;
  for(const kind of ["academic","business"]){
    byId("ws-"+kind).classList.toggle("active",kind===category);
    byId("ws-"+kind).setAttribute("aria-pressed",kind===category?"true":"false");
  }
  const container=byId("ws-capabilities");container.replaceChildren();
  for(const feature of capabilitiesFor(category)){
    const card=node("article",null,"ws-feature");
    const top=node("div",null,"ws-feature-top");
    const status=STATUS[feature.status];
    top.append(node("span",feature.title,"ws-feature-title"),
      node("span",status[0],"ws-feature-badge "+status[1]));
    card.append(top,node("p",feature.description,"ws-feature-description"));
    if(feature.status==="browser" && feature.href){
      const link=node("a",feature.action,"ws-launch");
      link.href=feature.href;
      link.target="_blank";
      link.rel="noopener";
      card.append(link);
    }else if(feature.status==="browser"&&feature.view){
      const button=node("button",feature.action,"ws-launch");
      button.type="button";button.addEventListener("click",()=>navigate(feature.view));
      card.append(button);
    }else{
      card.append(node("small",EXECUTION_MODES[feature.status],"ws-feature-notice"));
    }
    container.append(card);
  }
  const versions=node("p",WORKSTATION_VERSION+" · Capabilities are separate between the browser and local Python editions.","ws-version-note");
  container.append(versions);
}
byId("ws-academic").addEventListener("click",()=>render("academic"));
byId("ws-business").addEventListener("click",()=>render("business"));
render("academic");
