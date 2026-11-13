import type { ExploreSamples } from './GuideFootprint'
import { useEffect,useMemo,useState } from 'react'
import { Camera,Footprints,NotebookPen,Radio,Sun,Target,ArrowLeft,Download } from 'lucide-react'
import type { Site,Horizon,EphRow,Ephemeris } from './data'
import { horizonAt } from './data'
import type { SkySample } from './lib/science'
import { siteSeparation,type VisitPose } from './lib/visit'
import type { FieldReading } from './lib/fieldwork'
import { assignmentSteps,equipmentAssessment,photoMetadata,MAX_JOURNAL_PHOTOS,type JournalPhoto,type Equipment,type Assignment } from './lib/expedition'
import { MODEL_VERSION } from './modelIdentity'
import { buildSeries,type Constraints } from './architect/solver'
import { explorationDecision,type DecisionGuide as Guide } from './lib/explorationDecision'
import { DecisionGuide,type DecisionPreview } from './DecisionGuide'
import { ExpeditionAssignmentReview } from './ExpeditionAssignmentReview'
import { parseRowT } from './lib/sim'
import { buildFailurePreview,type PreviewWindow } from './lib/failurePreview'
import { assessRobustness,type RobustnessProducts } from './architect/robustness'
import type { Scn } from './architect/comparison'
import type { PredictionIndex } from './lib/predictionIndex'
import type { ExpeditionRecord } from './lib/expeditionArchive'
import type { SurfacePreferences } from './lib/surfacePolish'
import { SurfaceDisplayOptions } from './SurfaceDisplayOptions'
import type { PanelMissionComparison } from './explore/panelComparison'

