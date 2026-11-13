import { Fragment, useMemo, useState } from 'react'
import type { Site,Ephemeris,Horizon } from '../data'
import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from './solver.ts'
import { PowerControls, ThermalControls, explain } from './EnergyPanel'
import { cloneConstraints, comparisonReport, encodeScenarios, shiftedRow, verifiedRepairs, type Scn } from './comparison.ts'
import { arrivalSearchText, nextPassingArrival } from '../lib/arrivalSearch.ts'
import { jointVisibility } from '../lib/jointVisibility.ts'
import { DecisionScope } from './DecisionScope.tsx'
import { landingContext,comparisonExplanation,formatEnergyKwh } from './comparisonContext'
import { LandingConditions } from './LandingConditions'
import { LandingDateInput } from './LandingDateInput'
import type { PredictionIndex } from '../lib/predictionIndex.ts'
import { useRobustnessProducts } from './useRobustness'
import { assessRobustness } from './robustness'
import { RobustnessSummary } from './RobustnessSummary'
import { buildMissionBrief,type MissionBrief } from './missionBrief'
import { PrintableBrief } from './PrintableBrief'
import { MissionCsvDownloads } from '../MissionCsvDownloads'
export { decodeScenarios } from './comparison.ts'
export type { Scn } from './comparison.ts'

type Props = {
  sites: Site[]; bySlug: Map<string, SiteSeries>; startMs: number; seed: Scn[]
  datasetIndex: PredictionIndex
  eph:Record<string,Record<'sun'|'earth',Ephemeris>>;horizons:Record<string,Horizon>;introNote?:string
  onClose: () => void; onPreviewMission: (slug: string, startRow: number, endRow: number) => void
  onUseScenario: (scenario: Scn) => void
}
const HOUR = 3_600_000
type Metric = {label: string; value: (e: Evaluated) => number | null; unit: string; digits?: number}
const METRICS: Metric[] = [
  {label:'Sun centre visible', value:e=>e.litPct, unit:'%',digits:1},
  {label:'Earth centre visible', value:e=>e.linkPct, unit:'%',digits:1},
  {label:'Longest darkness', value:e=>e.longestDarkH, unit:'h'},
  {label:'Longest Earth gap', value:e=>e.longestGapH, unit:'h'},
  {label:'Solar energy', value:e=>e.power ? e.power.generatedWh/1000 : null, unit:'kWh',digits:2},
  {label:'Minimum battery', value:e=>e.power?.minPct ?? null, unit:'%',digits:1},
  {label:'Unmet demand', value:e=>e.power ? e.power.unmetWh/1000 : null, unit:'kWh',digits:2},
  {label:'Minimum temperature', value:e=>e.thermal ? e.thermal.minTempK-273.15 : null, unit:'°C',digits:1},
]

