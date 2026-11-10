// Independent SVG infographic renderer for StatLab Business Analytics.
// Inspired by visualization ideas in apache/echarts (Apache-2.0); no source copied.
import {formatMoney} from "./business-analytics.mjs";
const safe=text=>String(text??"").replace(/[&<>"']/g,s=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[s]));
const f=n=>Number.isFinite(n)?Number(n.toFixed(2)):0;
const accent=["#1DDAB1","#8B7CF8","#F3B55F","#64B8FA","#FE7998","#A1E678","#6F8FFA"];
function line(x1,y1,x2,y2,color="#26495D",width=1,extra=""){
  return '<line x1="'+f(x1)+'" y1="'+f(y1)+'" x2="'+f(x2)+'" y2="'+f(y2)+'" stroke="'+color+'" stroke-width="'+width+'" '+extra+'/>';
}
function txt(x,y,content,size=16,fill="#C8DEEA",weight=400,extra=""){
  return '<text x="'+f(x)+'" y="'+f(y)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+size+'" font-weight="'+weight+'" fill="'+fill+'" '+extra+'>'+safe(content)+'</text>';
}
function rect(x,y,w,h,fill,rx=0,extra=""){
  return '<rect x="'+f(x)+'" y="'+f(y)+'" width="'+f(w)+'" height="'+f(h)+'" rx="'+rx+'" fill="'+fill+'" '+extra+'/>';
}
function truncate(s,n){const v=String(s);return v.length>n?v.slice(0,n-1)+"…":v;}
function smallCurrency(value,currency){
  const a=Math.abs(value),sign=value<0?"-":"";
  if(a>=1e9)return sign+formatMoney(a/1e9,currency)+"bn";
  if(a>=1e6)return sign+formatMoney(a/1e6,currency)+"m";
  if(a>=1e3)return sign+formatMoney(a/1e3,currency)+"k";
  return sign+formatMoney(a,currency);
}
function kpi(x,y,label,value,sub,color="#1DDAB1"){
  return rect(x,y,270,112,"#153449",18,'stroke="#285669"')+
    rect(x+20,y+21,7,21,color,4)+
    txt(x+38,y+37,label.toUpperCase(),13,"#A9C9D7",700)+
    txt(x+20,y+81,truncate(value,21),27,"#FFFFFF",800)+
    txt(x+20,y+101,sub,11,"#9ABCCB",400);
}
function trendChart(data,currency){
  let svg=txt(71,349,"REVENUE TREND",16,"#FFFFFF",800);
  svg+=txt(71,371,"Recorded months only • no missing months invented",11,"#9FB9C8");
  const left=78,right=764,top=411,bottom=592;
  svg+=rect(63,394,725,250,"#153449",18,'stroke="#285669"');
  // Title must appear over the card background.
  svg+=txt(85,423,"MONTHLY SALES",14,"#FFFFFF",800);
  const max=Math.max(1,...data.map(x=>x.revenue))*1.15;
  for(let i=0;i<4;i++){
    const gy=455+i*40;
    svg+=line(left,gy,right,gy,"#315568",1,'stroke-dasharray="5,8"');
    svg+=txt(right-5,gy-6,smallCurrency(max*(1-i/4),currency),10,"#91B4C4",400,'text-anchor="end"');
  }
  if(data.length===0)return svg+txt(110,540,"Import records to see revenue over time.",16,"#B7CBDA");
  const positions=data.map((r,i)=>{
    const x=data.length===1?(left+right)/2:left+i*(right-left)/(data.length-1);
    const y=bottom-r.revenue/max*(bottom-460);
    return {x,y,month:r.name,value:r.revenue};
  });
  if(positions.length>1){
    svg+='<polyline points="'+positions.map(p=>f(p.x)+","+f(p.y)).join(" ")+'" fill="none" stroke="#1DDAB1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  for(const p of positions){
    svg+='<circle cx="'+f(p.x)+'" cy="'+f(p.y)+'" r="5" fill="#1DDAB1" stroke="#153449" stroke-width="2"/>';
  }
  const step=Math.max(1,Math.ceil(positions.length/6));
  positions.forEach((p,i)=>{
    if(i%step===0||i===positions.length-1)svg+=txt(p.x,617,p.month,11,"#BED5DF",500,'text-anchor="middle"');
  });
  return svg;
}
function breakdown(data,title,x,y,w,h,currency,color){
  let out=rect(x,y,w,h,"#153449",18,'stroke="#285669"')+
    txt(x+24,y+32,title.toUpperCase(),14,"#FFFFFF",800);
  if(!data.length)return out+txt(x+24,y+110,"No data for this breakdown",14);
  const max=Math.max(1,...data.map(v=>v.revenue));
  data.slice(0,5).forEach((record,i)=>{
    const yy=y+65+i*52;
    out+=txt(x+24,yy,truncate(record.name,23),13,"#CEE0E8",600);
    out+=txt(x+w-23,yy,smallCurrency(record.revenue,currency),12,"#A1CFD7",600,'text-anchor="end"');
    out+=rect(x+24,yy+11,w-48,11,"#2C5366",6);
    out+=rect(x+24,yy+11,(w-48)*(record.revenue/max),11,color,6);
  });
  return out;
}
export function createBusinessInfographic(report,{brand="MABRIG StatLab",title="BUSINESS PERFORMANCE"}={}){
  if(!report||!report.metrics||!Array.isArray(report.byMonth))throw Error("Analyze business data first.");
  if(typeof brand!=="string"||brand.length>70||typeof title!=="string"||title.length>100)
    throw Error("Infographic title is too long.");
  const m=report.metrics,currency=report.currency;
  const metric=[
    ["REVENUE",smallCurrency(m.revenue,currency),"Sum of sales",accent[0]],
    ["GROSS PROFIT",smallCurrency(m.profit,currency),"Before overhead & taxes",accent[1]],
    ["GROSS MARGIN",m.margin===null?"N/A":(m.margin*100).toFixed(1)+"%","Gross profit / revenue",accent[2]],
    [m.orders!==null?"ORDERS":"SALES LINES",m.orders===null?String(m.lineItems):String(m.orders),
       m.orders===null?"Line items; IDs not supplied":"Distinct IDs or reported count",accent[3]]
  ];
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1100" viewBox="0 0 1200 1100" role="img" aria-labelledby="business-svg-title business-svg-desc">';
  svg+='<title id="business-svg-title">'+safe(title)+' — infographic</title>';
  svg+='<desc id="business-svg-desc">Revenue, gross profit, margin and order statistics, monthly trend, categories and sales channels. Based on '+safe(report.source)+'.</desc>';
  svg+='<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#081C30"/><stop offset="1" stop-color="#123D49"/></linearGradient></defs>';
  svg+=rect(0,0,1200,1100,"url(#bg)");
  svg+=rect(54,58,12,60,accent[0],6);
  svg+=txt(80,75,brand.toUpperCase(),15,"#7EF5D9",800,'letter-spacing="2"');
  svg+=txt(80,117,title.toUpperCase(),39,"#FFFFFF",800);
  svg+=txt(80,149,(report.synthetic?"SYNTHETIC DEMO • ":"")+
    (report.mode==="transactions"?"TRANSACTION DATA":"MONTHLY SUMMARY")+
    " • "+report.currency+" • "+report.metrics.lineItems+" records",14,"#A8C4D0",500);
  metric.forEach((entry,i)=>{svg+=kpi(55+i*284,185,...entry);});
  svg+=trendChart(report.byMonth,currency);
  svg+=breakdown(report.byCategory,"Top categories",55,668,535,331,currency,accent[0]);
  svg+=breakdown(report.byChannel,"Sales channels",608,668,535,331,currency,accent[1]);
  svg+=line(55,1021,1145,1021,"#356477");
  svg+=txt(60,1050,"SOURCE: "+truncate(report.source,78),12,"#C1D4DE",600);
  svg+=txt(60,1074,"Descriptive gross figures only • costs depend on supplied data • no currency conversion",12,"#93B1C3");
  svg+=txt(1140,1060,"MABRIG",15,"#89EFD5",800,'text-anchor="end"');
  svg+='</svg>';
  return svg;
}
