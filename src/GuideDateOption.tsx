import type { ExploreSamples } from './GuideFootprint'
import { useEffect,useMemo,useRef,useState } from 'react'
import { findLessSensitiveDate,DATE_SEARCH_DAYS,DATE_SEARCH_STEP_H,type SensitiveDateContext,type SensitiveDateResult,type DateSearchProgress } from './lib/sensitiveDate'
import { cloneConstraints,type Scn } from './architect/comparison'
import { assessRobustness } from './architect/robustness'
import { GuideRobustness } from './GuideRobustness'
import { formatDecisionUTC } from './DecisionDebrief'
import { parseRowT } from './lib/sim'

type SearchState={status:'idle'}|{status:'running';progress:DateSearchProgress|null}|{status:'done';result:SensitiveDateResult}
export function GuideDateOption({scenario,context,onApply,onCandidate,onExplore}:{scenario:Scn;context:SensitiveDateContext;onApply:(scenarios:Scn[],note:string)=>void;onCandidate?:(scenario:Scn)=>void;onExplore?:ExploreSamples}){
 const [search,setSearch]=useState<SearchState>({status:'idle'}),controller=useRef<AbortController|null>(null),root=useRef<HTMLElement>(null)
 useEffect(()=>{setSearch({status:'idle'});return()=>controller.current?.abort()},[scenario,context.series,context.products,context.sun,context.earth])
 const candidateCallback=useRef(onCandidate);candidateCallback.current=onCandidate
 const run=async()=>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort
  setSearch({status:'running',progress:null})
  try{
   const result=await findLessSensitiveDate(context,scenario,{signal:abort.signal,onProgress:progress=>{if(!abort.signal.aborted)setSearch({status:'running',progress})}})
   if(!abort.signal.aborted){setSearch({status:'done',result});if(result.status==='complete'&&result.candidate)candidateCallback.current?.(result.candidate.scenario);requestAnimationFrame(()=>{if(!abort.signal.aborted)root.current?.scrollIntoView({block:'nearest',behavior:'instant'})})}
  }catch(error){if(!abort.signal.aborted)setSearch({status:'done',result:{status:'unavailable',reason:`Date search unavailable: ${String(error)}`}})}
 }
 const result=search.status==='done'?search.result:null,candidate=result?.status==='complete'?result.candidate:null
 const assessment=useMemo(()=>candidate?assessRobustness(context.products,context.sun,context.earth,context.horizon,candidate.scenario.row,candidate.scenario.c):null,[candidate,context.products,context.sun,context.earth,context.horizon])
 const utc=(row:number)=>new Date(parseRowT(context.sun.rows[0].t).getTime()+row*3600000).toISOString()
 return <section ref={root} className="guide-date-option" aria-label="Later landing date"><h4>Could another date help?</h4>
  {search.status==='idle'&&<><p>Keep this lander and requirements. Check later dates for more passing footprint samples.</p><button className="tool-button guide-failure-button" disabled={context.products.footprint.status!=='ready'} onClick={()=>{void run()}}>Check another date</button>{context.products.footprint.status!=='ready'&&<p role="status">{context.products.footprint.status==='loading'?'Waiting for footprint data…':'Footprint unavailable; date sensitivity not assessed.'}</p>}</>}
  {search.status==='running'&&<><p role="status">{search.progress?.phase==='terrain'?'Preparing nearby terrain checks…':`Checking later starts · ${search.progress?.done??0}/${search.progress?.total??'…'}`}</p><progress aria-label="Later date search progress" max={search.progress?.total??1} value={search.progress?.done??0}/><button className="tool-button" onClick={()=>{controller.current?.abort();setSearch({status:'idle'})}}>Cancel date search</button></>}
  {result?.status==='unavailable'&&<p role="status">{result.reason}</p>}
  {result?.status==='complete'&&(candidate&&assessment?<>
   <p><strong>More sampled locations pass</strong><br/>{formatDecisionUTC(utc(candidate.scenario.row))} · +{Number(((candidate.scenario.row-scenario.row)/24).toFixed(2))} days</p>
   <dl><dt>Footprint samples</dt><dd>{result.baselinePassing}/19 → {candidate.passing}/19</dd><dt>Nominal requirements</dt><dd>Passes</dd><dt>Minimum battery</dt><dd>{candidate.result.power?`${candidate.result.power.minPct.toFixed(1)}%`:'Not assessed'}</dd></dl>
   <GuideRobustness assessment={assessment} nominal={candidate.result} context={context} scenario={candidate.scenario} onExplore={onExplore} onCompare={onApply}/>
   <button className="tool-button guide-failure-button" onClick={()=>onApply([{...scenario,id:0,c:cloneConstraints(scenario.c)},{...candidate.scenario,id:1,c:cloneConstraints(candidate.scenario.c)}],`Guided date check: A is the current mission; B changes only its landing date. Same site, hardware, duration and requirements. Footprint improves from ${result.baselinePassing}/19 to ${candidate.passing}/19 sampled passes. Later six-hour starts were searched within 90 days and cached coverage; rank by sample count, then earliest date. Counts are not probabilities; thermal and RF are excluded from footprint checks.`)}>Compare current & later date in planner</button>
  </>:<p role="status">{result.baselinePassing===19?'All 19 sampled locations already pass.':`No later nominally passing date with more footprint samples passing was found among ${result.checked} checked starts. This does not rule out other dates or sites.`}</p>)}
  <details><summary>Search scope</summary><p>Later starts only: {DATE_SEARCH_STEP_H}-hour steps, up to {DATE_SEARCH_DAYS} days, within full-mission cache coverage. Prefer more sampled passes, then the earliest date; stop early if all 19 pass. Hardware and requirements remain fixed. Footprint excludes thermal and RF; it is not a continuous safety assessment.{result?.status==='complete'?` Checked ${result.checked} starts; ${result.nominalPassing} met nominal requirements. Latest bounded start: ${formatDecisionUTC(utc(result.lastRow))}.`:''}</p></details>
 </section>
}
