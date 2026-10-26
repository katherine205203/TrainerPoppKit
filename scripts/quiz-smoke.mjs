import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const base = process.env.QUIZ_SMOKE_URL ?? "http://127.0.0.1:8787";
const fixtures = { definitionIds: new Set(), activityIds: new Set(), sessionIds: new Set() };
function cleanupFixtures() {
  if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) return;
  const ids = [...fixtures.definitionIds, ...fixtures.activityIds, ...fixtures.sessionIds];
  if (!ids.length || !ids.every((value) => /^[0-9a-f-]{36}$/i.test(value))) return;
  const statements = [
    fixtures.activityIds.size ? `DELETE FROM activities WHERE id IN (${[...fixtures.activityIds].map((id) => `'${id}'`).join(",")});` : "",
    fixtures.sessionIds.size ? `DELETE FROM sessions WHERE id IN (${[...fixtures.sessionIds].map((id) => `'${id}'`).join(",")});` : "",
    fixtures.definitionIds.size ? `DELETE FROM quiz_definitions WHERE id IN (${[...fixtures.definitionIds].map((id) => `'${id}'`).join(",")});` : "",
  ].join(" ");
  try { execFileSync("npx", ["wrangler", "d1", "execute", "trainerpopp-kit", "--local", "--command", statements], { cwd: new URL("..", import.meta.url), env: { ...process.env, WRANGLER_WRITE_LOGS: "false" }, stdio: "ignore" }); }
  catch { /* Keep the original test failure visible if local fixture cleanup is unavailable. */ }
}
process.on("exit", cleanupFixtures);
const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0,index),line.slice(index+1).trim().replace(/^["']|["']$/g,"")];
}));
assert.ok(vars.OWNER_PASSWORD, "Local OWNER_PASSWORD is needed in .dev.vars");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = "";
let requestCount = 0;
async function call(path,method="GET",payload,token) {
  requestCount += 1;
  const response=await fetch(base+"/api"+path,{method,headers:{"Content-Type":"application/json",Origin:base,"CF-Connecting-IP":`198.51.100.${(requestCount%250)+1}`,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
  const body=response.headers.get("content-type")?.includes("application/json")?await response.json():await response.text();
  return {status:response.status,body,headers:response.headers};
}
function ok(result,label){assert.ok(result.status>=200&&result.status<300,label+": "+result.status+" "+JSON.stringify(result.body));return result.body;}
function matchAnswerToken(leftId,rightId){return `${leftId}::${rightId}`;}
const login=await call("/auth/login","POST",{password:vars.OWNER_PASSWORD});ok(login,"owner sign-in");cookie=login.headers.get("set-cookie")?.split(";")[0]??"";
assert.ok(cookie,"signed owner cookie");
const q1=randomUUID(),q2=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID();
const definition=ok(await call("/owner/quiz/definitions","POST",{title:"Quiz smoke "+Date.now(),description:"Local lifecycle check",sharedLiveTimerMs:5000,sharedBasePoints:1000,questions:[
  {id:q1,type:"SINGLE_CHOICE",stem:"Choose A",options:[{id:a,label:"A"},{id:b,label:"B"}],correctOptionIds:[a],explanation:"A is correct.",hopeMultiplier:3},
  {id:q2,type:"MULTIPLE_CHOICE",stem:"Choose both",options:[{id:c,label:"C"},{id:d,label:"D"}],correctOptionIds:[c,d],explanation:"Both are correct.",hopeMultiplier:1},
]}),"create Definition").definition;
fixtures.definitionIds.add(definition.id);
ok(await call("/owner/quiz/definitions/"+definition.id+"/publish","POST",{}),"publish");
const activity=ok(await call("/owner/quiz/activities","POST",{definitionId:definition.id}),"create Activity").activity;
fixtures.activityIds.add(activity.id);
const run=ok(await call("/owner/quiz/activities/"+activity.id+"/runs","POST",{name:"Live Team",runType:"LIVE",competitionMode:"TEAM",hostingMode:"MANUAL",scoringMode:"ACCURACY_SPEED",teams:["Red","Blue"]}),"create Live Run").run;
const manualPresenter=ok(await call("/owner/quiz/runs/"+run.id+"/presenter-token","POST",{}),"create Run-pinned Manual Presenter token");
const manualPresenterToken=new URL(manualPresenter.url).hash.slice(1);
if (process.env.QUIZ_SMOKE_VISUAL === "1") {
  console.log("Local Quiz visual fixture:",activity.id,run.id);
  process.exit(0);
}
let state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"owner state");
assert.equal((await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"START_RUN"})).status,409,"Live Run requires at least one participant");
const liveActivity=ok(await call("/owner/gdm/activities/"+activity.id),"current Quiz Activity access").activity;
const livePin=liveActivity.join_pin;
assert.notEqual(livePin,activity.joinPin,"starting a Run rotates the Activity PIN");
const red=state.teams.find((team)=>team.name==="Red").id,blue=state.teams.find((team)=>team.name==="Blue").id;
const lookup=ok(await call("/join/lookup","POST",{pin:livePin}),"generic PIN lookup");
assert.equal(lookup.activity.toolId,"quiz");
const guest1=ok(await call("/quiz/join","POST",{runId:run.id,nickname:"Red One",teamId:red}),"join Red");
const guest2=ok(await call("/quiz/join","POST",{runId:run.id,nickname:"Blue One",teamId:blue}),"join Blue");
let switched=ok(await call("/quiz/runs/"+run.id+"/team","POST",{teamId:red},guest2.token),"change Team before start");
assert.equal(switched.participant.teamId,red);
switched=ok(await call("/quiz/runs/"+run.id+"/team","POST",{teamId:blue},guest2.token),"restore Team before start");
assert.equal(switched.participant.teamId,blue);
assert.equal((await call("/quiz/join","POST",{runId:run.id,nickname:"  rEd   oNe ",teamId:blue})).status,409,"normalized duplicate nickname rejected");
let guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"lobby projection");
assert.equal(guestState.question,null);
assert.equal((await call("/quiz/runs/"+run.id+"/state","GET",undefined,livePin)).status,401,"PIN is not participant token");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"START_RUN"}),"start Live");
await delay(3200);
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"first question");
assert.equal(guestState.run.phase,"ANSWERING");
assert.equal(guestState.question.correctOptionIds,undefined,"key hidden while answering");
assert.equal((await call("/quiz/runs/"+run.id+"/team","POST",{teamId:red},guest2.token)).status,409,"Team locked after start");
const late=ok(await call("/quiz/join","POST",{runId:run.id,nickname:"Red Late",teamId:red}),"join mid-question");
let lateState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,late.token),"mid-question eligibility");
assert.equal(lateState.eligible,false,"mid-question join is not eligible");
assert.equal((await call("/quiz/runs/"+run.id+"/answer","POST",{questionId:q1,selectedOptionIds:[a],requestId:randomUUID()},late.token)).status,409,"mid-question late answer rejected");
const answerId=randomUUID();
ok(await call("/quiz/runs/"+run.id+"/answer","POST",{questionId:q1,selectedOptionIds:[a],requestId:answerId},guest1.token),"answer Red");
ok(await call("/quiz/runs/"+run.id+"/answer","POST",{questionId:q1,selectedOptionIds:[b],requestId:randomUUID()},guest2.token),"answer Blue");
ok(await call("/quiz/runs/"+run.id+"/answer","POST",{questionId:q1,selectedOptionIds:[a],requestId:answerId},guest1.token),"idempotent retry");
state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"pre-lock state");
assert.equal(state.answerCount,2);
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"LOCK_EARLY",expectedRevision:state.run.revision}),"manual early lock");
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"locked projection");
assert.equal(guestState.question.correctOptionIds,undefined,"key hidden while locked");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"REVEAL_ANSWER"}),"reveal");
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"revealed projection");
assert.deepEqual(guestState.question.correctOptionIds,[a]);
assert.equal(guestState.myResult,null,"Manual question feedback does not reveal cumulative results");assert.deepEqual(guestState.leaderboard,[],"Manual question feedback does not publish a leaderboard");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"NEXT_QUESTION"}),"next question");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"OPEN_QUESTION"}),"open second");
await delay(3200);
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,late.token),"late eligibility");
assert.equal(guestState.eligible,true);
assert.equal((await call("/quiz/join","POST",{runId:run.id,nickname:"Too Late",teamId:blue})).status,409,"final question closes Join");
ok(await call("/quiz/runs/"+run.id+"/answer","POST",{questionId:q2,selectedOptionIds:[d,c],requestId:randomUUID()},late.token),"late answer");
await delay(5100);
state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"second lock");
assert.equal(state.run.phase,"LOCKED");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"REVEAL_ANSWER"}),"reveal second");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"NEXT_QUESTION"}),"finish Live");
state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"final Live state");
assert.equal(state.run.state,"COMPLETED");
assert.equal(state.results.team.find((team)=>team.name==="Red").members,2);
assert.equal((await fetch(base+"/api/owner/quiz/runs/"+run.id+"/results.csv",{headers:{Authorization:"Bearer "+guest1.token,Origin:base}})).status,401,"guest cannot export results");
ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"DISQUALIFY",participantId:late.participantId,reason:"Local smoke check"}),"disqualify completed participant");
state=ok(await call("/owner/quiz/runs/"+run.id+"/state"),"corrected Team divisor");
assert.equal(state.results.team.find((team)=>team.name==="Red").members,1,"DQ removes Team denominator");
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"completed hidden Participant projection");
assert.equal(state.run.final_results_visibility,"HIDDEN");assert.equal(guestState.myResult,null);assert.equal(guestState.teamResult,null);assert.deepEqual(guestState.leaderboard,[]);
let finalProjection=ok(await call("/quiz/runs/"+run.id+"/presenter","GET",undefined,manualPresenterToken),"completed hidden Presenter projection");
assert.equal(finalProjection.run.finalResultsVisibility,"HIDDEN");assert.deepEqual(finalProjection.leaderboard,[]);
state=ok(await call("/owner/quiz/runs/"+run.id+"/commands","POST",{kind:"REVEAL_FINAL_RESULTS",expectedRevision:state.run.revision}),"Trainer final reveal");
assert.equal(state.run.final_results_visibility,"RELEASED");
guestState=ok(await call("/quiz/runs/"+run.id+"/state","GET",undefined,guest1.token),"released Participant projection");
assert.ok(guestState.teamResult);assert.ok(guestState.leaderboard.length>0);
finalProjection=ok(await call("/quiz/runs/"+run.id+"/presenter","GET",undefined,manualPresenterToken),"released Presenter podium");assert.ok(finalProjection.leaderboard.length>0);
const csv=await call("/owner/quiz/runs/"+run.id+"/results.csv");
assert.equal(csv.status,200);assert.ok(csv.body.includes(run.id));assert.equal(csv.body.includes(guest1.token),false,"CSV excludes bearer tokens");
const second=ok(await call("/owner/quiz/activities/"+activity.id+"/runs","POST",{name:"Self-paced",runType:"SELF_PACED",teams:[],attemptTimerMs:60000,scoreReleasePolicy:"AFTER_RUN",reviewPolicy:"AFTER_RUN_DETAIL"}),"new Run").run;
assert.equal((await call("/quiz/runs/"+second.id+"/state","GET",undefined,guest1.token)).status,401,"old token cannot enter next Run");
const solo=ok(await call("/quiz/join","POST",{runId:second.id,nickname:"Solo"}),"fresh join");
ok(await call("/owner/quiz/runs/"+second.id+"/commands","POST",{kind:"START_RUN"}),"start Self-paced");
guestState=ok(await call("/quiz/runs/"+second.id+"/state","GET",undefined,solo.token),"before attempt");
assert.equal(guestState.questions,null,"questions hidden before Start Quiz");
guestState=ok(await call("/quiz/runs/"+second.id+"/attempt/start","POST",{},solo.token),"start own attempt");
assert.equal(guestState.questions.length,2);
ok(await call("/quiz/runs/"+second.id+"/attempt/draft","PUT",{questionId:q1,selectedOptionIds:[a],version:1},solo.token),"save draft");
guestState=ok(await call("/quiz/runs/"+second.id+"/attempt/submit","POST",{},solo.token),"submit");
assert.equal(guestState.myResult,null,"score pending until Run end");
ok(await call("/owner/quiz/runs/"+second.id+"/commands","POST",{kind:"END_SELF_PACED"}),"end Self-paced");
guestState=ok(await call("/quiz/runs/"+second.id+"/state","GET",undefined,solo.token),"released result");
assert.equal(guestState.myResult.points,3000);
assert.equal(guestState.review.length,2);
ok(await call("/owner/quiz/runs/"+second.id+"/commands","POST",{kind:"VOID",questionIndex:0,reason:"smoke correction"}),"void result");
state=ok(await call("/owner/quiz/runs/"+second.id+"/state"),"corrected result");
assert.equal(state.results.participants.find((person)=>person.id===guestState.participant.id).points,0);
guestState=ok(await call("/quiz/runs/"+second.id+"/state","GET",undefined,solo.token),"voided participant review");
assert.equal(guestState.review[0].voided,true);
assert.deepEqual(guestState.review[0].correctOptionIds,[]);
ok(await call("/owner/quiz/runs/"+second.id+"/commands","POST",{kind:"REGRADE",questionIndex:0,correctOptionIds:[a],reason:"Restore original key"}),"regrade result");
state=ok(await call("/owner/quiz/runs/"+second.id+"/state"),"regraded result");
assert.equal(state.results.participants.find((person)=>person.id===guestState.participant.id).points,3000);
guestState=ok(await call("/quiz/runs/"+second.id+"/state","GET",undefined,solo.token),"regraded participant review");
assert.deepEqual(guestState.review[0].correctOptionIds,[a]);
ok(await call("/owner/quiz/activities/"+activity.id+"/archive","POST",{}),"archive Activity");
ok(await call("/owner/quiz/activities/"+activity.id+"/reopen","POST",{}),"reopen Activity");
// Update Pack v1.2 acceptance: all five types, partial grading, shuffled attempts,
// immutable revisions, old-Run Presenter pinning, and independent final reveal.
const ids={q1:randomUUID(),q2:randomUUID(),q3:randomUUID(),q4:randomUUID(),q5:randomUUID(),singleA:randomUUID(),singleB:randomUUID(),multiA:randomUUID(),multiB:randomUUID(),multiC:randomUUID(),r1:randomUUID(),r2:randomUUID(),r3:randomUUID(),m1:randomUUID(),m2:randomUUID(),m3:randomUUID()};
const v12Content={title:"Quiz v1.2 acceptance "+Date.now(),description:"All five supported text question types",sharedLiveTimerMs:5000,sharedBasePoints:1000,questions:[
  {id:ids.q1,type:"SINGLE_CHOICE",stem:"Single Choice",options:[{id:ids.singleA,label:"Correct"},{id:ids.singleB,label:"Other"}],correctOptionIds:[ids.singleA],explanation:"Single answer explanation",hopeMultiplier:1},
  {id:ids.q2,type:"MULTIPLE_CHOICE",stem:"Multiple Choice",options:[{id:ids.multiA,label:"One"},{id:ids.multiB,label:"Two"},{id:ids.multiC,label:"Distractor"}],correctOptionIds:[ids.multiA,ids.multiB],explanation:"Exact set only",hopeMultiplier:2},
  {id:ids.q3,type:"REORDER",stem:"Reorder these steps",items:[{id:ids.r1,label:"First step"},{id:ids.r2,label:"Second step"},{id:ids.r3,label:"Third step"}],correctOrderItemIds:[ids.r2,ids.r1,ids.r3],explanation:"Correct sequence",hopeMultiplier:2},
  {id:ids.q4,type:"MATCH_PAIRS",stem:"Match each term",pairs:[{id:randomUUID(),leftId:ids.m1,leftText:"One",rightId:randomUUID(),rightText:"First"},{id:randomUUID(),leftId:ids.m2,leftText:"Two",rightId:randomUUID(),rightText:"Second"},{id:randomUUID(),leftId:ids.m3,leftText:"Three",rightId:randomUUID(),rightText:"Third"}],explanation:"Correct pairs",hopeMultiplier:3},
  {id:ids.q5,type:"TRUE_FALSE",stem:"The sky is blue",options:[{id:"true",label:"True"},{id:"false",label:"False"}],correctOptionIds:["true"],explanation:"True",hopeMultiplier:1},
]};
const v12Definition=ok(await call("/owner/quiz/definitions","POST",v12Content),"create five-type Quiz Definition").definition;fixtures.definitionIds.add(v12Definition.id);
ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/publish","POST",{}),"publish five-type version 1");
const v12Activity=ok(await call("/owner/quiz/activities","POST",{definitionId:v12Definition.id}),"create five-type Quiz Activity").activity;fixtures.activityIds.add(v12Activity.id);
let versions=ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/versions"),"published version list").versions;assert.deepEqual(versions.map(item=>item.version),[1]);
const allTypesRun=ok(await call("/owner/quiz/activities/"+v12Activity.id+"/runs","POST",{name:"All five types · Live",runType:"LIVE",definitionVersion:1,competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]}),"create all-types Live Run").run;
let allTypesState=ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/state"),"all-types Run snapshot");assert.equal(allTypesState.run.definition_version,1);assert.equal(allTypesState.run.snapshot.questions.length,5);
const allTypesPlayer=ok(await call("/quiz/join","POST",{runId:allTypesRun.id,nickname:"All Types Player"}),"join all-types Run");
const allTypesPresenter=ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/presenter-token","POST",{}),"create all-types Presenter token"),allTypesPresenterToken=new URL(allTypesPresenter.url).hash.slice(1);
ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"START_RUN"}),"start all-types Live Run");
const liveAnswers=[
  [ids.q1,[ids.singleA]],
  [ids.q2,[ids.multiB,ids.multiA]],
  [ids.q3,[ids.r2,ids.r3,ids.r1]],
  [ids.q4,[matchAnswerToken(ids.m1,v12Content.questions[3].pairs[0].rightId),matchAnswerToken(ids.m2,v12Content.questions[3].pairs[2].rightId)]],
  [ids.q5,["true"]],
];
for(let index=0;index<liveAnswers.length;index++){
  if(index>0){ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"NEXT_QUESTION"}),"advance to question "+(index+1));ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"OPEN_QUESTION"}),"open question "+(index+1));}
  await delay(3200);
  let participant=ok(await call("/quiz/runs/"+allTypesRun.id+"/state","GET",undefined,allTypesPlayer.token),"question "+(index+1)+" Answering projection");
  assert.equal(participant.question.correctOptionIds,undefined);assert.equal(participant.question.correctAnswerIds,undefined,"answer key hidden while answering");
  if(index===2){const projected=ok(await call("/quiz/runs/"+allTypesRun.id+"/presenter","GET",undefined,allTypesPresenterToken),"Reorder Presenter while answering");assert.equal(projected.question.type,"REORDER");assert.equal(projected.question.correctAnswerIds,undefined);assert.equal(projected.question.items.length,3);}
  if(index===3){const invalid=await call("/quiz/runs/"+allTypesRun.id+"/answer","POST",{questionId:ids.q4,selectedOptionIds:[matchAnswerToken(ids.m1,v12Content.questions[3].pairs[0].rightId),matchAnswerToken(ids.m2,v12Content.questions[3].pairs[0].rightId)],requestId:randomUUID()},allTypesPlayer.token);assert.equal(invalid.status,400,"Match Pairs rejects duplicate right-side assignments");const projected=ok(await call("/quiz/runs/"+allTypesRun.id+"/presenter","GET",undefined,allTypesPresenterToken),"Match Pairs Presenter while answering");assert.equal(projected.question.type,"MATCH_PAIRS");assert.equal(projected.question.correctAnswerIds,undefined);assert.equal(projected.question.leftItems.length,3);assert.equal(projected.question.rightItems.length,3);}
  ok(await call("/quiz/runs/"+allTypesRun.id+"/answer","POST",{questionId:liveAnswers[index][0],selectedOptionIds:liveAnswers[index][1],requestId:randomUUID()},allTypesPlayer.token),"answer v1.2 question "+(index+1));
  allTypesState=ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/state"),"owner question state");ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"LOCK_EARLY",expectedRevision:allTypesState.run.revision}),"lock v1.2 question "+(index+1));
  ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"REVEAL_ANSWER"}),"reveal v1.2 question "+(index+1));
  participant=ok(await call("/quiz/runs/"+allTypesRun.id+"/state","GET",undefined,allTypesPlayer.token),"manual question reveal projection");
  assert.equal(participant.myResult,null,"per-question feedback does not release cumulative results");assert.deepEqual(participant.leaderboard,[],"per-question feedback does not publish a leaderboard");
  if(index===2){assert.deepEqual(participant.question.correctAnswerIds,[ids.r2,ids.r1,ids.r3]);assert.equal(participant.currentResult.status,"PARTIALLY_CORRECT");assert.equal(participant.currentResult.correctParts,1);}
  if(index===3){assert.equal(participant.question.correctAnswerIds.length,3);assert.equal(participant.currentResult.status,"PARTIALLY_CORRECT");assert.equal(participant.currentResult.correctParts,1);}
}
ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"NEXT_QUESTION"}),"complete all-types Run");
allTypesState=ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/state"),"completed all-types Run");assert.equal(allTypesState.run.final_results_visibility,"HIDDEN");
let allTypesGuest=ok(await call("/quiz/runs/"+allTypesRun.id+"/state","GET",undefined,allTypesPlayer.token),"five-type final hidden projection");assert.equal(allTypesGuest.myResult,null);assert.deepEqual(allTypesGuest.leaderboard,[]);
let allTypesProjection=ok(await call("/quiz/runs/"+allTypesRun.id+"/presenter","GET",undefined,allTypesPresenterToken),"five-type finished Presenter hidden");assert.equal(allTypesProjection.run.id,allTypesRun.id);assert.deepEqual(allTypesProjection.leaderboard,[]);
const shuffledRun=ok(await call("/owner/quiz/activities/"+v12Activity.id+"/runs","POST",{name:"All five types · Shuffled Self-paced",runType:"SELF_PACED",definitionVersion:1,shuffleQuestions:true,teams:[],scoreReleasePolicy:"AFTER_RUN",reviewPolicy:"AFTER_RUN_DETAIL"}),"create shuffled Self-paced Run").run;
const shuffledPlayer=ok(await call("/quiz/join","POST",{runId:shuffledRun.id,nickname:"Shuffled Player"}),"join shuffled Self-paced Run");ok(await call("/owner/quiz/runs/"+shuffledRun.id+"/commands","POST",{kind:"START_RUN"}),"start shuffled Self-paced Run");
let attemptState=ok(await call("/quiz/runs/"+shuffledRun.id+"/attempt/start","POST",{},shuffledPlayer.token),"start shuffled attempt");
assert.equal(attemptState.run.shuffleQuestions,true);assert.deepEqual(attemptState.questions.map(q=>q.questionIndex),attemptState.questionOrder,"shuffled order is persisted and returned consistently");
const stableOrder=[...attemptState.questionOrder];ok(await call("/quiz/runs/"+shuffledRun.id+"/attempt/navigate","PUT",{position:3},shuffledPlayer.token),"persist attempt position");
attemptState=ok(await call("/quiz/runs/"+shuffledRun.id+"/state","GET",undefined,shuffledPlayer.token),"restore shuffled attempt state");assert.equal(attemptState.attempt.current_position,3);assert.deepEqual(attemptState.questions.map(q=>q.questionIndex),stableOrder,"reload does not reshuffle a started attempt");
const reorderIndex=v12Content.questions.findIndex(q=>q.type==="REORDER"),matchIndex=v12Content.questions.findIndex(q=>q.type==="MATCH_PAIRS");
ok(await call("/quiz/runs/"+shuffledRun.id+"/attempt/draft","PUT",{questionId:ids.q3,selectedOptionIds:[],version:1,interacted:false},shuffledPlayer.token),"save untouched Reorder draft");
ok(await call("/quiz/runs/"+shuffledRun.id+"/attempt/draft","PUT",{questionId:ids.q4,selectedOptionIds:[matchAnswerToken(ids.m1,v12Content.questions[3].pairs[0].rightId)],version:1,interacted:true},shuffledPlayer.token),"save partial Match Pairs draft");
ok(await call("/quiz/runs/"+shuffledRun.id+"/attempt/submit","POST",{},shuffledPlayer.token),"submit shuffled attempt");
// The earlier Presenter's capability remains pinned to the completed Run while the next Run is active.
allTypesProjection=ok(await call("/quiz/runs/"+allTypesRun.id+"/presenter","GET",undefined,allTypesPresenterToken),"older Run Presenter while next Run is open");assert.equal(allTypesProjection.run.id,allTypesRun.id);assert.deepEqual(allTypesProjection.leaderboard,[]);
allTypesState=ok(await call("/owner/quiz/runs/"+allTypesRun.id+"/commands","POST",{kind:"REVEAL_FINAL_RESULTS",expectedRevision:allTypesState.run.revision}),"reveal prior Run while newer Run is active");
allTypesGuest=ok(await call("/quiz/runs/"+allTypesRun.id+"/state","GET",undefined,allTypesPlayer.token),"prior Run release");assert.ok(allTypesGuest.myResult);
allTypesProjection=ok(await call("/quiz/runs/"+allTypesRun.id+"/presenter","GET",undefined,allTypesPresenterToken),"prior pinned Presenter released");assert.equal(allTypesProjection.run.id,allTypesRun.id);assert.ok(allTypesProjection.leaderboard.length);
ok(await call("/owner/quiz/runs/"+shuffledRun.id+"/commands","POST",{kind:"END_SELF_PACED"}),"end shuffled attempt Run");
const shuffledResults=ok(await call("/owner/quiz/runs/"+shuffledRun.id+"/state"),"shuffled attempt grading");
assert.equal(shuffledResults.results.questionStats[reorderIndex].unanswered,1,"untouched Reorder earns zero and remains unanswered");assert.equal(shuffledResults.results.questionStats[matchIndex].partiallyCorrect,1,"Self-paced Match Pairs receives partial credit");
// Published version rows are immutable; changes require a Draft Revision.
const revision=ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/revise","POST",{}),"create Draft Revision");assert.equal(revision.revision,true);assert.equal(revision.baseVersion,1);
const revisedContent={...revision.content,title:"Quiz v1.2 acceptance · revised"};ok(await call("/owner/quiz/definitions/"+v12Definition.id,"PUT",revisedContent),"save Draft Revision");
versions=ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/versions"),"verify published v1 did not mutate").versions;assert.equal(versions.length,1);assert.equal(versions[0].content.title,v12Content.title);
ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/publish","POST",{}),"publish immutable version 2");
versions=ok(await call("/owner/quiz/definitions/"+v12Definition.id+"/versions"),"list immutable versions").versions;assert.deepEqual(versions.map(item=>item.version),[2,1]);assert.equal(versions.find(item=>item.version===1).content.title,v12Content.title);
const version2Run=ok(await call("/owner/quiz/activities/"+v12Activity.id+"/runs","POST",{name:"Pinned version 2",runType:"LIVE",definitionVersion:2,competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]}),"create Run pinned to version 2").run;
const version2State=ok(await call("/owner/quiz/runs/"+version2Run.id+"/state"),"check version 2 Run snapshot");assert.equal(version2State.run.definition_version,2);assert.equal(version2State.run.snapshot.title,revisedContent.title);assert.equal(allTypesState.run.definition_version,1,"earlier Run stays pinned to version 1");
ok(await call("/owner/quiz/runs/"+version2Run.id+"/commands","POST",{kind:"END_EARLY"}),"close unused version 2 acceptance Run");

