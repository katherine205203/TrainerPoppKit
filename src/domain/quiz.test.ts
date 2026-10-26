import { describe, expect, it } from "vitest";
import { correctChoice, duplicateQuestion, gradeAnswer, matchAnswerToken, questionPoints, rankIndividuals, rankTeams, validateQuiz, type QuizContent, type QuizQuestion } from "./quiz";

const base = { id:"q", stem:"Prompt", explanation:"", hopeMultiplier:1 as const };
const single:QuizQuestion={...base,type:"SINGLE_CHOICE",options:[{id:"a",label:"A"},{id:"b",label:"B"}],correctOptionIds:["b"]};
const multi:QuizQuestion={...base,type:"MULTIPLE_CHOICE",options:[{id:"a",label:"A"},{id:"b",label:"B"},{id:"c",label:"C"}],correctOptionIds:["a","c"]};
const reorder:QuizQuestion={...base,type:"REORDER",items:[{id:"a",label:"A"},{id:"b",label:"B"},{id:"c",label:"C"}],correctOrderItemIds:["b","a","c"]};
const match:QuizQuestion={...base,type:"MATCH_PAIRS",pairs:[{id:"p1",leftId:"l1",leftText:"One",rightId:"r1",rightText:"First"},{id:"p2",leftId:"l2",leftText:"Two",rightId:"r2",rightText:"Second"},{id:"p3",leftId:"l3",leftText:"Three",rightId:"r3",rightText:"Third"}]};

