import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER,generationFor,simulatePower } from '../src/architect/power.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import { assessRobustness,pendingRobustness,type RobustnessProducts } from '../src/architect/robustness.ts'
import { explorationDecision } from '../src/lib/explorationDecision.ts'
import { buildFailurePreview,failureReading } from '../src/lib/failurePreview.ts'
let checks=0
const check=(v:unknown,message:string)=>{assert.ok(v,message);checks++}
const close=(a:number,b:number,tolerance=1e-8)=>check(Math.abs(a-b)<=tolerance,`${a} must equal ${b}`)
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const slug='malapert-massif',sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`),series=buildSeries(slug,sun.rows,earth.rows,horizon)
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const before=JSON.stringify(c),pair=explorationDecision(series,1104,Date.parse('2026-09-01T00:00:00Z'),c),resultBefore=JSON.stringify(pair)
check(buildFailurePreview(series,pair.a,c)===null,'A passing mission does not get a failure preview')
check(buildFailurePreview(series,null,c)===null,'An unassessed mission does not get a fabricated failure')
const failure=buildFailurePreview(series,pair.b,c)!
check(failure.kind==='battery'&&failure.timing==='threshold'&&!!failure.battery,'Reference slip uses the actual limiting battery requirement')
close(failure.eventHour,pair.b!.power!.firstReserveH!)
close(failure.eventHour,332.801154886651,1e-6)
check(failure.window.target==='sun'&&failure.window.showSunPath===false,'Battery preview faces the Sun without an unrelated future Sun path')
check(failure.window.startRow>=1272&&failure.window.endRow<=1608&&failure.window.eventRow<=1608,'Preview remains inside the failed 14-day mission, before the later Sun-centre sunset')
assert.deepEqual(failure.battery,simulatePower(generationFor(series.solar,c.power!),1272,1608,c.power!,true));checks++
close(failureReading(failure,failure.window.eventRow)!.batteryPct!,20,1e-6)
check(failureReading(failure,1104)===null&&failureReading(failure,1608.01)===null,'Live readout does not extrapolate or show B battery while the scene is at A')
check(failureReading(failure,NaN)===null,'Invalid scene epoch produces no reading')
close(failureReading(failure,1608)!.batteryPct!,pair.b!.power!.endPct)
const event=failureReading(failure,failure.window.eventRow)!
check(event.generationW!<event.loadW!&&event.loadW===1200,'B breach reveals the actual generation deficit against the same demand')
check(JSON.stringify(c)===before&&JSON.stringify(pair)===resultBefore,'Preview calculation leaves dates, requirements and nominal results unchanged')
const products:RobustnessProducts={footprint:{status:'ready',data:read(`dispersion/${slug}.json`)},height:{status:'ready',data:read(`validation/sites/${slug}.json`)}}
const a=assessRobustness(products,sun,earth,horizon,pair.rowA,c),b=assessRobustness(products,sun,earth,horizon,pair.rowB,c)
check(a.footprint.status==='ready'&&a.footprint.data.passing===5,'Guide A has the same 5/19 footprint result as planner')
check(b.footprint.status==='ready'&&b.footprint.data.passing===1,'Guide B independently has 1/19 passing footprint samples')
check(a.height.status==='ready'&&a.height.data.every(h=>h.result.pass),'Guide A height results all pass')
check(b.height.status==='ready'&&!b.height.data[0].result.pass&&b.height.data.slice(1).every(h=>h.result.pass),'Guide B reports verdict changes at raised heights, while ground-level verdict still fails')
check(pair.a!.pass&&!pair.b!.pass,'Robustness calculations do not overwrite the nominal decisions')
const pending=assessRobustness(pendingRobustness(),sun,earth,horizon,1104,c)
check(pending.footprint.status==='loading'&&pending.height.status==='loading','Pending products stay distinct from calculated counts')
const unavailable=assessRobustness({footprint:{status:'unavailable',error:'missing'},height:{status:'unavailable',error:'missing'}},sun,earth,horizon,1104,c)
check(unavailable.footprint.status==='unavailable'&&unavailable.height.status==='unavailable','Missing checks never become zero failures or all passing')
const relaxed:Constraints={...c,minLitPct:0,minLinkPct:0,maxDarkH:720,maxGapH:720,power:undefined}
const startLow={...relaxed,power:{...DEFAULT_POWER,initialPct:10,reservePct:20,loadW:0}}
const low=buildFailurePreview(series,evaluateWindow(series,1104,1440,startLow),startLow)!
check(low.eventHour===0&&low.window.startRow===1104&&low.title.includes('starts'),'Starting below reserve creates a landing-time example, not a negative preview epoch')
const hslug='haworth-rim',hs=read(`ephemeris/${hslug}.sun.json`),he=read(`ephemeris/${hslug}.earth.json`),hh=read(`horizons/${hslug}.json`),haworth=buildSeries(hslug,hs.rows,he.rows,hh)
for(const kind of ['gap','dark','lit','link'] as const){
 const settings={...relaxed,...(kind==='gap'?{maxGapH:72}:kind==='dark'?{maxDarkH:72}:kind==='lit'?{minLitPct:60}:{minLinkPct:60})}
 const r=evaluateWindow(haworth,1104,1440,settings),f=buildFailurePreview(haworth,r,settings)!
 check(r.limiting===kind&&f.kind===kind,'Preview follows the actual '+kind+' limiting requirement')
 check(f.window.target===(kind==='gap'||kind==='link'?'earth':'sun'),'Selected '+kind+' preview faces the relevant body')
 check(f.window.startRow>=1104&&f.window.endRow<=1440,'Blocked-interval preview stays within the complete mission')
 check(f.timing===(kind==='lit'||kind==='link'?'representative':'threshold'),'Aggregate percentage shortfall is not presented as a unique failure instant')
 if(f.limitH!==null)close(failureReading(f,f.window.eventRow)!.blockedHours!,f.limitH)
 else check(f.explanation.includes('not a unique failure instant'),'Representative interval discloses its scope')
}
const thermal={...relaxed,power:{...DEFAULT_POWER,loadW:0},thermal:{...DEFAULT_THERMAL,thermalMassJK:1000,internalHeatFraction:0,heaterMaxW:0,absorptivityAreaM2:0,survivalK:273}}
const tr=evaluateWindow(series,1104,1440,thermal),tf=buildFailurePreview(series,tr,thermal)!
check(tr.limiting==='thermal'&&tf.kind==='thermal'&&tf.eventHour===tr.thermal!.firstFreezeH,'Thermal-limited case uses the modeled survival event rather than an unrelated sunset')
check(tf.battery===null,'Thermal preview does not masquerade as a battery explanation')
check(buildFailurePreview(series,{...pair.b!,endRow:series.hours+1},c)===null,'Incomplete cached mission cannot be previewed')
console.log(`Failure preview and guide robustness checks passed: ${checks}`)
