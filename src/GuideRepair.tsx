import type { ExploreSamples } from './GuideFootprint'
import { useEffect,useMemo,useRef } from 'react'
import { guideRepair } from './lib/guideRepair'
import type { Scn } from './architect/comparison'
import type { SiteSeries } from './architect/solver'
import { assessRobustness,type RobustnessProducts } from './architect/robustness'
import type { Ephemeris,Horizon } from './data'
import { GuideRobustness } from './GuideRobustness'
import { GuideDateOption } from './GuideDateOption'

export type GuideRepairContext={series:SiteSeries;products:RobustnessProducts;sun:Ephemeris;earth:Ephemeris;horizon:Horizon}
export function GuideRepair({scenario,context,onApply,onCandidate,onExplore}:{scenario:Scn;context:GuideRepairContext;onApply:(scenarios:Scn[],note:string)=>void;onCandidate?:(scenario:Scn)=>void;onExplore?:ExploreSamples}){
 const repair=useMemo(()=>guideRepair(context.series,scenario),[context.series,scenario])
 const before=useMemo(()=>repair?assessRobustness(context.products,context.sun,context.earth,context.horizon,repair.original.row,repair.original.c):null,[repair,context.products,context.sun,context.earth,context.horizon])
 const assessment=useMemo(()=>repair?assessRobustness(context.products,context.sun,context.earth,context.horizon,repair.repaired.row,repair.repaired.c):null,[repair,context.products,context.sun,context.earth,context.horizon])
 const root=useRef<HTMLElement>(null)
 useEffect(()=>{root.current?.scrollIntoView({block:'nearest',behavior:'instant'})},[])
 const label=repair?.key==='panelAreaM2'?'Panel area':repair?.key==='capacityWh'?'Battery storage':'Constant demand'
 const footprint=assessment?.footprint
 const headline=footprint?.status==='ready'?(footprint.data.passing===footprint.data.samples.length?'Target and all sampled locations pass':'Target passes; nearby samples remain sensitive'):'Target passes; footprint not assessed'
 return <section ref={root} className="guide-repair" aria-label="Verified repair" aria-live="polite"><h4>{repair?headline:'No single repair found'}</h4>{repair&&assessment?<>
  <p>{label}: <strong>{repair.from} → {repair.to} {repair.unit}</strong></p>
  <dl><dt>Original → repair</dt><dd>Misses → passes</dd><dt>Minimum battery</dt><dd>{repair.before.power?.minPct.toFixed(1)}% → {repair.after.power?.minPct.toFixed(1)}%</dd></dl>
  <GuideRobustness assessment={assessment} nominal={repair.after} context={context} scenario={repair.repaired} onExplore={onExplore} onCompare={onApply}/>
  <p className="visit-field-scope">Same date and target. One setting changes; no extra engineering margin.</p>
  {footprint?.status!=='ready'||footprint.data.passing<footprint.data.samples.length?<GuideDateOption scenario={repair.repaired} context={context} onApply={onApply} onCandidate={onCandidate} onExplore={onExplore}/>:null}
  <button className="visit-text-button" onClick={()=>onApply([repair.original,repair.repaired],'Guided repair: A is the original failed mission; B changes one electrical setting at the same target and date. All enabled nominal requirements rechecked. No engineering margin added; inspect footprint and height sensitivity separately. The guide reference hardware is unchanged.')}>Compare original & repair in planner</button>
  <details><summary>Repair evidence & limits</summary><p>Original: footprint {before?.footprint.status==='ready'?`${before.footprint.data.passing}/${before.footprint.data.samples.length} pass`:before?.footprint.status==='loading'?'checking…':'not assessed'}; height {before?.height.status==='ready'?`${before.height.data.filter(h=>h.result.pass).length}/${before.height.data.length} pass`:before?.height.status==='loading'?'checking…':'not assessed'}. Every enabled nominal requirement is rechecked.</p><p>Try panel area first, then battery storage, then reduced demand. Searches are bounded to 100 m², 1,000,000 Wh and 0–10,000 W. This is a teaching order, not an optimum design.</p></details>
 </>:<><p>No single electrical repair meets all enabled requirements within the search bounds. No repair has been applied.</p><GuideDateOption scenario={scenario} context={context} onApply={onApply} onCandidate={onCandidate} onExplore={onExplore}/></>}</section>
}
