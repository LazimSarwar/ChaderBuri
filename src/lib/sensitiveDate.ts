import type { Ephemeris,Horizon } from '../data.ts'
import { cloneConstraints,type Scn } from '../architect/comparison.ts'
import { offsetSky,checkDispersion } from '../architect/dispersion.ts'
import { buildSeries,evaluateWindow,type Evaluated,type SiteSeries } from '../architect/solver.ts'
import type { RobustnessProducts } from '../architect/robustness.ts'

export const DATE_SEARCH_DAYS=90,DATE_SEARCH_STEP_H=6
export type SensitiveDateContext={series:SiteSeries;products:RobustnessProducts;sun:Ephemeris;earth:Ephemeris;horizon:Horizon}
export type DateSearchProgress={phase:'terrain'|'dates';done:number;total:number}
export type SensitiveDateResult=
 |{status:'unavailable';reason:string}
 |{status:'complete';baselinePassing:number;total:number;checked:number;nominalPassing:number;lastRow:number;candidate:{scenario:Scn;result:Evaluated;passing:number}|null}
type SearchOptions={signal?:AbortSignal;onProgress?:(p:DateSearchProgress)=>void;yieldControl?:()=>Promise<void>}

/** Later six-hour starts, at most 90 days. Rank nominal passes by footprint
 * sample count, then earliest date. These are sampled visibility/battery checks,
 * not an optimizer for continuous safety. Hardware and requirements stay fixed.
 * Prebuild only the needed local sample interval, yielding between samples and
 * candidate batches so exploration remains responsive and cancellation works. */
export async function findLessSensitiveDate(context:SensitiveDateContext,input:Scn,options:SearchOptions={}):Promise<SensitiveDateResult>{
 const pause=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)))
 const abort=()=>{if(options.signal?.aborted)throw new DOMException('Date search cancelled','AbortError')}
 const report=async(p:DateSearchProgress)=>{abort();options.onProgress?.(p);await pause();abort()}
 abort()
 const {series,sun,earth,products}=context,c=cloneConstraints(input.c),scenario={...input,c},hours=c.missionDays*24
 if(series.slug!==scenario.slug||!Number.isInteger(scenario.row)||scenario.row<0||!Number.isInteger(hours)||hours<=0||scenario.row+hours>series.hours||scenario.row+hours>=sun.rows.length||sun.rows.length!==earth.rows.length)return {status:'unavailable',reason:'A complete mission at the selected site and date is required.'}
 if(products.footprint.status!=='ready')return {status:'unavailable',reason:products.footprint.status==='loading'?'Footprint data is still loading.':'Footprint data is unavailable; later dates have not been assessed.'}
 const data=products.footprint.data
 const lastRow=Math.min(scenario.row+DATE_SEARCH_DAYS*24,series.hours-hours,sun.rows.length-1-hours)
 const total=Math.floor((lastRow-scenario.row)/DATE_SEARCH_STEP_H)
 if(total<1)return {status:'unavailable',reason:'No later six-hour start fits a complete mission inside cached coverage.'}
 await report({phase:'terrain',done:0,total:data.samples.length})
 const baselinePassing=checkDispersion(data,sun.rows,earth.rows,scenario.row,c).passing
 if(baselinePassing===data.samples.length)return {status:'complete',baselinePassing,total,checked:0,nominalPassing:0,lastRow,candidate:null}
 const localSun=sun.rows.slice(scenario.row,lastRow+hours+1),localEarth=earth.rows.slice(scenario.row,lastRow+hours+1)
 const sampleSeries:SiteSeries[]=[]
 for(const terrain of data.samples){
  sampleSeries.push(buildSeries('date-footprint',localSun.map(r=>offsetSky(r,data.samples[0],terrain)),localEarth.map(r=>offsetSky(r,data.samples[0],terrain)),terrain))
  await report({phase:'terrain',done:sampleSeries.length,total:data.samples.length})
 }
 const footprintConstraints={...c,thermal:undefined}
 let candidate:Extract<SensitiveDateResult,{status:'complete'}>['candidate']=null,checked=0,nominalPassing=0
 for(let row=scenario.row+DATE_SEARCH_STEP_H;row<=lastRow;row+=DATE_SEARCH_STEP_H){
  abort();checked++
  const result=evaluateWindow(series,row,row+hours,c)
  if(result.pass){
   nominalPassing++
   const local=row-scenario.row
   const passing=sampleSeries.filter(sample=>evaluateWindow(sample,local,local+hours,footprintConstraints).pass).length
   if(passing>baselinePassing&&(!candidate||passing>candidate.passing))candidate={scenario:{...scenario,id:1,row,c:cloneConstraints(c)},result,passing}
   // Earliest all-sample pass is unbeatable under the disclosed ranking.
   if(passing===data.samples.length){await report({phase:'dates',done:checked,total});break}
  }
  if(checked%12===0||checked===total)await report({phase:'dates',done:checked,total})
 }
 abort()
 return {status:'complete',baselinePassing,total,checked,nominalPassing,lastRow,candidate}
}
