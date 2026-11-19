import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createGateway } from "../src/index.mjs";

const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=keys.publicKey.export({format:"jwk"});
const ISSUER="https://statlab-pilot.cloudflareaccess.com";
const AUD="statlab-advanced-pilot-app";
const SHARED="a-private-compute-token-with-at-least-32-characters";
function jwt(mods={}){
  const now=Math.floor(Date.now()/1000);
  const header={alg:"RS256",typ:"JWT",kid:"unit-test-key"};
  const payload={iss:ISSUER,aud:[AUD],exp:now+3600,sub:"pilot-student-1",...mods};
  const b64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signed=b64(header)+"."+b64(payload);
  return signed+"."+createSign("RSA-SHA256").update(signed).sign(keys.privateKey).toString("base64url");
}
function counter(limit=20){
  let calls=0;
  return {get calls(){return calls},prepare(){
    return {bind(){return {async first(){calls++;return calls<=limit?{requests:calls}:null}}}}
  }};
}
function env(patch={}){
  return {ADVANCED_COMPUTE_ENABLED:"true",
    ADVANCED_ENGINE_TOKEN:SHARED,
    ADVANCED_COMPUTE_ORIGIN:"https://engine.example",
    CF_ACCESS_TEAM_DOMAIN:ISSUER,
    CF_ACCESS_AUD:AUD,
    ADVANCED_USAGE_DB:counter(),
    ...patch};
}
function req(data,token=jwt(),origin="https://statlab.example"){
  return new Request("https://statlab.example/api/advanced/run",{
    method:"POST",headers:{"Content-Type":"application/json",
      "Cf-Access-Jwt-Assertion":token,"Origin":origin},body:JSON.stringify(data)});
}
const valid={mode:"arima",values:Array.from({length:110},(_,i)=>12+Math.sin(i/3)),
  p:1,d:0,q:0,steps:3,consent:true};
function network(captured=[]){
  return async function(url,options){
    if(url===ISSUER+"/cdn-cgi/access/certs"){
      return Response.json({keys:[{...jwk,kid:"unit-test-key"}]});
    }
    captured.push({url,options});
    return Response.json({title:"Verified example",tables:[{title:"Numbers",columns:["X"],rows:[[1]]}],
      warnings:[],narrative:"Numerical reference",method:"test service"});
  };
}

test("public status is fail-closed and does not disclose secrets",async()=>{
  const worker=createGateway(async()=>{throw Error("Never fetch");});
  const r=await worker.fetch(new Request("https://statlab.example/api/advanced/status"),env({ADVANCED_COMPUTE_ENABLED:"false"}));
  assert.equal(r.status,200);const payload=await r.json();assert.equal(payload.available,false);
  assert.equal(JSON.stringify(payload).includes(SHARED),false);
});
test("pilot disabled and absent quota deny before network",async()=>{
  let touched=0;
  const worker=createGateway(async()=>{touched++;throw Error("No network");});
  const off=await worker.fetch(req(valid),env({ADVANCED_COMPUTE_ENABLED:"false"}));
  const unmetered=await worker.fetch(req(valid),env({ADVANCED_USAGE_DB:undefined}));
  assert.equal(off.status,503);assert.equal(unmetered.status,503);assert.equal(touched,0);
});
test("missing, forged, expired and wrong-audience Access JWTs fail closed",async()=>{
  const captured=[],worker=createGateway(network(captured)),settings=env();
  assert.equal((await worker.fetch(req(valid,""),settings)).status,401);
  assert.equal((await worker.fetch(req(valid,jwt({exp:1})),settings)).status,401);
  assert.equal((await worker.fetch(req(valid,jwt({aud:["not-my-app"]})),settings)).status,401);
  const forged=jwt().slice(0,-4)+"AAAA";
  assert.equal((await worker.fetch(req(valid,forged),settings)).status,401);
  assert.equal(captured.length,0);assert.equal(settings.ADVANCED_USAGE_DB.calls,0);
});
test("cross-site requests and missing consent never reach computing service",async()=>{
  const captured=[],worker=createGateway(network(captured)),settings=env();
  assert.equal((await worker.fetch(req(valid,jwt(),"https://evil.example"),settings)).status,403);
  assert.equal((await worker.fetch(req({...valid,consent:false}),settings)).status,422);
  assert.equal((await worker.fetch(req({...valid,values:[1,2,3]}),settings)).status,422);
  assert.equal(captured.length,0);
});
test("valid JWT and consent proxy ONLY bounded numeric values and hide backend key",async()=>{
  const captured=[],worker=createGateway(network(captured)),settings=env();
  const r=await worker.fetch(req(valid),settings);
  assert.equal(r.status,200);
  const output=await r.json();assert.equal(output.title,"Verified example");
  assert.equal(JSON.stringify(output).includes(SHARED),false);
  assert.equal(captured.length,1);
  assert.equal(captured[0].url,"https://engine.example/internal/compute");
  assert.equal(captured[0].options.headers.Authorization,"Bearer "+SHARED);
  assert.deepEqual(JSON.parse(captured[0].options.body),{
    mode:"arima",values:valid.values,steps:3,p:1,d:0,q:0,input_type:"prices"});
  assert.equal(settings.ADVANCED_USAGE_DB.calls,1);
});
test("quota is enforced with no upstream request on overage",async()=>{
  const captured=[],worker=createGateway(network(captured)),settings=env({ADVANCED_USAGE_DB:counter(1)});
  assert.equal((await worker.fetch(req(valid),settings)).status,200);
  assert.equal((await worker.fetch(req(valid),settings)).status,429);
  assert.equal(captured.length,1);
});
test("disallowed backend origin and unknown fields reject",async()=>{
  const captured=[],worker=createGateway(network(captured));
  assert.equal((await worker.fetch(req(valid),env({ADVANCED_COMPUTE_ORIGIN:"http://127.0.0.1"}))).status,503);
  assert.equal((await worker.fetch(req({...valid,dataset_id:"unauthorized"}),env())).status,422);
  assert.equal(captured.length,0);
});
test("unrelated existing Cloudflare API paths retain their restricted behavior",async()=>{
  const worker=createGateway(network());
  assert.equal((await worker.fetch(new Request("https://statlab.example/api/datasets"),env())).status,404);
});