/** Complete missions evaluated in the same drawer and by the same planner model. */
export function ScenarioCompare({sites,bySlug,startMs,seed,onClose,onPreviewMission,onUseScenario,datasetIndex,eph,horizons,introNote}: Props) {
  const [scns,setScns] = useState<Scn[]>(() => seed.slice(0,3).map(s=>({...s,c:cloneConstraints(s.c)})))
  const [notice,setNotice] = useState(introNote??'')
  const [mobileId,setMobileId]=useState(seed[0].id)
  const [repairs,setRepairs] = useState<{id:number; choices:ReturnType<typeof verifiedRepairs>} | null>(null)
  const [brief,setBrief]=useState<MissionBrief|null>(null)
  const products=useRobustnessProducts(datasetIndex,scns.map(s=>s.slug))
  const maxHours = Math.min(...[...bySlug.values()].map(s=>s.hours))
  const iso = (row:number) => new Date(startMs+row*HOUR).toISOString().slice(0,16)
  const date = (row:number) => iso(row).replace('T',' ')+' UTC'
  const update = (id:number,patch:Partial<Scn>) => {
    setScns(p=>p.map(s=>s.id===id ? {...s,...patch} : s)); setRepairs(null); setNotice('')
  }
  const setC = (s:Scn,c:Constraints) => update(s.id,{c})
  const activate=(id:number)=>{setMobileId(id);requestAnimationFrame(()=>document.getElementById('comparison-scenario-'+id)?.scrollIntoView({block:'start'}))}
  const duplicate = (s:Scn) => {
    if(scns.length>=3) return
    const id=Math.max(...scns.map(x=>x.id))+1
    setScns(p=>[...p,{...s,id,c:cloneConstraints(s.c)}]);activate(id)
  }
  const evals = useMemo(()=>scns.map(s=>{
    const series=bySlug.get(s.slug)
    if(!series || s.row<0 || s.row+s.c.missionDays*24>series.hours) return null
    try{return evaluateWindow(series,s.row,s.row+s.c.missionDays*24,s.c)}catch{return null}
  }),[scns,bySlug])
  const assessments=useMemo(()=>scns.map((s,i)=>evals[i]&&eph[s.slug]&&horizons[s.slug]?assessRobustness(products[s.slug],eph[s.slug].sun,eph[s.slug].earth,horizons[s.slug],s.row,s.c):null),[scns,evals,products,eph,horizons])
  const contexts=useMemo(()=>scns.map(s=>eph[s.slug]&&horizons[s.slug]?landingContext(s,eph[s.slug].sun,eph[s.slug].earth,horizons[s.slug],startMs):null),[scns,eph,horizons,startMs])
  const explanations=useMemo(()=>scns.slice(1).map((s,i)=>comparisonExplanation(scns[0],s,bySlug.get(scns[0].slug),bySlug.get(s.slug),evals[0],evals[i+1])),[scns,bySlug,evals])
  const selectedMobile=scns.some(s=>s.id===mobileId)?mobileId:scns[0].id
  const share = async () => {
    const url=new URL(window.location.href)
    url.searchParams.set('view','plan'); url.searchParams.set('compare',encodeScenarios(scns))
    url.searchParams.set('dataset',datasetIndex.datasetId);url.searchParams.set('model',datasetIndex.model.version)
    window.history.replaceState(null,'',url)
    try{await navigator.clipboard.writeText(url.toString());setNotice('Comparison link copied. Dates, requirements and hardware are included.')}
    catch{window.history.replaceState(null,'',url);setNotice('Comparison saved in the address bar. Copy the URL to share.')}
  }
  const exportComparison = () => {
    const payload=comparisonReport(datasetIndex,scns,bySlug,undefined,{eph,horizons,products})
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
    const a=document.createElement('a');a.href=url;a.download='chader-buri-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const identical = () => {
    const first=scns[0].c
    setScns(p=>p.map(s=>({...s,c:{...s.c,power:first.power?{...first.power}:undefined,thermal:first.thermal?{...first.thermal}:undefined}})))
    setRepairs(null);setNotice('Hardware copied from A. Dates and visibility requirements remain independent.')
  }
  return <section className="scenario-comparison absolute inset-0 z-40 flex flex-col bg-void" aria-label="Compare scenarios">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge p-4">
      <div><h2 className="font-display text-lg">Compare equipment & requirements</h2></div>
      <button className="tool-button" onClick={onClose}>Back to mission</button>
      <p className="w-full text-xs leading-5 text-inkdim">Give each option its own equipment or requirements. You can also change its site and arrival date. A is the baseline; hardware defaults are illustrative.</p>
      <div className="comparison-actions flex flex-wrap items-center gap-2"><button className="tool-button" onClick={()=>setBrief(buildMissionBrief(datasetIndex,scns,bySlug,sites,eph,horizons,products,undefined,'comparison'))}>Printable comparison brief</button><details className="comparison-share"><summary>Share & export</summary><div className="flex flex-wrap gap-2"><button className="tool-button" onClick={share}>Copy comparison link</button><button className="tool-button" onClick={exportComparison}>Export comparison JSON</button></div></details></div>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <MissionCsvDownloads index={datasetIndex} scenarios={scns} series={bySlug} sites={sites} eph={eph} horizons={horizons}/>
      {notice && <p role="status" className="comparison-notice">{notice}</p>}
      <nav className="comparison-mobile-tabs" aria-label="Choose comparison scenario">{scns.map((s,i)=><button key={s.id} aria-pressed={selectedMobile===s.id} onClick={()=>activate(s.id)}>{String.fromCharCode(65+i)} · {i===0?'Baseline':'Alternative'}</button>)}</nav>
      <div className="scenario-cards" style={{gridTemplateColumns:`repeat(${scns.length}, minmax(0,1fr))`}}>
        {scns.map((s,i)=><article key={s.id} id={'comparison-scenario-'+s.id} data-mobile-active={selectedMobile===s.id} aria-label={`Scenario ${String.fromCharCode(65+i)}`} className="rounded-xl border border-edge bg-panel2 p-3">
          <div className="flex justify-between gap-2"><strong>{String.fromCharCode(65+i)} · {i===0?'Baseline':'Alternative'}</strong>{scns.length>1&&<button className="text-xs text-inkdim" onClick={()=>{setScns(p=>p.filter(x=>x.id!==s.id));setRepairs(null)}} aria-label={`Remove scenario ${String.fromCharCode(65+i)}`}>Remove</button>}</div>
          <label className="scenario-site mt-2 block text-xs"><span className="sr-only">Site</span><select aria-label={`Scenario ${String.fromCharCode(65+i)} site`} className="comparison-input" value={s.slug} onChange={e=>update(s.id,{slug:e.target.value})}>{sites.map(site=><option key={site.slug} value={site.slug}>{site.name}</option>)}</select></label>
          <LandingDateInput row={s.row} startMs={startMs} hours={maxHours} days={s.c.missionDays} onPick={row=>update(s.id,{row})}/>
          <div className="scenario-result"><p className={'scenario-verdict mt-3 text-sm font-semibold '+(evals[i]?.pass?'text-viable':'text-danger')}>{evals[i]?(evals[i]!.pass?'Nominal: meets requirements':'Nominal: misses requirements'):'Outside data coverage'}</p>{evals[i]&&<div className="scenario-battery"><strong>{evals[i]!.power?evals[i]!.power!.minPct.toFixed(1)+'%':'—'}</strong><span>{evals[i]!.power?'Minimum battery':'Battery not assessed'}</span></div>}</div>
          <p className="scenario-explanation">{evals[i]?explain(evals[i]!,s.c):'Choose a landing inside the supported interval.'}</p>
          {evals[i]&&<DecisionScope heightM={horizons[s.slug]?.observerHeightAboveGroundM??0}/>}
          {assessments[i]&&evals[i]?<RobustnessSummary compact assessment={assessments[i]!} nominal={evals[i]!}/>:<p className="text-xs text-inkdim">Robustness not assessed · complete mission outside coverage.</p>}
          <div className="scenario-key-metrics"><span>Sun elevation · landing<strong>{contexts[i]?(contexts[i]!.sun.el>=0?'+':'')+contexts[i]!.sun.el.toFixed(2)+'°':'Unavailable'}</strong></span><span>Earth elevation · landing<strong>{contexts[i]?(contexts[i]!.earth.el>=0?'+':'')+contexts[i]!.earth.el.toFixed(2)+'°':'Unavailable'}</strong></span><span>Sun / Earth centre visible<strong>{evals[i]?evals[i]!.litPct.toFixed(1)+'% / '+evals[i]!.linkPct.toFixed(1)+'%':'Not assessed'}</strong></span>{bySlug.get(s.slug)&&(()=>{const j=jointVisibility(bySlug.get(s.slug)!,s.row,s.row+s.c.missionDays*24);return <span title="Hours when the Sun's centre and Earth's centre are both above the measured skyline. Geometry only: not usable power and not a working radio link.">Sun &amp; Earth visible together<strong>{j.pct.toFixed(1)}% · longest {j.longestH} h</strong><small className="scenario-joint-note">geometry only · not power or a radio link</small></span>})()}</div>
          {horizons[s.slug]&&<LandingConditions context={contexts[i]} horizon={horizons[s.slug]} missionHours={s.c.missionDays*24} tracks={eph[s.slug]?{sun:eph[s.slug].sun.rows.slice(Math.round(s.row),Math.round(s.row)+s.c.missionDays*24),earth:eph[s.slug].earth.rows.slice(Math.round(s.row),Math.round(s.row)+s.c.missionDays*24)}:undefined}/>}
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Shift landing date">{[-1,1,3,7].map(days=><button key={days} className="tool-button" disabled={shiftedRow(s,days,maxHours)===null} onClick={()=>update(s.id,{row:shiftedRow(s,days,maxHours)!})}>{days>0?'+':''}{days} day{Math.abs(days)>1?'s':''}</button>)}</div>
          <label className="mt-2 block text-xs">Mission duration (days)<input className="comparison-input" type="number" min={3} max={30} value={s.c.missionDays} onChange={e=>{const d=Number(e.target.value);if(Number.isInteger(d)&&d>=3&&d<=30)setC(s,{...cloneConstraints(s.c),missionDays:d})}} /></label>
          <button className="mt-2 text-xs text-earth underline" disabled={scns.length>=3} onClick={()=>duplicate(s)}>Duplicate scenario</button>
          <details className="mt-3"><summary className="cursor-pointer text-xs text-earth">Hardware & requirements</summary>
            <div className="mt-2 space-y-3"><PowerControls value={s.c.power} onChange={power=>setC(s,{...cloneConstraints(s.c),power,thermal:power?s.c.thermal:undefined})} /><ThermalControls value={s.c.thermal} powerOn={!!s.c.power} onChange={thermal=>setC(s,{...cloneConstraints(s.c),thermal})} />
              {([{key:'minLitPct',label:'Minimum Sun visibility (%)',max:100},{key:'minLinkPct',label:'Minimum Earth visibility (%)',max:100},{key:'maxDarkH',label:'Maximum darkness (h)',max:720},{key:'maxGapH',label:'Maximum Earth gap (h)',max:720}] as const).map(f=><label className="block text-xs" key={f.key}>{f.label}<input className="comparison-input" type="number" min={0} max={f.max} value={s.c[f.key]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0&&n<=f.max)setC(s,{...cloneConstraints(s.c),[f.key]:n})}} /></label>)}
            </div>
          </details>
          <p className="mt-2 text-xs text-inkdim">Battery: {s.c.power?'assessed':'not assessed'} · Thermal: {s.c.thermal?'assessed':'not assessed'}<br />RF: diagnostic only · Footprint excludes thermal and RF</p>
          {evals[i]&&<div className="mt-3 flex flex-col items-start gap-2"><button className="text-xs text-earth underline" onClick={()=>onUseScenario(s)}>Use this mission & inspect evidence</button><button className="text-xs text-earth underline" onClick={()=>{onPreviewMission(s.slug,s.row,s.row+s.c.missionDays*24);setNotice(`Scene aligned to scenario ${String.fromCharCode(65+i)} · ${sites.find(site=>site.slug===s.slug)?.name??s.slug} · ${date(s.row)}. Playback paused; comparison settings retained.`)}}>Preview this scenario · site & UTC</button></div>}
          {evals[i]&&!evals[i]!.pass&&<div className="mt-3 flex flex-col items-start gap-2"><button className="tool-button" onClick={()=>{const found=nextPassingArrival(bySlug.get(s.slug)!,s.row,s.c),searched=arrivalSearchText(found,date);if(found.row===null)setNotice(searched);else{update(s.id,{row:found.row});setNotice(`Alternative updated to ${date(found.row)}. ${searched} Requirements and hardware are unchanged.`)}}}>Find next passing date</button><button className="tool-button" disabled={!s.c.power} onClick={()=>setRepairs({id:s.id,choices:verifiedRepairs(bySlug.get(s.slug)!,s)})}>Check hardware repairs</button></div>}
          {repairs?.id===s.id&&<section aria-label="Verified hardware alternatives" className="mt-3 rounded-xl border border-edge p-3"><h3 className="text-sm">Hardware alternatives rechecked against the enabled nominal requirements</h3><p className="mt-1 text-xs text-inkdim">One setting changes. No engineering margin is added; footprint and RF remain separate.</p>{repairs.choices.length===0?<p className="mt-2 text-sm">No single electrical change found that also satisfies all enabled requirements.</p>:repairs.choices.map(r=><button key={r.key} className="tool-button mt-2 mr-2" onClick={()=>update(repairs.id,{c:cloneConstraints(r.c)})}>Apply {r.label.toLowerCase()}: {r.value} {r.unit}</button>)}</section>}
        </article>)}
      </div>
      <section className="comparison-causes" aria-label="What changes and why"><div className="flex flex-wrap items-center justify-between gap-2"><h3>What changes—and why?</h3><button className="tool-button" onClick={identical}>Use identical hardware</button></div>{scns.slice(1).map((s,i)=><article key={s.id} aria-label={`Scenario ${String.fromCharCode(66+i)} differences`}><h4>{String.fromCharCode(66+i)} versus A</h4><ul>{explanations[i].lines.map(line=><li key={line}>{line}</li>)}</ul>{explanations[i].energy&&<div className="generation-attribution"><p>Modeled solar-energy change: <strong>{formatEnergyKwh(explanations[i].energy!.totalWh)} kWh</strong></p>{explanations[i].energy!.contributions.map(part=><span key={part.label}>{part.label}<strong>{formatEnergyKwh(part.wh,true)} kWh</strong></span>)}<small>Contributions average all replacement orders with identical hardware and duration. Exposure combines terrain and eclipses; rounded values may not sum exactly. This is model attribution, not independent evidence of real-world causation.</small></div>}</article>)}{scns.length===1&&<p>Add an alternative to compare its date, site and energy with A.</p>}</section>
      <details className="comparison-all-metrics"><summary>All mission metrics · differences relative to A</summary><div className="comparison-grid grid gap-x-3" style={{gridTemplateColumns:`125px repeat(${scns.length}, minmax(180px,1fr))`}}><div>Metric</div>{scns.map((s,i)=><strong key={s.id}>{String.fromCharCode(65+i)} · {sites.find(site=>site.slug===s.slug)?.name}</strong>)}
        {METRICS.map(metric=><Fragment key={metric.label}><div className="border-b border-edge py-3 text-xs text-inkdim">{metric.label}</div>{scns.map((s,i)=>{
          const n=evals[i]?metric.value(evals[i]!):null, base=evals[0]?metric.value(evals[0]):null
          const rawDelta=n!==null&&base!==null&&i>0?n-base:null
          const delta=rawDelta!==null&&Math.abs(rawDelta)<0.5*10**-(metric.digits??0)?0:rawDelta
          return <div key={s.id} className="border-b border-edge py-3 font-mono text-sm">{n===null?'Not assessed':`${n.toFixed(metric.digits??0)} ${metric.unit}`}{delta!==null&&<small className="block text-xs text-inkdim">{delta>=0?'+':''}{delta.toFixed(metric.digits??0)} {metric.unit==='%'?'pp':metric.unit} vs A</small>}</div>
        })}</Fragment>)}
      </div></details>
      <p className="mt-3 text-xs leading-5 text-inkdim">Hourly screening estimates, not a success probability. Changing only a date can change electrical energy even when visibility percentages remain equal. Footprint and height diagnostics do not alter the nominal verdict. Review full evidence in mission details.</p>
    </div>
    {brief&&<PrintableBrief brief={brief} onClose={()=>setBrief(null)}/>}
  </section>
}
