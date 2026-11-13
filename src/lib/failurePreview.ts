import type { Constraints,Evaluated,SiteSeries } from '../architect/solver.ts'
import { generationFor,simulatePower,type PowerRun } from '../architect/power.ts'
import { simulateThermal } from '../architect/thermal.ts'
import { longestRunOverlapping } from './attribution.ts'

export type PreviewWindow={startRow:number;endRow:number;eventRow:number;target?:'sun'|'earth';showSunPath?:boolean}
export type FailurePreview={kind:Evaluated['limiting'];title:string;explanation:string;timing:'threshold'|'representative';missionStart:number;missionEnd:number;eventHour:number;window:PreviewWindow;blockedRun:[number,number]|null;limitH:number|null;battery:PowerRun|null;reservePct:number|null;loadW:number;heaterW:Float64Array|null}

/** Explain the solver's limiting failed requirement inside the same full mission.
 * Crossing times inherit hourly-model limits; aggregate percentages have no unique
 * failure instant, so their blocked interval is explicitly representative. */
export function buildFailurePreview(series:SiteSeries,result:Evaluated|null,c:Constraints):FailurePreview|null{
 if(!result||result.pass)return null
 const s=result.startRow,e=result.endRow
 if(!Number.isInteger(s)||!Number.isInteger(e)||s<0||e>series.hours||e<=s||e-s!==c.missionDays*24)return null
 const kind=result.limiting
 let eventHour:number|null=null,title='',explanation='',timing:FailurePreview['timing']='threshold',blockedRun:[number,number]|null=null,limitH:number|null=null,battery:PowerRun|null=null,heaterW:Float64Array|null=null
 if(kind==='battery'){
  if(!c.power||!result.power||result.power.pass)return null
  heaterW=c.thermal?simulateThermal(series.solar,s,e,c.thermal,c.power.loadW).heaterW:null
  battery=simulatePower(generationFor(series.solar,c.power),s,e,c.power,true,heaterW??undefined)
  eventHour=battery.firstReserveH??battery.firstUnmetH
  title=battery.firstReserveH!==null?(eventHour===0?'Battery starts below reserve':'Battery reserve breached'):'Demand cannot be supplied'
  explanation=`The ${c.power.reservePct}% battery reserve and hourly energy balance determine this result. Sun-centre visibility alone does not measure generation or stored energy.`
 }else if(kind==='thermal'){
  if(!c.thermal||!result.thermal||result.thermal.pass)return null
  eventHour=result.thermal.firstFreezeH;title='Thermal survival limit missed'
  explanation=`The thermal screening model drops below ${c.thermal.survivalK} K. This is a modeled equipment temperature, not measured surface temperature.`
 }else{
  const earth=kind==='gap'||kind==='link'
  if(result.ok[kind])return null
  blockedRun=longestRunOverlapping(earth?series.gapRuns:series.darkRuns,s,e)
  if(!blockedRun)return null
  if(kind==='gap'||kind==='dark'){
   limitH=earth?c.maxGapH:c.maxDarkH
   if(blockedRun[1]-blockedRun[0]<=limitH)return null
   eventHour=blockedRun[0]-s+limitH
   title=earth?'Earth-outage limit exceeded':'Darkness limit exceeded'
   explanation=`The longest ${earth?'Earth-centre masking':'terrain darkness'} interval in this mission exceeds the ${limitH} h requirement. ${earth?'Geometry does not establish RF service.':'The Sun centre is tested against the cached target skyline.'}`
  }else{
   timing='representative';eventHour=(blockedRun[0]+blockedRun[1])/2-s
   title=earth?'Too little Earth visibility':'Too little sunlight'
   explanation=`${earth?'Earth':'Sun'}-centre visibility totals ${(earth?result.linkPct:result.litPct).toFixed(1)}%, below the ${earth?c.minLinkPct:c.minLitPct}% requirement. This blocked interval illustrates an aggregate shortfall; it is not a unique failure instant.`
  }
 }
 if(eventHour===null||!Number.isFinite(eventHour)||eventHour<0||eventHour>e-s)return null
 const eventRow=s+eventHour,padding=kind==='battery'?4:1,startRow=Math.max(s,eventRow-padding),endRow=Math.min(e,eventRow+padding)
 if(endRow<=startRow)return null
 return {kind,title,explanation,timing,missionStart:s,missionEnd:e,eventHour,window:{startRow,endRow,eventRow,target:kind==='gap'||kind==='link'?'earth':'sun',showSunPath:false},blockedRun,limitH,battery,reservePct:c.power?.reservePct??null,loadW:c.power?.loadW??0,heaterW}
}

/** Plot cursor only while the scene is inside this scenario. No extrapolation.
 * The battery cursor interpolates hourly trace endpoints for display only. */
export function failureReading(f:FailurePreview,row:number){
 if(!Number.isFinite(row)||row<f.missionStart||row>f.missionEnd)return null
 const hour=row-f.missionStart,points=f.battery?.points
 if(points){
  const i=Math.min(points.length-2,Math.floor(hour)),fraction=hour-i,a=points[i],b=points[i+1]
  return {hour,batteryPct:a.socPct+(b.socPct-a.socPct)*fraction,generationW:b.generationW,loadW:f.loadW+(f.heaterW?.[i]??0),blockedHours:null}
 }
 return {hour,batteryPct:null,generationW:null,loadW:null,blockedHours:f.blockedRun?Math.max(0,Math.min(row,f.blockedRun[1])-f.blockedRun[0]):null}
}
