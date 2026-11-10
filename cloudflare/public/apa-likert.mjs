// APA-inspired export from existing computed Likert results.
// Formatting is editorial; it does not recalculate statistics or supply missing data.
import {objectiveTables} from "./likert-student.mjs";
function html(value){
  return String(value??"").replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
}
export function apaLikertHtml(report,{highestFirst=true}={}){
  const tables=objectiveTables(report,{highestFirst});
  const blocks=tables.tables.map((group,index)=>{
    const number=index+1;
    const rows=group.rows.length?group.rows.map(({cells})=>{
      const [item,question,...rest]=cells;
      return "<tr><th scope=\"row\">"+html(item)+"</th><td>"+html(question)+"</td>"+
        rest.map(v=>"<td class=\"right\">"+html(v)+"</td>").join("")+"</tr>";
    }).join(""):"<tr><td colspan=\""+tables.headers.length+"\">No items assigned.</td></tr>";
    const headings=tables.headers.map((heading,i)=>
      "<th scope=\"col\""+(i>1?' class="right"':"")+">"+html(heading)+"</th>").join("");
    const note="Note. Each rating cell shows frequency (valid percentage) for that item's valid N. "+
      (report.sdMethod==="sample"?"Sample":"Population")+" standard deviation is reported. "+
      "Coded response categories are treated as approximately equally spaced for means. "+
      "† denotes a reverse-scored item. The comparison with the scale midpoint "+
      "is descriptive and is not a hypothesis test. Item means should not be treated as "+
      "respondent-level composite statistics. Source: "+tables.source+".";
    return '<section class="apa-table"><p class="apa-number">Table 4.'+number+"</p>"+
      '<p class="apa-caption">'+html(group.objective)+
      " — Frequency distribution and descriptive statistics</p>"+
      '<div class="table-scroll"><table><thead><tr>'+headings+
      "</tr></thead><tbody>"+rows+"</tbody></table></div>"+
      '<p class="apa-note">'+html(note)+"</p></section>";
  }).join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    "<title>StatLab APA-style descriptive tables</title>"+
    '<style>@page{size:landscape;margin:18mm}body{font:12pt/1.6 "Times New Roman",Times,serif;color:#111;max-width:1350px;margin:0 auto;padding:24px}'+
    'h1{text-align:center;font-size:16pt}h2{font-size:13pt}p{margin:7px 0}.intro{line-height:1.6}'+
    '.apa-table{margin:34px 0;break-inside:avoid}.apa-number{font-weight:700;margin-bottom:3px}'+
    '.apa-caption{font-style:italic;margin-bottom:13px}.table-scroll{overflow-x:auto}'+
    'table{border-collapse:collapse;width:100%;font-size:10pt;line-height:1.4;border-top:1.3px solid #111;border-bottom:1.3px solid #111}'+
    'th,td{padding:7px 5px;text-align:left;vertical-align:top;border:0}'+
    'thead th{border-bottom:1px solid #111;font-weight:700}.right{text-align:right;white-space:nowrap}'+
    'tbody tr:nth-child(even){background:#fff}.apa-note{font-size:10pt;margin-top:9px;line-height:1.5}'+
    '@media print{body{max-width:none;margin:0;padding:0}.table-scroll{overflow:visible}}</style></head><body>'+
    "<h1>Descriptive Research Tables</h1>"+
    '<p class="intro"><strong>Study:</strong> '+html(report.studyTitle||"Untitled study")+
    "</p><p>Exported in an APA-inspired minimalist table layout for review against your "+
    "university's specific formatting requirements. No significance tests or raw cases are inferred.</p>"+
    blocks+"</body></html>";
}
