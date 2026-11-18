// Local-only XLSX/CSV reader. No third-party calls, no macros or formula execution.
const MAX_BYTES=4000000, MAX_ENTRIES=300, MAX_SHEETS=20, MAX_ROWS=5000, MAX_COLS=60, MAX_ENTRY=10000000, MAX_TOTAL=25000000;
const decoder=new TextDecoder("utf-8");
const u16=(dv,n)=>dv.getUint16(n,true), u32=(dv,n)=>dv.getUint32(n,true);
function zipFiles(buffer){
 const bytes=new Uint8Array(buffer),dv=new DataView(buffer);
 if(bytes.length>MAX_BYTES)throw Error("This Excel file exceeds 4 MB. Export a smaller worksheet as CSV.");
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(dv,i)===0x06054b50){end=i;break;}
 if(end<0)throw Error("This is not a valid Excel .xlsx file.");
 const count=u16(dv,end+10),offset=u32(dv,end+16);
 if(count>MAX_ENTRIES||offset>=bytes.length)throw Error("This workbook has too many internal files.");
 const entries=new Map();let at=offset,total=0;
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||u32(dv,at)!==0x02014b50)throw Error("Invalid workbook directory.");
  const flags=u16(dv,at+8),method=u16(dv,at+10),packed=u32(dv,at+20),unpacked=u32(dv,at+24);
  const nameLen=u16(dv,at+28),extraLen=u16(dv,at+30),commentLen=u16(dv,at+32),start=u32(dv,at+42);
  if(at+46+nameLen+extraLen+commentLen>bytes.length||start>=bytes.length)throw Error("Invalid workbook entry.");
  const name=decoder.decode(bytes.slice(at+46,at+46+nameLen));at+=46+nameLen+extraLen+commentLen;
  if(name.includes("..")||name.startsWith("/")||name.includes("\\"))throw Error("Unsafe workbook file path.");
  if(flags&1)throw Error("Password-protected Excel workbooks are not supported.");
  if(method!==0&&method!==8)throw Error("This workbook uses unsupported compression.");
  if(unpacked>MAX_ENTRY||(total+=unpacked)>MAX_TOTAL)throw Error("Workbook is too large after expansion.");
  entries.set(name,{method,packed,unpacked,start});
 }
 return{async read(name){
  const e=entries.get(name);if(!e)return null;
  if(e.start+30>bytes.length||u32(dv,e.start)!==0x04034b50)throw Error("Invalid workbook ZIP entry.");
  const from=e.start+30+u16(dv,e.start+26)+u16(dv,e.start+28);
  if(from+e.packed>bytes.length)throw Error("Invalid workbook data length.");
  const compressed=bytes.slice(from,from+e.packed);
  if(!e.method)return decoder.decode(compressed);
  if(typeof DecompressionStream==="undefined")throw Error("This browser cannot read Excel. Save the worksheet as CSV.");
  const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const result=await new Response(stream).arrayBuffer();
  if(result.byteLength>MAX_ENTRY||result.byteLength!==e.unpacked)throw Error("Workbook decompression failed integrity checks.");
  return decoder.decode(result);
 }};
}
function parseXml(source){
 if(!source)throw Error("Required Excel workbook data is missing.");
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error("Unsafe XML is not supported.");
 const doc=new DOMParser().parseFromString(source,"application/xml");
 if(doc.getElementsByTagName("parsererror").length||doc.getElementsByTagNameNS("*","parsererror").length)throw Error("Invalid Excel workbook XML.");
 return doc;
}
const descendants=(root,name)=>[...root.getElementsByTagNameNS("*",name)];
const direct=(parent,name)=>[...(parent?.children||[])].find(e=>e.localName===name)||null;
const kids=(parent,name)=>[...(parent?.children||[])].filter(e=>e.localName===name);
const nodeText=node=>node?.textContent||"";
function columnIndex(ref){
 const m=/^([A-Z]{1,3})\d+$/.exec(ref||"");if(!m)return -1;
 let n=0;for(const ch of m[1])n=n*26+ch.charCodeAt(0)-64;return n-1;
}
function safePath(target){
 const raw=target.startsWith("/")?target.slice(1):"xl/"+target;
 const parts=[];for(const part of raw.split("/")){
  if(part==="..")parts.pop();else if(part&&part!==".")parts.push(part);
 }
 const path=parts.join("/");if(!path.startsWith("xl/"))throw Error("Invalid Excel worksheet path.");
 return path;
}
function valueOf(cell,strings){
 const type=cell.getAttribute("t");
 if(type==="inlineStr")return nodeText(direct(cell,"is"));
 const raw=nodeText(direct(cell,"v"));
 if(type==="s")return strings[Number(raw)]??"";
 if(type==="b")return raw==="1"?"TRUE":"FALSE";
 if(type==="e"||type==="str")return raw;
 if(raw==="")return "";
 const n=Number(raw);return Number.isFinite(n)?n:raw;
}
function sheetRows(doc,strings){
 const data=descendants(doc,"sheetData")[0];if(!data)return [];
 const rows=[];
 for(const row of kids(data,"row")){
  if(rows.length>=MAX_ROWS)throw Error("Worksheet has more than 5,000 rows. Export a smaller CSV.");
  const values=[];let next=0;
  for(const cell of kids(row,"c")){
   const index=columnIndex(cell.getAttribute("r"));const pos=index>=0?index:next;
   if(pos>=MAX_COLS)throw Error("Worksheet contains more than 60 columns.");
   values[pos]=valueOf(cell,strings);next=pos+1;
  }
  rows.push(values);
 }
 return rows;
}
export async function readXlsxWorkbook(file){
 const zip=zipFiles(await file.arrayBuffer());
 const book=parseXml(await zip.read("xl/workbook.xml"));
 const relationships=parseXml(await zip.read("xl/_rels/workbook.xml.rels"));
 const refs=new Map();
 for(const rel of descendants(relationships,"Relationship"))refs.set(rel.getAttribute("Id"),safePath(rel.getAttribute("Target")||""));
 let strings=[];const rawShared=await zip.read("xl/sharedStrings.xml");
 if(rawShared){
  strings=descendants(parseXml(rawShared),"si").map(si=>descendants(si,"t").map(nodeText).join(""));
  if(strings.length>250000)throw Error("Excel shared string table exceeds the safe limit.");
 }
 const declared=descendants(book,"sheet");
 if(declared.length<1||declared.length>MAX_SHEETS)throw Error("Workbook has an unsupported number of worksheets.");
 const sheets=[];
 for(const sheet of declared){
  const id=sheet.getAttribute("r:id")||sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id");
  const path=refs.get(id);if(!path||!path.startsWith("xl/worksheets/"))continue;
  const raw=await zip.read(path);if(!raw)continue;
  sheets.push({name:(sheet.getAttribute("name")||"Worksheet").slice(0,100),rows:sheetRows(parseXml(raw),strings)});
 }
 if(!sheets.length)throw Error("No readable worksheets in this workbook.");
 return sheets;
}
export function readCsv(text){
 if(text.length>3000000)throw Error("CSV exceeds 3 MB.");
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}
  else if(char==='"')quoted=!quoted;
  else if(!quoted&&char===","){row.push(cell);cell="";}
  else if(!quoted&&(char==="\r"||char==="\n")){
   if(char==="\r"&&text[i+1]==="\n")i++;
   row.push(cell);cell="";
   if(rows.length>=MAX_ROWS||row.length>MAX_COLS)throw Error("CSV exceeds 5,000 rows or 60 columns.");
   rows.push(row);row=[];
  }else cell+=char;
 }
 if(quoted)throw Error("CSV contains an unfinished quotation mark.");
 if(cell||row.length){row.push(cell);rows.push(row);}
 if(rows.length&&rows[0][0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,"");
 return[{name:"CSV data",rows}];
}
export function sheetAsCsv(rows){
 // StatLab's Data View requires each CSV row to have exactly the header width.
 // Sparse Excel rows can omit trailing empty cells: preserve those as blank CSV columns.
 const width=rows[0]?.length||0;
 if(width<1||width>MAX_COLS)throw Error("Worksheet has no readable header row or too many columns.");
 return rows.map(row=>Array.from({length:width},(_,i)=>{
  const value=row[i];
  let text=value==null?"":String(value);
  if(typeof value!=="number"&&/^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 }).join(",")).join("\r\n");
}
export function summarizeSheet(rows){
 const header=rows[0]||[];
 const records=rows.slice(1).filter(row=>row.some(x=>x!==""&&x!=null));
 const numericColumns=header.map((name,i)=>{
  const valid=records.map(row=>row[i]).filter(v=>v!==""&&v!=null);
  return valid.length&&valid.every(v=>Number.isFinite(Number(v)))?String(name||"Column "+(i+1)):null;
 }).filter(Boolean);
 const index=header.findIndex(name=>/^study\s*id$/i.test(String(name).trim()));
 const distinctStudies=index<0?null:new Set(records.map(row=>String(row[index]||"").trim()).filter(Boolean)).size;
 return{rows:records.length,columns:header.length,numericColumns,distinctStudies};
}