describe("Quiz v1.2 scoring contract", () => {
  const vectors = [
    [1000,1,"ACCURACY",20000,5000,true,1000],[1000,2,"ACCURACY",20000,5000,true,2000],[1000,3,"ACCURACY",20000,5000,true,3000],
    [1000,1,"ACCURACY_SPEED",20000,0,true,2000],[1000,2,"ACCURACY_SPEED",20000,10000,true,3000],[1000,3,"ACCURACY_SPEED",20000,0,true,6000],
    [1000,3,"ACCURACY_SPEED",20000,2000,true,5700],[1000,3,"ACCURACY_SPEED",20000,100,false,0],[1000,1,"ACCURACY_SPEED",20000,19980,true,1001],
    [333,3,"ACCURACY_SPEED",20000,10000,true,1499],[100,2,"ACCURACY_SPEED",20000,15000,true,250],[1000,3,"ACCURACY",null,null,true,3000],
  ] as const;
  it.each(vectors)("scores the supplied full-credit vector B=%i Hope ×%i in %s",(basePoints,hopeMultiplier,scoringMode,durationMs,elapsedMs,isCorrect,expected)=>{
    expect(questionPoints({basePoints,hopeMultiplier,scoringMode,durationMs,elapsedMs,isCorrect})).toBe(expected);
  });
  it("awards Reorder partial credit by exact position and applies speed and Hope once",()=>{
    const grade=gradeAnswer(reorder,["b","c","a"]);
    expect(grade).toMatchObject({correctParts:1,totalParts:3,correctnessRatio:1/3,fullyCorrect:false,gradingStatus:"PARTIALLY_CORRECT"});
    expect(questionPoints({basePoints:1000,hopeMultiplier:3,scoringMode:"ACCURACY_SPEED",durationMs:20000,elapsedMs:10000,accuracyRatio:grade.correctnessRatio})).toBe(1500);
  });
  it("awards Match Pairs partial credit by unique correct pairs",()=>{
    const grade=gradeAnswer(match,[matchAnswerToken("l1","r1"),matchAnswerToken("l2","r2")]);
    expect(grade).toMatchObject({correctParts:2,totalParts:3,gradingStatus:"PARTIALLY_CORRECT"});
    expect(gradeAnswer(match,match.pairs.map(pair=>matchAnswerToken(pair.leftId,pair.rightId))).fullyCorrect).toBe(true);
  });
  it("requires exact choice sets and treats untouched Reorder as unanswered",()=>{
    expect(correctChoice(single,["b"])).toBe(true);expect(correctChoice(single,["a"])).toBe(false);
    expect(correctChoice(multi,["c","a"])).toBe(true);expect(correctChoice(multi,["a"])).toBe(false);expect(correctChoice(multi,["a","b","c"])).toBe(false);expect(correctChoice(multi,["a","a"])).toBe(false);
    expect(gradeAnswer(reorder,[],undefined,false)).toMatchObject({correctParts:0,gradingStatus:"UNANSWERED"});
  });
  it("uses correct count to break individual point ties, then shares ranks",()=>{
    const ranked=rankIndividuals([{id:"a",nickname:"Amy",points:5000,correct:4},{id:"b",nickname:"Bee",points:5000,correct:3},{id:"c",nickname:"Cat",points:5000,correct:4}]);
    expect(ranked.map((row)=>[row.id,row.rank])).toEqual([["a",1],["c",1],["b",3]]);
  });
  it("includes zero-score Team members, excludes DQ and ranks by exact averages",()=>{
    const teams=[{id:"a",name:"A"},{id:"b",name:"B"}],people=[
      {id:"a1",nickname:"a1",teamId:"a",points:1001,correct:1},{id:"a2",nickname:"a2",teamId:"a",points:0,correct:0},
      {id:"b1",nickname:"b1",teamId:"b",points:1000,correct:1},{id:"b2",nickname:"b2",teamId:"b",points:0,correct:0},
      {id:"dq",nickname:"dq",teamId:"a",points:9999,correct:9,dq:true},
    ];
    expect(rankTeams(teams,people).map(row=>[row.id,row.rank])).toEqual([["a",1],["b",2]]);
    people[0]!.points=1000;expect(rankTeams(teams,people).map(row=>[row.id,row.rank])).toEqual([["a",1],["b",1]]);
    expect(rankTeams(teams,people).find(row=>row.id==="a")).toMatchObject({members:2,averagePoints:500});
  });
  it("duplicates each question type with fresh IDs while preserving answer structure",()=>{
    for(const original of [single,multi,reorder,match]) {
      const copy=duplicateQuestion(original);expect(copy.id).not.toBe(original.id);
      if(copy.type==="REORDER"&&original.type==="REORDER") {expect(new Set(copy.items.map(item=>item.id)).size).toBe(copy.items.length);expect(copy.correctOrderItemIds).toEqual(original.correctOrderItemIds.map(id=>copy.items[original.items.findIndex(item=>item.id===id)]!.id));}
      if(copy.type==="MATCH_PAIRS"&&original.type==="MATCH_PAIRS") expect(copy.pairs.every((pair,index)=>pair.leftId!==original.pairs[index]!.leftId&&pair.rightId!==original.pairs[index]!.rightId)).toBe(true);
      if((copy.type==="SINGLE_CHOICE"||copy.type==="MULTIPLE_CHOICE")&&(original.type==="SINGLE_CHOICE"||original.type==="MULTIPLE_CHOICE")) expect(copy.correctOptionIds.map(id=>copy.options.find(option=>option.id===id)?.label)).toEqual(original.correctOptionIds.map(id=>original.options.find(option=>option.id===id)?.label));
    }
  });
});

describe("Quiz definition validation",()=>{
  const content:QuizContent={title:"Training quiz",description:"",sharedLiveTimerMs:20000,sharedBasePoints:1000,questions:[single]};
  it("accepts all five valid text-only question types",()=>expect(validateQuiz({...content,questions:[single,{...multi,id:"q2"},{...base,id:"q3",type:"TRUE_FALSE",options:[{id:"true",label:"True"},{id:"false",label:"False"}],correctOptionIds:["true"]},{...reorder,id:"q4"},{...match,id:"q5"}]})).toEqual([]));
  it("rejects broken answer keys, duplicate IDs and out-of-range structures",()=>{
    expect(validateQuiz({...content,questions:[{...single,options:[{id:"a",label:"A"},{id:"a",label:"Again"}],correctOptionIds:[]}]}).length).toBeGreaterThan(0);
    expect(validateQuiz({...content,questions:[{...reorder,items:reorder.items.slice(0,2)}]}).length).toBeGreaterThan(0);
    expect(validateQuiz({...content,questions:[{...match,pairs:[match.pairs[0]!]}]}).length).toBeGreaterThan(0);
  });
});
