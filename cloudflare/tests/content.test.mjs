import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {
  CONTENT_SCHEMA,newContentProject,contentDemo,validateContentProject,segmentDocuments,
  keywordMatches,analyzeContent,saveUnitReview,unreviewUnit,addContentDocument,
  importContentCsv,exportContentProject,importContentProject,codedUnitsCsv,
  codesSummaryCsv,chapterFourContentHtml
} from "../public/content-analysis.mjs";

const demo=()=>contentDemo();

test("blank content analysis project has no manufactured interviews or coded units",()=>{
  const p=newContentProject();
  assert.equal(p.schema,CONTENT_SCHEMA);
  const report=analyzeContent(p);
  assert.equal(report.metrics.documents,0);
  assert.equal(report.metrics.units,0);
  assert.equal(report.metrics.codedUnits,0);
  assert.equal(report.metrics.reviewedUnits,0);
  assert.equal(report.synthetic,false);
});

test("synthetic example is transparently labelled and segmented by paragraphs",()=>{
  const p=demo(),r=analyzeContent(p);
  assert.equal(r.synthetic,true);
  assert.equal(r.metrics.documents,3);
  assert.equal(r.metrics.units,6);
  assert.equal(r.metrics.codes,3);
  assert.equal(r.units[0].id,"D1::1");
  assert.equal(r.units[0].reviewed,false);
  assert.ok(r.units[0].suggested.includes("ACCESS"));
  assert.ok(r.units[0].hitsByCode.ACCESS.length>=2);
});

test("manual review can accept, reject, or add codes without modifying source text",()=>{
  const input=demo(),before=JSON.stringify(input);
  const reviewed=saveUnitReview(input,"D1::1",["COST"],"Coding confirmed by reviewer.");
  const result=analyzeContent(reviewed);
  const segment=result.units[0];
  assert.deepEqual(segment.assigned,["COST"]);
  assert.equal(segment.reviewed,true);
  assert.equal(segment.memo,"Coding confirmed by reviewer.");
  assert.ok(segment.suggested.includes("ACCESS"));
  assert.equal(JSON.stringify(input),before);
  const rejected=saveUnitReview(reviewed,"D1::1",[],"Keyword was irrelevant.");
  assert.deepEqual(analyzeContent(rejected).units[0].assigned,[]);
  assert.equal(analyzeContent(rejected).units[0].reviewed,true);
  const reset=unreviewUnit(rejected,"D1::1");
  assert.equal(analyzeContent(reset).units[0].reviewed,false);
  assert.deepEqual(analyzeContent(reset).units[0].assigned,analyzeContent(reset).units[0].suggested);
});

test("whole-word, case-insensitive Unicode-safe phrase matching excludes partial words",()=>{
  const hits=keywordMatches("Internet access; internet access, internet! International internet.",
    ["internet","internet access"]);
  assert.equal(hits.length,4);
  assert.equal(hits.filter(x=>x.match.toLowerCase()==="internet").length,2);
  assert.equal(keywordMatches("affordability",["afford"]).length,0);
  assert.equal(keywordMatches("C++ language.",["C++"])[0].match,"C++");
  assert.equal(keywordMatches("naïve student",["naïve"]).length,1);
});

test("units can represent whole documents, sentences, or paragraphs",()=>{
  const p=demo();
  assert.equal(segmentDocuments(p.documents,"paragraph").length,6);
  assert.equal(segmentDocuments(p.documents,"document").length,3);
  assert.ok(segmentDocuments(p.documents,"sentence").length>6);
  assert.throws(()=>segmentDocuments(p.documents,"word"),/valid unit/);
});

test("code percentages count multiple labels but do not claim respondents",()=>{
  const report=analyzeContent(demo());
  assert.equal(report.metrics.units,6);
  assert.ok(report.codeStats.every(c=>c.percent===100*c.unitCount/6));
  assert.ok(report.notes.some(s=>s.includes("multiple codes")));
  assert.ok(report.notes.some(s=>s.includes("reliability")));
  assert.ok(report.topWords.length>0);
});

test("document import parses quoted newlines and preserves source IDs",()=>{
  const raw="id,title,text\nA1,Interview A,\"Internet access is poor.\n\nTraining was helpful.\"\nA2,Policy B,\"High tuition costs.\"\n";
  const docs=importContentCsv(raw);
  assert.equal(docs.length,2);
  assert.equal(docs[0].id,"A1");
  assert.ok(docs[0].text.includes("\n\n"));
  const p=addContentDocument(newContentProject(),docs[0]);
  assert.equal(p.documents[0].origin,"user");
  assert.equal(analyzeContent(p).metrics.units,2);
});

