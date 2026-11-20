// Opt-in, fail-closed, Cloudflare Access authenticated advanced-compute bridge.
// Does not expose the unprotected FastAPI dataset-session endpoints.
const LIMIT=60000;
const MAX_BACKEND_RESPONSE_BYTES=85000;
const MAX_JWKS_BYTES=64000;

async function readBoundedJson(response,maxBytes) {
  const advertised=response.headers.get("content-length");
  if(advertised!==null) {
    const value=Number(advertised);
    if(!Number.isFinite(value)||value<0||value>maxBytes)throw Error("Response exceeds configured size.");
  }
  const reader=response.body?.getReader();
  if(!reader)throw Error("Missing response body.");
  const parts=[];let total=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes) {
        await reader.cancel();
        throw Error("Response exceeds configured size.");
      }
      parts.push(value);
    }
    const out=new Uint8Array(total);let offset=0;
    for(const item of parts){out.set(item,offset);offset+=item.length}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(out));
  }finally {
    try {reader.releaseLock()} catch {/* Body may have been canceled. */}
  }
}
const HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const reply=(code,payload)=>new Response(JSON.stringify(payload),{status:code,headers:HEADERS});
const enabled=env=>env.ADVANCED_COMPUTE_ENABLED==="true" &&
  typeof env.ADVANCED_ENGINE_TOKEN==="string" && env.ADVANCED_ENGINE_TOKEN.length>=32 &&
  typeof env.ADVANCED_QUOTA_HMAC_SECRET==="string" && env.ADVANCED_QUOTA_HMAC_SECRET.length>=32 &&
  typeof env.ADVANCED_COMPUTE_ORIGIN==="string" &&
  /^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(env.ADVANCED_COMPUTE_ORIGIN) &&
  typeof env.CF_ACCESS_TEAM_DOMAIN==="string" &&
  /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(env.CF_ACCESS_TEAM_DOMAIN) &&
  typeof env.CF_ACCESS_AUD==="string" && env.CF_ACCESS_AUD.length>=10 &&
  env.ADVANCED_USAGE_DB?.prepare instanceof Function;

