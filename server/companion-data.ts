import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Site,Ephemeris,Horizon } from '../src/data.ts'
import { horizonAt } from '../src/data.ts'
import { buildSeries,evaluateWindow } from '../src/architect/solver.ts'
import type { SiteSeries } from '../src/architect/solver.ts'
import { checkDispersion,type DispersionData } from '../src/architect/dispersion.ts'
import { decisionFailures } from '../src/lib/explorationDecision.ts'
import { sampleSky } from '../src/lib/science.ts'
import { validateEphemeris,validateHorizon,validateSites } from '../src/lib/siteProducts.ts'
import type { PredictionIndex } from '../src/lib/predictionIndex.ts'
import type { CompanionComparison,CompanionContext,CompanionEvidence,CompanionRequirements,CompanionSite } from '../src/lib/lunarCompanion.ts'
import { compareFairly,type FairSide } from '../src/lib/fairCompare.ts'
import { generationDifference } from '../src/architect/comparisonContext.ts'
import type { Constraints,Evaluated } from '../src/architect/solver.ts'
import { createHash } from 'node:crypto'

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],pad=(n:number)=>String(n).padStart(2,'0')
/** The visitor's own limits, labelled as theirs: never NASA requirements or safety limits. */
function requirementsOf(c:Constraints):CompanionRequirements{
 return {selectedBy:'visitor',reservePct:c.power?.reservePct??null,minSunPct:c.minLitPct,minEarthPct:c.minLinkPct,maxDarkH:c.maxDarkH,maxEarthGapH:c.maxGapH,missionDays:c.missionDays,
  note:'These limits are the visitor’s own selections in the mission plan. They are not NASA requirements, safety limits or certified margins.'}
}
/** The Compare page's two options, computed by the same code as the page (fairCompare), with its causes and energy split. */
function comparisonOf(context:CompanionContext,data:{bundles:Bundle[]},start:number):CompanionComparison{
 const k=context.compare!,c=context.constraints
 const fmt=(row:number)=>{const d=new Date(start+row*3600000);return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:00 UTC`}
 const short=(row:number)=>{const d=new Date(start+row*3600000);return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`}
 // The page's option labels: site names, or the two landing dates.
 const dateLabel=(r:number,other:number,letter:string)=>r===other?`Landing ${letter}`:short(r)===short(other)?`${short(r)} ${pad(new Date(start+r*3600000).getUTCHours())}:00 landing`:`${short(r)} landing`
 const side=(slug:string,row:number,label:string):FairSide=>{
  const b=data.bundles.find(x=>x.site.slug===slug)
  if(!b)throw new Error('A compared site is unavailable.')
  return {label,ref:k.mode==='dates'?`the ${label}`:label,site:b.site.name,slug,row,series:b.series,sunRows:b.sun.rows,earthRows:b.earth.rows,horizon:b.horizon}
 }
 const A=side(k.a.slug,k.a.row,k.mode==='sites'?'':dateLabel(k.a.row,k.b.row,'A')),B=side(k.b.slug,k.b.row,k.mode==='sites'?'':dateLabel(k.b.row,k.a.row,'B'))
 if(k.mode==='sites'){A.label=A.ref=A.site;B.label=B.ref=B.site}
 const p=c.power,equipment=p?`${p.panelAreaM2} m² ${p.orientation} panel, ${p.capacityWh} Wh battery, ${p.loadW} W load`:'No battery model'
 const r=compareFairly(k.mode,A,B,c,fmt,equipment)
 const option=(id:'A'|'B',s:FairSide,e:Evaluated|null)=>({id,label:s.label,site:s.site,landingUTC:new Date(start+s.row*3600000).toISOString(),pass:e?e.pass:null,failures:e?decisionFailures(e):[],minBatteryPct:e?.power?.minPct??null,solarEnergyKWh:e?.power?e.power.generatedWh/1000:null,sunPct:e?.litPct??null,earthPct:e?.linkPct??null,darkWithinMissionH:e?.longestDarkH??null,outageWithinMissionH:e?.longestGapH??null})
 const energy=p&&r.evA&&r.evB?generationDifference({id:0,slug:A.slug,row:A.row,c},{id:1,slug:B.slug,row:B.row,c},A.series,B.series):null
 return {mode:k.mode,kept:r.same,change:r.differs,options:[option('A',A,r.evA),option('B',B,r.evB)],verdict:r.verdict,summary:r.summary,
  metrics:r.metrics.map(m=>({label:m.label,a:m.a,b:m.b,change:m.change,diff:m.diff})),causes:r.why,
  energyByCause:energy?energy.contributions.map(x=>({cause:x.label,kWh:Math.round(x.wh)/1000})):null,
  panel:p?p.orientation==='tracking'?'Ideal Sun tracking: the panel always faces the Sun, so panel angle causes no loss in either option.':`${p.orientation} panel: its angle to the Sun changes during the mission.`:null}
}

