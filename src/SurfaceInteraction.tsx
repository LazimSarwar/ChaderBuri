import { useEffect } from 'react'
import { Box,Radio,Sun,X,ExternalLink,ChevronLeft,ChevronRight,Check,Move } from 'lucide-react'
import type { AdjustableEquipment } from './lib/equipmentGesture'
import { setEquipmentAdjust,useEquipmentAdjust } from './space/equipmentAdjust'
import type { Mission,Site,Horizon } from './data'
import { horizonAt } from './data'
import type { Equipment } from './lib/expedition'
import { equipmentAssessment } from './lib/expedition'
import type { SkySample } from './lib/science'
import { surfaceMission,orientEquipment,type SurfaceSelection } from './lib/surfaceMission'
import type { PanelMissionComparison } from './explore/panelComparison'

export function SurfaceInteraction(p:{selection:SurfaceSelection;site:Site;missions:Mission[];equipment:Equipment;sun:SkySample;earth:SkySample;horizon:Horizon;onEquipment:(e:Equipment)=>void;onSelect:(object:SurfaceSelection['object'],index?:number)=>void;onClose:()=>void;onCompare:()=>void;canCompare:boolean;panelMissionComparison?:PanelMissionComparison}){
 const mission=surfaceMission(p.site,p.missions),object=p.selection.object,gear=object==='panel'||object==='antenna',payload=mission?.payloads?.[p.selection.payloadIndex??0],a=equipmentAssessment(p.equipment,p.sun,p.earth,horizonAt(p.horizon,p.sun.az),horizonAt(p.horizon,p.earth.az))
 const change=(dx:number,dy:number)=>{if(gear)p.onEquipment({...p.equipment,...orientEquipment(p.equipment,object,dx,dy)})}
 // "Aim by dragging" belongs to this card's instrument: switching instrument or closing the card ends it.
 const aiming=useEquipmentAdjust()===object
 useEffect(()=>{setEquipmentAdjust(null)},[object])
 useEffect(()=>()=>setEquipmentAdjust(null),[])
 return <section className="visit-field-card surface-object-card pointer-events-auto" aria-label="Mission equipment inspector" data-object={object}>
  <header><span>{gear?'Equipment experiment':mission?'Mission exhibit':'Concept field station'}</span><button onClick={p.onClose} aria-label="Close mission exhibit"><X size={16}/></button></header>
  <h3>{object==='panel'?'Catch the sunlight':object==='antenna'?'Find the Earth':object==='payload'?(payload?.name??'Survey instrument'):(mission?.vehicle??'Lunar field station')}</h3>
  {gear?<>
   <p>Use these controls, or turn on aiming and drag the {object==='panel'?'panel to change its bearing and tilt':'antenna to change its bearing and elevation'} in the scene. Otherwise dragging the view only looks around.</p>
   <button className="tool-button surface-aim-toggle" aria-pressed={aiming} onClick={()=>setEquipmentAdjust(aiming?null:object as AdjustableEquipment)}>{aiming?<><Check size={14}/> Done aiming</>:<><Move size={14}/> Aim by dragging in the scene</>}</button>
   {aiming&&<p className="surface-aim-note" role="status">Aiming on: drag the {object==='panel'?'panel':'antenna'} itself (marked by the gold ring). Dragging anywhere else still looks around.</p>}
   <div className="surface-live-result" aria-live="polite"><strong>{object==='panel'?`${a.watts.toFixed(1)} W`:`${a.pointingErrorDeg.toFixed(1)}°`}</strong><span>{object==='panel'?'modeled solar output':'error from Earth centre'}</span></div>
   <div className="surface-output-gauge" role="img" aria-label={object==='panel'?`Solar output ${a.watts.toFixed(1)} watts`:`Pointing error ${a.pointingErrorDeg.toFixed(1)} degrees`}><i style={{width:`${Math.max(0,Math.min(100,object==='panel'?a.watts/800*100:(1-a.pointingErrorDeg/180)*100))}%`}}/></div>
   <p className="surface-facing-key">Blue arrow: chosen {object==='panel'?'panel facing':'antenna direction'}.</p>
   <div className="surface-adjust"><button aria-label="Rotate equipment left" onClick={()=>change(-20,0)}><ChevronLeft size={18}/></button><span>{(object==='panel'?p.equipment.panelAz:p.equipment.antennaAz).toFixed(0)}° bearing</span><button aria-label="Rotate equipment right" onClick={()=>change(20,0)}><ChevronRight size={18}/></button></div>
   <label className="expedition-range">{object==='panel'?'Panel tilt':'Antenna elevation'}<input aria-label={object==='panel'?'Scene panel tilt':'Scene antenna elevation'} type="range" min={object==='panel'?0:-90} max="90" step="1" value={object==='panel'?p.equipment.panelTilt:p.equipment.antennaEl} onChange={e=>p.onEquipment({...p.equipment,...(object==='panel'?{panelTilt:+e.target.value}:{antennaEl:+e.target.value})})}/></label>
   <button className="tool-button" onClick={()=>p.onEquipment({...p.equipment,...(object==='panel'?{panelAz:p.sun.az,panelTilt:Math.max(0,Math.min(90,90-p.sun.el))}:{antennaAz:p.earth.az,antennaEl:p.earth.el})})}>{object==='panel'?<Sun size={14}/>:<Radio size={14}/>} {object==='panel'?'Point toward the Sun':'Aim at Earth'}</button>
   <p className="visit-field-scope">{object==='panel'?'2 m² / 28% example panel. Instantaneous output; the display lamp adds no power.':`Earth centre is ${a.earthVisible?'above':'below'} the cached terrain horizon. Pointing alone does not establish a radio link.`} Assessment stays at the landing target; walking does not move it.</p>
   <div className="surface-object-tabs"><button onClick={()=>p.onSelect(object==='panel'?'antenna':'panel')}>{object==='panel'?'Try the antenna':'Try the panel'}</button><button onClick={()=>p.onSelect('lander')}>Mission exhibit</button></div>
   {object==='panel'&&<>
    {p.panelMissionComparison&&<><button className="tool-button" disabled={!p.panelMissionComparison.canCompare} onClick={p.panelMissionComparison.onCompare}>Compare with my mission</button><p className="visit-field-scope">{p.panelMissionComparison.missionDays}-day mission from {p.panelMissionComparison.arrivalUTC}. Uses your mission hardware and requirements; compares tracking with this fixed orientation. Your mission stays unchanged.</p>{p.panelMissionComparison.unavailableReason&&<p role="status">{p.panelMissionComparison.unavailableReason}</p>}</>}
    <button className="tool-button" disabled={!p.canCompare} onClick={p.onCompare}>Compare example panel over 14 days</button>
    {!p.canCompare&&<p className="visit-field-scope">Not enough future cache for the complete 14-day example.</p>}
   </>}
  </>:<>
   <p>{object==='payload'?(payload?.purpose??'A visitor-created instrument for investigating sunlight and the Earth direction at this target.'):(mission?`${mission.name} / ${mission.provider}`:'An illustrative station for exploring this candidate landing region.')}</p>
   {object==='payload'&&payload&&<p className="visit-field-scope">{payload.kind} / {payload.agency}{payload.unconfirmed?' / catalogue marks this payload unconfirmed':''}</p>}
   <div className="surface-exhibit-scope"><Box size={16}/><span>Illustrative model & placement</span></div>
   <details className="surface-context"><summary>Model & date context</summary><p className="visit-field-scope">Simplified educational shape and scale. Vehicle condition and hardware positions are not reconstructed. {mission&&<>Catalogue snapshot reviewed {mission.lastReviewed??'date not recorded'}. Mission event dates are separate from the simulated scene date.</>}</p></details>
   {mission?<><div className="surface-payload-list">{(mission.payloads??[]).slice(0,3).map((item,i)=><button key={i} aria-pressed={object==='payload'&&p.selection.payloadIndex===i} onClick={()=>p.onSelect('payload',i)}><span>{item.name}</span><small>{item.kind}</small></button>)}</div>{(mission.payloads?.length??0)>3&&<details className="surface-context" open={object==='payload'&&(p.selection.payloadIndex??0)>=3||undefined}><summary>More instruments / {(mission.payloads?.length??0)-3}</summary><div className="surface-payload-list">{mission.payloads!.slice(3).map((item,j)=><button key={j} aria-pressed={object==='payload'&&p.selection.payloadIndex===j+3} onClick={()=>p.onSelect('payload',j+3)}><span>{item.name}</span><small>{item.kind}</small></button>)}</div></details>}{(object==='payload'?payload?.sourceUrl:mission.sourceUrls?.find(u=>u.includes('nasa.gov')))&&<a className="surface-source" href={object==='payload'?payload?.sourceUrl:mission.sourceUrls?.find(u=>u.includes('nasa.gov'))} target="_blank" rel="noreferrer">Read mission source <ExternalLink size={12}/></a>}</>:<p className="visit-field-scope">No flown mission is assigned to this site in the loaded catalogue. The station and instruments are visitor learning aids.</p>}
   <button className="tool-button" onClick={()=>p.onSelect('panel')}><Sun size={14}/>Start a power experiment</button><button className="tool-button" onClick={()=>p.onSelect('antenna')}><Radio size={14}/>Test the Earth direction</button>
  </>}
 </section>
}
