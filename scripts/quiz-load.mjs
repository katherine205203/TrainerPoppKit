import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const base=process.env.QUIZ_LOAD_URL??"http://127.0.0.1:8787";
const count=Number(process.env.QUIZ_LOAD_COUNT??200);
assert.ok(Number.isInteger(count)&&count>=1&&count<=500);
const vars=Object.fromEntries(readFileSync(new URL("../.dev.vars",import.meta.url),"utf8").split(/\r?\n/).filter((line)=>/^[A-Z_]+=/.test(line)).map((line)=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
assert.ok(vars.OWNER_PASSWORD);
let cookie="";
async function call(path,method="GET",payload,token,ip="quiz-load"){
  const start=performance.now();
  try{
    const response=await fetch(base+"/api"+path,{method,headers:{Origin:base,"Content-Type":"application/json","CF-Connecting-IP":ip,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
    const body=await response.json();
    return {status:response.status,body,ms:performance.now()-start,headers:response.headers};
  }catch(error){return {status:0,body:{error:error instanceof Error?error.message:"Network failure"},ms:performance.now()-start};}
}
function ok(result,label){assert.ok(result.status>=200&&result.status<300,label+": "+result.status+" "+JSON.stringify(result.body));return result.body;}
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]?.toFixed(1)??0);}
const login=await call("/auth/login","POST",{password:vars.OWNER_PASSWORD});ok(login,"owner login");cookie=login.headers.get("set-cookie")?.split(";")[0]??"";assert.ok(cookie);
const questionId=randomUUID(),rightId=randomUUID(),wrongId=randomUUID();
const definition=ok(await call("/owner/quiz/definitions","POST",{title:"Quiz load "+Date.now(),description:"Local concurrency measurement",sharedLiveTimerMs:60000,sharedBasePoints:1000,questions:[{id:questionId,type:"SINGLE_CHOICE",stem:"Choose the correct option",options:[{id:rightId,label:"Correct"},{id:wrongId,label:"Incorrect"}],correctOptionIds:[rightId],explanation:"",hopeMultiplier:1}]}),"create Definition").definition;
ok(await call("/owner/quiz/definitions/"+definition.id+"/publish","POST",{}),"publish");
const activity=ok(await call("/owner/quiz/activities","POST",{definitionId:definition.id}),"create Activity").activity;
const run=ok(await call("/owner/quiz/activities/"+activity.id+"/runs","POST",{name:"Concurrent answers",runType:"LIVE",competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]}),"create Run").run;
const participants=[];
const joinStart=performance.now();
for(let i=0;i<count;i++){
  const joined=ok(await call("/quiz/join","POST",{runId:run.id,nickname:"Load "+String(i+1).padStart(3,"0")},undefined,"quiz-load-join-"+i),"join participant "+(i+1));
  participants.push(joined.token);
}
const joinMs=performance.now()-joinStart;
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"START_RUN"}),"start Run");
await new Promise((resolve)=>setTimeout(resolve,3200));
const phase=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"question phase");assert.equal(phase.run.phase,"ANSWERING");
const burstStart=performance.now();
const answers=await Promise.all(participants.map((token,i)=>call("/quiz/runs/"+run.id+"/answer","POST",{questionId,selectedOptionIds:[rightId],requestId:randomUUID()},token,"quiz-load-answer-"+i)));
const burstMs=performance.now()-burstStart;
const accepted=answers.filter((answer)=>answer.status===200).length;
const failed=answers.filter((answer)=>answer.status!==200);
const state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"answer count");
const locked=accepted===count?await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"LOCK_EARLY"}):null;
const participantAfterLock=locked?.status===200?await call("/quiz/runs/"+run.id+"/state","GET",undefined,participants[0],"quiz-load-reconnect"):null;
console.log(JSON.stringify({environment:"local Cloudflare Worker + D1",runId:run.id,participants:count,joinMs:Number(joinMs.toFixed(1)),answerBurstMs:Number(burstMs.toFixed(1)),accepted,failed:failed.length,firstFailure:failed[0]?{status:failed[0].status,error:failed[0].body.error}:null,answerCount:state.answerCount,p50Ms:percentile(answers.map((answer)=>answer.ms),.5),p95Ms:percentile(answers.map((answer)=>answer.ms),.95),p99Ms:percentile(answers.map((answer)=>answer.ms),.99),lockStatus:locked?.status??null,lockAckMs:locked?Number(locked.ms.toFixed(1)):null,reconnectState:participantAfterLock?.body.run?.phase??null,reconnectReadMs:participantAfterLock?Number(participantAfterLock.ms.toFixed(1)):null}));
assert.equal(accepted,count,"all concurrent answers accepted");
assert.equal(state.answerCount,count,"all answers persisted once");
ok(locked,"early lock after all answers");
assert.equal(participantAfterLock?.body.run?.phase,"LOCKED","participant reconnect sees locked phase");
if (["127.0.0.1","localhost"].includes(new URL(base).hostname) && process.env.QUIZ_LOAD_KEEP!=="1") {
  assert.ok([activity.id,definition.id].every((value)=>/^[0-9a-f-]{36}$/i.test(value)));
  execFileSync("npx",["wrangler","d1","execute","trainerpopp-kit","--local","--command",
    `DELETE FROM activities WHERE id='${activity.id}'; DELETE FROM quiz_definitions WHERE id='${definition.id}';`],
  {cwd:new URL("..",import.meta.url),env:{...process.env,WRANGLER_WRITE_LOGS:"false"},stdio:"ignore"});
}