test("invalid code IDs, duplicate documents and unknown manual assignments fail closed",()=>{
  const p=demo();
  assert.throws(()=>addContentDocument(p,{id:"D1",title:"Duplicate",text:"One",origin:"user"}),/Duplicate document ID/);
  assert.throws(()=>addContentDocument(p,{id:"2broken",title:"Bad",text:"One",origin:"user"}),/Document ID/);
  assert.throws(()=>saveUnitReview(p,"D999::1",["ACCESS"]),/valid passage/);
  assert.throws(()=>saveUnitReview(p,"D1::1",["UNKNOWN"]),/invalid codes/);
  const broken=structuredClone(p);broken.codes.push({...p.codes[0]});
  assert.throws(()=>validateContentProject(broken),/Duplicate code ID/);
});

test("manual review cannot migrate to shifted segmentation without explicit reset",()=>{
  const p=saveUnitReview(demo(),"D1::2",["SUPPORT"]);
  const changed={...p,unit:"document"};
  assert.throws(()=>validateContentProject(changed),/reviewed unit no longer exists|reviewed unit/);
  const reset=validateContentProject({...changed,reviews:{}});
  assert.equal(analyzeContent(reset).metrics.units,3);
});

test("backups preserve source documents, codebook, reviewed passages and synthetic provenance",()=>{
  const p=saveUnitReview(demo(),"D1::1",[],"No theme");
  const restored=importContentProject(exportContentProject(p));
  assert.deepEqual(restored,p);
  assert.equal(restored.reviews["D1::1"].codes.length,0);
  assert.equal(restored.documents[0].origin,"synthetic");
  assert.throws(()=>importContentProject('{"schema":"other"}'),/Not a supported/);
  assert.throws(()=>importContentProject("invalid json"),/Invalid JSON/);
});

test("quantitative summary separates assigned units, source coverage and literal keyword hits",()=>{
  const report=analyzeContent(demo()),stat=report.codeStats.find(s=>s.id==="ACCESS");
  assert.ok(stat.unitCount>=1);
  assert.ok(stat.documentCount>=1);
  assert.ok(stat.keywordHits>=stat.unitCount);
  const csv=codesSummaryCsv(report);
  assert.match(csv,/Assigned units/);
  assert.match(csv,/Keyword hits/);
  assert.match(codedUnitsCsv(report),/Suggested only/);
});

test("exports escape HTML and neutralize CSV formula injection",()=>{
  const p=demo();
  p.documents[0].text='=HYPERLINK("fake",1) <script>danger()</script>.';
  p.documents[0].title='=PAYLOAD';
  // Explicitly review the excerpt so it is included among exported coded extracts.
  const report=analyzeContent(saveUnitReview(p,"D1::1",["ACCESS"]));
  const csv=codedUnitsCsv(report);
  assert.ok(csv.includes("'=PAYLOAD"));
  assert.ok(csv.includes("'=HYPERLINK"));
  const html=chapterFourContentHtml(report);
  assert.ok(!html.includes('<script>danger()</script>'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("SYNTHETIC EXAMPLE INCLUDED"));
});

test("codebook can contain manual-only themes without literal keywords",()=>{
  const p=demo();
  p.codes.push({id:"HOPE",name:"Hopefulness",description:"Manually coded optimism",keywords:[]});
  const report=analyzeContent(saveUnitReview(p,"D1::2",["HOPE"]));
  const stat=report.codeStats.find(s=>s.id==="HOPE");
  assert.equal(stat.unitCount,1);
  assert.equal(stat.keywordHits,0);
  assert.equal(stat.reviewedUnits,1);
});

test("interface has documents, codebook, coding review, charts and research exports",()=>{
  const base=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(base,"index.html"),"utf8");
  const ui=readFileSync(resolve(base,"content-ui.mjs"),"utf8");
  const workspace=readFileSync(resolve(base,"workspace-ui.mjs"),"utf8");
  for(const id of ["workspace-content","menu-content","ca-unit","ca-add-doc","ca-codebook",
    "ca-add-code","ca-analyze","ca-code-stats","ca-passages","ca-review-dialog",
    "ca-review-save","ca-review-revert","ca-export-codes","ca-export-units",
    "ca-export-chapter","ca-project-file","ca-backup","ca-template"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
  }
  assert.ok(workspace.includes('"content"'));
  assert.ok(ui.includes("saveUnitReview("));
  assert.ok(ui.includes("importContentCsv("));
  assert.ok(ui.includes("chapterFourContentHtml("));
});
