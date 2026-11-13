import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { explorationDecision,decisionFailures,decisionTakeaway } from '../src/lib/explorationDecision.ts'
import { buildExpeditionDebrief,captureAssignmentCompletion,DEFAULT_EQUIPMENT,type Assignment,type JournalPhoto } from '../src/lib/expedition.ts'
let checks=0
const check=(value:unknown,message:string)=>{assert.ok(value,message);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const original=JSON.stringify(c)
for(const slug of ['malapert-massif','haworth-rim']){
 const sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`),series=buildSeries(slug,sun.rows,earth.rows,horizon)
 const start=Date.parse(sun.rows[0].t.endsWith('Z')?sun.rows[0].t:sun.rows[0].t+'Z')
 const pair=explorationDecision(series,1104.2,start,c)
 check(pair.rowA===1104&&pair.rowB===1272,'Comparison uses the rounded starting scene hour and an exact seven-day slip')
 check(pair.utcA==='2026-10-17T00:00:00.000Z'&&pair.utcB==='2026-10-24T00:00:00.000Z','Both UTC labels match the cache epoch')
 assert.deepEqual(pair.a,evaluateWindow(series,1104,1440,c));checks++
 assert.deepEqual(pair.b,evaluateWindow(series,1272,1608,c));checks++
 if(slug==='malapert-massif'){
  check(pair.a?.pass&&!pair.b?.pass&&pair.recommendation==='a','Published reference example distinguishes the passing date from the slipped battery failure')
  check(decisionFailures(pair.b!).includes('battery reserve / unsupplied energy'),'Debrief identifies the real slipped-mission battery failure')
 }else{
  check(!pair.a?.pass&&!pair.b?.pass&&pair.recommendation==='neither','A difficult site does not force a preferred date when both fail')
  check(decisionFailures(pair.a!).includes('Earth visibility duration'),'Masked Earth remains a mission requirement failure')
 }
 const partial=explorationDecision(series,series.hours-336,start,c)
 check(!!partial.a&&partial.b===null&&partial.recommendation===null,'Incomplete slipped mission stays unavailable, even when baseline fits exactly')
 check(decisionTakeaway(partial).includes('unavailable'),'Coverage gap produces an explicit unavailable explanation')
 const none=explorationDecision(series,series.hours,start,c)
 check(none.a===null&&none.b===null&&none.recommendation===null,'No extrapolation at the final boundary')
 const relaxed={...c,minLitPct:0,minLinkPct:0,maxDarkH:720,maxGapH:720,power:undefined}
 const both=explorationDecision(series,1104,start,relaxed)
 check(both.a?.pass&&both.b?.pass,'Identical edited requirements reach both independent evaluations')
 check(['a','b','either'].includes(both.recommendation!),'Two passing dates are compared by nominal margin, with an explicit tie')
 const equal=explorationDecision(series,1104,start,{...relaxed,maxDarkH:1e6,maxGapH:1e6})
 if(Math.abs(equal.a!.margin-equal.b!.margin)<=1e-6)check(equal.recommendation==='either','Equal nominal margins never invent a preferred landing date')
 check(!decisionTakeaway(pair).includes('safe'),'Debrief does not certify a safe landing')
 const uniform={...series,hours:504,litPrefix:Int32Array.from({length:505},(_,i)=>i),linkPrefix:Int32Array.from({length:505},(_,i)=>i),litRuns:[[0,504]] as [number,number][],darkRuns:[],linkRuns:[[0,504]] as [number,number][],gapRuns:[]}
 check(explorationDecision(uniform,0,start,relaxed).recommendation==='either','Constant fully visible geometry produces a real tie, rather than an arbitrary winner')
 const assignment:Assignment={kind:'scout',siteSlug:slug,startedUTC:'2026-11-01T00:00:00Z',startDistanceM:0,inspectionId:null,flagIds:[],photoIds:[],panelAz:0,panelTilt:0,comparisonCount:0,decisionRow:1104}
 const photo:JournalPhoto={id:'new-photo',siteSlug:slug,siteName:slug,sceneRow:1104,sceneUTC:pair.utcA,capturedUTC:'2026-11-01T00:00:00Z',pose:{heading:106,pitch:-18,fov:60,eyeHeightM:1.1},light:true,equipment:DEFAULT_EQUIPMENT,trailVisible:true,imageUrl:'blob:temporary',note:'Ground inspection',width:800,height:900,datasetId:'dataset',model:'model'}
 const completedInput={inspectionId:'new-inspection',flagIds:['new-flag'],photoIds:['new-photo'],equipmentPhoto:false,distanceM:6,targetDistanceM:0,airborne:false,equipment:{...DEFAULT_EQUIPMENT},comparisonCount:0}
 const completion=captureAssignmentCompletion(assignment,completedInput,{inspection:null,flags:[],photos:[photo]},'2026-11-01T00:00:00Z')
 completedInput.distanceM=0;completedInput.flagIds.length=0
 check(completion.input.distanceM===6&&completion.input.flagIds[0]==='new-flag'&&completion.steps.every(s=>s.done),'Completion retains the actual return/travel evidence after a guide resets the trail')
 check(!('imageUrl' in completion.photos[0])&&completion.atUTC==='2026-11-01T00:00:00Z','Completion snapshots retain metadata and timestamp without pinning image blobs')
 assert.throws(()=>captureAssignmentCompletion(assignment,completedInput,{inspection:null,flags:[],photos:[]}));checks++
 const context={site:{slug,lat:0,lonEast:0},observerHeightM:0,sceneUTC:pair.utcA,datasetId:'dataset',model:'model',assignment,steps:Array.from({length:4},(_,i)=>({label:'task '+i,done:true})),comparison:pair,inspection:null,flags:[],photos:[photo],equipment:DEFAULT_EQUIPMENT}
 assert.throws(()=>buildExpeditionDebrief(context));checks++
 const reviewed={...context,assignment:{...assignment,reflection:{choice:'b' as const,reason:'Check the battery reserve across the full mission.',reviewedUTC:'2026-11-01T00:00:00Z'}}}
 const report=JSON.parse(JSON.stringify(buildExpeditionDebrief(reviewed)))
 check(report.schemaVersion===2&&report.assessment.observerHeightAboveGroundM===0&&report.photos[0].pose.eyeHeightM===1.1,'Export distinguishes cached analysis height and visitor eye height')
 check(report.assignment.reflection.choice==='b'&&report.assignment.reflection.reason===reviewed.assignment.reflection.reason,'A differing visitor decision and reasoning remain intact')
 check(report.comparison.utcA===pair.utcA&&report.comparison.utcB===pair.utcB&&report.comparison.b.pass===pair.b?.pass,'Serialized export retains the actual independent mission results and frozen dates')
 check(!('imageUrl' in report.photos[0])&&report.photos[0].note==='Ground inspection','Decision export preserves observations without transient object URLs')
 assert.throws(()=>buildExpeditionDebrief({...reviewed,site:{...context.site,slug:'another-site'}}));checks++
 assert.throws(()=>buildExpeditionDebrief({...reviewed,steps:[{label:'incomplete',done:false}]}));checks++
 assert.throws(()=>buildExpeditionDebrief({...reviewed,assignment:{...reviewed.assignment,reflection:{...reviewed.assignment.reflection,reason:' '}}}));checks++
 assert.throws(()=>buildExpeditionDebrief({...reviewed,assignment:{...reviewed.assignment,decisionRow:1105}}));checks++
 const unavailable=buildExpeditionDebrief({...context,assignment:{...assignment,decisionRow:partial.rowA},comparison:partial})
 check(unavailable.comparison.b===null&&unavailable.comparison.recommendation===null,'Field observations can be exported without inventing a decision outside coverage')
 pair.constraints.power!.loadW=1
 check(c.power!.loadW===1200,'Exported comparison assumptions are independent copies')
 for(const row of [NaN,Infinity,-1]){assert.throws(()=>explorationDecision(series,row,start,c));checks++}
}
check(JSON.stringify(c)===original,'Running and exporting the lesson does not mutate reference hardware')
console.log(`Exploration decision checks passed: ${checks}`)
