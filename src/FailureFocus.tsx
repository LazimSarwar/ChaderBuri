import { useEffect,useMemo,useRef } from 'react'
import { failureReading,type FailurePreview } from './lib/failurePreview'
import type { DecisionPreview } from './DecisionGuide'

export function FailureFocus({failure:f,label,preview,request}:{failure:FailurePreview;label:'A'|'B';preview:DecisionPreview;request:number}){
 const root=useRef<HTMLElement>(null)
 useEffect(()=>{root.current?.scrollIntoView({block:'nearest',behavior:'auto'})},[f,label,request])
 const reading=failureReading(f,preview.row),points=f.battery?.points
 const x=(h:number)=>26+228*h/(f.missionEnd-f.missionStart),y=(pct:number)=>93-.78*pct
 const path=useMemo(()=>points?.map((p,i)=>`${i?'L':'M'}${(26+228*p.hour/(f.missionEnd-f.missionStart)).toFixed(2)},${(93-.78*p.socPct).toFixed(2)}`).join(' ')??'',[points,f.missionStart,f.missionEnd])
 return <section ref={root} className="failure-focus" aria-label={`Why scenario ${label} fails`}>
  <h4>{label} · {f.title}</h4><p>{f.timing==='representative'?'Representative blocked interval':'Modeled threshold'} · around mission hour {Math.round(f.eventHour)}</p>
  {points&&f.reservePct!==null&&<><svg viewBox="0 0 280 116" role="img" aria-label={`Scenario ${label} battery over the full mission; reserve ${f.reservePct} percent. Marker near hour ${Math.round(f.eventHour)}.`}>
   <rect x="26" y={y(f.reservePct)} width="228" height={93-y(f.reservePct)} fill="#c69b7033"/>
   <line x1="26" y1={y(f.reservePct)} x2="254" y2={y(f.reservePct)} stroke="#d4b686" strokeDasharray="4 3"/>
   <path d={path} fill="none" stroke="#a9d2e0" strokeWidth="2"/>
   <line x1={x(f.eventHour)} y1="12" x2={x(f.eventHour)} y2="93" stroke="#dbac88" strokeDasharray="2 3"/>
   {reading&&<circle cx={x(reading.hour)} cy={y(reading.batteryPct!)} r="3" fill="#f2f6f7"/>}
   <text x="2" y="18">100%</text><text x="2" y="95">0%</text><text x="26" y="110">Landing</text><text x="254" y="110" textAnchor="end">{(f.missionEnd-f.missionStart)/24} days</text>
  </svg><p className="failure-chart-key">Blue: battery · dashed: {f.reservePct}% reserve · vertical: modeled breach</p></>}
  {reading?<dl className="failure-readout"><dt>Scene · mission hour</dt><dd>~{reading.hour.toFixed(1)}</dd>{reading.batteryPct!==null?<><dt>Battery / reserve</dt><dd>~{reading.batteryPct.toFixed(1)}% / {f.reservePct}%</dd><dt>Generation / demand</dt><dd>{reading.generationW!.toFixed(0)} / {reading.loadW!.toFixed(0)} W</dd></>:reading.blockedHours!==null?<><dt>{f.window.target==='earth'?'Earth masked':'Sun masked'} in selected interval</dt><dd>~{reading.blockedHours.toFixed(1)} h{f.limitH!==null?` / ${f.limitH} h limit`:''}</dd></>:null}</dl>:<p>Scene is outside scenario {label}'s mission. Start the preview to follow its conditions.</p>}
  <p>{f.explanation}</p>
  {preview.running&&<><progress max={1} value={preview.progress} aria-label="Failure preview progress"/><button className="tool-button" onClick={preview.stop}>Stop failure preview</button></>}
  {preview.canRestore&&<button className="tool-button" onClick={preview.restore}>Restore pre-preview date</button>}
  <details className="guide-geometry"><summary>Timing & limits</summary><p className="visit-field-scope">At the landing target. Approximate timing from hourly samples; the battery cursor interpolates hourly endpoints. No validated numerical timing bound. Other requirements may also fail.</p></details>
 </section>
}
