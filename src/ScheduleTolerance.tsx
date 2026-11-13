import { useEffect,useRef,useState } from 'react'
import { scheduleTolerance,type SchedulePoint } from './lib/scheduleTolerance'
import type { SensitiveDateContext } from './lib/sensitiveDate'
import { cloneConstraints,type Scn } from './architect/comparison'
import { parseRowT } from './lib/sim'

export function ScheduleTolerance({scenario,context,onCompare}:{scenario:Scn;context:SensitiveDateContext;onCompare:(scenarios:Scn[],note:string)=>void}){
 const [open,setOpen]=useState(false),[points,setPoints]=useState<SchedulePoint[]|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[selected,setSelected]=useState(6)
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 const run=async()=>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError('')
  try{const result=await scheduleTolerance(context,scenario,abort.signal,setProgress);if(!abort.signal.aborted){setPoints(result);setBusy(false)}}catch(e){if(!abort.signal.aborted){setError(String(e));setBusy(false)}}
 }
 const terrainIdentity=context.products.footprint.status==='ready'?context.products.footprint.data:context.products.footprint.status
 const assumptions=JSON.stringify(scenario.c)
 useEffect(()=>{
  controller.current?.abort();setPoints(null);setBusy(false);setError('');setSelected(6)
  if(open)void run()
 },[terrainIdentity,scenario.slug,scenario.row,assumptions])
 const point=points?.[selected],date=(row:number)=>new Date(parseRowT(context.sun.rows[0].t).getTime()+row*3600000).toISOString().slice(0,16).replace('T',' ')+' UTC'
 return <details className="schedule-tolerance" open={open} onToggle={e=>{const next=e.currentTarget.open;setOpen(next);if(next&&!points&&!busy)void run();if(!next){controller.current?.abort();setBusy(false)}}}><summary>How much schedule slip can this tolerate?</summary>{open&&<>
  <p>Same lander and requirements. Thirteen checked starts from −3 to +3 days; half-day spacing.</p>
  {busy&&<><progress aria-label="Schedule tolerance progress" max={13} value={progress}/><p role="status">Checking {progress}/13 landing starts…</p><button className="tool-button" onClick={()=>{controller.current?.abort();setBusy(false)}}>Cancel schedule check</button></>}
  {error&&<p role="status">Schedule checks unavailable; no tolerance is inferred.</p>}
  {!busy&&!points&&<button className="tool-button" onClick={()=>{void run()}}>Check schedule tolerance</button>}
  {points&&<><div className="schedule-grid" role="group" aria-label="Discrete landing start checks">{points.map((p,i)=><button key={p.offsetH} aria-pressed={selected===i} data-pass={p.nominal?String(p.nominal.pass):'unknown'} aria-label={`${p.offsetH/24>=0?'+':''}${p.offsetH/24} days: ${!p.nominal?'not assessed':p.nominal.pass?'passes nominal requirements':'misses nominal requirements'}; ${p.footprint.status==='ready'?p.footprint.data.passing+'/19 footprint samples pass':'footprint not assessed'}`} onClick={()=>setSelected(i)}><span>{p.offsetH>0?'+':''}{p.offsetH/24}d</span><strong>{!p.nominal?'?':p.nominal.pass?'✓':'×'}</strong><small>{p.footprint.status==='ready'?p.footprint.data.passing+'/19':'—'}</small></button>)}</div>{point&&<><p><strong>{date(point.row)}</strong><br/>{point.nominal?point.nominal.pass?'Passes nominal requirements':'Misses nominal requirements':'Complete mission outside cached coverage'}</p>{point.nominal&&<dl><dt>Minimum battery</dt><dd>{point.nominal.power?point.nominal.power.minPct.toFixed(1)+'%':'Not assessed'}</dd><dt>Footprint samples</dt><dd>{point.footprint.status==='ready'?point.footprint.data.passing+'/19 pass':'Not assessed'}</dd></dl>}<button className="tool-button" disabled={!point.nominal||point.offsetH===0} onClick={()=>onCompare([{...scenario,id:0,c:cloneConstraints(scenario.c)},{...scenario,id:1,row:point.row,c:cloneConstraints(scenario.c)}],'Schedule tolerance: same site, hardware and requirements; only landing UTC differs. Discrete half-day starts within ±3 days; no pass is inferred between checked starts. Footprint excludes thermal and RF.')}>Compare selected schedule change</button></>}</>}
  <p className="visit-field-scope">✓/× is the nominal verdict; X/19 is separate sampled visibility/battery sensitivity. No passing interval is inferred between starts. Unavailable terrain remains unassessed. Height is not swept in this strip.</p>
 </>}</details>
}
