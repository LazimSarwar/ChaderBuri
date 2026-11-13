import { useEffect,useRef } from 'react'
import { createPortal } from 'react-dom'
import type { MissionBrief } from './missionBrief'
import { explain } from './EnergyPanel'
import { formatEnergyKwh } from './comparisonContext'
import type { Constraints } from './solver'
import './printableBrief.css'

const utc=(value:string)=>value.slice(0,16).replace('T',' ')+' UTC'
function Assumptions({c}:{c:Constraints}){
 const p=c.power,t=c.thermal
 return <div className="brief-assumptions"><h3>This scenario's requirements & assumptions</h3><p>Sun centre ≥{c.minLitPct}%; darkness ≤{c.maxDarkH} h; Earth centre ≥{c.minLinkPct}%; Earth gap ≤{c.maxGapH} h.</p><p>{p?`Array ${p.panelAreaM2} m², ${p.efficiencyPct}% cells, ${p.orientation} orientation${p.orientation==='fixed'?` (tilt ${p.tiltDeg}°, azimuth ${p.azimuthDeg}°)`:''}; demand ${p.loadW} W; battery ${p.capacityWh} Wh; initial charge ${p.initialPct}%; reserve ${p.reservePct}%; charge/discharge efficiency ${p.chargeEfficiencyPct}%/${p.dischargeEfficiencyPct}%.`:'Battery requirement disabled.'}</p><p>{t?`Thermal node: ${t.thermalMassJK} J/K; εA ${t.radiativeCoeffM2} m²; αA ${t.absorptivityAreaM2} m²; internal heat ${t.internalHeatFraction}%; heater ${t.heaterMaxW} W; setpoint ${t.setpointK} K; survival ${t.survivalK} K; assumed sink ${t.sinkK} K.`:'Thermal not assessed.'}</p></div>
}
export function PrintableBrief({brief,onClose}:{brief:MissionBrief&{decision?:{reason:string;stages:string[];originUTC:string}};onClose:()=>void}){
 const comparison=brief.kind==='comparison'
 const close=useRef<HTMLButtonElement>(null)
 const closeAction=useRef(onClose);closeAction.current=onClose
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,title=document.title
  document.title=comparison?'Chader Buri comparison brief':'Chader Buri mission brief';close.current?.focus()
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.stopPropagation();closeAction.current()}
   if(event.key==='Tab'){
    const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.mission-print-toolbar button')),first=buttons[0],last=buttons.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  document.addEventListener('keydown',key,true)
  return()=>{document.title=title;document.removeEventListener('keydown',key,true);previous?.focus()}
 },[])
 const download=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(brief,null,2)],{type:'application/json'})),a=document.createElement('a')
  a.href=url;a.download=comparison?'chader-buri-comparison-brief.json':'chader-buri-mission-brief.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return createPortal(<div className="mission-print-portal" role="dialog" aria-modal="true" aria-label={comparison?'Printable comparison brief':'Printable mission brief'}>
  <nav className="mission-print-toolbar"><strong>{comparison?'Comparison':'Mission'} brief preview</strong><button onClick={()=>window.print()}>Print / Save PDF</button><button onClick={download}>Download brief JSON</button><button ref={close} onClick={onClose}>Close brief</button></nav>
  <article className="mission-brief-paper">
   <header><p>CHADER BURI · LUNAR MISSION SCREENING</p><h1>{comparison?'Scenario comparison brief':'Mission decision brief'}</h1><p>{comparison?'Scenarios exactly as configured. A is the baseline; dates, hardware and requirements may differ.':'Selected mission versus an unchanged lander landing seven days later.'}</p><small>Generated {utc(brief.generatedUTC)} · Analysis observer {brief.reproducibility.analysisObserverHeightM} m above DEM ground</small></header>
   <>{brief.decision&&<section><h2>Your decision story</h2><p>{brief.decision.stages.join(" / ")}</p><p>Reason: {brief.decision.reason||"Not entered"}</p><p>Journey starting scene: {utc(brief.decision.originUTC)}</p></section>}</><div className="brief-scenarios" data-count={brief.scenarios.length}>{brief.scenarios.map((s,i)=><section className="brief-scenario" key={s.label}>
    <h2>{s.label}{brief.decision?` / ${brief.decision.stages[i]}`:""}</h2><h3>{s.site}</h3><p><strong>Landing</strong> {utc(s.landingUTC)}<br/><strong>End</strong> {utc(s.endUTC)} · {s.constraints.missionDays} days</p>
    {!s.result?<p className="brief-warning">Not assessed · complete mission outside cached coverage</p>:<>
     <h3 className={!s.result.pass?'brief-warning':''}>Nominal: {s.result.pass?'meets':'misses'} enabled requirements</h3><p className="brief-explanation">{explain(s.result,s.constraints)}</p>
     <dl><dt>Sun / Earth centre visible</dt><dd>{s.result.litPct.toFixed(1)}% / {s.result.linkPct.toFixed(1)}%</dd><dt>Longest darkness / Earth gap</dt><dd>{s.result.longestDarkH} h / {s.result.longestGapH} h</dd><dt>Minimum battery / reserve</dt><dd>{s.result.power?`${s.result.power.minPct.toFixed(1)}% / ${s.constraints.power!.reservePct}%`:'Not assessed'}</dd><dt>Unmet load</dt><dd>{s.result.power?`${s.result.power.unmetWh.toFixed(0)} Wh`:'Not assessed'}</dd><dt>Thermal survival</dt><dd>{s.result.thermal?(s.result.thermal.pass?'Meets enabled requirement':'Misses requirement'):'Not assessed'}</dd></dl>
     {s.atLanding&&<p>At landing: Sun {s.atLanding.sun.el.toFixed(2)}°, Earth {s.atLanding.earth.el.toFixed(2)}° geometric elevation.<br/>Sun {s.atLanding.sun.nextKind}: {s.atLanding.sun.next?s.atLanding.sun.next.atUTC+' UTC':'no future crossing in cache'}.<br/>Earth {s.atLanding.earth.nextKind}: {s.atLanding.earth.next?s.atLanding.earth.next.atUTC+' UTC':'no future crossing in cache'}.</p>}
     {s.battery&&<svg viewBox="0 0 320 120" role="img" aria-label={`${s.label} battery charge curve`}><text x="0" y="12">Battery charge (%) · dashed: reserve</text>{[0,50,100].map(p=><g key={p}><line x1="26" x2="310" y1={100-p*.75} y2={100-p*.75} stroke="#ddd"/><text x="0" y={103-p*.75}>{p}</text></g>)}<line x1="26" x2="310" y1={100-s.constraints.power!.reservePct*.75} y2={100-s.constraints.power!.reservePct*.75} stroke="#a33" strokeDasharray="4 3"/><polyline fill="none" stroke="#164e63" strokeWidth="2" points={s.battery.points.map(p=>`${26+p.hour/(s.constraints.missionDays*24)*284},${100-p.socPct*.75}`).join(' ')}/><text x="26" y="117">0</text><text x="290" y="117">{s.constraints.missionDays} d</text></svg>}
     <h3>Robustness checks</h3><p>{s.robustness?.footprint.status==='ready'?`Nearby footprint: ${s.robustness.footprint.data.passing}/${s.robustness.footprint.data.samples.length} sampled points meet visibility${s.constraints.power?' / battery':''} requirements.`:`Footprint: ${s.robustness?.footprint.status==='loading'?'pending':'not assessed / unavailable'}.`}</p><p>{s.robustness?.height.status==='ready'?`Observer heights (verdict; minimum battery): ${s.robustness.height.data.map(r=>`${r.height} m ${r.result.pass?'meets':'misses'}${r.result.power?'; '+r.result.power.minPct.toFixed(1)+'%':''}`).join(' · ')}.`:`Observer heights: ${s.robustness?.height.status==='loading'?'pending':'not assessed / unavailable'}.`}</p>
    </>}
    <Assumptions c={s.constraints}/>
   </section>)}</div>
   {comparison&&brief.differences.length>0&&<section className="brief-differences"><h2>What changes relative to A?</h2>{brief.differences.map(d=><div key={d.label}><h3>{d.label} versus A</h3><ul>{d.lines.map(line=><li key={line}>{line}</li>)}</ul>{d.energy&&<p>Modeled generated energy: {formatEnergyKwh(d.energy.totalWh,true)} kWh. {d.energy.contributions.map(p=>`${p.label}: ${formatEnergyKwh(p.wh,true)} kWh`).join('; ')}. Model attribution with identical electrical hardware and duration; not an attribution of battery minima or independent real-world causation.</p>}</div>)}</section>}
   <section className="brief-not-assessed"><h2>Not assessed</h2><p>These parts of a landing decision are outside this brief. A result here never covers them.</p><ul>{[...new Set(brief.scenarios.flatMap(s => [...(s.constraints.power ? [] : ['Battery reserve (turned off)']), ...(s.constraints.thermal ? [] : ['Night survival (turned off)'])]))].map(x => <li key={x}>{x}</li>)}<li>Radio link budget: diagnostic only, not part of the verdict; Earth visibility is line of sight, not a scheduled DSN pass.</li><li>Landing hazards, slope and surface roughness at landing-ellipse scale.</li><li>Night survival and radio at the 19 nearby footprint points (those points check visibility and battery only).</li><li>Battery ageing, dust on panels, pointing errors and real operations schedules.</li></ul></section>
   <section><h2>Interpretation & limitations</h2><p>{brief.timingLimitations} Footprint checks use 19 points within 250 m and exclude thermal and RF. Height checks retain enabled nominal requirements. These checks are not success probabilities, confidence intervals or continuous landing-safety assessments. RF is diagnostic only and is excluded from the nominal verdict. Earth visibility does not establish station service or DSN capacity.</p><p>Partial-disc solar exposure and eclipse geometry are approximations. The regional published illumination comparison retains an unresolved 1 m discrepancy; no global accuracy bound is established. No engineering margin is added to a minimum repair.</p></section>
   <footer><h2>Source identity</h2><p>NASA/JPL Horizons · LRO LOLA · Cache {brief.reproducibility.coverage.start} to {brief.reproducibility.coverage.stop} UTC<br/>Dataset: <code>{brief.reproducibility.datasetId}</code><br/>Model: <code>{brief.reproducibility.model.version}</code> · <code>{brief.reproducibility.model.sha256}</code></p><p><a href="https://ssd.jpl.nasa.gov/horizons/">ssd.jpl.nasa.gov/horizons/</a> · <a href="https://pds-geosciences.wustl.edu/missions/lro/lola.htm">LOLA archive</a>. Brief JSON provides individual product and model-source fingerprints. Preserve those products to reproduce an earlier snapshot.</p></footer>
  </article>
 </div>,document.body)
}
