// Integration test: REAL Python numerical engine behind the in-process Cloudflare Worker.
// No deployed services, real student data, paid infrastructure or external requests.
// Run explicitly in Python CI after installing requirements-dev.txt.
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createSign, generateKeyPairSync} from "node:crypto";
import {createServer} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
import {createGateway} from "../../cloudflare/src/index.mjs";
import {syntheticTimeSeries} from "../../cloudflare/public/advanced-demo.mjs";

const TEAM="https://statlab-pilot.cloudflareaccess.com";
const AUD="statlab-advanced-integration-only";
const ORIGIN="https://engine.example";
const BACKEND_TOKEN="integration-only-private-secret-with-at-least-32-characters";
const identity="synthetic-pilot-user-do-not-create-real-account";
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const publicJwk=publicKey.export({format:"jwk"});
const keyId="in-process-jwks-fixture";

async function availablePort(){
  const server=createServer();
  return new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}
function accessAssertion(overrides={}){
  const base=seconds=>Math.floor(Date.now()/1000)+seconds;
  const head={alg:"RS256",kid:keyId,typ:"JWT"};
  const claims={iss:TEAM,aud:[AUD],exp:base(300),nbf:base(-5),sub:identity,...overrides};
  const encoded=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const signed=encoded(head)+"."+encoded(claims);
  return signed+"."+createSign("RSA-SHA256").update(signed).sign(privateKey).toString("base64url");
}
function request(payload,token=accessAssertion()){
  return new Request("https://statlab.example/api/advanced/run",{
    method:"POST",
    headers:{"Origin":"https://statlab.example","Content-Type":"application/json",
      "Cf-Access-Jwt-Assertion":token},
    body:JSON.stringify(payload),
  });
}
function quotaDB(){
  const counts=new Map();
  const subjects=[];
  return {
    subjects,counts,
    prepare(sql){
      assert.match(sql,/ON CONFLICT\(subject_hash,day\)/);
      return {
        bind(subject,date){
          subjects.push(subject);
          assert.match(subject,/^[a-f0-9]{64}$/);
          assert.notEqual(subject,identity);
          assert.match(date,/^\d{4}-\d{2}-\d{2}$/);
          const key=subject+":"+date;
          return {async first(){
            const previous=counts.get(key)||0;
            if(previous>=20)return null;
            counts.set(key,previous+1);
            return {requests:previous+1};
          }};
        }
      };
    }
  };
}
async function waitUntilHealthy(url,child) {
  for(let attempt=0;attempt<90;attempt++){
    if(child.exitCode!==null)throw Error("Local Python engine exited before health check.");
    try{
      const response=await fetch(url+"/health",{signal:AbortSignal.timeout(500)});
      if(response.ok){
        const body=await response.json();
        assert.equal(body.service,"statlab-private-compute");
        return;
      }
    }catch{/* Service not started yet. */}
    await sleep(150);
  }
  throw Error("Python test service failed to become healthy.");
}
async function stop(child){
  if(child.exitCode!==null)return;
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve=>child.once("exit",resolve)),sleep(3500)]);
  if(child.exitCode===null){child.kill("SIGKILL");await sleep(100);}
}
test("Cloudflare JWT + D1 quota -> real Python ARIMA/GARCH over HTTP", {timeout:60000},async()=>{
  const port=await availablePort();
  const backend="http://127.0.0.1:"+port;
  const child=spawn(process.env.STATLAB_PYTHON||"python",[
    "-m","uvicorn","app.compute_service:app",
    "--host","127.0.0.1","--port",String(port),"--workers","1",
    "--no-access-log"
  ],{cwd:process.cwd(),
     env:{...process.env,STATLAB_COMPUTE_SHARED_TOKEN:BACKEND_TOKEN},
     stdio:["ignore","pipe","pipe"]});
  let stderr="";
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-3000)});
  // Do not echo the bearer token or numeric research data to logs.
  const forwarded=[];
  const database=quotaDB();
  const gateway=createGateway(async(url,init)=>{
    if(url===TEAM+"/cdn-cgi/access/certs")return Response.json({
      keys:[{...publicJwk,kid:keyId}]
    });
    if(url===ORIGIN+"/internal/compute"){
      const {Authorization,...safeHeaders}=init.headers;
      assert.equal(Authorization,"Bearer "+BACKEND_TOKEN);
      forwarded.push({mode:JSON.parse(init.body).mode,host:url});
      return fetch(backend+"/internal/compute",init);
    }
    throw Error("Unexpected network destination: "+url);
  });
  const env={ADVANCED_COMPUTE_ENABLED:"true",
    ADVANCED_COMPUTE_ORIGIN:ORIGIN,ADVANCED_ENGINE_TOKEN:BACKEND_TOKEN,
    ADVANCED_QUOTA_HMAC_SECRET:"integration-only-pseudonym-key-very-long-and-private",
    CF_ACCESS_TEAM_DOMAIN:TEAM,CF_ACCESS_AUD:AUD,ADVANCED_USAGE_DB:database};
  try{
    await waitUntilHealthy(backend,child);
    const protectedOriginal=await fetch(backend+"/api/datasets");
    assert.equal(protectedOriginal.status,404);
    const directNoToken=await fetch(backend+"/internal/compute",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({mode:"arima",values:[1,2,3],steps:3})
    });
    assert.equal(directNoToken.status,401);

    const disabled=await gateway.fetch(request({mode:"arima",values:[1]}),
      {...env,ADVANCED_COMPUTE_ENABLED:"false"});
    assert.equal(disabled.status,503);
    const invalidIdentity=await gateway.fetch(request(
      {mode:"arima",values:Array.from({length:95},(_,i)=>i),p:1,d:0,q:0,steps:3,consent:true},
      accessAssertion({aud:"not-this-pilot"})
    ),env);
    assert.equal(invalidIdentity.status,401);
    assert.equal(forwarded.length,0);
    const missingConsent=await gateway.fetch(request({
      mode:"arima",values:Array.from({length:95},(_,i)=>i),p:1,d:0,q:0,steps:3,consent:false,
    }),env);
    assert.equal(missingConsent.status,422);
    assert.equal(forwarded.length,0);
    const arimaValues=syntheticTimeSeries("arima").slice(1).map(r=>Number(r[1]));
    const arimaRequest={mode:"arima",values:arimaValues,p:1,d:0,q:0,steps:3,consent:true};
    const arimaResponse=await gateway.fetch(request(arimaRequest),env);
    assert.equal(arimaResponse.status,200,await arimaResponse.clone().text());
    const arima=await arimaResponse.json();
    assert.match(arima.title,/ARIMA\(1,0,0\)/);
    assert.equal(arima.execution,"remote_python");
    assert.equal(arima.n_submitted,96);
    assert.equal(arima.tables[2].rows.length,3);
    assert.ok(arima.tables[1].rows.every(row=>Number.isFinite(row[1])));
    assert.equal(arima.tables[2].rows[0][0],"T+1");
    assert.equal(JSON.stringify(arima).includes(BACKEND_TOKEN),false);
    assert.equal(JSON.stringify(arima).includes(identity),false);
    console.log("Cloudflare → private Python ARIMA: OK, real 3-step forecast on 96 synthetic periods");

    const prices=syntheticTimeSeries("garch").slice(1).map(r=>Number(r[1]));
    const garchResponse=await gateway.fetch(request({
      mode:"garch",values:prices,steps:3,input_type:"prices",consent:true
    }),env);
    assert.equal(garchResponse.status,200,await garchResponse.clone().text());
    const garch=await garchResponse.json();
    assert.match(garch.title,/GARCH\(1,1\)/);
    assert.equal(garch.n_submitted,320);
    assert.equal(garch.tables[3].rows.length,3);
    for(const [name,variance,volatility] of garch.tables[3].rows){
      assert.ok(name.startsWith("T+"));
      assert.ok(variance>0&&volatility>0);
    }
    assert.equal(garch.execution,"remote_python");
    assert.equal(forwarded.length,2);
    assert.equal(database.subjects.length,2);
    assert.equal(database.counts.values().next().value,2);
    console.log("Cloudflare → private Python GARCH: OK, real 3-step volatility on 320 synthetic prices");
    console.log("Cloudflare JWT, explicit consent, hashed-identity quotas and local auth: OK");
  }catch(e){
    const diagnostic=stderr.replaceAll(BACKEND_TOKEN,"[REDACTED]");
    if(diagnostic)console.error("Local engine diagnostic:",diagnostic);
    throw e;
  }finally{
    await stop(child);
  }
});
