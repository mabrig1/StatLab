// All survey calculations run locally in the browser. No network access.
export const DEFAULT_SCALE="1 = Strongly Disagree\n2 = Disagree\n3 = Neutral\n4 = Agree\n5 = Strongly Agree";
export const DEFAULT_COUNTS="Item 5:\nStrongly Disagree = 30\nDisagree = 23\nNeutral = 20\nAgree = 45\nStrongly Agree = 35\nTotal N = 153";

export function parseScale(raw){
  if(typeof raw!=="string"||!raw.trim()) throw Error("Define your scale labels first.");
  const map=new Map();
  for(const line of raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
    const row=line.match(/^(-?\d+(?:\.\d+)?)\s*(?:=|:|,)\s*(.+)$/);
    if(!row) throw Error('Use scale definitions such as "1 = Strongly Disagree".');
    const code=Number(row[1]),label=row[2].trim();
    if(!Number.isFinite(code)||!label||map.has(code)) throw Error("Scale codes must be unique numeric values.");
    if([...map.values()].some(x=>x.toLowerCase()===label.toLowerCase())) throw Error("Scale labels must be unique.");
    map.set(code,label);
  }
  if(map.size<2||map.size>11) throw Error("Choose between 2 and 11 scale categories.");
  return [...map].sort((a,b)=>a[0]-b[0]).map(([code,label])=>({code,label}));
}

function inputRows(raw){
  if(typeof raw!=="string"||!raw.trim()) throw Error("Paste item frequencies first.");
  const data=raw.trim();
  if(data[0]==="{"){
    let parsed;
    try{parsed=JSON.parse(data)}catch{throw Error("Cannot read the pasted JSON dictionary.");}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) throw Error("Use a JSON dictionary keyed by item.");
    return Object.entries(parsed).map(([item,frequencies])=>{
      if(!frequencies||typeof frequencies!=="object"||Array.isArray(frequencies)) throw Error("Each JSON item needs a frequency dictionary.");
      return {item,rows:Object.entries(frequencies).map(([label,count])=>({label,count}))};
    });
  }
  const lines=data.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(/^(item|question)\s*,/i.test(lines[0])){
    const headers=lines[0].split(",").map(x=>x.trim());
    return lines.slice(1).map(line=>{
      const cells=line.split(",").map(x=>x.trim());
      if(cells.length!==headers.length) throw Error("CSV row width differs from the header.");
      return {item:cells[0],rows:headers.slice(1).map((label,i)=>({label,count:cells[i+1]}))};
    });
  }
  const items=[];let current={item:"Item 1",rows:[]};
  for(const line of lines){
    const heading=line.match(/^((?:item|question|q)\s*[\w.-]+)(?:\s*\([^)]*\))?\s*:?\s*$/i);
    if(heading){if(current.rows.length)items.push(current);current={item:heading[1],rows:[]};continue;}
    const pair=line.match(/^(.+?)\s*(?:=|:)\s*(\d+)\s*$/);
    if(!pair) throw Error('Cannot read "'+line.slice(0,80)+'"; use "Agree = 45".');
    current.rows.push({label:pair[1].trim(),count:Number(pair[2])});
  }
  if(current.rows.length)items.push(current);
  return items;
}

function position(sorted,target){
  let acc=0;
  for(const r of sorted){acc+=r.count;if(acc>=target)return r.score;}
  throw Error("Invalid median position.");
}

export function analyzeFrequencies(raw,scaleText,{reversed=false,sdMethod="sample"}={}){
  const scale=parseScale(scaleText),items=inputRows(raw);
  if(!items.length||items.length>100) throw Error("Analyze 1 to 100 items at a time.");
  if(!["sample","population"].includes(sdMethod)) throw Error("SD method must be sample or population.");
  const used=new Set(),output=[];
  for(const item of items){
    const title=String(item.item||"").trim();
    if(!title||title.length>100||used.has(title.toLowerCase())) throw Error("Every item must have a unique, short title.");
    used.add(title.toLowerCase());
    const counts=new Map();let suppliedTotal=null;
    for(const record of item.rows){
      const label=String(record.label||"").trim();
      const count=Number(record.count);
      if(!Number.isSafeInteger(count)||count<0) throw Error(title+": frequencies must be nonnegative integers.");
      if(/^total(?:\s*n)?$/i.test(label)){
        if(suppliedTotal!==null) throw Error(title+": repeated Total N.");
        suppliedTotal=count;continue;
      }
      const match=scale.find(x=>String(x.code)===label||x.label.toLowerCase()===label.toLowerCase());
      if(!match) throw Error(title+": unknown response "+label+".");
      if(counts.has(match.code)) throw Error(title+": duplicate response "+label+".");
      counts.set(match.code,count);
    }
    const N=[...counts.values()].reduce((a,b)=>a+b,0);
    if(!N) throw Error(title+": no responses supplied.");
    if(suppliedTotal!==null&&suppliedTotal!==N) throw Error(title+": Total N ("+suppliedTotal+") differs from the frequency sum ("+N+").");
    const rows=scale.map((x,index)=>({
      label:x.label,originalCode:x.code,count:counts.get(x.code)||0,
      score:reversed?scale[scale.length-1-index].code:x.code
    }));
    const weightedSum=rows.reduce((a,r)=>a+r.count*r.score,0);
    const mean=weightedSum/N;
    const squaredSum=rows.reduce((a,r)=>a+r.count*(r.score-mean)**2,0);
    const divisor=sdMethod==="sample"?N-1:N;
    const sd=divisor>0?Math.sqrt(squaredSum/divisor):null;
    const sorted=[...rows].sort((a,b)=>a.score-b.score);
    const median=(position(sorted,Math.floor((N+1)/2))+position(sorted,Math.ceil((N+1)/2)))/2;
    const peak=Math.max(...rows.map(x=>x.count));
    const modes=rows.filter(x=>x.count===peak).map(x=>x.score);
    const top=rows.filter(x=>x.count===peak).map(x=>x.label).join(" / ");
    const midpoint=(scale[0].code+scale[scale.length-1].code)/2;
    const relation=Math.abs(mean-midpoint)<1e-10?"at":mean>midpoint?"above":"below";
    const interpretation="Mean "+mean.toFixed(2)+" is "+relation+" the numeric scale midpoint ("+midpoint+
      "); most common original response: "+top+" ("+(100*peak/N).toFixed(1)+"%)."+
      (reversed?" Reverse-scoring is applied to calculated scores.":"");
    output.push({item:title,N,mean,sd,median,modes,top,peak,weightedSum,squaredSum,sdMethod,
      reversed,interpretation,rows:rows.map(x=>({...x,percent:100*x.count/N}))});
  }
  return output;
}
export function toSummaryCsv(results){
  const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';
  return "Item,N,Mean,SD,Median,Mode,Top response\r\n"+results.map(r=>
    [r.item,r.N,r.mean.toFixed(3),r.sd===null?"":r.sd.toFixed(3),r.median,r.modes.join(" / "),r.top].map(quote).join(",")
  ).join("\r\n")+"\r\n";
}
