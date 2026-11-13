import type { EphRow,Horizon } from '../data.ts'
import { horizonElevation,sampleSky,angularSep } from './science.ts'
import { sampleEpoch } from './siteProducts.ts'
import { directionCrossingFraction } from './attribution.ts'
export type TransitionCase={slug:string;body:'sun'|'earth';status:'complete'|'unavailable';sourceURL:string;retrievedUTC?:string;rawSha256?:string;cachedEphemerisSha256?:string;nominalHorizonSha256?:string;startRow?:number;stopRow?:number;stepMinutes?:number;samples?:EphRow[];error?:string}
function edges(rows:EphRow[],profile:number[],stepH:number,legacy=false){
  const result:number[]=[]
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1].el-horizonElevation(profile,rows[i-1].az),b=rows[i].el-horizonElevation(profile,rows[i].az)
    if((a>0)!==(b>0)){
      const fraction=legacy?Math.abs(a)/(Math.abs(a)+Math.abs(b)):directionCrossingFraction(rows[i-1],rows[i],profile,b>0)
      if(fraction!==null)result.push((i-1+fraction)*stepH)
    }
  }return result
}
export function assessTransition(probe:TransitionCase,cached:EphRow[],horizon:Horizon) {
  if(probe.status!=='complete'||!probe.samples||probe.startRow===undefined||probe.stopRow===undefined||probe.stepMinutes!==10||probe.samples.length!==(probe.stopRow-probe.startRow)*6+1)throw new Error('Incomplete ten-minute source probe')
  const start=sampleEpoch(cached[0].t)+probe.startRow*3600000
  if(probe.samples.some((p,i)=>sampleEpoch(p.t)!==start+i*600000||!Number.isFinite(p.az)||!Number.isFinite(p.el)||p.az<0||p.az>360||Math.abs(p.el)>90))throw new Error('Invalid finer-source sample grid or direction')
  let maxAngleDeg=0,disagreements=0
  for(let i=0;i<probe.samples.length;i++){
    const source=probe.samples[i],interpolated=sampleSky(cached,probe.startRow+i/6)
    maxAngleDeg=Math.max(maxAngleDeg,angularSep(source.az,source.el,interpolated.az,interpolated.el))
    if((source.el>horizonElevation(horizon.profile,source.az))!==(interpolated.el>horizonElevation(horizon.profile,interpolated.az)))disagreements++
  }
  const hourly=edges(cached.slice(probe.startRow,probe.stopRow+1),horizon.profile,1),fine=edges(probe.samples,horizon.profile,1/6)
  const sameCount=hourly.length===fine.length
  const maxEdgeMinutes=sameCount&&fine.length?Math.max(...fine.map((at,i)=>Math.abs(at-hourly[i])*60)):null
  const legacy=edges(cached.slice(probe.startRow,probe.stopRow+1),horizon.profile,1,true)
  const maxLegacyEdgeMinutes=legacy.length===fine.length&&fine.length?Math.max(...fine.map((at,i)=>Math.abs(at-legacy[i])*60)):null
  return {samples:probe.samples.length,maxAngleDeg,disagreements,hourlyEdges:hourly.length,fineEdges:fine.length,maxEdgeMinutes,maxLegacyEdgeMinutes}
}
