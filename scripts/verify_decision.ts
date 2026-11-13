import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries,type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import { assessRobustness,loadRobustnessProducts,pendingRobustness,type RobustnessProducts } from '../src/architect/robustness.ts'
import { buildMissionBrief } from '../src/architect/missionBrief.ts'
import { comparisonReport,cloneConstraints,type Scn } from '../src/architect/comparison.ts'
import { TIMING_LIMITATION } from '../src/lib/attribution.ts'
let checks=0
const check=(value:unknown,message:string)=>{assert.ok(value,message);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const index=read('prediction-index.json'),sites=read('sites.json'),slug='malapert-massif',sun=read(`ephemeris/${slug}.sun.json`),earth=read(`ephemeris/${slug}.earth.json`),horizon=read(`horizons/${slug}.json`)
const products:RobustnessProducts={footprint:{status:'ready',data:read(`dispersion/${slug}.json`)},height:{status:'ready',data:read(`validation/sites/${slug}.json`)}}
const c:Constraints={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER,panelAreaM2:3.08,loadW:1200}}
const nominal=assessRobustness(products,sun,earth,horizon,1104,c)
check(nominal.footprint.status==='ready'&&nominal.footprint.data.passing===5,'Reference nominal pass still exposes only 5/19 nearby visibility/battery passes')
check(nominal.height.status==='ready'&&nominal.height.data.length===4&&nominal.height.data.every(r=>r.result.pass),'Four nominal height checks retain the enabled mission verdict')
const slipped=assessRobustness(products,sun,earth,horizon,1272,c)
check(slipped.height.status==='ready'&&!slipped.height.data[0].result.pass&&slipped.height.data.slice(1).every(r=>r.result.pass),'Seven-day slip exposes the actual verdict change at 1/3/5 m')
check(slipped.footprint.status==='ready'&&slipped.footprint.data.passing===1,'Slipped mission recomputes the footprint as 1/19')
const failing=assessRobustness(products,sun,earth,horizon,1104,{...c,power:{...c.power!,loadW:5000}})
check(failing.height.status==='ready'&&failing.height.data.every(r=>!r.result.pass),'Editing demand recomputes height results, rather than retaining a stale pass')
const thermal=assessRobustness(products,sun,earth,horizon,1104,{...c,thermal:{...DEFAULT_THERMAL}})
check(thermal.height.status==='ready'&&thermal.height.data.every(r=>r.result.thermal!==undefined),'Height checks include enabled thermal screening')
check(thermal.footprint.status==='ready'&&thermal.footprint.data.passing===5&&thermal.footprint.data.samples.every(r=>r.result.thermal===undefined),'Footprint explicitly retains visibility/battery scope when thermal is enabled')
const missing=assessRobustness({footprint:{status:'unavailable',error:'missing'},height:{status:'unavailable',error:'missing'}},sun,earth,horizon,1104,c)
check(missing.footprint.status==='unavailable'&&missing.height.status==='unavailable','Unavailable products never become zero failures or a passing result')
const pending=assessRobustness(pendingRobustness(),sun,earth,horizon,1104,c)
check(pending.footprint.status==='loading'&&pending.height.status==='loading','Loading remains distinct from assessed and unavailable')
const series=buildSeries(slug,sun.rows,earth.rows,horizon),bySlug=new Map([[slug,series]]),eph={[slug]:{sun,earth}},horizons={[slug]:horizon}
const brief=buildMissionBrief(index,[{id:0,slug,row:1104,c},{id:1,slug,row:1272,c}],bySlug,sites,eph,horizons,{[slug]:products},'2026-10-31T00:00:00Z')
check(brief.scenarios[0].result?.pass&&brief.scenarios[1].result?.pass===false,'Printed baseline and slip have independently evaluated verdicts')
check(brief.scenarios[0].landingUTC==='2026-10-17T00:00:00.000Z'&&brief.scenarios[1].landingUTC==='2026-10-24T00:00:00.000Z','Printed dates are absolute UTC and exactly seven days apart')
for(const s of brief.scenarios){
 check(s.battery?.points.length===337,'Battery chart includes every interval boundary')
 check(s.battery?.minPct===s.result?.power?.minPct,'Printed battery curve and verdict agree')
 check(s.robustness?.footprint.status==='ready','Printed footprint uses the verified product')
 check(s.robustness?.height.status==='ready','Printed heights use the verified product')
}
check(brief.reproducibility.datasetId===index.datasetId&&brief.reproducibility.model.sha256===index.model.sha256,'Printed source identity matches the loaded numerical model')
check(brief.timingLimitations===TIMING_LIMITATION&&!brief.timingLimitations.includes('±'),'Brief carries the sampling limitation without a fabricated timing bound')
brief.scenarios[0].constraints.power!.loadW=5
check(c.power!.loadW===1200&&brief.scenarios[1].constraints.power!.loadW===1200,'Brief scenarios do not alias live settings or each other')
const boundary=buildMissionBrief(index,[{id:0,slug,row:series.hours-336,c},{id:1,slug,row:series.hours-336+168,c}],bySlug,sites,eph,horizons,{[slug]:products})
check(boundary.scenarios[0].result!==null&&boundary.scenarios[1].result===null&&boundary.scenarios[1].battery===null&&boundary.scenarios[1].robustness===null,'End-of-cache slip is explicitly not assessed, with no silently shifted landing date')
const outside=assessRobustness(products,sun,earth,horizon,series.hours-24,c)
check(outside.height.status==='unavailable'&&outside.footprint.status==='unavailable','A partial height window cannot masquerade as a complete assessment')
const otherSlug='nobile-rim',otherSun=read(`ephemeris/${otherSlug}.sun.json`),otherEarth=read(`ephemeris/${otherSlug}.earth.json`),otherHorizon=read(`horizons/${otherSlug}.json`)
const allSeries=new Map([...bySlug,[otherSlug,buildSeries(otherSlug,otherSun.rows,otherEarth.rows,otherHorizon)] as const]),allEph={...eph,[otherSlug]:{sun:otherSun,earth:otherEarth}},allHorizons={...horizons,[otherSlug]:otherHorizon}
const otherProducts:RobustnessProducts={footprint:{status:'ready',data:read(`dispersion/${otherSlug}.json`)},height:{status:'ready',data:read(`validation/sites/${otherSlug}.json`)}}
const allProducts={[slug]:products,[otherSlug]:otherProducts}
const comparison:Scn[]=[{id:9,slug,row:1104,c:cloneConstraints(c)},{id:4,slug,row:1272,c:cloneConstraints(c)},{id:18,slug:otherSlug,row:6000,c:{...cloneConstraints(c),missionDays:10,power:undefined}}]
const multi=buildMissionBrief(index,comparison,allSeries,sites,allEph,allHorizons,allProducts,'2026-10-31T00:00:00Z','comparison')
check(multi.kind==='comparison'&&multi.scenarios.map(s=>s.label).join('|')==='A · Baseline|B · Alternative|C · Alternative','Arbitrary scenario IDs keep current visual A/B/C ordering in the brief')
check(multi.scenarios[2].slug===otherSlug&&multi.scenarios[2].landingUTC===new Date(Date.parse(index.coverage.start)+6000*3600000).toISOString(),'Third scenario keeps its actual site and arbitrary date instead of a synthetic seven-day slip')
check(multi.scenarios[2].constraints.missionDays===10&&multi.scenarios[2].battery===null&&multi.scenarios[2].constraints.power===undefined,'Different durations and disabled battery requirements remain scenario-specific')
check(multi.scenarios[0].robustness?.footprint.status==='ready'&&multi.scenarios[0].robustness.footprint.data.passing===5&&multi.scenarios[1].robustness?.footprint.status==='ready'&&multi.scenarios[1].robustness.footprint.data.passing===1,'Comparison brief preserves the same 5/19 and 1/19 diagnostics as the mission view')
const directOther=assessRobustness(otherProducts,otherSun,otherEarth,otherHorizon,6000,comparison[2].c)
check(JSON.stringify(multi.scenarios[2].robustness)===JSON.stringify(directOther),'Cross-site diagnostics use that site’s own ephemeris and products')
check(multi.scenarios.every(s=>s.atLanding!==null)&&multi.differences.length===2&&multi.differences[0].energy!==null&&multi.differences[1].energy===null,'Brief includes landing geometry and only applicable electrical attribution')
comparison[1].c.power!.loadW=5000
const edited=buildMissionBrief(index,comparison,allSeries,sites,allEph,allHorizons,allProducts,undefined,'comparison')
check(edited.scenarios[1].constraints.power!.loadW===5000&&multi.scenarios[1].constraints.power!.loadW===1200,'Open brief is a stable snapshot, isolated from subsequent edits')
check(edited.scenarios[1].robustness?.height.status==='ready'&&edited.scenarios[1].robustness.height.data.every(r=>!r.result.pass),'Hardware edits invalidate previously passing raised-height outcomes')
const exported=comparisonReport(index,comparison,allSeries,undefined,{eph:allEph,horizons:allHorizons,products:allProducts})
for(let i=0;i<comparison.length;i++)check(JSON.stringify(exported.scenarios[i].robustness)===JSON.stringify(edited.scenarios[i].robustness),'Comparison JSON and brief share the exact scenario-specific assessment')
check(!!exported.reproducibility.productFingerprints[`/data/dispersion/${otherSlug}.json`]&&!!exported.reproducibility.productFingerprints[`/data/validation/sites/${slug}.json`],'Multi-site export fingerprints both kinds of diagnostic input')
const partialBrief=buildMissionBrief(index,comparison,allSeries,sites,allEph,allHorizons,{[slug]:{footprint:{status:'unavailable',error:'offline'},height:products.height},[otherSlug]:pendingRobustness()},undefined,'comparison')
check(partialBrief.scenarios[0].robustness?.footprint.status==='unavailable'&&partialBrief.scenarios[0].robustness.height.status==='ready'&&partialBrief.scenarios[2].robustness?.height.status==='loading','Printed partial/unavailable and loading states remain distinct from assessed failures')
check(buildMissionBrief(index,[comparison[2]],allSeries,sites,allEph,allHorizons,allProducts,undefined,'comparison').scenarios[0].label==='A · Baseline','Removing alternatives leaves a valid one-scenario comparison brief')
const originalFetch=globalThis.fetch
try{
 globalThis.fetch=async(input)=>new Response(readFileSync('public'+String(input),'utf8'),{status:200})
 const loaded=await loadRobustnessProducts(index,slug)
 check(loaded.footprint.status==='ready'&&loaded.height.status==='ready','Both fingerprinted diagnostic products load successfully')
 globalThis.fetch=async()=>new Response('not found',{status:404})
 const absent=await loadRobustnessProducts(index,slug)
 check(absent.footprint.status==='unavailable'&&absent.height.status==='unavailable','HTTP failure remains a missing assessment')
 globalThis.fetch=async(input)=>String(input).includes('/dispersion/')?new Response('missing',{status:404}):new Response(readFileSync('public'+String(input),'utf8'),{status:200})
 const partial=await loadRobustnessProducts(index,slug)
 check(partial.footprint.status==='unavailable'&&partial.height.status==='ready','One missing diagnostic does not suppress the other measured assessment')
 globalThis.fetch=async(input)=>new Response(readFileSync('public'+String(input),'utf8')+' ',{status:200})
 const changed=await loadRobustnessProducts(index,slug)
 check(changed.footprint.status==='unavailable'&&changed.height.status==='unavailable','Changed source bytes cannot reach the headline or print report')
}finally{globalThis.fetch=originalFetch}
console.log(`Decision robustness and printable brief checks passed: ${checks}`)
