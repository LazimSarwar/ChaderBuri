import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { assessRobustness,pendingRobustness,type RobustnessProducts } from '../src/architect/robustness.ts'
import { encodeScenarios,decodeScenarios } from '../src/architect/comparison.ts'
import { explorationDecision } from '../src/lib/explorationDecision.ts'
import { guideRepair,guideRecommendation } from '../src/lib/guideRepair.ts'
let checks=0
const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const slug='malapert-massif',sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`),series=buildSeries(slug,sun.rows,earth.rows,horizon)
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const scenario={id:7,slug,row:1272,c},snapshot=JSON.stringify(scenario)
const repair=guideRepair(series,scenario)!
check(!!repair&&repair.key==='panelAreaM2'&&repair.from===3.08&&repair.to===3.1,'Reference repair deterministically chooses the verified rounded panel area')
check(!repair.before.pass&&repair.after.pass&&repair.after.power!.minPct>=20,'The whole repaired mission passes with reserve')
assert.deepEqual(repair.after,evaluateWindow(series,1272,1608,repair.repaired.c));checks++
check(repair.repaired.row===scenario.row&&repair.original.row===scenario.row,'Repair preserves both landing dates')
const delta=Object.keys(c.power!).filter(key=>c.power![key as keyof typeof c.power]!==repair.repaired.c.power![key as keyof typeof c.power])
assert.deepEqual(delta,['panelAreaM2']);checks++
const shared=decodeScenarios(encodeScenarios([repair.original,repair.repaired]),s=>s===slug)!
check(shared[0].c.power!.panelAreaM2===3.08&&shared[1].c.power!.panelAreaM2===3.1,'Planner/share handoff retains before and after independently')
repair.original.c.power!.loadW=7;repair.repaired.c.power!.capacityWh=17
check(JSON.stringify(scenario)===snapshot,'Repair does not mutate input hardware')
const fresh=guideRepair(series,scenario)!
const products:RobustnessProducts={footprint:{status:'ready',data:read(`dispersion/${slug}.json`)},height:{status:'ready',data:read(`validation/sites/${slug}.json`)}}
const assess=(row:number,constraints:Constraints)=>assessRobustness(products,sun,earth,horizon,row,constraints)
const pair=explorationDecision(series,1104,Date.parse('2026-09-01T00:00:00Z'),c),a=assess(pair.rowA,c),b=assess(pair.rowB,c),after=assess(1272,fresh.repaired.c)
check(a.footprint.status==='ready'&&a.footprint.data.passing===5,'Nominal passing A has actual mixed 5/19 footprint')
check(b.footprint.status==='ready'&&b.footprint.data.passing===1,'Original B footprint is 1/19')
check(after.footprint.status==='ready'&&after.height.status==='ready','Repair recomputes both sensitivity products')
check(after.footprint.status==='ready'&&after.footprint.data.samples.every(s=>s.result.power?.minPct!==undefined),'Every repaired footprint sample includes the battery assessment')
check(guideRecommendation(pair,{a,b}).includes('mixed footprint outcomes (5/19)'),'Recommendation qualifies preferred A with actual mixed results')
check(guideRecommendation(pair,{a,b}).includes('not probabilities'),'Recommendation never converts sample counts into success odds')
const pending=assessRobustness(pendingRobustness(),sun,earth,horizon,1104,c)
check(guideRecommendation(pair,{a:pending,b:pending}).includes('pending'),'Loading diagnostics cannot imply robustness')
const unavailable={footprint:{status:'unavailable' as const,error:'offline'},height:{status:'unavailable' as const,error:'offline'}}
check(guideRecommendation(pair,{a:unavailable,b}).includes('not assessed'),'Unavailable diagnostics cannot imply robustness')
if(a.footprint.status==='ready'){
 for(const n of [0,a.footprint.data.samples.length]){
  const test={...a,footprint:{status:'ready' as const,data:{...a.footprint.data,passing:n}}}
  check(guideRecommendation(pair,{a:test,b}).includes(n===0?'no sampled locations pass':'all sampled locations pass'),'All/none sample outcomes are distinct')
 }
}
for(const invalid of [{...scenario,row:-1},{...scenario,row:1.5},{...scenario,row:series.hours-335},{...scenario,slug:'other'},{...scenario,c:{...c,power:undefined}},{...scenario,row:1104}])check(guideRepair(series,invalid)===null,'Invalid, incomplete, unpowered and already passing missions do not invent repairs')
const haw='haworth-rim',hs=buildSeries(haw,read(`ephemeris/${haw}.sun.json`).rows,read(`ephemeris/${haw}.earth.json`).rows,read(`horizons/${haw}.json`))
check(guideRepair(hs,{...scenario,slug:haw})===null,'Hardware cannot bypass actual Earth visibility failure')
const neither=explorationDecision(hs,1104,Date.parse('2026-09-01T00:00:00Z'),c)
check(guideRecommendation(neither,{a,b}).startsWith('Neither'),'Neither failing date is recommended because of unrelated samples')
check(JSON.stringify(scenario)===snapshot,'Assessment and recommendation preserve original scenario')
console.log(`Guide repair checks passed: ${checks}; repaired footprint ${after.footprint.status==='ready'?after.footprint.data.passing:'unavailable'}/19; min battery ${fresh.after.power?.minPct.toFixed(3)}%`)
