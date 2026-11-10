// Value Labels editor model: changes are drafts until the user clicks OK.
// No respondent values are created, recoded, or changed by this module.
export const VALUE_LABEL_PRESETS=Object.freeze({
  4:Object.freeze(["Strongly Disagree","Disagree","Agree","Strongly Agree"]),
  5:Object.freeze(["Strongly Disagree","Disagree","Neutral","Agree","Strongly Agree"]),
  7:Object.freeze(["Strongly Disagree","Disagree","Somewhat Disagree","Neither Agree nor Disagree","Somewhat Agree","Agree","Strongly Agree"])
});
const MAX_VALUE_LABELS=100;
function fail(message){throw Error(message);}
export function canonicalCode(raw,type="numeric"){
  const str=String(raw??"").trim();
  if(!str)fail("Enter a value code, such as 1 or 2.");
  if(str.length>100)fail("Value codes must not exceed 100 characters.");
  if(type==="numeric"){
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(str)||
        !Number.isFinite(Number(str)))fail("This variable is Numeric. Use a numeric code such as 1, 2, or 99.");
    return String(Number(str));
  }
  if(!["string","date"].includes(type))fail("Unsupported variable type.");
  return str;
}
export function normalizedLabel(raw){
  const label=String(raw??"").trim();
  if(!label)fail('Enter a label for this code, such as "Strongly Agree".');
  if(label.length>200)fail("A response label can contain up to 200 characters.");
  return label;
}
export function createValueDraft(variable){
  if(!variable||!["numeric","string","date"].includes(variable.type))fail("Choose a valid variable.");
  const entries=Object.entries(variable.values||{}).map(([code,label])=>({
    code:canonicalCode(code,variable.type),
    label:normalizedLabel(label)
  }));
  if(new Set(entries.map(v=>v.code)).size!==entries.length)
    fail("Existing value labels contain duplicate codes. Review their numeric forms.");
  return {type:variable.type,entries,missing:[...(variable.missing||[])]};
}
export function addValueLabel(draft,rawCode,rawLabel){
  const code=canonicalCode(rawCode,draft.type),label=normalizedLabel(rawLabel);
  if(draft.entries.length>=MAX_VALUE_LABELS)fail("Only 100 coded response labels are supported per variable.");
  if(draft.entries.some(entry=>entry.code===code))
    fail("Value "+code+" already exists. Select it in the list and click Change.");
  return {...draft,entries:[...draft.entries,{code,label}]};
}
export function changeValueLabel(draft,selectedCode,rawCode,rawLabel){
  if(selectedCode===null||selectedCode===undefined)fail("Select a coded response from the list before changing it.");
  const old=canonicalCode(selectedCode,draft.type);
  const index=draft.entries.findIndex(entry=>entry.code===old);
  if(index<0)fail("Selected value no longer exists.");
  const code=canonicalCode(rawCode,draft.type),label=normalizedLabel(rawLabel);
  if(draft.entries.some((entry,i)=>i!==index&&entry.code===code))
    fail("Value "+code+" already exists. Choose a unique code.");
  return {...draft,entries:draft.entries.map((entry,i)=>i===index?{code,label}:entry)};
}
export function removeValueLabel(draft,selectedCode){
  if(selectedCode===null||selectedCode===undefined)fail("Select a coded response to remove.");
  const code=canonicalCode(selectedCode,draft.type);
  if(!draft.entries.some(entry=>entry.code===code))fail("Selected value no longer exists.");
  return {...draft,entries:draft.entries.filter(entry=>entry.code!==code)};
}
export function applyLikertPreset(draft,points=5){
  if(draft.type!=="numeric")fail("Choose a Numeric variable in Variable View to apply a Likert preset.");
  const names=VALUE_LABEL_PRESETS[points];
  if(!names)fail("Choose a 4-, 5-, or 7-point Likert scale.");
  return {...draft,entries:names.map((label,i)=>({code:String(i+1),label}))};
}
export function orderedLabels(draft){
  return [...draft.entries].sort((a,b)=>draft.type==="numeric"?
    Number(a.code)-Number(b.code):a.code.localeCompare(b.code));
}
export function parseMissingCodes(raw,type){
  if(typeof raw!=="string")fail("Missing codes must be comma-separated text.");
  const parts=raw.split(",").map(x=>x.trim()).filter(Boolean);
  if(parts.length>20)fail("A variable can contain at most 20 missing-value codes.");
  const entries=parts.map(x=>canonicalCode(x,type));
  if(new Set(entries).size!==entries.length)fail("Missing-value codes must be unique.");
  return entries;
}
export function valueDraftPatch(draft,missingText,{likertPreset=false}={}){
  const values=Object.fromEntries(draft.entries.map(({code,label})=>[code,label]));
  const missing=parseMissingCodes(missingText,draft.type);
  const patch={values,missing};
  // A questionnaire rating is Ordinal by default, but the caller must opt in.
  if(likertPreset)patch.measure="ordinal";
  return patch;
}