const automatic=ok(await call("/owner/quiz/activities/"+activity.id+"/runs","POST",{name:"Automatic Individual",runType:"LIVE",competitionMode:"INDIVIDUAL",hostingMode:"AUTOMATIC",scoringMode:"ACCURACY",teams:[]}),"create Automatic Run").run;
const automaticPin=ok(await call("/owner/gdm/activities/"+activity.id),"Automatic Run access").activity.join_pin;
const player=ok(await call("/quiz/join","POST",{runId:automatic.id,nickname:"Auto Player"}),"join Automatic");
const presenter=ok(await call("/owner/quiz/runs/"+automatic.id+"/presenter-token","POST",{}),"presenter token");
const presenterToken=new URL(presenter.url).hash.slice(1);
assert.equal((await call("/quiz/runs/"+automatic.id+"/presenter","GET",undefined,automaticPin)).status,401,"PIN cannot view Presenter");
ok(await call("/owner/quiz/runs/"+automatic.id+"/commands","POST",{kind:"START_RUN"}),"start Automatic");
await delay(3200);
let projection=ok(await call("/quiz/runs/"+automatic.id+"/presenter","GET",undefined,presenterToken),"Automatic question projection");
assert.equal(projection.question.correctOptionIds,undefined,"Automatic answer key hidden");
ok(await call("/quiz/runs/"+automatic.id+"/answer","POST",{questionId:q1,selectedOptionIds:[a],requestId:randomUUID()},player.token),"Automatic early answer");
state=ok(await call("/owner/quiz/runs/"+automatic.id+"/state"),"Automatic transition");
assert.equal(state.run.phase,"TRANSITION","all eligible submitted causes early lock");
projection=ok(await call("/quiz/runs/"+automatic.id+"/presenter","GET",undefined,presenterToken),"transition projection");
assert.equal(projection.question.correctOptionIds,undefined,"no automatic interim reveal");
ok(await call("/owner/quiz/runs/"+automatic.id+"/commands","POST",{kind:"PAUSE"}),"pause transition");
state=ok(await call("/owner/quiz/runs/"+automatic.id+"/state"),"paused state");
assert.equal(state.run.state,"PAUSED");
const pausedRemaining=state.run.phase_remaining_ms;
await delay(600);
state=ok(await call("/owner/quiz/runs/"+automatic.id+"/state"),"still paused");
assert.equal(state.run.phase_remaining_ms,pausedRemaining,"pause freezes transition");
ok(await call("/owner/quiz/runs/"+automatic.id+"/commands","POST",{kind:"RESUME"}),"resume transition");
await delay(2200);
state=ok(await call("/owner/quiz/runs/"+automatic.id+"/state"),"Automatic countdown");
assert.equal(state.run.phase,"COUNTDOWN");
await delay(3200);
guestState=ok(await call("/quiz/runs/"+automatic.id+"/state","GET",undefined,player.token),"Automatic second question");
assert.equal(guestState.run.phase,"ANSWERING");
ok(await call("/quiz/runs/"+automatic.id+"/answer","POST",{questionId:q2,selectedOptionIds:[c,d],requestId:randomUUID()},player.token),"Automatic final answer");
state=ok(await call("/owner/quiz/runs/"+automatic.id+"/state"),"Automatic final");
assert.equal(state.run.state,"COMPLETED");
projection=ok(await call("/quiz/runs/"+automatic.id+"/presenter","GET",undefined,presenterToken),"final podium");
assert.equal(projection.run.finalResultsVisibility,"HIDDEN");assert.deepEqual(projection.leaderboard,[],"Automatic completion waits for Trainer Final Reveal");
guestState=ok(await call("/quiz/runs/"+automatic.id+"/state","GET",undefined,player.token),"Automatic completed participant hidden");assert.equal(guestState.myResult,null);assert.deepEqual(guestState.leaderboard,[]);
ok(await call("/owner/quiz/runs/"+automatic.id+"/commands","POST",{kind:"REVEAL_FINAL_RESULTS",expectedRevision:state.run.revision}),"Trainer reveals Automatic final results");
projection=ok(await call("/quiz/runs/"+automatic.id+"/presenter","GET",undefined,presenterToken),"Automatic released final podium");assert.equal(projection.run.finalResultsVisibility,"RELEASED");assert.equal(projection.leaderboard.length,1);
const session=ok(await call("/owner/sessions","POST",{name:"Quiz smoke Session "+Date.now(),description:"Local guard check",location:"",expectedParticipants:6}),"create Session").session;
fixtures.sessionIds.add(session.id);
const linked=ok(await call("/owner/quiz/activities","POST",{definitionId:definition.id,sessionId:session.id}),"create Session Quiz").activity;
fixtures.activityIds.add(linked.id);
const sessionRun=ok(await call("/owner/quiz/activities/"+linked.id+"/runs","POST",{name:"Session Run 1",runType:"LIVE",competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]}),"create Session Run").run;
assert.equal((await call("/owner/sessions/"+session.id+"/archive","POST",{})).status,409,"active Run blocks Session archive");
ok(await call("/quiz/join","POST",{runId:sessionRun.id,nickname:"Session Runner"}),"join Session Run");
ok(await call("/owner/quiz/runs/"+sessionRun.id+"/commands","POST",{kind:"START_RUN"}),"start Session Run");
ok(await call("/owner/quiz/runs/"+sessionRun.id+"/commands","POST",{kind:"END_EARLY"}),"end Session Run");
ok(await call("/owner/sessions/"+session.id+"/archive","POST",{}),"archive Session");
const archivedDetail=ok(await call("/owner/gdm/sessions/"+session.id),"archived Session snapshot");
assert.equal(archivedDetail.session.status,"completed");
assert.deepEqual(archivedDetail.reportSources.map((source)=>source.runId),[sessionRun.id],"archive report freezes its source Runs");
assert.equal(archivedDetail.reportSources[0].available,true,"completed Run export is retained in archive report");
const accessBefore=ok(await call("/owner/gdm/activities/"+linked.id),"stable Activity access before new Run").activity;
const stablePath="/join/activities/"+accessBefore.access_slug;
const oldStableAccess=ok(await call(stablePath),"stable Activity access before new Run");
assert.equal((await call("/owner/quiz/activities/"+linked.id+"/runs","POST",{name:"Blocked by archived Session",runType:"LIVE",competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]})).status,409,"Quiz requires its archived Session to be reopened before a new Run");
assert.equal((await call("/owner/gdm/activities/"+linked.id+"/start-run","POST",{operationId:randomUUID()})).status,409,"GDM Start New Run cannot bypass the Quiz archived-Session guard");
assert.equal((await call("/owner/gdm/activities/"+linked.id+"/reset","POST",{operationId:randomUUID(),scope:"ALL"})).status,409,"GDM Activity Reset cannot bypass the Quiz archived-Session guard");
ok(await call("/owner/sessions/"+session.id+"/reopen","POST",{}),"reopen Session before Quiz Run");
const resumed=ok(await call("/owner/quiz/activities/"+linked.id+"/runs","POST",{name:"Session Run 2",runType:"LIVE",competitionMode:"INDIVIDUAL",hostingMode:"MANUAL",scoringMode:"ACCURACY",teams:[]}),"start new Run under archived Session").run;
assert.notEqual(resumed.id,sessionRun.id,"new Run has fresh identity scope");
const afterArchivedRun=ok(await call("/owner/gdm/sessions/"+session.id),"Session archive stays frozen after a new Run");
assert.equal(afterArchivedRun.session.status,"upcoming","parent Session is reopened before its next Quiz Run");
assert.deepEqual(afterArchivedRun.reportSources.map((source)=>source.runId),[sessionRun.id],"new Run is excluded from archived Session report");
assert.ok(afterArchivedRun.runs.some((entry)=>entry.id===resumed.id&&entry.origin_session_id===session.id),"new Run preserves immutable Session origin");
const currentStableAccess=ok(await call(stablePath),"stable Activity access follows current Run");
assert.equal(currentStableAccess.path,oldStableAccess.path,"stable Activity URL continues to resolve the Activity entry point");
const currentActivity=ok(await call("/owner/gdm/activities/"+linked.id),"current Activity after new Run").activity;
assert.notEqual(currentActivity.join_pin,accessBefore.join_pin,"starting a Run rotates the Activity PIN");
assert.equal((await call("/join/lookup","POST",{pin:accessBefore.join_pin})).status,404,"old PIN cannot enter the new Run");
const six=[];
for(let i=0;i<6;i++) six.push(ok(await call("/quiz/join","POST",{runId:resumed.id,nickname:"Workshop "+(i+1)}),"six-person Workshop join").token);
ok(await call("/owner/quiz/runs/"+resumed.id+"/commands","POST",{kind:"START_RUN"}),"start six-person Run");
await delay(3200);
await Promise.all(six.map((token)=>call("/quiz/runs/"+resumed.id+"/answer","POST",{questionId:q1,selectedOptionIds:[a],requestId:randomUUID()},token).then((result)=>ok(result,"six-person Workshop answer"))));
state=ok(await call("/owner/quiz/runs/"+resumed.id+"/state"),"six-person progress");
assert.equal(state.answerCount,6);
ok(await call("/owner/quiz/runs/"+resumed.id+"/commands","POST",{kind:"LOCK_EARLY"}),"six-person early lock");
ok(await call("/owner/quiz/runs/"+resumed.id+"/commands","POST",{kind:"REVEAL_ANSWER"}),"six-person reveal");
ok(await call("/owner/quiz/runs/"+resumed.id+"/commands","POST",{kind:"END_EARLY"}),"end six-person Run");
state=ok(await call("/owner/quiz/runs/"+resumed.id+"/state"),"six-person final scores");
assert.equal(state.results.individual.length,6);
assert.ok(state.results.individual.every((person)=>person.points===3000));
const sessionDetail=ok(await call("/owner/sessions/"+session.id),"Session detail with Quiz");
assert.ok(sessionDetail.activities.some((item)=>item.id===linked.id&&item.tool_id==="quiz"&&item.participant_count>=6),"Session Activity aggregates Quiz participants across its Runs");
const ownerActivities=ok(await call("/owner/activities"),"shared Activity list with Quiz");
assert.ok(ownerActivities.activities.some((item)=>item.id===activity.id&&item.participant_count>=4));
if (["127.0.0.1","localhost"].includes(new URL(base).hostname) && process.env.QUIZ_SMOKE_KEEP!=="1") {
  const ids=[activity.id,linked.id,definition.id,session.id];
  assert.ok(ids.every((value)=>/^[0-9a-f-]{36}$/i.test(value)));
  execFileSync("npx",["wrangler","d1","execute","trainerpopp-kit","--local","--command",
    `DELETE FROM activities WHERE id IN ('${activity.id}','${linked.id}'); DELETE FROM quiz_definitions WHERE id='${definition.id}'; DELETE FROM sessions WHERE id='${session.id}';`],
  {cwd:new URL("..",import.meta.url),env:{...process.env,WRANGLER_WRITE_LOGS:"false"},stdio:"ignore"});
}
console.log("Quiz smoke passed: all five types, partial Speed/Hope scoring, stable shuffled Self-paced drafts, Draft Revision/immutable snapshots, Manual and Automatic Final Reveal, pinned old-Run Presenter, PIN/permission isolation, GDM archive/reset guards, six-person Workshop, corrections, exports and shared Activity counts.");