export type ExpeditionMode='menu'|'sky'|'trail'|'journal'|'equipment'|'assignments'|'assessment'|'journey'|'display'
export type ExpeditionProps={
 archiveStatus:string;records:ExpeditionRecord[];onMissionExhibit:()=>void
 surfacePreferences:SurfacePreferences;onSurfacePreferences:(value:SurfacePreferences)=>void
 mode:ExpeditionMode;onMode:(mode:ExpeditionMode)=>void;onClose:()=>void
 site:Site;epoch:Date;row:number;viewpoint:VisitPose;sun:SkySample;earth:SkySample;horizon:Horizon;datasetId:string
 photos:JournalPhoto[];onCapture:()=>void;onPhotoNote:(id:string,note:string)=>void;onRemovePhoto:(id:string)=>void;photoBusy:boolean
 equipment:Equipment;onEquipment:(e:Equipment)=>void;onCompareEquipment:()=>void;comparisonCount:number;comparisonCovered:boolean;panelMissionComparison?:PanelMissionComparison
 assignment:Assignment|null;onAssignment:(run:Assignment|null)=>void;lastInspection:FieldReading|null;flags:FieldReading[]
 trailVisible:boolean;onTrailVisible:(visible:boolean)=>void;onFace:(az:number,el?:number)=>void;onFind:(target:'sun'|'earth'|'skyline')=>void;onWatchSun:()=>void;crossingAvailable:boolean;onNotes:()=>void
 sunRows:EphRow[];earthRows:EphRow[];decisionConstraints:Constraints;onDecisionCompare:(row:number)=>void;onRepairCompare:(scenarios:Scn[],note:string)=>void
 datasetIndex:PredictionIndex;guideEphemeris:{sun:Ephemeris;earth:Ephemeris};guideProducts:RobustnessProducts
 guide:Guide|null;onGuide:(run:Guide|null)=>void;onStartGuide:()=>void;onEndGuide:()=>void;onLocateTarget:()=>void;onReturnFace:(az:number,el:number)=>void
 preview:DecisionPreview;onPreviewDecision:(window:PreviewWindow,label:string,scenario?:Scn)=>void;onSampleExplore:ExploreSamples
}
function JSONDownload({name,value,children}:{name:string;value:unknown;children:React.ReactNode}){
 const contents=JSON.stringify(value,null,2),[url,setURL]=useState('')
 useEffect(()=>{const next=URL.createObjectURL(new Blob([contents],{type:'application/json'}));setURL(next);return()=>URL.revokeObjectURL(next)},[contents])
 return <a className="tool-button" href={url||undefined} aria-disabled={!url} download={name}>{children}</a>
}
export function expeditionInputs(p:Pick<ExpeditionProps,'assignment'|'lastInspection'|'flags'|'photos'|'viewpoint'|'equipment'|'comparisonCount'>){
 return {inspectionId:p.lastInspection?.id??null,flagIds:p.flags.map(f=>f.id),photoIds:p.photos.map(f=>f.id),equipmentPhoto:p.photos.some(f=>!p.assignment?.photoIds.includes(f.id)&&f.equipment.panel),distanceM:p.viewpoint.trailDistanceM??0,targetDistanceM:Math.hypot(p.viewpoint.eastM??0,p.viewpoint.northM??0),airborne:!!p.viewpoint.airborne,equipment:p.equipment,comparisonCount:p.comparisonCount}
}
export function expeditionProgress(p:Pick<ExpeditionProps,'assignment'|'lastInspection'|'flags'|'photos'|'viewpoint'|'equipment'|'comparisonCount'>){
 if(!p.assignment)return []
 return p.assignment.completion?.steps??assignmentSteps(p.assignment,expeditionInputs(p))
}
export function ExpeditionPanel(p:ExpeditionProps){
 const assessment=equipmentAssessment(p.equipment,p.sun,p.earth,horizonAt(p.horizon,p.sun.az),horizonAt(p.horizon,p.earth.az)),steps=expeditionProgress(p)
 const needsDecision=p.mode==='journey'
 const series=useMemo(()=>needsDecision?buildSeries(p.site.slug,p.sunRows,p.earthRows,p.horizon):null,[needsDecision,p.site.slug,p.sunRows,p.earthRows,p.horizon])
 const decisionRow=p.mode==='journey'?(p.guide?.originRow??Math.round(p.row)):(p.assignment?.decisionRow??Math.round(p.row))
 const pair=useMemo(()=>series?explorationDecision(series,decisionRow,parseRowT(p.sunRows[0].t).getTime(),p.decisionConstraints):null,[series,decisionRow,p.sunRows,p.decisionConstraints])
 const failures=useMemo(()=>p.mode==='journey'&&pair&&series?{a:buildFailurePreview(series,pair.a,pair.constraints),b:buildFailurePreview(series,pair.b,pair.constraints)}:null,[p.mode,pair,series])
 const robustness=useMemo(()=>p.mode==='journey'&&p.guide?.step===2&&pair?{a:assessRobustness(p.guideProducts,p.guideEphemeris.sun,p.guideEphemeris.earth,p.horizon,pair.rowA,pair.constraints),b:assessRobustness(p.guideProducts,p.guideEphemeris.sun,p.guideEphemeris.earth,p.horizon,pair.rowB,pair.constraints)}:null,[p.mode,p.guide?.step,pair,p.guideProducts,p.guideEphemeris,p.horizon])
 const faceHome=()=>{if(p.viewpoint.lat!==undefined&&p.viewpoint.lonEast!==undefined)p.onFace(siteSeparation({lat:p.viewpoint.lat,lonEast:p.viewpoint.lonEast},p.site).bearing,0)}
 const setGear=(change:Partial<Equipment>)=>p.onEquipment({...p.equipment,...change})
 return <section className="visit-field-card expedition-panel pointer-events-auto" aria-label="Astronaut tools">
  <header>{p.mode==='menu'?<span>Astronaut tools</span>:<button className="expedition-back" onClick={()=>p.onMode('menu')}><ArrowLeft size={12}/>Tools</button>}<button aria-label="Close astronaut tools" onClick={p.onClose}>×</button></header>
  {p.mode==='menu'&&<><h3>Your field kit</h3><button className="decision-guide-entry" onClick={p.onStartGuide}>{p.guide?'Continue the decision guide':'Why is this landing window difficult?'}<small>Skyline → Sun crossing → landing decision</small></button><p>Choose a tool. Keep exploring in the same view.</p><div className="expedition-menu">
   <button onClick={p.onMissionExhibit}><Target size={16}/><span>Mission exhibit<small>Lander, payloads and hands-on equipment</small></span></button>
   <button onClick={()=>p.onMode('sky')}><Sun size={16}/><span>Observe the sky<small>Find the Sun, Earth or skyline</small></span></button>
   <button onClick={()=>p.onMode('trail')}><Footprints size={16}/><span>Footprints & return trail<small>Trace this excursion back to the target</small></span></button>
   <button onClick={()=>p.onMode('journal')}><Camera size={16}/><span>Photo journal · {p.photos.length}<small>Photographs and observations</small></span></button>
   <button onClick={()=>p.onMode('equipment')}><Radio size={16}/><span>Equipment experiments<small>Orient a panel or antenna at the target</small></span></button>
   <button onClick={()=>p.onMode('assignments')}><Target size={16}/><span>Mission assignments<small>{p.assignment?`${steps.filter(s=>s.done).length}/4 tasks complete`:'Optional scout and power experiments'}</small></span></button>
   <button onClick={p.onNotes}><NotebookPen size={16}/><span>Field notebook · {p.flags.length}<small>Survey flags, readings and exports</small></span></button>
   <button onClick={()=>p.onMode('display')}><Sun size={16}/><span>Exploration view<small>Quiet controls, astronaut view and motion</small></span></button>
  </div></>}
  {p.mode==='display'&&<SurfaceDisplayOptions preferences={p.surfacePreferences} onChange={p.onSurfacePreferences}/>}
  {p.mode==='assessment'&&<><h3>Assessment: landing target</h3><p>{p.site.name} · {p.site.lat.toFixed(5)}° / {p.site.lonEast.toFixed(5)}° E</p><dl><dt>Analysis observer above ground</dt><dd>{p.horizon.observerHeightAboveGroundM??0} m</dd><dt>Camera distance from target</dt><dd>{Math.hypot(p.viewpoint.eastM??0,p.viewpoint.northM??0).toFixed(1)} m</dd><dt>Camera eye above feet</dt><dd>{(p.viewpoint.eyeHeightM??1.7).toFixed(1)} m</dd></dl><p>Sun/Earth conditions, equipment output and mission verdicts use this fixed target and cached analysis height. Walking, crouching and jumping change your view.</p><button className="tool-button" onClick={p.onLocateTarget}>Locate assessment target</button></>}
  {p.mode==='journey'&&p.guide&&pair&&<DecisionGuide key={pair.siteSlug+pair.rowA+JSON.stringify(pair.constraints)} site={p.site} index={p.datasetIndex} onExplore={p.onSampleExplore} repairContext={{series:series!,products:p.guideProducts,sun:p.guideEphemeris.sun,earth:p.guideEphemeris.earth,horizon:p.horizon}} onRepairCompare={(scenarios,note)=>{p.onGuide({...p.guide!,compared:true});p.onRepairCompare(scenarios,note)}} run={p.guide} pair={pair} sunRows={p.sunRows} horizon={p.horizon} preview={p.preview} failures={failures} robustness={robustness} onRun={p.onGuide} onFace={p.onReturnFace} onPreview={p.onPreviewDecision} onCompare={()=>{p.onGuide({...p.guide!,compared:true});p.onDecisionCompare(pair.rowA)}} onEnd={p.onEndGuide}/>}
  {p.mode==='sky'&&<><h3>Observe the sky</h3><p>Find directions yourself, with optional hints.</p><div className="expedition-menu"><button onClick={()=>p.onFind('sun')}>Locate the Sun</button><button onClick={()=>p.onFind('earth')}>Locate Earth</button><button onClick={()=>p.onFind('skyline')}>Inspect the highest skyline</button><button disabled={!p.crossingAvailable} onClick={p.onWatchSun}>Watch the next Sun crossing</button></div></>}
  {p.mode==='trail'&&<><h3>Your return trail</h3><dl><dt>Tracked horizontal distance</dt><dd>{(p.viewpoint.trailDistanceM??0).toFixed(1)} m</dd><dt>Recorded footfalls</dt><dd>{p.viewpoint.trailSteps??0}</dd><dt>Landing target</dt><dd>{Math.hypot(p.viewpoint.eastM??0,p.viewpoint.northM??0).toFixed(1)} m away</dd></dl><label className="visit-check"><input type="checkbox" checked={p.trailVisible} onChange={e=>p.onTrailVisible(e.target.checked)}/>Show return trail</label><button className="tool-button" onClick={faceHome}>Face the landing target</button><p>Bootprints record grounded movement. The line retains the most recent 240 samples; it is a memory aid, not a safe-route assessment. Returning to orbit or resetting starts a new trail.</p><p>Press C or use Walk & jump to crouch for a closer look.</p></>}
  {p.mode==='journal'&&<><h3>Expedition journal</h3><p className="archive-status" role="status">{p.archiveStatus}</p><button className="tool-button" disabled={p.photoBusy} onClick={p.onCapture}><Camera size={13}/>Take photo · P</button><p>Your most recent {MAX_JOURNAL_PHOTOS} photographs, survey flags and discoveries across sites are saved in this browser when storage is available. Photos are stamped as simulations.</p>
   {p.records.length>0&&<details className="expedition-records-wrap"><summary>Exploration record / {p.records.length}</summary><ol className="expedition-records">{[...p.records].reverse().map(r=><li key={r.id}>{r.label}<small>Scene {r.sceneUTC.slice(0,16).replace('T',' ')} UTC</small>{(r.datasetId!==p.datasetId||r.model!==MODEL_VERSION)&&<span className="archive-provenance">Recorded with another data/model snapshot</span>}</li>)}</ol></details>}
   {p.photos.map((photo,i)=><article className="journal-photo" key={photo.id}><img src={photo.imageUrl} alt={`Chader Buri simulated view ${i+1} at ${photo.sceneUTC}`} loading="lazy"/><time>{photo.sceneUTC.slice(0,16).replace('T',' ')} UTC</time>{(photo.datasetId!==p.datasetId||photo.model!==MODEL_VERSION)&&<p className="archive-provenance">Archived image / original data and model retained in export</p>}<textarea aria-label={`Observation for photo ${i+1}`} rows={2} maxLength={280} placeholder="What did you notice?" value={photo.note} onChange={e=>p.onPhotoNote(photo.id,e.target.value)}/><div><a className="tool-button" href={photo.imageUrl} download={`landsight-${p.site.slug}-${photo.id}.jpg`}>Download photo</a><button className="tool-button" onClick={()=>p.onRemovePhoto(photo.id)}>Remove</button></div></article>)}
   {(p.photos.length>0||p.records.length>0)&&<JSONDownload name={`chader-buri-${p.site.slug}-expedition-journal.json`} value={{schemaVersion:2,kind:'landsight-expedition-journal',siteSlug:p.site.slug,datasetId:p.datasetId,model:MODEL_VERSION,records:p.records,flags:p.flags,photos:p.photos.map(photoMetadata)}}><Download size={13}/>Export expedition record</JSONDownload>}
  </>}
  {p.mode==='equipment'&&<><h3>Equipment experiments</h3><p>At the landing target · cached horizon. The simple models stand beside it for illustration; walking elsewhere does not recalculate conditions.</p>
   <label className="visit-check"><input type="checkbox" checked={p.equipment.panel} onChange={e=>setGear({panel:e.target.checked})}/>Deploy a virtual solar panel</label>
   {p.equipment.panel&&<><label className="expedition-range">Panel tilt · {p.equipment.panelTilt.toFixed(0)}°<input aria-label="Panel tilt" type="range" min="0" max="90" value={p.equipment.panelTilt} onChange={e=>setGear({panelTilt:+e.target.value})}/></label><label className="expedition-range">Panel bearing · {p.equipment.panelAz.toFixed(0)}°<input aria-label="Panel bearing" type="range" min="0" max="359" value={p.equipment.panelAz} onChange={e=>setGear({panelAz:+e.target.value})}/></label><button className="tool-button" onClick={()=>setGear({panelAz:p.sun.az,panelTilt:Math.max(0,Math.min(90,90-p.sun.el))})}>Face panel toward the Sun</button><output className="equipment-result">{assessment.watts.toFixed(1)} W <small>At landing target · analysis {p.horizon.observerHeightAboveGroundM??0} m<br/>instantaneous screening · 2 m² / 28%</small></output></>}
   <label className="visit-check"><input type="checkbox" checked={p.equipment.antenna} onChange={e=>setGear({antenna:e.target.checked})}/>Deploy a virtual antenna</label>
   {p.equipment.antenna&&<><label className="expedition-range">Antenna bearing · {p.equipment.antennaAz.toFixed(0)}°<input aria-label="Antenna bearing" type="range" min="0" max="359" value={p.equipment.antennaAz} onChange={e=>setGear({antennaAz:+e.target.value})}/></label><label className="expedition-range">Antenna elevation · {p.equipment.antennaEl.toFixed(1)}°<input aria-label="Antenna elevation" type="range" min="-90" max="90" value={p.equipment.antennaEl} onChange={e=>setGear({antennaEl:+e.target.value})}/></label><button className="tool-button" onClick={()=>setGear({antennaAz:p.earth.az,antennaEl:p.earth.el})}>Aim at Earth</button><output className="equipment-result">{assessment.pointingErrorDeg.toFixed(1)}° pointing error<small>At landing target · Earth centre {assessment.earthVisible?'clear':'masked'} · not a radio link budget</small></output></>}
   <p>Power uses the planner's Sun-disc/eclipse and incidence model. The display lamp adds no solar power. These are editable hardware examples, not flown equipment.</p>
   {p.panelMissionComparison&&<><button className="tool-button" disabled={!p.equipment.panel||!p.panelMissionComparison.canCompare} onClick={p.panelMissionComparison.onCompare}>Compare with my mission</button><p>Uses your selected {p.panelMissionComparison.missionDays}-day mission from {p.panelMissionComparison.arrivalUTC}, preserving its hardware and requirements. Only panel orientation changes; your mission stays unchanged.</p>{p.panelMissionComparison.unavailableReason&&<p role="status">{p.panelMissionComparison.unavailableReason}</p>}</>}
   <button className="tool-button" disabled={!p.equipment.panel||!p.comparisonCovered} onClick={p.onCompareEquipment}>Compare example panel over 14 days</button><p>Example: fixed panel against an ideal tracker, with a 14-day mission, 2 m² / 28% panel, 100 W load and 10 kWh storage.</p>{!p.comparisonCovered&&<p>Not enough future cache for a complete 14-day example.</p>}
  </>}
  {p.mode==='assignments'&&<ExpeditionAssignmentReview {...p} steps={steps}/>}

 </section>
}
