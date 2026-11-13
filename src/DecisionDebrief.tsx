import { decisionFailures,decisionTakeaway,type DecisionPair,type DecisionChoice,type DecisionReflection } from './lib/explorationDecision'

import type { ReactNode } from 'react'

import type { Evaluated } from './architect/solver'



export const formatDecisionUTC=(utc:string)=>utc.slice(0,16).replace('T',' ')+' UTC'

export function DecisionAssumptions({pair}:{pair:DecisionPair}){

 const c=pair.constraints,p=c.power

 return <details className="decision-assumptions"><summary>Mission assumptions & limits</summary><p>{c.missionDays} days · {p?`${p.panelAreaM2} m² / ${p.efficiencyPct}% ideal tracking panel · ${p.loadW} W load · ${p.capacityWh/1000} kWh battery · ${p.reservePct}% reserve · ${p.initialPct}% initial charge · ${p.chargeEfficiencyPct}% / ${p.dischargeEfficiencyPct}% charge / discharge efficiency`:'battery not assessed'}.</p><p>Required: sunlight ≥{c.minLitPct}%, darkness ≤{c.maxDarkH} h, Earth visibility ≥{c.minLinkPct}%, Earth outage ≤{c.maxGapH} h. Hourly screening at the landing target. RF is excluded; thermal is {c.thermal?'enabled':'not enabled'}. Footprint and height checks remain separate from the nominal verdict.</p></details>

}

export function DecisionEvidence({pair,compact=false,afterVerdict,takeaway,collapsedOriginal}:{pair:DecisionPair;compact?:boolean;afterVerdict?:(label:'A'|'B',result:Evaluated)=>ReactNode;takeaway?:string;collapsedOriginal?:'A'|'B'|null}){

 const geometry=(r:Evaluated)=><dl><dt>Sun / Earth centre visible</dt><dd>{r.litPct.toFixed(1)}% / {r.linkPct.toFixed(1)}%</dd><dt>Longest dark / Earth outage</dt><dd>{r.longestDarkH} h / {r.longestGapH} h</dd></dl>

 const evidence=(label:'A'|'B',r:Evaluated)=><><strong>{r.pass?'Nominal: passes requirements':'Nominal: misses requirements'}</strong><dl><dt>{afterVerdict?`Scenario ${label} minimum battery`:'Minimum battery'}</dt><dd>{r.power?r.power.minPct.toFixed(1)+'%':'Not assessed'}</dd></dl>{compact?<details className="guide-geometry"><summary>Sun/Earth & intervals</summary>{geometry(r)}</details>:geometry(r)}{!r.pass&&<p>Misses: {decisionFailures(r).join(', ')}.</p>}</>

 return <div className="decision-evidence" aria-label="Computed date comparison">{([['A',pair.utcA,pair.a],['B',pair.utcB,pair.b]] as const).map(([label,utc,r])=><article key={label}><h4>{label} · {formatDecisionUTC(utc)}</h4>{r?<>{collapsedOriginal===label?<details className="guide-original"><summary>Original scenario · {r.pass?'passes':'misses'} requirements</summary>{evidence(label,r)}</details>:evidence(label,r)}{afterVerdict?.(label,r)}</>:<p>Complete mission outside cached coverage.</p>}</article>)}<>{collapsedOriginal?<details className="guide-original"><summary>Original date comparison</summary><p className="decision-takeaway">{takeaway??decisionTakeaway(pair)}</p></details>:<p className="decision-takeaway">{takeaway??decisionTakeaway(pair)}</p>}</></div>

}

export function DecisionDebrief({pair,reflection,onChange,onCompare}:{pair:DecisionPair;reflection?:DecisionReflection;onChange:(r:DecisionReflection)=>void;onCompare:()=>void}){

 const labels:Record<DecisionChoice,string>={a:'Choose A',b:'Choose B',either:'Either date',neither:'Neither date'}

 return <section aria-label="Your example landing-date decision"><h4>Your example landing-date decision</h4><p>For the same illustrative lander at this target, which landing date would you choose? If both pass, prefer the date with more margin against its tightest requirement.</p><p>A · {formatDecisionUTC(pair.utcA)}<br/>B · {formatDecisionUTC(pair.utcB)} (+7 days)</p><DecisionAssumptions pair={pair}/>{pair.recommendation===null?<><p>No complete pair is available. Your field observations can still be exported; a date recommendation cannot be assessed.</p><DecisionEvidence pair={pair}/></>:<><div className="decision-choices" role="group" aria-label="Choose a landing date">{(['a','b','either','neither'] as const).map(choice=><button key={choice} aria-pressed={reflection?.choice===choice} onClick={()=>onChange({choice,reason:reflection?.reason??''})}>{labels[choice]}</button>)}</div><label className="decision-reason">Why this choice?<textarea maxLength={280} rows={2} value={reflection?.reason??''} placeholder="What could limit this mission?" onChange={e=>{if(reflection)onChange({...reflection,reason:e.target.value,reviewedUTC:undefined})}} disabled={!reflection}/></label>{!reflection?.reviewedUTC?<button className="tool-button" disabled={!reflection?.reason.trim()} onClick={()=>{if(reflection)onChange({...reflection,reviewedUTC:new Date().toISOString()})}}>Review computed evidence</button>:<><DecisionEvidence pair={pair}/><p>Your choice {reflection.choice===pair.recommendation?'agrees with':'differs from'} the nominal comparison. Your reasoning is retained with the evidence; this is not a landing-safety score.</p><button className="tool-button" onClick={onCompare}>Inspect example dates in planner</button></>}</> }</section>

}

