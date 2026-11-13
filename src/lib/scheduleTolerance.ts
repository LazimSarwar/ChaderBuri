import { evaluateWindow,type Evaluated } from '../architect/solver.ts'
import { checkDispersion } from '../architect/dispersion.ts'
import { cloneConstraints,type Scn } from '../architect/comparison.ts'
import type { SensitiveDateContext } from './sensitiveDate.ts'
import type { Diagnostic } from '../architect/robustness.ts'

export type SchedulePoint={row:number;offsetH:number;nominal:Evaluated|null;footprint:Diagnostic<{passing:number;total:number}>}
/** Thirteen discrete starts, +/- 72 h at 12 h spacing. Never interpolate pass. */
export async function scheduleTolerance(context:SensitiveDateContext,scenario:Scn,signal?:AbortSignal,onProgress?:(done:number)=>void,pause=()=>new Promise<void>(r=>setTimeout(r,0))){
 const c=cloneConstraints(scenario.c),hours=c.missionDays*24,points:SchedulePoint[]=[]
 if(scenario.slug!==context.series.slug||!Number.isInteger(scenario.row)||!Number.isInteger(hours)||hours<=0)throw new Error('Invalid schedule scenario')
 for(let offsetH=-72;offsetH<=72;offsetH+=12){
  if(signal?.aborted)throw new DOMException('Schedule check cancelled','AbortError')
  const row=scenario.row+offsetH,covered=row>=0&&row+hours<=context.series.hours&&row+hours<context.sun.rows.length&&row+hours<context.earth.rows.length
  const nominal=covered?evaluateWindow(context.series,row,row+hours,c):null
  let footprint:SchedulePoint['footprint']={status:'unavailable',error:'Complete mission outside cached coverage'}
  if(covered){
   const product=context.products.footprint
   if(product.status==='ready'){
    const result=checkDispersion(product.data,context.sun.rows,context.earth.rows,row,c)
    footprint={status:'ready',data:{passing:result.passing,total:result.samples.length}}
   }else footprint=product
  }
  points.push({row,offsetH,nominal,footprint});onProgress?.(points.length);await pause()
 }
 if(signal?.aborted)throw new DOMException('Schedule check cancelled','AbortError')
 return points
}
