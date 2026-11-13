import type { Evaluated } from './solver'
import type { RobustnessAssessment } from './robustness'
export function RobustnessSummary({assessment,nominal,onInspect,compact=false}:{assessment:RobustnessAssessment;nominal:Evaluated;onInspect?:()=>void;compact?:boolean}){
 const {footprint,height}=assessment
 const changed=height.status==='ready'?height.data.filter(r=>r.result.pass!==nominal.pass):[]
 const scope='Footprint checks use visibility and enabled battery requirements; they exclude thermal and RF. Height checks use enabled nominal requirements. Sample counts are not success probabilities or landing-safety certification.'
 return <section className={'mission-robustness'+(compact?' comparison-robustness':'')} aria-label="Mission robustness">
  <div><strong>Nearby footprint</strong>{footprint.status==='ready'?<p className={footprint.data.passing===footprint.data.samples.length?'':'robustness-warning'}>{footprint.data.passing}/{footprint.data.samples.length}{compact?` sampled points pass · ${footprint.data.passing===0?'none pass':footprint.data.passing===footprint.data.samples.length?'all pass':'mixed outcomes'}`:` sampled points meet visibility${nominal.power?' / battery':''} requirements`}</p>:<p role="status">{footprint.status==='loading'?'Checking nearby points…':'Not assessed · terrain check unavailable'}</p>}</div>
  <div><strong>{compact?'Height':'Observer height'} · 0 / 1 / 3 / 5 m</strong>{height.status==='ready'?<p className={changed.length?'robustness-warning':''}>{changed.length?(compact?`Verdict changes: ${changed.map(r=>r.height).join(', ')} m`:`Nominal verdict changes at ${changed.map(r=>r.height+' m').join(', ')}`):`Same ${nominal.pass?'passing':'failing'} verdict${compact?'':' at all four heights'}`}</p>:<p role="status">{height.status==='loading'?'Checking observer heights…':'Not assessed · height check unavailable'}</p>}</div>
  {compact?<details><summary>Scope & height results</summary><p>{scope}</p>{height.status==='ready'&&<ul>{height.data.map(r=><li key={r.height}>{r.height} m: {r.result.pass?'meets':'misses'} requirements · minimum battery {r.result.power?r.result.power.minPct.toFixed(1)+'%':'not assessed'}</li>)}</ul>}</details>:<p>{scope}</p>}{onInspect&&<button className="text-earth underline" onClick={onInspect}>Inspect robustness details</button>}
 </section>
}
