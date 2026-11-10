import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {contentDemo,analyzeContent,saveUnitReview} from "../public/content-analysis.mjs";
import {
  discoverPhrases,addDiscoveredPhraseAsCode,sourceCodeMatrix,sourceMatrixCsv,
  discoveredPhrasesCsv,buildOptionalAiPrompt
} from "../public/content-discovery.mjs";

const report=()=>analyzeContent(contentDemo());

test("repeated literal phrase is found across synthetic documents with supporting evidence",()=>{
  const data=discoverPhrases(report(),{minUnits:2,minDocuments:2,limit:100});
  const phrase=data.candidates.find(c=>c.phrase==="internet access");
  assert.ok(phrase,"Expected recurring internet access");
  assert.equal(phrase.unitCount,2);
  assert.equal(phrase.documentCount,2);
  assert.equal(phrase.evidence.length,2);
  assert.ok(phrase.evidence.every(x=>x.excerpt.toLowerCase().includes("internet access")));
  assert.ok(data.candidates.every(x=>x.unitCount>=2&&x.documentCount>=2));
  assert.ok(!data.candidates.some(c=>c.phrase==="internet")); // Existing codebook keyword
  assert.equal(data.partialScan,false);
});

test("word sequence discovery is deterministic and filters unit, source, and phrase length",()=>{
  const r=report();
  const a=discoverPhrases(r,{minUnits:1,maxWords:2,limit:18});
  const b=discoverPhrases(r,{minUnits:1,maxWords:2,limit:18});
  assert.deepEqual(a,b);
  assert.ok(a.candidates.every(x=>x.words<=2));
  const single=discoverPhrases(r,{minUnits:1,maxWords:1,limit:18});
  assert.ok(single.candidates.every(x=>!x.phrase.includes(" ")));
  const none=discoverPhrases(r,{minDocuments:4});
  assert.equal(none.candidates.length,0);
  assert.throws(()=>discoverPhrases(r,{maxWords:10}),/Words per phrase/);
  assert.throws(()=>discoverPhrases(r,{minUnits:0}),/Minimum units/);
});

test("repeated phrase candidate creates draft code, does not auto-assign or mark passages reviewed",()=>{
  const initial=contentDemo();
  const original=JSON.stringify(initial);
  const r=analyzeContent(initial);
  const candidate=discoverPhrases(r,{minUnits:2,minDocuments:2,limit:100})
    .candidates.find(c=>c.phrase==="internet access");
  const output=addDiscoveredPhraseAsCode(initial,candidate);
  assert.equal(output.code.id,"T_INTERNET_ACCESS");
  assert.deepEqual(output.code.keywords,["internet access"]);
  assert.ok(output.code.description.includes("researcher must"));
  const updated=analyzeContent(output.project);
  const stat=updated.codeStats.find(c=>c.id===output.code.id);
  assert.equal(stat.unitCount,2); // automatic suggestions only
  assert.equal(stat.reviewedUnits,0);
  assert.equal(updated.metrics.reviewedUnits,0);
  assert.equal(original,JSON.stringify(initial));
  assert.throws(()=>addDiscoveredPhraseAsCode(output.project,candidate),/already defined/);
});

test("draft codes do not overwrite existing codebooks or original interviews",()=>{
  const r=report(),candidate=discoverPhrases(r,{minUnits:2,limit:100}).candidates[0];
  const result=addDiscoveredPhraseAsCode(r.project,candidate);
  assert.equal(result.project.documents.length,r.project.documents.length);
  assert.deepEqual(result.project.documents,r.project.documents);
  assert.deepEqual(result.project.codes.slice(0,3),r.project.codes);
  assert.equal(result.project.codes.length,r.project.codes.length+1);
});

