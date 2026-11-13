import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries, evaluateWindow, type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { cloneConstraints, decodeScenarios, encodeScenarios, nextPassingLanding, shiftedRow, verifiedRepairs, type Scn } from '../src/architect/comparison.ts'
const read = (p:string) => JSON.parse(readFileSync(`public/data/${p}`,'utf8'))
const slug='malapert-massif'
const series=buildSeries(slug,read(`ephemeris/${slug}.sun.json`).rows,read(`ephemeris/${slug}.earth.json`).rows,read(`horizons/${slug}.json`))
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const a:Scn={id:0,slug,row:1104,c}, b:Scn={id:1,slug,row:1272,c:cloneConstraints(c)}
let checks=0
const check=(v:unknown,message:string)=>{assert.ok(v,message);checks++}
check(evaluateWindow(series,a.row,a.row+336,a.c).pass,'Reference original passes')
check(!evaluateWindow(series,b.row,b.row+336,b.c).pass,'Seven-day delay fails reserve')
check(shiftedRow(a,7,series.hours)===b.row,'Seven-day shift uses UTC hours')
check(shiftedRow({...a,row:0},-1,series.hours)===null,'Shift before coverage rejected')
check(shiftedRow({...a,row:series.hours-336},1,series.hours)===null,'Shift beyond final boundary rejected')
b.c.power!.panelAreaM2=4; check(a.c.power!.panelAreaM2===3.08,'Editing a duplicate does not mutate baseline'); b.c=cloneConstraints(c)
const roundtrip=decodeScenarios(encodeScenarios([a,b]),s=>s===slug)
check(roundtrip?.[1].row===b.row && roundtrip[1].c.power?.loadW===1200,'Comparison restores dates and hardware')
for(const bad of [null,'{}','[null]',encodeScenarios([{...a,row:0.5}]),encodeScenarios([{...a,c:{...c,minLitPct:-1}}]),encodeScenarios([{...a,c:{...c,missionDays:60}}]),encodeScenarios([{...a,c:{...c,power:{...c.power!,loadW:1e12}}}]),encodeScenarios([a,b,a,b])])check(decodeScenarios(bad,s=>s===slug)===null,'Invalid shared comparison rejected')
const repairs=verifiedRepairs(series,b)
check(repairs.length===3,'Three independently verified electrical alternatives')
for(const r of repairs)check(evaluateWindow(series,b.row,b.row+336,r.c).pass,`${r.key} passes all enabled nominal requirements`)
check(repairs.find(r=>r.key==='panelAreaM2')?.value===3.1,'Delayed reference has reproducible 3.10 m² repair')
check(verifiedRepairs(series,{...b,c:{...b.c,minLinkPct:100,maxGapH:0,minLitPct:100,maxDarkH:0}}).every(r=>r.result.pass),'Repairs never bypass visibility requirements')
const row=nextPassingLanding(series,b)
check(row!==null && row>b.row && row<=b.row+90*24,'Next passing date search is bounded')
if(row!==null){check(evaluateWindow(series,row,row+336,b.c).pass,'Next candidate really passes');for(let h=b.row+6;h<row;h+=6)check(!evaluateWindow(series,h,h+336,b.c).pass,'No earlier six-hour candidate passes')}
check(nextPassingLanding(series,{...b,row:series.hours-336})===null,'No search beyond coverage')
console.log(`Comparison and schedule-slip checks passed: ${checks}`)
