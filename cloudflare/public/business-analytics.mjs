// Business Analytics in StatLab: independent, offline-first implementation.
// Inspired by dashboard concepts in Apache ECharts (Apache-2.0) and Metabase (AGPL).
// No third-party application source code is copied into this module.
import {parseCsv} from "./workspace.mjs";
export const MAX_BUSINESS_ROWS=5000;
export const TRANSACTION_FIELDS=["date","product","category","region","channel","quantity","unit_price","unit_cost","order_id"];
export const MONTH_FIELDS=["month","category","region","channel","revenue","cost","units","orders"];
export const CURRENCY_CODES=["NGN","USD","GBP","EUR","GHS","KES","ZAR"];
export const CURRENCY_SYMBOLS={NGN:"₦",USD:"$",GBP:"£",EUR:"€",GHS:"GH₵",KES:"KSh",ZAR:"R"};
const SYNONYMS={
 date:["date","sale_date","transaction_date","order_date"],
 product:["product","item","product_name","service"],
 category:["category","segment","product_category"],
 region:["region","state","location","city"],
 channel:["channel","sales_channel","source"],
 quantity:["quantity","qty","units_sold","units"],
 unit_price:["unit_price","price","selling_price","unit_revenue"],
 unit_cost:["unit_cost","cost_price","cost_per_unit","purchase_price"],
 order_id:["order_id","order","invoice","invoice_id","transaction_id"],
 month:["month","period","year_month"],
 revenue:["revenue","sales","total_sales","sales_amount","turnover"],
 cost:["cost","costs","expenses","total_cost","cogs"],
 units:["units","quantity","qty","units_sold"],
 orders:["orders","order_count","transactions"]
};
const required={transactions:["date","product","quantity","unit_price","unit_cost"],
monthly:["month","revenue","cost"]};
function fail(message){throw Error(message);}
const cap=(s,max=90)=>String(s??"").trim().slice(0,max);
function validAmount(value,name){
  if(typeof value!=="string"&&typeof value!=="number")fail(name+" must be numeric.");
  const x=String(value).trim();
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(x))fail(name+" must be a non-negative number (without currency symbols).");
  const number=Number(x);
  if(!Number.isFinite(number)||number>1e12)fail(name+" is outside the supported range.");
  return number;
}
function integerAmount(value,name){const v=validAmount(value,name);if(!Number.isSafeInteger(v))fail(name+" must be a whole number.");return v;}
function validDay(value){
  const s=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))fail("Dates must use YYYY-MM-DD.");
  const d=new Date(s+"T00:00:00.000Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail("Invalid calendar date "+s+".");
  return s;
}
function validMonth(value){
  const s=String(value).trim();
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))fail("Months must use YYYY-MM.");
  return s;
}
export function detectFields(columns,mode){
  if(!required[mode])fail("Choose transactions or monthly summary.");
  const used=new Set(),result={};
  for(const field of (mode==="transactions"?TRANSACTION_FIELDS:MONTH_FIELDS)){
    const matches=columns.map((c,i)=>({norm:c.trim().toLowerCase().replace(/[\s-]+/g,"_"),i}))
      .filter(x=>SYNONYMS[field]?.includes(x.norm)&&!used.has(x.i));
    if(matches.length>1)fail("Multiple columns appear to represent "+field+". Rename or remove the duplicate.");
    if(matches.length){result[field]=matches[0].i;used.add(matches[0].i);}
  }
  const missing=required[mode].filter(key=>result[key]===undefined);
  if(missing.length)fail("CSV is missing required columns: "+missing.join(", ")+".");
  return result;
}
export function parseBusinessCsv(text,mode="transactions"){
  if(typeof text!=="string"||new TextEncoder().encode(text).length>2_000_000)fail("CSV must be smaller than 2 MB.");
  const matrix=parseCsv(text);
  if(matrix.length<2)fail("CSV must include a header and at least one data row.");
  if(matrix.length-1>MAX_BUSINESS_ROWS)fail("Analyze up to 5,000 rows at a time.");
  const header=matrix[0],mapping=detectFields(header,mode);
  const rows=matrix.slice(1).map((line,index)=>{
    if(line.length!==header.length)fail("CSV line "+(index+2)+" has inconsistent columns.");
    const get=field=>mapping[field]===undefined?"":line[mapping[field]].trim();
    const common={category:cap(get("category")||"Uncategorised"),
      region:cap(get("region")||"Unspecified"),
      channel:cap(get("channel")||"Unspecified")};
    try{
      if(mode==="transactions"){
        const date=validDay(get("date")),product=cap(get("product"));
        if(!product)fail("Product/service name cannot be blank.");
        const quantity=integerAmount(get("quantity"),"Quantity");
        const unitPrice=validAmount(get("unit_price"),"Unit price");
        const unitCost=validAmount(get("unit_cost"),"Unit cost");
        const revenue=quantity*unitPrice,cost=quantity*unitCost;
        if(!Number.isFinite(revenue)||!Number.isFinite(cost)||revenue>1e15||cost>1e15)fail("Calculated total exceeds supported range.");
        return {...common,date,month:date.slice(0,7),product,quantity,unitPrice,unitCost,revenue,cost,
          orderId:cap(get("order_id"),100),units:quantity,orders:null};
      }
      const month=validMonth(get("month"));
      const revenue=validAmount(get("revenue"),"Revenue"),cost=validAmount(get("cost"),"Cost");
      const units=get("units")===""?null:integerAmount(get("units"),"Units");
      const orders=get("orders")===""?null:integerAmount(get("orders"),"Orders");
      return {...common,month,product:null,revenue,cost,units,orders};
    }catch(error){fail("Row "+(index+2)+": "+error.message);}
  });
  return {mode,rows,source:"CSV import",synthetic:false};
}
export function syntheticBusinessData(){
  const rows=[
    ["2026-05-02","Campus notebooks","Stationery","Enugu","Walk-in",14,1600,900,"INV-001"],
    ["2026-05-09","Printing service","Services","Enugu","WhatsApp",60,45,20,"INV-002"],
    ["2026-06-03","Campus notebooks","Stationery","Enugu","Walk-in",18,1600,900,"INV-003"],
    ["2026-06-12","USB flash drives","Electronics","Abuja","Online",8,6500,4400,"INV-004"],
    ["2026-07-02","Printing service","Services","Enugu","Walk-in",120,45,20,"INV-005"],
    ["2026-07-09","USB flash drives","Electronics","Lagos","Online",11,6500,4400,"INV-006"],
    ["2026-08-01","Campus notebooks","Stationery","Enugu","WhatsApp",20,1600,900,"INV-007"],
    ["2026-08-14","Printing service","Services","Enugu","Walk-in",180,45,20,"INV-008"],
    ["2026-09-10","USB flash drives","Electronics","Lagos","Online",14,6500,4400,"INV-009"],
    ["2026-09-18","Campus notebooks","Stationery","Abuja","Online",22,1600,900,"INV-010"],
    ["2026-10-05","Printing service","Services","Enugu","WhatsApp",210,45,20,"INV-011"],
    ["2026-10-20","USB flash drives","Electronics","Lagos","Online",15,6500,4400,"INV-012"],
    ["2026-11-02","Campus notebooks","Stationery","Enugu","Walk-in",28,1600,900,"INV-013"],
    ["2026-11-06","Printing service","Services","Enugu","WhatsApp",260,45,20,"INV-014"],
    ["2026-11-08","USB flash drives","Electronics","Abuja","Online",17,6500,4400,"INV-015"]
  ];
  const records=rows.map(([date,product,category,region,channel,quantity,unitPrice,unitCost,orderId])=>
    ({date,month:date.slice(0,7),product,category,region,channel,quantity,unitPrice,unitCost,
      revenue:quantity*unitPrice,cost:quantity*unitCost,units:quantity,orders:null,orderId}));
  return {mode:"transactions",rows:records,source:"Synthetic small-business demo",synthetic:true};
}
function moneyRaw(n){return Math.round((n+Number.EPSILON)*100)/100;}
function groups(rows,key){
  const map=new Map();
  for(const row of rows){
    const name=row[key]||"Unspecified";
    const current=map.get(name)||{name,revenue:0,cost:0,units:0,unitsKnown:true,lineItems:0,orders:0};
    current.revenue+=row.revenue;current.cost+=row.cost;
    if(row.units===null)current.unitsKnown=false;else current.units+=row.units;
    if(row.orders!==null)current.orders+=row.orders;
    current.lineItems++;map.set(name,current);
  }
  return [...map.values()].map(item=>({...item,revenue:moneyRaw(item.revenue),cost:moneyRaw(item.cost),
    profit:moneyRaw(item.revenue-item.cost),margin:item.revenue>0?(item.revenue-item.cost)/item.revenue:null}))
    .sort((a,b)=>b.revenue-a.revenue||a.name.localeCompare(b.name));
}
function validCurrency(currency){if(!CURRENCY_CODES.includes(currency))fail("Choose a supported display currency.");return currency;}
export function analyzeBusiness(dataset,{currency="NGN",category="all",channel="all",region="all",from="",to=""}={}){
  if(!dataset||!["transactions","monthly"].includes(dataset.mode)||!Array.isArray(dataset.rows))
    fail("Import a valid business CSV or load the synthetic example first.");
  validCurrency(currency);
  if(dataset.rows.length>MAX_BUSINESS_ROWS)fail("Too many rows.");
  if(from)validMonth(from);if(to)validMonth(to);
  if(from&&to&&from>to)fail("Start month must not be after end month.");
  const rows=dataset.rows.filter(x=>
    (category==="all"||x.category===category)&&
    (channel==="all"||x.channel===channel)&&
    (region==="all"||x.region===region)&&
    (!from||x.month>=from)&&(!to||x.month<=to)
  );
  const revenue=rows.reduce((a,b)=>a+b.revenue,0),cost=rows.reduce((a,b)=>a+b.cost,0);
  const profit=revenue-cost,margin=revenue===0?null:profit/revenue;
  const unitsKnown=rows.every(x=>x.units!==null);
  const units=unitsKnown?rows.reduce((a,b)=>a+b.units,0):null;
  const hasOrders=dataset.mode==="monthly"?
    rows.every(x=>x.orders!==null):rows.every(x=>x.orderId);
  const orders=dataset.mode==="monthly"?
    (hasOrders?rows.reduce((a,b)=>a+b.orders,0):null):
    (hasOrders?new Set(rows.map(x=>x.orderId)).size:null);
  const aov=orders&&orders>0?revenue/orders:null;
  const metrics={revenue:moneyRaw(revenue),cost:moneyRaw(cost),profit:moneyRaw(profit),
    margin,units,orders,aov:aov===null?null:moneyRaw(aov),lineItems:rows.length};
  const byMonth=groups(rows,"month").sort((a,b)=>a.name.localeCompare(b.name));
  const byCategory=groups(rows,"category"),byChannel=groups(rows,"channel"),byRegion=groups(rows,"region");
  const byProduct=dataset.mode==="transactions"?groups(rows,"product"):[];
  const insights=[];
  if(!rows.length)insights.push("No records match the selected filters. Clear the filters or import more data.");
  else{
    if(profit<0)insights.push("Gross loss in the selected records: costs exceed sales revenue. Review pricing and direct costs.");
    else insights.push("Gross profit is revenue minus recorded costs; it is not net income because taxes, overhead and unrecorded expenses are excluded.");
    if(byCategory.length)insights.push("Largest revenue category: "+byCategory[0].name+". Revenue ranking does not automatically mean highest profitability.");
    if(byMonth.length>1){
      const first=byMonth[0],last=byMonth.at(-1);
      insights.push("Recorded monthly revenue ranges from "+first.name+" to "+last.name+
        "; this is a historical description, not a forecast.");
    }
  }
  const caveats=[
    "This mode reports descriptive business metrics from the imported data. It does not predict demand, prove causation or give financial advice.",
    "All amounts are assumed to be in the selected display currency. No FX conversion is performed.",
    "Costs are based solely on provided unit costs or summary costs; overhead, discounts, returns, taxes and payment fees are not inferred.",
    "Transaction CSV rows represent sales line items; order count and average order value require an order_id. Monthly summaries require an orders column for order KPIs.",
    "Monthly summary rows are treated as additive, non-overlapping records. Do not import totals alongside component breakdowns, or totals will be double-counted."
  ];
  return {mode:dataset.mode,synthetic:dataset.synthetic,source:dataset.source||"Imported data",
    currency,filters:{category,channel,region,from,to},metrics,byMonth,byCategory,byChannel,
    byRegion,byProduct,insights,caveats};
}
export function formatMoney(amount,currency="NGN"){
  validCurrency(currency);
  if(amount===null||!Number.isFinite(amount))return "N/A";
  const symbol=CURRENCY_SYMBOLS[currency];
  return symbol+new Intl.NumberFormat("en-NG",{maximumFractionDigits:2,minimumFractionDigits:0}).format(amount);
}
export function csvTemplate(mode="transactions"){
  if(mode==="transactions")return "date,order_id,product,category,region,channel,quantity,unit_price,unit_cost\n2026-11-01,INV-001,Printing,Services,Enugu,Walk-in,50,45,20\n";
  if(mode==="monthly")return "month,category,region,channel,revenue,cost,orders,units\n2026-11,Services,Enugu,Walk-in,120000,70000,25,400\n";
  fail("Unknown template mode.");
}
function escapeCsv(value){
  const s=String(value??"");
  return '"'+(s.match(/^[\s]*[=+@-]/)&&!s.match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)?"'":"")+s.replace(/"/g,'""')+'"';
}
export function businessReportCsv(report){
  const lines=[["Metric","Value"],["Source",report.source],["Currency",report.currency],
    ["Revenue",report.metrics.revenue],["Cost",report.metrics.cost],["Gross profit",report.metrics.profit],
    ["Gross margin",report.metrics.margin===null?"":(report.metrics.margin*100).toFixed(2)+"%"],
    ["Units",report.metrics.units??""],["Order count",report.metrics.orders??""],["Average order value",report.metrics.aov??""]];
  for(const group of ["byMonth","byCategory","byChannel","byRegion","byProduct"]){
    for(const row of report[group])lines.push([group+" / "+row.name,row.revenue]);
  }
  return lines.map(cells=>cells.map(escapeCsv).join(",")).join("\r\n")+"\r\n";
}
