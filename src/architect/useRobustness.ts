import { useEffect,useMemo,useRef,useState } from 'react'
import type { Ephemeris,Horizon } from '../data'
import type { PredictionIndex } from '../lib/predictionIndex'
import type { Constraints } from './solver'
import { assessRobustness,loadRobustnessProducts,pendingRobustness,type RobustnessProducts } from './robustness'
/** Keep completed products per dataset; date/hardware edits do not fetch them again.
 * Aborted requests never populate the cache or a newly selected site's assessment. */
export function useRobustnessProducts(index:PredictionIndex,slugs:string[]){
  const key=JSON.stringify([...new Set(slugs)].sort())
  const cache=useRef<{index:PredictionIndex;products:Record<string,RobustnessProducts>}>({index,products:{}})
  const [loaded,setLoaded]=useState(cache.current)
  useEffect(()=>{
    if(cache.current.index!==index)cache.current={index,products:{}}
    const abort=new AbortController()
    setLoaded(cache.current)
    for(const slug of JSON.parse(key) as string[]){
      if(cache.current.products[slug])continue
      void loadRobustnessProducts(index,slug,abort.signal).then(products=>{
        if(abort.signal.aborted||cache.current.index!==index)return
        cache.current={index,products:{...cache.current.products,[slug]:products}}
        setLoaded(cache.current)
      })
    }
    return()=>abort.abort()
  },[index,key])
  return useMemo(()=>Object.fromEntries((JSON.parse(key) as string[]).map(slug=>[slug,loaded.index===index?loaded.products[slug]??pendingRobustness():pendingRobustness()])),[index,key,loaded]) as Record<string,RobustnessProducts>
}
export function useRobustness(index:PredictionIndex,slug:string|undefined,sun:Ephemeris|undefined,earth:Ephemeris|undefined,horizon:Horizon|undefined,row:number,c:Constraints){
  const [loaded,setLoaded]=useState<{slug:string;index:PredictionIndex;products:RobustnessProducts}|null>(null)
  useEffect(()=>{
    if(!slug)return
    const abort=new AbortController()
    void loadRobustnessProducts(index,slug,abort.signal).then(products=>{if(!abort.signal.aborted)setLoaded({slug,index,products})})
    return()=>abort.abort()
  },[slug,index])
  const products=useMemo(()=>loaded&&loaded.slug===slug&&loaded.index===index?loaded.products:pendingRobustness(),[loaded,slug,index])
  const assessment=useMemo(()=>sun&&earth&&horizon?assessRobustness(products,sun,earth,horizon,row,c):{footprint:{status:'loading' as const},height:{status:'loading' as const}},[products,sun,earth,horizon,row,c])
  return {products,assessment}
}