test("source-code matrix uses reviewed assignments, counts units not people",()=>{
  let p=contentDemo();
  p=saveUnitReview(p,"D1::1",["COST"],"Reviewer override.");
  const r=analyzeContent(p),matrix=sourceCodeMatrix(r);
  assert.equal(matrix.rows.length,3);
  assert.equal(matrix.rows[0].documentId,"D1");
  assert.equal(matrix.rows[0].units,2);
  assert.equal(matrix.rows[0].reviewed,1);
  assert.equal(matrix.rows[0].counts.COST,1);
  assert.equal(matrix.rows[0].counts.ACCESS,0); // rejected by override
  assert.match(matrix.note,/not numbers of people/);
  const csv=sourceMatrixCsv(r);
  assert.match(csv,/Source ID/);
  assert.match(csv,/Code: Internet accessibility/);
});

test("exported CSVs are spreadsheet-safe for potentially adversarial source titles or phrases",()=>{
  const p=contentDemo();
  p.documents[0].title="=HYPERLINK(1,2)";
  const r=analyzeContent(p);
  const matrix=sourceMatrixCsv(r);
  assert.ok(matrix.includes("'=HYPERLINK(1,2)"));
  const candidate={candidates:[{phrase:"=1+1",unitCount:3,documentCount:1,
    occurrences:4,evidence:[{source:"=DANGER",unitId:"D1::1"}]}]};
  const csv=discoveredPhrasesCsv(candidate);
  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes("'=DANGER"));
});

test("optional AI prompt contains aggregate code counts but no transcripts or source titles",()=>{
  const r=report(),prompt=buildOptionalAiPrompt(r);
  assert.match(prompt,/Number of coding units: 6/);
  assert.match(prompt,/Researcher-defined code frequencies/);
  assert.match(prompt,/Do NOT fabricate quotes/);
  assert.ok(!prompt.includes("Poor connectivity interrupts live discussions"));
  assert.ok(!prompt.includes("Synthetic interview A"));
  assert.ok(!prompt.includes("data bundle"));
  assert.ok(!prompt.includes("Internet access is unreliable"));
});

test("recurring source phrases enter prompt only with explicit includePhrases option",()=>{
  const r=report(),discovery=discoverPhrases(r,{minUnits:2,minDocuments:2,limit:100});
  const plain=buildOptionalAiPrompt(r,{discovery});
  assert.ok(!plain.includes("internet access (2 units"));
  const withPhrases=buildOptionalAiPrompt(r,{includePhrases:true,discovery});
  assert.match(withPhrases,/OPTIONAL UNREVIEWED PHRASES/);
  assert.match(withPhrases,/internet access/);
  assert.throws(()=>buildOptionalAiPrompt(r,{includePhrases:true}),/Discover phrases/);
  assert.throws(()=>buildOptionalAiPrompt(r,{includePhrases:"yes"}),/Choose whether/);
});

test("unreviewed phrases are not labelled AI-generated semantic discoveries",()=>{
  const r=report(),result=discoverPhrases(r);
  assert.match(result.notes,/Literal recurring phrases only/);
  assert.ok(!result.notes.includes("AI-generated themes"));
  const c=result.candidates[0];
  assert.ok(c.unitCount>=1);
  assert.ok(c.evidence.length>=1);
});

test("UI has review-first discovery, editable prompt and never sends source text to APIs",()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../public");
  const html=readFileSync(resolve(root,"index.html"),"utf8");
  const ui=readFileSync(resolve(root,"content-ui.mjs"),"utf8");
  for(const id of ["ca-discover","ca-candidates","ca-min-units","ca-min-documents",
    "ca-max-words","ca-discovery-csv","ca-exclude-existing","ca-matrix-head",
    "ca-matrix-body","ca-matrix-csv","ca-ai-draft","ca-ai-text","ca-ai-copy",
    "ca-ai-save","ca-ai-include-phrases","ca-ai-status"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing UI control "+id);
  }
  assert.ok(ui.includes("discoverPhrases("));
  assert.ok(ui.includes("addDiscoveredPhraseAsCode("));
  assert.ok(ui.includes("navigator.clipboard.writeText("));
  assert.ok(!ui.includes("fetch("));
  assert.ok(!ui.includes("OPENROUTER_API_KEY"));
  assert.ok(!ui.includes("STATLAB_ADMIN_TOKEN"));
});
