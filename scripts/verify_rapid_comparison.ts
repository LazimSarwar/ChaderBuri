import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quickComparison } from '../src/architect/quickCompare.ts'
import { landingRow } from '../src/architect/landingDate.ts'
import { landingContext,generationDifference,comparisonExplanation,formatEnergyKwh } from '../src/architect/comparisonContext.ts'
import { buildSeries,evaluateWindow,type SiteSeries,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER,generationFor,simulatePower } from '../src/architect/power.ts'
import { comparisonReport,type Scn } from '../src/architect/comparison.ts'
let checks=0
const check=(value:unknown,message:string)=>{assert.ok(value,message);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const sites=read('sites.json'),slug='malapert-massif',sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`),start=Date.parse(sun.start)
check(landingRow('2026-10-25T00:00',start,20448,14)===1296,'Date picker commits the selected UTC date without host-timezone conversion')
check(landingRow('2026-10-25T00:00:00',start,20448,14)===1296,'Native picker seconds are accepted when exactly on the hourly grid')
for(const value of ['','2026-02-30T00:00','2026-10-25T00:30','2028-12-31T00:00','2026-08-31T00:00'])check(landingRow(value,start,20448,14)===null,'Partial/invalid/out-of-coverage date remains unapplied: '+value)
const quick=quickComparison(sites,slug,1104,20448)!
check(quick.scns[0].slug===slug&&quick.scns[1].slug!==slug,'Direct entry compares two supported sites')
check(quick.scns[0].row===1104&&quick.scns[1].row===1104,'Direct entry starts with the same selected date')
quick.scns[0].c.power!.loadW=999
check(quick.scns[1].c.power!.loadW===DEFAULT_POWER.loadW&&DEFAULT_POWER.loadW===100,'Quick comparison settings are independent and do not mutate defaults')
const edge=quickComparison(sites,slug,20448,20448)!
check(edge.scns.every(s=>s.row===20112)&&edge.note.includes('moved'),'Cache-boundary default adjustment is explicit and keeps a complete mission')
check(quickComparison(sites.slice(0,1),slug,0,20448)===null&&quickComparison(sites,slug,NaN,20448)===null,'No invalid seed is created before sites are ready or with invalid dates')
check(formatEnergyKwh(-1)==='0.00'&&formatEnergyKwh(1,true)==='+0.00','Rounded near-zero differences do not display negative zero')
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const a:Scn={id:0,slug,row:1104,c},b:Scn={id:1,slug,row:1272,c}
const series=buildSeries(slug,sun.rows,earth.rows,horizon),ea=evaluateWindow(series,a.row,a.row+336,c),eb=evaluateWindow(series,b.row,b.row+336,c)
const context=landingContext(a,sun,earth,horizon,start)!
check(context.sun.el===sun.rows[1104].el&&context.earth.el===earth.rows[1104].el,'Landing elevations come from the selected date and site')
check(context.sun.visible===(context.sun.el>horizon.profile[Math.round(context.sun.az)%360]),'Clearance uses the terrain skyline rather than a flat zero-degree horizon')
for(const body of [context.sun,context.earth])check(body.next===null||body.next.hours>0,'Next event is in the future, not an already-active state')
const end=landingContext({row:20448},sun,earth,horizon,start)!
check(end.sun.next===null&&end.earth.next===null,'End of cache does not invent future Sun/Earth events')
check(landingContext({row:20449},sun,earth,horizon,start)===null,'Out-of-cache landing geometry is not clamped')
const syntheticSun={...sun,rows:[{...sun.rows[0],el:-1,az:0},{...sun.rows[1],el:1,az:0},{...sun.rows[2],el:-1,az:0}]},syntheticEarth={...earth,rows:syntheticSun.rows},flat={...horizon,profile:Array(360).fill(0)}
const rising=landingContext({row:0},syntheticSun,syntheticEarth,flat,start)!,setting=landingContext({row:1},syntheticSun,syntheticEarth,flat,start)!
check(rising.sun.nextKind==='rises'&&Math.abs(rising.sun.next!.hours-.5)<1e-8,'Masked Sun shows the next sunrise at the interpolated crossing')
check(setting.earth.nextKind==='sets'&&Math.abs(setting.earth.next!.hours-.5)<1e-8,'Clear Earth shows the next Earthset')
const belowLevel=landingContext({row:0},{...syntheticSun,rows:syntheticSun.rows.map(r=>({...r,el:-3}))},syntheticEarth,{...flat,profile:Array(360).fill(-4)},start)!
check(belowLevel.sun.visible&&belowLevel.sun.el<0,'A negative-elevation Sun can still clear a depressed terrain horizon')
const diff=generationDifference(a,b,series,series)!
check(Math.abs(diff.totalWh-(eb.power!.generatedWh-ea.power!.generatedWh))<1e-6,'Attributed energy difference equals the actual planner generation change')
check(Math.abs(diff.contributions.reduce((n,p)=>n+p.wh,0)-diff.totalWh)<1e-6,'All attributed components conserve the full energy difference')
check(Math.abs(diff.contributions[1].wh)<1e-8,'Ideal tracking does not invent an elevation-dependent incidence loss')
const reverse=generationDifference(b,a,series,series)!
check(diff.contributions.every((p,i)=>Math.abs(p.wh+reverse.contributions[i].wh)<1e-6),'Swapping scenarios reverses the attribution without an ordering bias')
check(generationDifference(a,{...b,c:{...c,power:{...c.power!,panelAreaM2:4}}},series,series)===null,'Hardware changes suppress a misleading geometry-only attribution')
check(generationDifference(a,{...b,c:{...c,missionDays:15}},series,series)===null,'Different durations suppress geometry-only attribution')
const make=(flux:number,elevation:number,fraction:number):SiteSeries=>({...series,hours:336,solar:{azimuth:new Float64Array(336),elevation:new Float64Array(336).fill(elevation),fraction:new Float64Array(336).fill(fraction),fluxScale:new Float64Array(336).fill(flux)}})
for(const orientation of ['tracking','horizontal','fixed'] as const){
 const config={...c.power!,orientation,tiltDeg:35},scn={...a,row:0,c:{...c,power:config}},alt={...scn,id:1}
 const A=make(1,30,.4),B=make(.97,60,.8),d=generationDifference(scn,alt,A,B)!
 const actual=simulatePower(generationFor(B.solar,config),0,336,config).generatedWh-simulatePower(generationFor(A.solar,config),0,336,config).generatedWh
 check(Math.abs(d.totalWh-actual)<1e-5,'Attribution reconstructs the production generation model for '+orientation)
 check(Math.abs(d.contributions.reduce((n,p)=>n+p.wh,0)-actual)<1e-5,'Component sum agrees for '+orientation)
}
const explanation=comparisonExplanation(a,b,series,series,ea,eb)
check(explanation.lines.some(s=>s.includes('unchanged at displayed precision'))&&explanation.lines.some(s=>s.includes('timing')),'Equal visibility does not conceal a changed electrical outcome')
check(!comparisonExplanation(a,b,series,series,{...ea,litPct:63.04},{...eb,litPct:63.06}).lines.some(s=>s.includes('percentages are unchanged')),'Display-rounding boundaries do not produce a false unchanged-visibility claim')
check(comparisonExplanation(a,b,series,series,ea,null).energy===null,'Missing complete mission does not receive an attributed cause')
const loaded={...b,c:{...c,power:{...c.power!,loadW:1300}}}
check(comparisonExplanation(a,loaded,series,series,ea,eb).lines.some(s=>s.includes('constant demand 1200 → 1300 W')),'Changed demand is explained in physical units instead of a generic hardware label')
const exportDoc=comparisonReport(read('prediction-index.json'),[a,b],new Map([[slug,series]]),undefined,{eph:{[slug]:{sun,earth}},horizons:{[slug]:horizon}})
check(exportDoc.scenarios[0].atLanding?.sun.el===context.sun.el&&exportDoc.differences[0].energy?.totalWh===diff.totalWh,'Comparison JSON preserves the displayed landing context and energy attribution')
console.log(`Rapid comparison and causal-model explanation checks passed: ${checks}`)
