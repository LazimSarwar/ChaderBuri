import { useState } from 'react'
import type { Horizon } from '../data'
import { SkyChart } from '../SkyChart'
import type { LandingContext } from './comparisonContext'
const angle=(n:number)=>(n>=0?'+':'')+n.toFixed(2)+'°'
export function LandingConditions({context,horizon,missionHours}:{context:LandingContext;horizon:Horizon;missionHours:number}){
 const [chart,setChart]=useState(false)
 if(!context)return <p className="comparison-landing">Landing geometry unavailable outside the cache.</p>
 return <section className="comparison-landing" aria-label="Sun and Earth at landing"><h3>Upcoming horizon crossings</h3>
  {(['sun','earth'] as const).map(body=>{const p=context[body];return <div className="landing-crossing" key={body}><strong>{body==='sun'?'Sun':'Earth'} {p.nextKind}<b>{p.next?(p.next.hours<48?p.next.hours.toFixed(1)+' h':(p.next.hours/24).toFixed(1)+' d'):'Not found'}</b></strong><span>{p.next?`${p.next.atUTC} UTC${p.next.hours>missionHours?' · after mission':''}`:'No future crossing in cached coverage'}</span></div>})}
  <details onToggle={e=>setChart(e.currentTarget.open)}><summary>Local horizon & geometry</summary>
   {(['sun','earth'] as const).map(body=>{const p=context[body];return <p key={body}>{body==='sun'?'Sun':'Earth'} {p.visible?'centre clear':'centre masked'} · clearance {angle(p.clearance)}</p>})}
   <p>Solar disc above skyline: {(context.terrainDiscFraction*100).toFixed(1)}% · uneclipsed disc: {(context.eclipseFraction*100).toFixed(1)}%.</p>
   {chart&&<SkyChart horizon={horizon} sunAz={context.sun.az} sunEl={context.sun.el} earthAz={context.earth.az} earthEl={context.earth.el}/>}
   <p>Observer {horizon.observerHeightAboveGroundM??0} m above ground. Estimated centre crossings from cached directions and terrain; not electrical shutdown times or radio-service guarantees.</p>
  </details>
 </section>
}