const decodeBase64URL=s=>{
  if(typeof s!=="string"||!/^[\w-]+$/.test(s))throw Error("Invalid JWT encoding");
  return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
};
async function verifiedSubject(token,env,network) {
  if(typeof token!=="string"||token.length>9000)return null;
  const parts=token.split(".");
  if(parts.length!==3)return null;
  try {
    const header=JSON.parse(new TextDecoder().decode(decodeBase64URL(parts[0])));
    const payload=JSON.parse(new TextDecoder().decode(decodeBase64URL(parts[1])));
    if(header.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>256)return null;
    const now=Math.floor(Date.now()/1000);
    const audiences=Array.isArray(payload.aud)?payload.aud:[payload.aud];
    if(payload.iss!==env.CF_ACCESS_TEAM_DOMAIN||!audiences.includes(env.CF_ACCESS_AUD)||
       !Number.isInteger(payload.exp)||payload.exp<=now||
       (payload.nbf!==undefined&&(!Number.isInteger(payload.nbf)||payload.nbf>now+30))||
       typeof payload.sub!=="string"||!payload.sub||payload.sub.length>256)return null;
    const response=await network(env.CF_ACCESS_TEAM_DOMAIN+"/cdn-cgi/access/certs",
      {redirect:"error",headers:{Accept:"application/json"},signal:AbortSignal.timeout(5000)});
    if(!response.ok)return null;
    const certs=await readBoundedJson(response,MAX_JWKS_BYTES);
    const key=(Array.isArray(certs.keys)?certs.keys:[]).find(k=>k.kid===header.kid&&k.kty==="RSA");
    if(!key||typeof key.n!=="string"||typeof key.e!=="string")return null;
    const publicKey=await crypto.subtle.importKey("jwk",
      {kty:"RSA",n:key.n,e:key.e,alg:"RS256",ext:true},
      {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    const data=new TextEncoder().encode(parts[0]+"."+parts[1]);
    const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,decodeBase64URL(parts[2]),data);
    return valid?payload.sub:null;
  }catch{return null}
}
async function readLimitedJson(request) {
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))
    return {error:reply(415,{error:"Use application/json."})};
  const length=Number(request.headers.get("content-length")||0);
  if(!Number.isFinite(length)||length>LIMIT)return {error:reply(413,{error:"Maximum request size exceeded."})};
  const reader=request.body?.getReader();
  if(!reader)return {error:reply(422,{error:"A JSON request body is required."})};
  const bytes=[];let total=0;
  try {
    for(;;){
      const next=await reader.read();if(next.done)break;
      total+=next.value.byteLength;
      if(total>LIMIT){await reader.cancel();return {error:reply(413,{error:"Maximum request size exceeded."})}}
      bytes.push(next.value);
    }
    const joined=new Uint8Array(total);let at=0;
    for(const b of bytes){joined.set(b,at);at+=b.length}
    const data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(joined));
    if(!data||typeof data!=="object"||Array.isArray(data))
      return {error:reply(422,{error:"Expected a JSON object."})};
    return {data};
  }catch{return {error:reply(400,{error:"Invalid JSON or UTF-8."})}}
}
const MODE_INPUTS=new Set(["prices","returns_decimal","returns_percent"]);
function validPayload(data){
  const allowed=new Set(["mode","values","steps","p","d","q","input_type","consent"]);
  if(Object.keys(data).some(k=>!allowed.has(k)))return false;
  if(data.consent!==true||!["arima","garch"].includes(data.mode))return false;
  const size=data.mode==="arima"?[50,1200]:[150,2500];
  if(!Array.isArray(data.values)||data.values.length<size[0]||data.values.length>size[1]||
     data.values.some(v=>typeof v!=="number"||!Number.isFinite(v)))return false;
  if(!Number.isInteger(data.steps)||data.steps<1||data.steps>12)return false;
  if(data.mode==="arima"){
    if(![data.p,data.d,data.q].every(Number.isInteger))return false;
    return data.p>=0&&data.p<=2&&data.d>=0&&data.d<=1&&data.q>=0&&data.q<=2&&data.p+data.q<=3;
  }
  return MODE_INPUTS.has(data.input_type);
}
async function accountForRequest(subject,env) {
  // Secret-keyed pseudonymisation prevents straightforward offline subject-ID guessing.
  const key=await crypto.subtle.importKey("raw",
    new TextEncoder().encode(env.ADVANCED_QUOTA_HMAC_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=await crypto.subtle.sign("HMAC",key,
    new TextEncoder().encode("statlab-advanced-v2:"+env.CF_ACCESS_AUD+":"+subject));
  const hash=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,"0")).join("");
  const day=new Date().toISOString().slice(0,10);
  // Requires pre-created D1 table. A missing binding or table disables compute.
  // This atomic UPSERT rejects calls after twenty daily research jobs per Access identity.
  const sql="INSERT INTO statlab_compute_usage (subject_hash, day, requests) VALUES (?1, ?2, 1) "+
    "ON CONFLICT(subject_hash,day) DO UPDATE SET requests=requests+1 WHERE requests<20 RETURNING requests";
  return env.ADVANCED_USAGE_DB.prepare(sql).bind(hash,day).first();
}
async function pilotReady(env,network){
  if(!enabled(env))return false;
  try{
    // Read-only check: an absent D1 table or disconnected binding must fail closed.
    const day=new Date().toISOString().slice(0,10);
    const row=await env.ADVANCED_USAGE_DB.prepare(
      "SELECT COUNT(*) AS entries FROM statlab_compute_usage WHERE day=?1"
    ).bind(day).first();
    if(!row||typeof row.entries!=="number")return false;
    const response=await network(env.ADVANCED_COMPUTE_ORIGIN+"/internal/ready",{
      method:"GET",redirect:"error",headers:{
        "Authorization":"Bearer "+env.ADVANCED_ENGINE_TOKEN,
        "Accept":"application/json",
      },signal:AbortSignal.timeout(3500),
    });
    if(!response.ok)return false;
    const status=await readBoundedJson(response,2048);
    return status?.ok===true&&status?.service==="statlab-private-compute"&&
      Array.isArray(status.models)&&status.models.includes("arima")&&status.models.includes("garch");
  }catch{return false}
}
export function createAdvancedGateway(network=globalThis.fetch){
  return async function advanced(request,env){
    const path=new URL(request.url).pathname;
    if(path==="/api/advanced/status"&&request.method==="GET"){
      const ready=await pilotReady(env,network);
      return reply(200,{available:ready,status:ready?"pilot_compute_ready":"disabled_or_unavailable",
        execution:"remote_python",privacy:"numeric series transferred only after explicit consent",
        researchOnly:true});
    }
    if(path!=="/api/advanced/run")return null;
    if(request.method!=="POST")return reply(405,{error:"POST required."});
    if(!enabled(env))return reply(503,{error:"Advanced remote computation has not been configured."});
    const origin=request.headers.get("Origin");
    if(origin&&origin!==new URL(request.url).origin)return reply(403,{error:"Cross-site requests are not allowed."});
    const subject=await verifiedSubject(request.headers.get("Cf-Access-Jwt-Assertion"),env,network);
    if(!subject)return reply(401,{error:"A valid Cloudflare Access session is required."});
    const parsed=await readLimitedJson(request);
    if(parsed.error)return parsed.error;
    if(!validPayload(parsed.data))return reply(422,{error:"Invalid series, settings or missing explicit consent."});
    try{
      const allowed=await accountForRequest(subject,env);
      if(!allowed)return reply(429,{error:"Pilot daily computing limit reached."});
    }catch{return reply(503,{error:"Pilot usage accounting is unavailable; computation remains disabled."})}
    const input=parsed.data;
    const clean={mode:input.mode,values:input.values,steps:input.steps,
      p:input.mode==="arima"?input.p:0,d:input.mode==="arima"?input.d:0,
      q:input.mode==="arima"?input.q:0,
      input_type:input.mode==="garch"?input.input_type:"prices"};
    try{
      const remote=await network(env.ADVANCED_COMPUTE_ORIGIN+"/internal/compute",{
        method:"POST",redirect:"error",headers:{"Authorization":"Bearer "+env.ADVANCED_ENGINE_TOKEN,
        "Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify(clean),signal:AbortSignal.timeout(25000),
      });
      if(!remote.ok)return reply(remote.status===422?422:502,{error:"Computing service declined the analysis."});
      const parsedOutput=await readBoundedJson(remote,MAX_BACKEND_RESPONSE_BYTES);
      if(typeof parsedOutput.title!=="string"||!Array.isArray(parsedOutput.tables)||
         !Array.isArray(parsedOutput.warnings))throw Error("Unexpected response");
      return reply(200,{...parsedOutput,execution:"remote_python",researchOnly:true});
    }catch{return reply(502,{error:"Computing service is unavailable or returned an invalid result."})}
  }
}
