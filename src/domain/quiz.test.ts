import { describe, expect, it } from "vitest";
import { correctChoice, questionPoints, rankIndividuals, rankTeams, validateQuiz, type QuizContent } from "./quiz";

describe("Quiz scoring vectors", () => {
  const vectors = [
    [1000,1,"ACCURACY",20000,5000,true,1000],
    [1000,2,"ACCURACY",20000,5000,true,2000],
    [1000,3,"ACCURACY",20000,5000,true,3000],
    [1000,1,"ACCURACY_SPEED",20000,0,true,2000],
    [1000,2,"ACCURACY_SPEED",20000,10000,true,3000],
    [1000,3,"ACCURACY_SPEED",20000,0,true,6000],
    [1000,3,"ACCURACY_SPEED",20000,2000,true,5700],
    [1000,3,"ACCURACY_SPEED",20000,100,false,0],
    [1000,1,"ACCURACY_SPEED",20000,19980,true,1001],
    [333,3,"ACCURACY_SPEED",20000,10000,true,1499],
    [100,2,"ACCURACY_SPEED",20000,15000,true,250],
    [1000,3,"ACCURACY",null,null,true,3000],
  ] as const;
  it.each(vectors)("awards B=%i Hope ×%i in %s at t=%s", (basePoints,hopeMultiplier,scoringMode,durationMs,elapsedMs,isCorrect,expectedPoints) => {
    expect(questionPoints({basePoints,hopeMultiplier,scoringMode,durationMs,elapsedMs,isCorrect})).toBe(expectedPoints);
  });
  it("matches single, multi and true/false answer keys exactly", () => {
    expect(correctChoice({type:"SINGLE_CHOICE",correctOptionIds:["b"]},["b"])).toBe(true);
    expect(correctChoice({type:"SINGLE_CHOICE",correctOptionIds:["b"]},["a"])).toBe(false);
    expect(correctChoice({type:"MULTIPLE_CHOICE",correctOptionIds:["a","c"]},["c","a"])).toBe(true);
    expect(correctChoice({type:"MULTIPLE_CHOICE",correctOptionIds:["a","c"]},["a"])).toBe(false);
    expect(correctChoice({type:"MULTIPLE_CHOICE",correctOptionIds:["a","c"]},["a","b","c"])).toBe(false);
    expect(correctChoice({type:"MULTIPLE_CHOICE",correctOptionIds:["a","c"]},["a","a"])).toBe(false);
    expect(correctChoice({type:"TRUE_FALSE",correctOptionIds:["true"]},["true"])).toBe(true);
  });
  it("uses correct count to break individual point ties, then shares ranks", () => {
    const ranked=rankIndividuals([{id:"a",nickname:"Amy",points:5000,correct:4},{id:"b",nickname:"Bee",points:5000,correct:3},{id:"c",nickname:"Cat",points:5000,correct:4}]);
    expect(ranked.map((row)=>[row.id,row.rank])).toEqual([["a",1],["c",1],["b",3]]);
  });
  it("includes zero-score and disconnected Team members, but excludes DQ", () => {
    const team=rankTeams([{id:"a",name:"A"},{id:"b",name:"B"}],[
      {id:"1",nickname:"One",teamId:"a",points:1000,correct:1},
      {id:"2",nickname:"Two",teamId:"a",points:0,correct:0},
      {id:"3",nickname:"Three",teamId:"a",points:0,correct:0},
      {id:"4",nickname:"Four",teamId:"a",points:4000,correct:2,dq:true},
      {id:"5",nickname:"Five",teamId:"b",points:1000,correct:1},
    ]);
    expect(team.find((row)=>row.id==="a")).toMatchObject({members:3,averagePoints:1000/3,averageCorrect:1/3});
    expect(team.find((row)=>row.id==="b")).toMatchObject({members:1,averagePoints:1000});
  });
  it("compares exact Team averages and shares truly equal ranks", () => {
    const teams=[{id:"a",name:"A"},{id:"b",name:"B"}];
    const people=[
      {id:"a1",nickname:"a1",teamId:"a",points:1001,correct:1},
      {id:"a2",nickname:"a2",teamId:"a",points:1000,correct:1},
      {id:"a3",nickname:"a3",teamId:"a",points:0,correct:0},
      {id:"a4",nickname:"a4",teamId:"a",points:0,correct:0},
      {id:"b1",nickname:"b1",teamId:"b",points:1000,correct:1},
      {id:"b2",nickname:"b2",teamId:"b",points:0,correct:0},
    ];
    expect(rankTeams(teams,people).map((row)=>[row.id,row.rank])).toEqual([["a",1],["b",2]]);
    people[0]!.points=1000;
    expect(rankTeams(teams,people).map((row)=>[row.id,row.rank])).toEqual([["a",1],["b",1]]);
  });
});

describe("Quiz definition validation", () => {
  const valid:QuizContent={title:"Training quiz",description:"",sharedLiveTimerMs:20000,sharedBasePoints:1000,questions:[{id:"q1",type:"SINGLE_CHOICE",stem:"Which?",options:[{id:"a",label:"A"},{id:"b",label:"B"}],correctOptionIds:["b"],explanation:"",hopeMultiplier:1}]};
  it("accepts a valid text-only definition",()=>expect(validateQuiz(valid)).toEqual([]));
  it("rejects missing answer keys and duplicate options",()=>{
    const broken:QuizContent={...valid,questions:[{...valid.questions[0]!,options:[{id:"a",label:"A"},{id:"a",label:"Again"}],correctOptionIds:[]}]};
    expect(validateQuiz(broken).length).toBeGreaterThan(0);
  });
});