const root=resolve(process.cwd(),'public/data')
const read=(path:string)=>JSON.parse(readFileSync(resolve(root,path),'utf8'))
type Bundle={site:Site;sun:Ephemeris;earth:Ephemeris;horizon:Horizon;series:SiteSeries}
let cache:{identity:string;bundles:Bundle[];missing:string[]}|null=null
function bundles(index:PredictionIndex){
 if(cache?.identity===index.datasetId)return cache
 const catalog=read('sites.json') as Site[];validateSites(catalog)
 const loaded:Bundle[]=[],missing:string[]=[]
 const product=(path:string)=>{const raw=readFileSync(resolve(root,path),'utf8'),expected=index.files['/data/'+path]?.sha256;if(!expected||createHash('sha256').update(raw).digest('hex')!==expected)throw new Error('Prediction product mismatch');return JSON.parse(raw)}
 for(const site of catalog){try{
  const sun=product(`ephemeris/${site.slug}.sun.json`),earth=product(`ephemeris/${site.slug}.earth.json`),horizon=product(`horizons/${site.slug}.json`)
  validateEphemeris(sun);validateEphemeris(earth);validateHorizon(horizon)
  if(sun.site!==site.name||earth.site!==site.name||horizon.site!==site.name)throw new Error('Site identity mismatch')
  loaded.push({site,sun,earth,horizon,series:buildSeries(site.slug,sun.rows,earth.rows,horizon)})
 }catch{missing.push(site.slug)}}
 cache={identity:index.datasetId,bundles:loaded,missing};return cache
}
export function companionEvidence(context:CompanionContext):CompanionEvidence{
 const index=read('prediction-index.json') as PredictionIndex
 if(context.datasetId!==index.datasetId||context.model!==index.model.version)throw new Error('The scene and guide use different data snapshots. Reload the app.')
 const data=bundles(index),hours=context.constraints.missionDays*24,unavailableSlugs=[...data.missing]
 const sites:CompanionSite[]=data.bundles.flatMap(b=>{
  if(context.row+hours>b.series.hours){unavailableSlugs.push(b.site.slug);return []}
  const r=evaluateWindow(b.series,context.row,context.row+hours,context.constraints),sun=sampleSky(b.sun.rows,context.row),earth=sampleSky(b.earth.rows,context.row)
  return [{slug:b.site.slug,name:b.site.name,pass:r.pass,margin:r.margin,failures:decisionFailures(r),minBatteryPct:r.power?.minPct??null,sunPct:r.litPct,earthPct:r.linkPct,outageWithinMissionH:r.longestGapH,darkWithinMissionH:r.longestDarkH,sunClearanceDeg:sun.el-horizonAt(b.horizon,sun.az),earthClearanceDeg:earth.el-horizonAt(b.horizon,earth.az),footprint:null}]
 })
 const current=sites.find(s=>s.slug===context.slug)
 if(!current){
  if(!data.bundles.some(b=>b.site.slug===context.slug)||context.row>=index.coverage.samples)throw new Error('This site or time is outside the available predictions.')
  const landing=Date.parse(index.coverage.start)+context.row*3600000
  return {context,landingUTC:new Date(landing).toISOString(),endUTC:new Date(landing+hours*3600000).toISOString(),observerHeightM:index.analysisObserverHeightM,sites:[],eligibleSlugs:[],unavailableSlugs,requirements:requirementsOf(context.constraints),scope:['The scene is inside coverage but the full mission extends beyond the prediction window. Navigation is available. Mission metrics and suitability are unassessed.']}
 }
 // Higher solver margin is a stated screening preference, not a universal best site.
 // Do not call numerical dust a better destination: a passing target needs
 // at least 0.01 normalized gain before recommending a move.
 const eligible=sites.filter(s=>s.slug!==current.slug&&s.pass&&(!current.pass||s.margin>=current.margin+.01)).sort((a,b)=>b.margin-a.margin||a.slug.localeCompare(b.slug))
 for(const s of [current,...eligible.slice(0,3)]){try{
  const path=`dispersion/${s.slug}.json`,raw=readFileSync(resolve(root,path),'utf8')
  if(createHash('sha256').update(raw).digest('hex')!==index.files['/data/'+path]?.sha256)throw new Error('Footprint snapshot mismatch')
  const d=JSON.parse(raw) as DispersionData,b=data.bundles.find(b=>b.site.slug===s.slug)!,f=checkDispersion(d,b.sun.rows,b.earth.rows,context.row,context.constraints)
  s.footprint={passing:f.passing,total:f.samples.length}
 }catch{s.footprint=null}}
 const start=Date.parse(index.coverage.start),own=data.bundles.find(b=>b.site.slug===context.slug)!
 // Would a nearby date help? The same mission at the same site, a few days either side.
 const nearbyDates=[-7,-3,-1,1,3,7].flatMap(offsetDays=>{const r=context.row+offsetDays*24;if(r<0||r+hours>own.series.hours)return [];const e=evaluateWindow(own.series,r,r+hours,context.constraints);return [{offsetDays,landingUTC:new Date(start+r*3600000).toISOString(),pass:e.pass,minBatteryPct:e.power?.minPct??null,darkWithinMissionH:e.longestDarkH,outageWithinMissionH:e.longestGapH,failures:decisionFailures(e)}]})
 const comparison=context.compare?comparisonOf(context,data,start):undefined
 return {context,nearbyDates,...(comparison?{comparison}:{}),requirements:requirementsOf(context.constraints),landingUTC:new Date(start+context.row*3600000).toISOString(),endUTC:new Date(start+(context.row+hours)*3600000).toISOString(),observerHeightM:index.analysisObserverHeightM,sites,eligibleSlugs:eligible.slice(0,3).map(s=>s.slug),unavailableSlugs,scope:[
  'All site comparisons use this same landing UTC and mission assumptions. Recommendations are nominal passes; replacing a passing target requires at least 0.01 greater normalized solver margin. This is a screening preference, not certified landing safety.',
  'Outage and darkness durations are clipped to this mission. They are not the full time until Earth or Sun returns.',
  'Hourly left-endpoint screening and a sampled terrain skyline can miss short events; no numerical timing uncertainty bound is established.',
  'Footprint counts are a separate 19-point visibility/battery sensitivity, excluding thermal and RF. Counts are not probabilities; missing footprint is unassessed.',
  'Walking, crouching and jumping change the camera, not the analysis coordinate or observer height. Models, rocks and soil detail are illustrative.',
  'Earth-centre visibility and pointing do not establish a radio link. There is no astronaut life-support or safe-traverse assessment.',
  'Source: cached JPL Horizons ephemerides and LOLA/LROC terrain horizons, identified by the dataset/model snapshot.'
 ]}
}
