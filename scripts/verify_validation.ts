import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { raisedObserver,heightHorizon,validateHeightReport,type HeightReport } from '../src/lib/heightSensitivity.ts'
import { assessTransition } from '../src/lib/transitionValidation.ts'
import { directionCrossingFraction,nextHorizonCrossing } from '../src/lib/attribution.ts'
import { comparisonReport,type Scn } from '../src/architect/comparison.ts'
import { buildSeries,evaluateWindow,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import type { PredictionIndex } from '../src/lib/predictionIndex.ts'
let checks=0;const check=(ok:unknown,message:string)=>{assert.ok(ok,message);checks++}
const raw=(p:string)=>readFileSync('public/data/'+p),read=(p:string)=>JSON.parse(raw(p).toString())
const hash=(p:string)=>createHash('sha256').update(raw(p)).digest('hex')
const index:PredictionIndex=read('prediction-index.json')
for(const [path,fingerprint]of Object.entries(index.model.files))check(createHash('sha256').update(readFileSync(path)).digest('hex')===fingerprint,'Model source fingerprint matches the exported version')
const stepped=Array(360).fill(0);stepped[1]=10
const stepFraction=directionCrossingFraction({az:.1,el:1},{az:.9,el:1},stepped,false)!
check(Math.abs(stepFraction-.5)<1e-8,'Crossing follows the actual skyline-bin boundary, not linear clearance')
const at=nextHorizonCrossing([{t:'2026-Oct-17 00:00',az:.1,el:1},{t:'2026-Oct-17 01:00',az:.9,el:1}],new Date('2026-10-17T00:00:00Z'),{profile:stepped} as any,false)!
check(Math.abs(at.hours-.5)<1e-8&&at.atUTC.includes('00:30'),'Displayed crossing time matches the renderer and mask lookup')
for(const [path,entry]of Object.entries(index.files))check(hash(path.slice(6))===entry.sha256,'Indexed product fingerprint matches its actual file')
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
for(const site of read('sites.json')){
 const report:HeightReport=read(`validation/sites/${site.slug}.json`),h=read(`horizons/${site.slug}.json`)
 validateHeightReport(report,site.slug,hash(`horizons/${site.slug}.json`));checks++
 check(report.nominalRecomputeMaxDeg<=.011,'Recomputed nominal agrees within stored horizon rounding')
 for(let i=0;i<360;i++){
  check(report.profiles[0].profile[i]===h.profile[i],'Zero-metre sensitivity preserves the production horizon')
  for(let j=1;j<4;j++)check(report.profiles[j].profile[i]<=report.profiles[j-1].profile[i]+.011,'Raising the observer lowers the skyline within stored rounding')
 }
 const sun=read(`ephemeris/${site.slug}.sun.json`).rows.slice(1104,1441),earth=read(`ephemeris/${site.slug}.earth.json`).rows.slice(1104,1441)
 const nominal=evaluateWindow(buildSeries('baseline',sun,earth,h),0,336,c)
 const same=evaluateWindow(buildSeries('zero',sun.map(r=>raisedObserver(r,0)),earth.map(r=>raisedObserver(r,0)),heightHorizon(h,report.profiles[0])),0,336,c)
 check(JSON.stringify(nominal)===JSON.stringify(same),'Zero-height diagnostic reproduces the full nominal verdict exactly')
}
const row={t:'2026-Oct-17 00:00',az:90,el:0,rangeKm:100,radiusDeg:1}
check(raisedObserver(row,3).el<0&&raisedObserver(row,3).rangeKm!>100,'Observer translation has the expected geometry')
for(const probe of read('validation/transitions.json').cases){
 check(probe.status==='complete','Actual finer-source query completed')
 check(probe.cachedEphemerisSha256===hash(`ephemeris/${probe.slug}.${probe.body}.json`),'Probe ties to the actual cache')
 const stats=assessTransition(probe,read(`ephemeris/${probe.slug}.${probe.body}.json`).rows,read(`horizons/${probe.slug}.json`))
 check(stats.samples===145&&Number.isFinite(stats.maxAngleDeg),'Source probe is a finite 24-hour ten-minute grid')
 if(probe.body==='sun')check(stats.maxEdgeMinutes!==null&&stats.maxLegacyEdgeMinutes!==null&&stats.maxEdgeMinutes<stats.maxLegacyEdgeMinutes,'Direction-based event detection improves the saved stepped-skyline source cases')
 console.log(probe.slug,probe.body,JSON.stringify(stats))
 const invalid={...probe,samples:probe.samples.slice(1)};assert.throws(()=>assessTransition(invalid,read(`ephemeris/${probe.slug}.${probe.body}.json`).rows,read(`horizons/${probe.slug}.json`)));checks++
}
const slug='malapert-massif',series=buildSeries(slug,read(`ephemeris/${slug}.sun.json`).rows,read(`ephemeris/${slug}.earth.json`).rows,read(`horizons/${slug}.json`))
const scns:Scn[]=[{id:0,slug,row:1104,c},{id:1,slug,row:1272,c:{...c,power:{...c.power!}}}]
const exported=comparisonReport(index,scns,new Map([[slug,series]]),'2026-10-31T00:00:00Z')
check(exported.schemaVersion===2&&exported.reproducibility.datasetId===index.datasetId,'Comparison identifies its data snapshot')
check(exported.reproducibility.model.sha256===index.model.sha256&&Object.keys(exported.reproducibility.productFingerprints).length>=5,'Comparison identifies model and exact products')
check(exported.scenarios[0].landingUTC==='2026-10-17T00:00:00.000Z'&&exported.scenarios[1].result?.pass===false,'Export uses absolute UTC and recomputed outcomes')
scns[0].c.power!.loadW=7
check(exported.scenarios[0].constraints.power!.loadW===1200,'Export is independent of later input edits')
check(JSON.parse(JSON.stringify(exported)).reproducibility.model.version===index.model.version,'Provenance survives JSON serialization')
console.log(`Validation, observer-height and export checks passed: ${checks}`)
