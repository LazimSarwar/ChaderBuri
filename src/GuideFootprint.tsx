import { useRef,useState,useEffect } from 'react'
import type { DispersionResult,LandingSample } from './architect/dispersion'
import { offsetSky } from './architect/dispersion'
import type { SensitiveDateContext } from './lib/sensitiveDate'
import type { Scn } from './architect/comparison'
import { horizonAt } from './data'
import { decisionFailures } from './lib/explorationDecision'
import { parseRowT } from './lib/sim'

export type FootprintScene={slug:string;row:number;selected:number;samples:{terrain:LandingSample;pass:boolean}[];select:(index:number)=>void;close:()=>void}
export type ExploreSamples=(selection:FootprintScene|null,face?:boolean)=>void
export function GuideFootprint({result,scenario,context,onExplore}:{result:DispersionResult;scenario:Scn;context:SensitiveDateContext;onExplore?:ExploreSamples}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(0),[markers,setMarkers]=useState(false),callback=useRef(onExplore)
 callback.current=onExplore
 useEffect(()=>()=>{callback.current?.(null)},[])
 const point=result.samples[selected],data=context.products.footprint
 if(!point||data.status!=='ready')return null
 const emit=(index:number,face=false)=>{
  setSelected(index)
  callback.current?.({slug:scenario.slug,row:scenario.row,selected:index,samples:result.samples.map(s=>({terrain:s.terrain,pass:s.result.pass})),select:i=>emit(i,true),close:()=>{setMarkers(false);callback.current?.(null)}},face)
 }
 const select=(index:number)=>{setSelected(index);if(markers)emit(index)}
 const sky=(rows:SensitiveDateContext['sun']['rows'])=>offsetSky(rows[scenario.row],data.data.samples[0],point.terrain)
 const sun=sky(context.sun.rows),earth=sky(context.earth.rows)
 const min=Math.min(-3,...point.terrain.profile,sun.el,earth.el),max=Math.max(8,...point.terrain.profile,sun.el,earth.el),y=(el:number)=>58-(el-min)/(max-min)*48
 const utc=new Date(parseRowT(context.sun.rows[0].t).getTime()+scenario.row*3600000).toISOString().slice(0,16).replace('T',' ')
 return <details className="guide-footprint" open={open} onToggle={e=>{setOpen(e.currentTarget.open);if(!e.currentTarget.open){setMarkers(false);callback.current?.(null)}}}><summary>Explore 19 measured samples</summary>{open&&<>
  <p>{utc} UTC · {result.passing}/19 sampled passes. Select a point to learn what changes.</p>
  <svg viewBox="0 0 230 230" role="group" aria-label="Measured footprint samples, north up"><circle cx="115" cy="115" r="90" fill="none" stroke="#6d8793" strokeDasharray="4 4"/><text x="115" y="15" textAnchor="middle">N · 250 m radius</text>{result.samples.map((p,i)=><g key={i} role="button" tabIndex={0} aria-label={`Inspect sample ${i+1}, ${p.result.pass?'passes':'misses'} requirements`} onClick={()=>select(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(i)}}}><circle cx={115+p.terrain.eastM*.36} cy={115-p.terrain.northM*.36} r="11" fill={p.result.pass?'#527d70':'#654e3d'} stroke={i===selected?'#f0f6f5':'#99aab1'} strokeWidth={i===selected?3:1}/><text x={115+p.terrain.eastM*.36} y={119-p.terrain.northM*.36} textAnchor="middle">{i+1}</text></g>)}</svg>
  <label>Sample location<select aria-label="Footprint sample" value={selected} onChange={e=>select(Number(e.target.value))}>{result.samples.map((p,i)=><option key={i} value={i}>Sample {i+1} · {p.result.pass?'passes':'misses'} requirements</option>)}</select></label>
  <p><strong>Sample {selected+1} · {point.result.pass?'passes sampled requirements':'misses sampled requirements'}</strong></p>
  <p>{point.terrain.eastM.toFixed(0)} m east / {point.terrain.northM.toFixed(0)} m north of target<br/>{point.terrain.lat.toFixed(5)}°, {point.terrain.lonEast.toFixed(5)}° E · analysis {point.terrain.observerHeightAboveGroundM??0} m above DEM</p>
  {!point.result.pass&&<p>Misses: {decisionFailures(point.result).join(', ')}.</p>}
  <dl><dt>Minimum battery</dt><dd>{point.result.power?point.result.power.minPct.toFixed(1)+'%':'Not assessed'}</dd><dt>Sun / Earth centre visible</dt><dd>{point.result.litPct.toFixed(1)}% / {point.result.linkPct.toFixed(1)}%</dd><dt>Sun / Earth clearance at landing</dt><dd>{(sun.el-horizonAt(point.terrain,sun.az)).toFixed(2)}° / {(earth.el-horizonAt(point.terrain,earth.az)).toFixed(2)}°</dd></dl>
  <svg viewBox="0 0 280 76" role="img" aria-label={`Sample ${selected+1} terrain skyline with Sun and Earth at landing`}><path d={point.terrain.profile.map((el,i)=>`${i?'L':'M'}${10+i*260/359},${y(el)}`).join(' ')} fill="none" stroke="#b3c6cf"/><circle cx={10+sun.az*260/360} cy={y(sun.el)} r="3" fill="#efd188"/><circle cx={10+earth.az*260/360} cy={y(earth.el)} r="3" fill="#8bc4e0"/><text x="10" y="73">N — E — S — W — N · yellow Sun / blue Earth</text></svg>
  {onExplore&&<button className="tool-button" aria-pressed={markers} onClick={()=>{if(markers){setMarkers(false);callback.current?.(null)}else{setMarkers(true);emit(selected,true)}}}>{markers?'Hide sample bearings':'Show sample bearings in terrain'}</button>}
  <p className="visit-field-scope">This selected sample has its own cached LOLA skyline. Nearby sky directions use a local translation of the target ephemeris. Footprint checks exclude thermal and RF. Scene markers indicate bearings, may be occluded by terrain, and are not safe routes. Walking does not change the planning target.</p>
 </>}</details>
}
