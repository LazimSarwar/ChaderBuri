import type { Ephemeris,Horizon } from '../data.ts'
import { SOLAR_IRRADIANCE,horizonElevation,sampleSky,solarDiscFraction,eclipseFactor } from '../lib/science.ts'
import { nextHorizonCrossing } from '../lib/attribution.ts'
import type { Scn } from './comparison.ts'
import type { Evaluated,SiteSeries } from './solver.ts'
import type { PowerConfig } from './power.ts'

export function landingContext(s:Pick<Scn,'row'>,sun:Ephemeris,earth:Ephemeris,horizon:Horizon,startMs:number){
 if(!Number.isFinite(s.row)||s.row<0||s.row>sun.rows.length-1||s.row>earth.rows.length-1)return null
 const at=new Date(startMs+s.row*3600000),solar=sampleSky(sun.rows,s.row),terrestrial=sampleSky(earth.rows,s.row)
 const body=(rows:Ephemeris['rows'],sky:typeof solar)=>{
  const mask=horizonElevation(horizon.profile,sky.az),clearance=sky.el-mask,visible=clearance>0
  return {...sky,mask,clearance,visible,nextKind:visible?'sets' as const:'rises' as const,next:nextHorizonCrossing(rows,at,horizon,!visible)}
 }
 return {sun:body(sun.rows,solar),earth:body(earth.rows,terrestrial),terrainDiscFraction:solarDiscFraction(solar.el,horizonElevation(horizon.profile,solar.az),solar.radiusDeg),eclipseFraction:eclipseFactor(solar.az,solar.el,terrestrial.az,terrestrial.el,solar.radiusDeg,terrestrial.radiusDeg)}
}
export type LandingContext=ReturnType<typeof landingContext>
export function formatEnergyKwh(wh:number,signed=false){const value=Math.abs(wh)<5?0:wh/1000;return (signed&&value>=0?'+':'')+value.toFixed(2)}
type Factors=[number,number,number]
function factors(series:SiteSeries,row:number,c:PowerConfig):Factors{
 const r=Math.PI/180,el=series.solar.elevation[row]*r,tilt=c.tiltDeg*r
 const incidence=c.orientation==='tracking'?1:c.orientation==='horizontal'?Math.sin(el):Math.sin(el)*Math.cos(tilt)+Math.cos(el)*Math.sin(tilt)*Math.cos((series.solar.azimuth[row]-c.azimuthDeg)*r)
 return [series.solar.fluxScale?.[row]??1,Math.max(0,incidence),series.solar.fraction[row]]
}
const product=(v:Factors)=>v[0]*v[1]*v[2]
const PERMUTATIONS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]
const sameSettings=(a:object|undefined,b:object|undefined)=>a===undefined||b===undefined?a===b:Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>value===(b as Record<string,unknown>)[key])
/** Symmetric factor attribution: average all six replacement orders, avoiding an
 * arbitrary ordering bias. Explains model generation, not real-world causation. */
