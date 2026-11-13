import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { cloneConstraints } from '../src/architect/comparison.ts'
import { checkDispersion } from '../src/architect/dispersion.ts'
import { guideRepair } from '../src/lib/guideRepair.ts'
import { scheduleTolerance } from '../src/lib/scheduleTolerance.ts'
import { missionTrace,missionConsequence } from '../src/lib/missionConsequence.ts'
import { sampleBearing } from '../src/lib/sampleBearing.ts'
import { encodeJourney,decodeJourney,journeyURL,buildDecisionReceipt,storyScenarios } from '../src/lib/decisionStory.ts'
import type { DecisionGuide } from '../src/lib/explorationDecision.ts'
import type { SensitiveDateContext } from '../src/lib/sensitiveDate.ts'
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
let checks=0
const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++}
const close=(a:number,b:number)=>check(Math.abs(a-b)<1e-7,`${a} = ${b}`)
const slug='malapert-massif',sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`),footprint=read(`dispersion/${slug}.json`),index=read('prediction-index.json'),site=read('sites.json').find((s:{slug:string})=>s.slug===slug)
const context:SensitiveDateContext={sun,earth,horizon,series:buildSeries(slug,sun.rows,earth.rows,horizon),products:{footprint:{status:'ready',data:footprint},height:{status:'ready',data:read(`validation/sites/${slug}.json`)}}}
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}},scenario={id:0,slug,row:1272,c},original=JSON.stringify(scenario)
const repaired=guideRepair(context.series,scenario)!.repaired,points=await scheduleTolerance(context,repaired,undefined,undefined,async()=>{})
check(points.length===13&&points[0].offsetH===-72&&points[12].offsetH===72,'Schedule checks exactly thirteen explicit half-day starts')
for(const p of points){
 assert.deepEqual(p.nominal,evaluateWindow(context.series,p.row,p.row+336,repaired.c));checks++
 const actual=checkDispersion(footprint,sun.rows,earth.rows,p.row,repaired.c)
 check(p.footprint.status==='ready'&&p.footprint.data.passing===actual.passing,'Schedule sample counts match independent production footprints')
}
check(points[6].row===1272&&points[6].footprint.status==='ready'&&points[6].footprint.data.passing===2,'Strip baseline uses repaired hardware, not the original lander')
const edge=await scheduleTolerance(context,{...repaired,row:0},undefined,undefined,async()=>{})
check(edge.slice(0,6).every(p=>p.nominal===null&&p.footprint.status==='unavailable'),'Before-cache starts remain unassessed')
const unavailable=await scheduleTolerance({...context,products:{...context.products,footprint:{status:'unavailable',error:'offline'}}},repaired,undefined,undefined,async()=>{})
check(unavailable.every(p=>p.nominal!==null&&p.footprint.status==='unavailable'),'Missing terrain does not erase nominal results or invent sample passes')
const abort=new AbortController()
await assert.rejects(()=>scheduleTolerance(context,repaired,abort.signal,n=>{if(n===3)abort.abort()},async()=>{}),{name:'AbortError'});checks++
const trace=missionTrace(context.series,scenario)!
const r=missionConsequence(trace,1606)!
check(r.sunVisible&&r.earthVisible&&r.flow==='battery supplying deficit'&&r.belowReserve,'Visible Sun can still leave a battery deficit and reserve breach')
close(missionConsequence(trace,1608)!.batteryPct!,trace.result.power!.minPct)
for(const row of [1104,1271,1609,NaN])check(missionConsequence(trace,row)===null,'Scene readout does not extrapolate outside its mission')
const noPower=missionTrace(context.series,{...scenario,c:{...c,power:undefined}})!
check(missionConsequence(noPower,1300)!.batteryPct===null,'Disabled electrical assessment cannot show an invented battery')
check(missionTrace(context.series,{...scenario,row:context.series.hours-10})===null,'An incomplete preview has no electrical trace')
const depleted=missionTrace(context.series,{...scenario,c:{...c,power:{...c.power!,capacityWh:1,loadW:10000}}})!
check(missionConsequence(depleted,1274)!.flow==='unmet demand','An empty battery cannot be described as supplying a power deficit')
const s={...footprint.samples[0],eastM:100,northM:0,siteHeightM:0},view={heading:0,pitch:0,fov:60,groundM:0,eyeHeightM:1.7}
close(sampleBearing(s,view,0)!.az,90)
close(sampleBearing({...s,eastM:0,northM:100},view,0)!.az,0)
close(sampleBearing({...s,eastM:-100},view,0)!.az,270)
close(sampleBearing({...s,eastM:0,northM:-100},view,0)!.az,180)
check(sampleBearing(s,{...view,eastM:100},0)===null,'Standing on the sample has no invented bearing')
check(sampleBearing(s,{...view,eyeHeightM:1.1},0)!.el>sampleBearing(s,view,0)!.el,'Crouching changes marker geometry, not the cached assessment')
const guide:DecisionGuide={originRow:1104,step:2,compared:true,source:{datasetId:index.datasetId,model:index.model.version},story:{original:scenario,repair:repaired,later:{...repaired,row:1848,c:cloneConstraints(repaired.c)},reason:'Accept a 24-day slip for more passing footprint samples, with mixed results disclosed.'}}
const decoded=decodeJourney(encodeJourney(slug,guide),s=>s===slug)!
check(decoded.guide.story?.reason===guide.story!.reason&&decoded.guide.story?.later?.row===1848,'Sharing/storage retains the full reasoning and three-stage inputs')
const url=new URL(journeyURL('http://localhost:5177/?compare=[]&plan=old&view=plan',slug,guide,index))
check(!url.searchParams.has('compare')&&!url.searchParams.has('plan')&&!url.searchParams.has('view'),'Journey links avoid conflicting planner inputs')
check(decodeJourney(url.searchParams.get('journey'),s=>s===slug)?.guide.originRow===1104,'Shared journey restores the frozen starting date')
const receipt=buildDecisionReceipt(index,guide,context,site,'2026-11-01T00:00:00Z'),serialized=JSON.parse(JSON.stringify(receipt))
check(serialized.stages.length===3&&serialized.reason===guide.story!.reason,'Receipt retains all three named stages and the visitor reason')
check(serialized.report.scenarios.map((s:{result:{pass:boolean}})=>s.result.pass).join(',')==='false,true,true','Receipt recomputes original failure and both passing alternatives')
check(serialized.report.scenarios.map((s:{robustness:{footprint:{data:{passing:number}}}})=>s.robustness.footprint.data.passing).join(',')==='1,2,13','Receipt carries actual independent footprint results for every stage')
check(serialized.brief.decision.reason===guide.story!.reason&&serialized.report.reproducibility.datasetId===index.datasetId,'Printable brief and JSON share reasoning and source identity')
check(Object.keys(serialized.report.reproducibility.productFingerprints).some(k=>k.includes('dispersion')),'Receipt includes terrain product fingerprints')
const saved=storyScenarios(guide.story!);saved[0].c.power!.loadW=1
check(guide.story!.original.c.power!.loadW===1200,'Export/comparison scenarios are independent copies')
const bad=[{...guide,originRow:-1},{...guide,ended:'yes'},{...guide,story:{...guide.story,reason:'x'.repeat(281)}},{...guide,story:{...guide.story,repair:{...repaired,row:1273}}},{...guide,story:{...guide.story,repair:{...repaired,c:{...repaired.c,minLitPct:0}}}},{...guide,story:{...guide.story,later:{...repaired,row:1849}}},{...guide,story:{...guide.story,later:{...repaired,row:1848,c:{...repaired.c,power:{...repaired.c.power!,loadW:1}}}}},{...guide,source:{datasetId:'wrong',model:index.model.version}}]
for(const g of bad)check(decodeJourney(JSON.stringify({v:1,slug,guide:g}),s=>s===slug)===null,'Invalid or mislabeled story inputs are rejected')
check(decodeJourney(encodeJourney(slug,{...guide,ended:true}),s=>s===slug)?.guide.story?.later?.row===1848,'Ending a guide retains its story for later resumption')
check(JSON.stringify(scenario)===original,'All features preserve the original requirements')
console.log(`Mission journey checks passed: ${checks}`)
