import { GuideFootprint,type ExploreSamples } from './GuideFootprint'
import { ScheduleTolerance } from './ScheduleTolerance'
import type { SensitiveDateContext } from './lib/sensitiveDate'
import type { Scn } from './architect/comparison'
import type { Evaluated } from './architect/solver'
import type { RobustnessAssessment } from './architect/robustness'

/** Same assessments as the planner; deliberately separate from nominal ranking. */
export function GuideRobustness({assessment,nominal,context,scenario,onExplore,onCompare}:{assessment:RobustnessAssessment;nominal:Evaluated;context?:SensitiveDateContext;scenario?:Scn;onExplore?:ExploreSamples;onCompare?:(scenarios:Scn[],note:string)=>void}){
 const {footprint,height}=assessment
 const changed=height.status==='ready'?height.data.filter(h=>h.result.pass!==nominal.pass):[]
 return <section className="guide-robustness" aria-label="Guide robustness">
  <p><strong>Footprint</strong> {footprint.status==='ready'?`${footprint.data.passing}/${footprint.data.samples.length} pass · ${footprint.data.passing===0?'none pass':footprint.data.passing===footprint.data.samples.length?'all pass':'mixed outcomes'}`:footprint.status==='loading'?'Checking…':'Not assessed · unavailable'}</p>
  <p><strong>Height</strong> {height.status==='ready'?changed.length?`Verdict changes at ${changed.map(h=>h.height).join(' / ')} m`:`Same ${nominal.pass?'pass':'failure'} at ${height.data.map(h=>h.height).join(' / ')} m`:height.status==='loading'?'Checking…':'Not assessed · unavailable'}</p>
  <details><summary>Scope & height results</summary><p>Sample counts are not probabilities or landing-safety certification. Footprint tests visibility and battery, excluding thermal and RF. Height tests enabled nominal requirements. These checks do not change the nominal verdict.</p>{height.status==='ready'&&<ul>{height.data.map(h=><li key={h.height}>{h.height} m · {h.result.pass?'passes':'misses'} requirements{h.result.power?` · battery ${h.result.power.minPct.toFixed(1)}%`:''}</li>)}</ul>}</details>
  {context&&scenario&&footprint.status==='ready'&&<GuideFootprint key={'foot:'+scenario.row+JSON.stringify(scenario.c)} result={footprint.data} context={context} scenario={scenario} onExplore={onExplore}/>}
  {context&&scenario&&onCompare&&<ScheduleTolerance key={'schedule:'+scenario.row+JSON.stringify(scenario.c)} context={context} scenario={scenario} onCompare={onCompare}/>}
 </section>
}