export function generationDifference(a:Scn,b:Scn,A:SiteSeries,B:SiteSeries){
 if(!a.c.power||!b.c.power||a.c.missionDays!==b.c.missionDays||!sameSettings(a.c.power,b.c.power)||!Number.isInteger(a.row)||!Number.isInteger(b.row))return null
 const hours=a.c.missionDays*24
 if(a.row<0||b.row<0||a.row+hours>A.hours||b.row+hours>B.hours)return null
 const shares=[0,0,0],scale=SOLAR_IRRADIANCE*a.c.power.panelAreaM2*a.c.power.efficiencyPct/100
 let totalWh=0
 for(let h=0;h<hours;h++){
  const from=factors(A,a.row+h,a.c.power),to=factors(B,b.row+h,b.c.power)
  totalWh+=(product(to)-product(from))*scale
  for(const order of PERMUTATIONS){const current=[...from] as Factors;for(const k of order){const before=product(current);current[k]=to[k];shares[k]+=(product(current)-before)*scale/6}}
 }
 return {totalWh,contributions:[{label:'Sun distance',wh:shares[0]},{label:'Panel incidence',wh:shares[1]},{label:'Terrain / eclipse exposure',wh:shares[2]}]}
}
export function comparisonExplanation(a:Scn,b:Scn,A:SiteSeries|undefined,B:SiteSeries|undefined,ea:Evaluated|null,eb:Evaluated|null){
 if(!A||!B||!ea||!eb)return {lines:['A complete mission is outside cached coverage or its site predictions are unavailable. No difference is inferred.'],energy:null}
 const lines:string[]=[]
 const changed=[a.slug!==b.slug?'site':null,a.row!==b.row?'landing date':null,a.c.missionDays!==b.c.missionDays?'duration':null,!sameSettings(a.c.power,b.c.power)?'electrical hardware':null,!sameSettings(a.c.thermal,b.c.thermal)?'thermal assumptions':null].filter(Boolean)
 lines.push(changed.length?`Changed from A: ${changed.join(', ')}.`:'Site, landing date, duration and hardware match A.')
 if(a.c.power&&b.c.power){
  const labels:[keyof PowerConfig,string,string][]=[['panelAreaM2','panel area','m²'],['efficiencyPct','cell efficiency','%'],['orientation','orientation',''],['tiltDeg','tilt','°'],['azimuthDeg','facing azimuth','°'],['loadW','constant demand','W'],['capacityWh','battery capacity','Wh'],['initialPct','initial charge','%'],['reservePct','reserve','%'],['chargeEfficiencyPct','charge efficiency','%'],['dischargeEfficiencyPct','discharge efficiency','%']]
  const edits=labels.filter(([key])=>a.c.power![key]!==b.c.power![key]).map(([key,label,unit])=>`${label} ${a.c.power![key]} → ${b.c.power![key]} ${unit}`)
  if(edits.length)lines.push('Electrical changes: '+edits.join('; ')+'.')
 }
 if(['minLitPct','minLinkPct','maxDarkH','maxGapH'].some(k=>a.c[k as keyof typeof a.c]!==b.c[k as keyof typeof b.c]))lines.push('Visibility requirements also differ; verdict changes do not isolate a physical change.')
 if(eb.litPct.toFixed(1)===ea.litPct.toFixed(1)&&eb.linkPct.toFixed(1)===ea.linkPct.toFixed(1))lines.push('Sun/Earth visibility percentages are unchanged at displayed precision. They do not measure solar-disc exposure, panel incidence or the timing of energy deficits.')
 else lines.push(`Sun-centre visibility changes by ${(eb.litPct-ea.litPct).toFixed(1)} percentage points; Earth-centre visibility changes by ${(eb.linkPct-ea.linkPct).toFixed(1)} points. These are terrain geometry, not RF service.`)
 if(eb.longestDarkH!==ea.longestDarkH)lines.push(`The longest terrain darkness changes from ${ea.longestDarkH} h to ${eb.longestDarkH} h, altering the continuous interval the power system must bridge.`)
 if(eb.longestGapH!==ea.longestGapH)lines.push(`The longest Earth-centre gap changes from ${ea.longestGapH} h to ${eb.longestGapH} h; antenna/station service remains a separate check.`)
 const energy=generationDifference(a,b,A,B)
 if(!energy&&(a.c.power||b.c.power))lines.push('Energy attribution requires identical electrical settings and mission duration. Use identical hardware, and compare the same duration, to isolate geometry.')
 if(a.c.power?.orientation==='tracking'&&b.c.power?.orientation==='tracking')lines.push('Ideal tracking keeps panel incidence at 1. Solar elevation can still change terrain/disc exposure; this is not a horizontal-panel calculation.')
 if(ea.power&&eb.power)lines.push(`${ea.power.minPct.toFixed(1)===eb.power.minPct.toFixed(1)?`Minimum battery remains ${ea.power.minPct.toFixed(1)}% at displayed precision`:`Minimum battery changes from ${ea.power.minPct.toFixed(1)}% to ${eb.power.minPct.toFixed(1)}%`}. Its value also depends on hourly generation timing, demand, losses, capacity and any enabled heating; it cannot be inferred from visibility alone.`)
 return {lines,energy}
}
