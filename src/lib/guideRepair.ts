import { cloneConstraints,verifiedRepairs,type Scn } from '../architect/comparison.ts'
import { evaluateWindow,type SiteSeries } from '../architect/solver.ts'
import type { RobustnessAssessment } from '../architect/robustness.ts'
import { decisionTakeaway,type DecisionPair } from './explorationDecision.ts'

/** One verified electrical change. Prefer more panel area, then storage, then
 * reduced demand; this teaching order is not an optimum hardware design. */
export function guideRepair(series:SiteSeries,scenario:Scn){
 const hours=scenario.c.missionDays*24
 if(series.slug!==scenario.slug||!Number.isInteger(scenario.row)||scenario.row<0||!Number.isInteger(hours)||hours<=0||scenario.row+hours>series.hours||!scenario.c.power)return null
 const before=evaluateWindow(series,scenario.row,scenario.row+hours,scenario.c)
 if(before.pass)return null
 const options=verifiedRepairs(series,scenario)
 const repair=(['panelAreaM2','capacityWh','loadW'] as const).map(key=>options.find(r=>r.key===key)).find(Boolean)
 if(!repair)return null
 const original={...scenario,id:0,c:cloneConstraints(scenario.c)}
 const repaired={...scenario,id:1,c:cloneConstraints(repair.c)}
 return {original,repaired,before,after:repair.result,key:repair.key,from:scenario.c.power[repair.key],to:repair.value!,unit:repair.unit}
}
export type GuideRepairResult=NonNullable<ReturnType<typeof guideRepair>>

/** Qualify nominal ranking with measured diagnostics, never a probability. */
export function guideRecommendation(pair:DecisionPair,checks:{a:RobustnessAssessment;b:RobustnessAssessment}|null){
 if(pair.recommendation===null||pair.recommendation==='neither')return decisionTakeaway(pair)
 const base=pair.recommendation==='either'?'Both dates pass with equal nominal margin.':`${pair.recommendation.toUpperCase()} is preferred at the nominal target${pair.a?.pass&&pair.b?.pass?' by margin':''}.`
 const notes=(['a','b'] as const).filter(key=>pair[key]?.pass).map(key=>{
  const check=checks?.[key],f=check?.footprint,label=key.toUpperCase()
  if(!f||f.status==='loading')return `${label}: footprint check pending.`
  if(f.status==='unavailable')return `${label}: footprint not assessed (unavailable).`
  const {passing,samples}=f.data
  const scope=passing===samples.length?'all sampled locations pass':passing===0?'no sampled locations pass':'mixed footprint outcomes'
  const height=check?.height.status==='ready'&&check.height.data.some(h=>h.result.pass!==pair[key]!.pass)?' Height changes the verdict.':''
  return `${label}: ${scope} (${passing}/${samples.length}).${height}`
 })
 return `${base} ${notes.join(' ')} A nominal preference is not a robust landing recommendation; inspect sensitivity before choosing. Sample counts are not probabilities.`
}
