import type { Ephemeris,Horizon } from '../data.ts'
import { indexedOptions,type PredictionIndex } from '../lib/predictionIndex.ts'
import { requestJson } from '../lib/request.ts'
import { heightHorizon,raisedObserver,validateHeightReport,type HeightReport } from '../lib/heightSensitivity.ts'
import { checkDispersion,type DispersionData } from './dispersion.ts'
import { buildSeries,evaluateWindow,type Constraints } from './solver.ts'

export type Diagnostic<T>={status:'loading'}|{status:'unavailable';error:string}|{status:'ready';data:T}
export type RobustnessProducts={footprint:Diagnostic<DispersionData>;height:Diagnostic<HeightReport>}
export const pendingRobustness=():RobustnessProducts=>({footprint:{status:'loading'},height:{status:'loading'}})
export async function loadRobustnessProducts(index:PredictionIndex,slug:string,signal?:AbortSignal):Promise<RobustnessProducts>{
  const load=async<T>(path:string,validate:(v:unknown)=>void):Promise<Diagnostic<T>>=>{
    try{const data=await requestJson(path,indexedOptions(index,path,signal));validate(data);return {status:'ready',data:data as T}}
    catch(error){return {status:'unavailable',error:String(error)}}
  }
  const [footprint,height]=await Promise.all([
    load<DispersionData>(`/data/dispersion/${slug}.json`,value=>{
      const d=value as DispersionData
      if(!d||!Number.isFinite(d.radiusM)||d.radiusM<=0||!Array.isArray(d.samples)||d.samples.length!==19||d.samples.some(s=>!Number.isFinite(s.eastM)||!Number.isFinite(s.northM)||!Array.isArray(s.profile)||s.profile.length!==360||s.profile.some(v=>!Number.isFinite(v))))throw new Error('Invalid footprint product')
    }),
    load<HeightReport>(`/data/validation/sites/${slug}.json`,value=>validateHeightReport(value,slug,index.files[`/data/horizons/${slug}.json`]?.sha256??'')),
  ])
  return {footprint,height}
}
export function assessHeights(report:HeightReport,sun:Ephemeris,earth:Ephemeris,horizon:Horizon,row:number,c:Constraints){
  const hours=c.missionDays*24
  return report.profiles.map(p=>{
    const series=buildSeries('height',sun.rows.slice(row,row+hours+1).map(r=>raisedObserver(r,p.observerHeightM)),earth.rows.slice(row,row+hours+1).map(r=>raisedObserver(r,p.observerHeightM)),heightHorizon(horizon,p))
    return {height:p.observerHeightM,result:evaluateWindow(series,0,hours,c)}
  })
}
/** Keep missing/failed checks distinct from a calculated pass, including in exports. */
export function assessRobustness(products:RobustnessProducts,sun:Ephemeris,earth:Ephemeris,horizon:Horizon,row:number,c:Constraints){
  if(!Number.isInteger(row)||row<0||row+c.missionDays*24>=sun.rows.length||row+c.missionDays*24>=earth.rows.length){
    const unavailable={status:'unavailable' as const,error:'Complete mission outside cached coverage'}
    return {footprint:unavailable,height:unavailable}
  }
  const calculate=<T,R>(product:Diagnostic<T>,run:(data:T)=>R):Diagnostic<R>=>{
    if(product.status!=='ready')return product
    try{return {status:'ready',data:run(product.data)}}catch(error){return {status:'unavailable',error:String(error)}}
  }
  return {footprint:calculate(products.footprint,data=>checkDispersion(data,sun.rows,earth.rows,row,c)),height:calculate(products.height,data=>assessHeights(data,sun,earth,horizon,row,c))}
}
export type RobustnessAssessment=ReturnType<typeof assessRobustness>
