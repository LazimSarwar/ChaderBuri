import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { assessRobustness,type RobustnessProducts } from '../src/architect/robustness.ts'
import { checkDispersion } from '../src/architect/dispersion.ts'
import { cloneConstraints,decodeScenarios,encodeScenarios } from '../src/architect/comparison.ts'
import { guideRepair } from '../src/lib/guideRepair.ts'
import { findLessSensitiveDate,DATE_SEARCH_DAYS,DATE_SEARCH_STEP_H,type SensitiveDateContext } from '../src/lib/sensitiveDate.ts'
let checks=0
const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
function context(slug:string):SensitiveDateContext{
 const sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`)
 const products:RobustnessProducts={footprint:{status:'ready',data:read(`dispersion/${slug}.json`)},height:{status:'ready',data:read(`validation/sites/${slug}.json`)}}
 return {sun,earth,horizon,products,series:buildSeries(slug,sun.rows,earth.rows,horizon)}
}
const ctx=context('malapert-massif'),c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const repair=guideRepair(ctx.series,{id:0,slug:ctx.series.slug,row:1272,c})!,original=JSON.stringify(repair),source=JSON.stringify(ctx.products)
let yields=0
const started=performance.now(),result=await findLessSensitiveDate(ctx,repair.repaired,{yieldControl:async()=>{yields++}})
const elapsed=performance.now()-started
check(result.status==='complete'&&!!result.candidate,'Actual repaired mission has a later option with more passing samples')
if(result.status!=='complete'||!result.candidate)throw new Error('Missing reference option')
const candidate=result.candidate
check(result.baselinePassing===2&&candidate.passing>result.baselinePassing,'Search compares against the actual repaired 2/19 baseline')
check(result.checked<=360&&result.lastRow<=repair.repaired.row+DATE_SEARCH_DAYS*24&&candidate.scenario.row>repair.repaired.row,'Later search stays inside 90 days and 360 candidates')
check((candidate.scenario.row-repair.repaired.row)%DATE_SEARCH_STEP_H===0,'Candidate remains on the disclosed six-hour grid')
check(yields>=20,'Precomputation and date batches yield, allowing cancellation and painting')
assert.deepEqual(candidate.scenario.c,repair.repaired.c);checks++
assert.deepEqual(candidate.result,evaluateWindow(ctx.series,candidate.scenario.row,candidate.scenario.row+336,candidate.scenario.c));checks++
const direct=assessRobustness(ctx.products,ctx.sun,ctx.earth,ctx.horizon,candidate.scenario.row,candidate.scenario.c)
check(direct.footprint.status==='ready'&&direct.footprint.data.passing===candidate.passing&&direct.height.status==='ready','Candidate diagnostics match direct production assessment')
// Independent brute-force calls rebuild each sample per complete mission. This
// checks the optimized sliced-series search, including earliest-date tie breaks.
let best:{row:number;passing:number}|null=null,nominalCount=0
if(ctx.products.footprint.status!=='ready')throw new Error('Missing fixture')
for(let row=repair.repaired.row+6;row<=result.lastRow;row+=6){
 if(!evaluateWindow(ctx.series,row,row+336,repair.repaired.c).pass)continue
 nominalCount++
 const passing=checkDispersion(ctx.products.footprint.data,ctx.sun.rows,ctx.earth.rows,row,repair.repaired.c).passing
 if(passing>result.baselinePassing&&(!best||passing>best.passing))best={row,passing}
 if(passing===19)break
}
check(best?.row===candidate.scenario.row&&best?.passing===candidate.passing&&nominalCount===result.nominalPassing,'Independent exhaustive search confirms count-first, earliest-date ranking')
const pair=decodeScenarios(encodeScenarios([{...repair.repaired,id:0},{...candidate.scenario,id:1}]),s=>s===ctx.series.slug)!
check(pair[0].row===1272&&pair[1].row===candidate.scenario.row&&JSON.stringify(pair[0].c)===JSON.stringify(pair[1].c),'Planner handoff isolates date and preserves identical repaired hardware')
check(JSON.stringify(repair)===original&&JSON.stringify(ctx.products)===source,'Search never mutates the original repair or terrain products')
for(const footprint of [{status:'loading' as const},{status:'unavailable' as const,error:'offline'}]){
 const unavailable=await findLessSensitiveDate({...ctx,products:{...ctx.products,footprint}},repair.repaired)
 check(unavailable.status==='unavailable','Missing footprint is unassessed, not a searched negative')
}
for(const row of [-1,1.5,NaN,ctx.series.hours-335,ctx.series.hours-336]){
 const unavailable=await findLessSensitiveDate(ctx,{...repair.repaired,row})
 check(unavailable.status==='unavailable','Invalid or coverage-limited missions do not invent a later date')
}
for(const phase of ['before','terrain','dates']){
 const abort=new AbortController()
 if(phase==='before')abort.abort()
 await assert.rejects(()=>findLessSensitiveDate(ctx,repair.repaired,{signal:abort.signal,yieldControl:async()=>{},onProgress:p=>{if(p.phase===phase&&(p.done>0))abort.abort()}}),{name:'AbortError'});checks++
}
const relaxed={...cloneConstraints(c),minLitPct:0,minLinkPct:0,maxDarkH:336,maxGapH:336,power:undefined}
const all=await findLessSensitiveDate(ctx,{...repair.repaired,c:relaxed},{yieldControl:async()=>{}})
check(all.status==='complete'&&all.baselinePassing===19&&all.checked===0&&!all.candidate,'An all-sample passing baseline does not invent a sensitivity improvement')
const haw=context('haworth-rim'),none=await findLessSensitiveDate(haw,{...repair.repaired,slug:haw.series.slug},{yieldControl:async()=>{}})
check(none.status==='complete'&&none.checked===360&&none.nominalPassing===0&&none.candidate===null,'No nominally passing date produces an honest completed no-result search')
check(JSON.stringify(repair)===original,'Cancelled and failed searches retain the original mission')
console.log(`Sensitive date checks passed: ${checks}; ${result.baselinePassing}/19 → ${candidate.passing}/19 at +${(candidate.scenario.row-repair.repaired.row)/24} days; actual search ${elapsed.toFixed(0)} ms`)
