import { useEffect,useMemo,useState } from 'react'
import type { Ephemeris,Horizon } from './data'
import type { PredictionIndex } from './lib/predictionIndex'
import { indexedOptions } from './lib/predictionIndex'
import { requestJson } from './lib/request'
import { assessTransition,type TransitionCase } from './lib/transitionValidation'
export function TransitionPanel({index,eph,horizons}:{index:PredictionIndex;eph:Record<string,Record<'sun'|'earth',Ephemeris>>;horizons:Record<string,Horizon>}){
  const [cases,setCases]=useState<TransitionCase[]>([]),[error,setError]=useState('')
  useEffect(()=>{const abort=new AbortController();const path='/data/validation/transitions.json';setError('');setCases([]);Promise.resolve().then(()=>requestJson(path,indexedOptions(index,path,abort.signal))).then(doc=>{if(!doc||!Array.isArray((doc as {cases:unknown}).cases))throw new Error('Invalid source probe report');setCases((doc as {cases:TransitionCase[]}).cases)}).catch(e=>{if(!abort.signal.aborted)setError(String(e))});return()=>abort.abort()},[index])
  const rows=useMemo(()=>cases.map(probe=>{
    const product=eph[probe.slug]?.[probe.body],horizon=horizons[probe.slug]
    if(!product||!horizon)return {probe,note:'Site predictions not ready'}
    if(probe.cachedEphemerisSha256!==index.files[`/data/ephemeris/${probe.slug}.${probe.body}.json`]?.sha256||probe.nominalHorizonSha256!==index.files[`/data/horizons/${probe.slug}.json`]?.sha256)return {probe,note:'Snapshot mismatch — not assessed'}
    try{return {probe,result:assessTransition(probe,product.rows,horizon)}}catch{return {probe,note:'Source probe unavailable'}}
  }),[cases,eph,horizons,index])
  return <section className="evidence-card mt-6"><p className="eyebrow">Actual finer source samples</p><h3>Ten-minute transition checks</h3><p>Six selected Sun/Earth transitions at three sites were queried again from JPL at ten-minute spacing. The comparison below uses the actual finer samples, not a resampled hourly table. It checks source interpolation and transition timing; it is not independent astronomical or terrain validation.</p>
    {error?<p role="status">{error}</p>:!cases.length?<p role="status">Loading source probes…</p>:<div className="benchmark-table-wrap"><table className="benchmark-table"><thead><tr><th>Site / body</th><th>Max direction difference</th><th>Changed ten-minute classifications</th><th>Max edge-time difference</th></tr></thead><tbody>{rows.map(({probe,result,note})=><tr key={probe.slug+probe.body}><th><a href={probe.sourceURL} target="_blank" rel="noreferrer">{probe.slug} · {probe.body} ↗</a></th><td>{result?`${result.maxAngleDeg.toFixed(5)}°`:note}</td><td>{result?`${result.disagreements}/${result.samples}`:'Not assessed'}</td><td>{result?result.maxEdgeMinutes===null?'Event counts differ / no matched edge':`${result.maxEdgeMinutes.toFixed(1)} min`:'Not assessed'}</td></tr>)}</tbody></table></div>}
    <p>These targeted 24-hour probes do not bound all dates, all sites or sub-ten-minute events. Event detection evaluates interpolated directions against the discrete terrain mask; it avoids interpolating clearance across skyline steps. Source query URLs and response fingerprints are included in the downloadable report.</p><a href="/data/validation/transitions.json" target="_blank" rel="noreferrer">Probe data & fingerprints ↗</a>
  </section>
}
