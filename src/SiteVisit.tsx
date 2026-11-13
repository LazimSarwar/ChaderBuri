import type { FootprintScene } from './GuideFootprint'
import { sampleBearing } from './lib/sampleBearing'
import { MissionConsequence } from './MissionConsequence'
import type { Scn } from './architect/comparison'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Compass, MapPin, Mountain, Radio, Ruler, Sun, X, Maximize, Footprints, ArrowUp, ArrowDown, ArrowRight, Check, Flashlight,ScanLine,Flag,Download,Camera,SlidersHorizontal } from 'lucide-react'
import type { Duty, EphRow, Horizon, Site, Mission } from './data'
import { horizonAt } from './data'
import { nextHorizonCrossing } from './lib/attribution'
import { sampleSky } from './lib/science'
import { NasaImagery } from './NasaImagery'
import { explorationHotspots, HORIZONS_SOURCE, LOLA_SOURCE, nextVisitSunset, projectVisit, projectedSunSegments, siteSeparation, visitSunPath, type Hotspot, type VisitPose } from './lib/visit'
import { buildSiteStory } from './siteStories'
import type { TerrainView } from './space/LunarTerrain'
import './visit.css'
import './surface-layout.css'
import './surface-experience.css'
import './lunar-companion.css'
import { SurfaceInteraction } from './SurfaceInteraction'
import { surfaceMission,objectBearing,OUTPOST_POSITION,type SurfaceObject,type SurfaceSelection } from './lib/surfaceMission'
import type { SurfaceFocus } from './lib/surfacePolish'
import { eventJourney,lookTarget,EXPLORATION_RADIUS_M } from './lib/surfaceExplorer'
import { useVisitJourney } from './useVisitJourney'
import { ASTRONAUT_EYE_HEIGHT_M,LUNAR_GRAVITY_MPS2,WALK_SPEED_MPS } from './lib/astronautMotion'
import type { ReactNode } from 'react'
import { fieldNotebook,visitorDistance,MAX_FIELD_FLAGS,type FieldReading,type FieldResult } from './lib/fieldwork'
import { parseRowT } from './lib/sim'
import { MODEL_VERSION } from './modelIdentity'
import { ExpeditionPanel,expeditionProgress,expeditionInputs,type ExpeditionMode,type ExpeditionProps } from './ExpeditionPanel'
import { captureAssignmentCompletion } from './lib/expedition'
import { useRobustnessProducts } from './architect/useRobustness'
import { pendingRobustness } from './architect/robustness'
import { FieldInterface, type FieldContext } from './explore/FieldInterface'

type Props = {
  /** Mission Visor element, shown in the immersive view. */
  visor?:React.ReactNode;visorOn?:boolean
  guidedArrival:boolean
  onOpenCompanion:()=>void
  surfaceFocus:SurfaceFocus|null
  surfaceSelection:SurfaceSelection|null;onSurfaceObject:(object:SurfaceObject,payloadIndex?:number)=>void;onCloseSurfaceObject:()=>void
  site: Site; sites: Site[]; horizon: Horizon; duty: Duty
  sun: { az: number; el: number }; earth: { az: number; el: number }
  sunRows: EphRow[]; earthRows: EphRow[]; epoch: Date; row: number
  heading: number; pitch: number; fov: number; terrain: TerrainView | null; missions: Mission[]
  onFace: (dir: number, pitch?: number) => void; onExit: () => void; onTime: (row: number) => void
  scaleBearing: number | null; onScale: (bearing: number | null) => void
  contrast: boolean; onContrast: (enabled: boolean) => void
  guideEntry?:number;light:boolean;onLight:(enabled:boolean)=>void
  viewpoint:VisitPose;onStep:(forward:number,right:number)=>void;onResetViewpoint:()=>void
  onWalk:(forward:number,right:number)=>void;onJump:()=>void
  datasetId:string;fieldResult:FieldResult|null;lastInspection:FieldReading|null;fieldFlags:FieldReading[];onField:(action:'inspect'|'flag')=>void;onClearFlags:()=>void
} & Pick<ExpeditionProps,'surfacePreferences'|'onSurfacePreferences'|'archiveStatus'|'records'|'photos'|'photoBusy'|'onCapture'|'onPhotoNote'|'onRemovePhoto'|'trailVisible'|'onTrailVisible'|'equipment'|'onEquipment'|'onCompareEquipment'|'panelMissionComparison'|'comparisonCount'|'assignment'|'onAssignment'|'decisionConstraints'|'onDecisionCompare'|'onRepairCompare'|'guide'|'onGuide'|'datasetIndex'|'guideEphemeris'> & {photoError:string;onCrouch:(crouched:boolean)=>void;onHighlightTarget:(show:boolean)=>void}
type Tool = 'activities'|'explore'|'sun'|'measure'|'details'|null
const CARDINALS: Record<number,string>={0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'}
const distance = (m: number) => m<1000 ? `${m.toFixed(0)} m` : `${(m/1000).toFixed(2)} km`
const signed = (n: number) => `${n>=0?'+':''}${n.toFixed(1)}°`

/** A quick tap steps once; a held pointer walks until release/cancel. */
function WalkButton(p:{label:string;forward:number;right:number;children:ReactNode;onWalk:Props['onWalk'];onStep:Props['onStep']}){
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),held=useRef(false),walk=useRef(p.onWalk)
  walk.current=p.onWalk
  const stop=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null}if(held.current)walk.current(0,0)}
  useEffect(()=>{
    const hidden=()=>{if(document.hidden)stop()}
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hidden)
    return()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hidden);stop()}
  },[])
  return <button aria-label={p.label} title="Hold to walk; tap for a 1 m step" onPointerDown={e=>{
    if(e.button!==0)return
    e.currentTarget.setPointerCapture(e.pointerId);held.current=false
    timer.current=setTimeout(()=>{timer.current=null;held.current=true;walk.current(p.forward,p.right)},150)
  }} onPointerUp={stop} onPointerCancel={()=>{stop();held.current=true}} onLostPointerCapture={stop} onClick={e=>{if(e.detail===0||!held.current)p.onStep(p.forward,p.right)}}>{p.children}</button>
}

export type SiteVisitProps = Props
/** The field interface by default; the classic instruments when the visitor chooses them (or no field context is given). */
export function SiteVisit({field,...p}: Props & {field?:FieldContext}) {
  if(field&&p.surfacePreferences.fieldMode)return <FieldInterface {...p} field={field}/>
  return <ClassicSiteVisit {...p}/>
}

function ClassicSiteVisit(p: Props) {
  const [controlsExpanded,setControlsExpanded]=useState(true),[controlActivity,setControlActivity]=useState(0)
  const [briefOpen,setBriefOpen]=useState(!p.guidedArrival)
  useEffect(()=>{if(p.surfaceSelection){setExpeditionMode(null);setFieldMode(null);setTool(null);setBriefOpen(false)}},[p.surfaceSelection?.id])
  const [sampleScene,setSampleScene]=useState<FootprintScene|null>(null),[sceneMission,setSceneMission]=useState<Scn|null>(null)
 const entrySeen=useRef(0)
 const [tool,setTool]=useState<Tool>(null), [active,setActive]=useState('solar')
  const [pathOn,setPathOn]=useState(false), [hotspotsOn,setHotspotsOn]=useState(true)
  const [target,setTarget]=useState('')
  const [immersive,setImmersive]=useState(true),[activity,setActivity]=useState<'sun'|'earth'|'skyline'>('sun')
  const [completed,setCompleted]=useState<string[]>([]),[movesOpen,setMovesOpen]=useState(false)
  const [fullscreenNote,setFullscreenNote]=useState('')
  const [fieldMode,setFieldMode]=useState<'inspect'|'notes'|null>(null)
  const [guided,setGuided]=useState(false)
  const [expeditionMode,setExpeditionMode]=useState<ExpeditionMode|null>(null)
  const guideProducts=useRobustnessProducts(p.datasetIndex,expeditionMode==='journey'?[p.site.slug]:[])
  useEffect(()=>{p.onHighlightTarget(expeditionMode==='assessment'||expeditionMode==='equipment'||expeditionMode==='journey'||expeditionMode==='assignments');if(expeditionMode)setMovesOpen(false);return()=>p.onHighlightTarget(false)},[expeditionMode,p.onHighlightTarget])
  useEffect(()=>{if(p.fieldResult){setFieldMode('inspect');setExpeditionMode(null);setTool(null);setGuided(false);p.onCloseSurfaceObject()}},[p.fieldResult])
  useEffect(()=>{setFieldMode(null);setGuided(false)},[p.site.slug])
  const immersiveRef=useRef(false),ownsFullscreen=useRef(false)
  immersiveRef.current=immersive
  const journey=useVisitJourney(p.row,p.onTime)
  const root=useRef<HTMLDivElement>(null), [size,setSize]=useState({width:1280,height:720})
  const compact=immersive&&p.surfacePreferences.quietHud&&!controlsExpanded
  useEffect(()=>{if(!p.surfacePreferences.quietHud||!controlsExpanded||expeditionMode||fieldMode||p.surfaceSelection)return
    const timer=setTimeout(()=>{if(!root.current?.contains(document.activeElement))setControlsExpanded(false)},4000)
    return()=>clearTimeout(timer)
  },[p.surfacePreferences.quietHud,controlsExpanded,expeditionMode,fieldMode,p.surfaceSelection?.id,controlActivity,p.viewpoint.walking])
  useEffect(()=>{if(p.surfaceSelection)setControlsExpanded(true)},[p.surfaceSelection?.id])
  useEffect(()=>{
    const node=root.current;if(!node)return
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}))
    observer.observe(node);return()=>observer.disconnect()
  },[])
  useEffect(()=>{setTool(null);setActive('solar');setTarget('');setCompleted([]);setActivity('sun')},[p.site.slug])
  useEffect(()=>{
    const exit=()=>{setImmersive(false);if(ownsFullscreen.current&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{});ownsFullscreen.current=false}
    const key=(event:KeyboardEvent)=>{if(document.querySelector('[data-guide-open]'))return;if(event.key==='Escape'&&immersiveRef.current){event.preventDefault();event.stopPropagation();exit()}}
    const changed=()=>{if(ownsFullscreen.current&&!document.fullscreenElement){ownsFullscreen.current=false;setImmersive(false)}}
    document.addEventListener('keydown',key,true);document.addEventListener('fullscreenchange',changed)
    return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('fullscreenchange',changed);if(ownsFullscreen.current&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{})}
  },[])
  const nativeFullscreen=()=>{
    const workspace=root.current?.closest<HTMLElement>('.landsight-workspace')
    setFullscreenNote('')
    if(workspace?.requestFullscreen&&!document.fullscreenElement){ownsFullscreen.current=true;void workspace.requestFullscreen().then(()=>{if(!immersiveRef.current&&document.fullscreenElement===workspace){ownsFullscreen.current=false;return document.exitFullscreen()}}).catch(()=>{ownsFullscreen.current=false;setFullscreenNote('Full screen is unavailable here. Immersive view remains active.')})}
    else if(!document.fullscreenElement)setFullscreenNote('Full screen is unavailable here. Immersive view remains active.')
  }
  const toggleImmersive=()=>{
    setFullscreenNote('')
    if(immersive){setImmersive(false);if(ownsFullscreen.current&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{});ownsFullscreen.current=false}
    else setImmersive(true)
  }
  const ms=p.epoch.getTime()
  const sunUp=p.sun.el>horizonAt(p.horizon,p.sun.az), earthUp=p.earth.el>horizonAt(p.horizon,p.earth.az)
  const crossings=useMemo(()=>({sunset:nextVisitSunset(p.sunRows,new Date(ms),p.horizon),
    sun:nextHorizonCrossing(p.sunRows,new Date(ms),p.horizon,!sunUp),earth:nextHorizonCrossing(p.earthRows,new Date(ms),p.horizon,!earthUp)}),[p.sunRows,p.earthRows,p.horizon,ms,sunUp,earthUp])
  const hotspots=useMemo(()=>explorationHotspots(p.horizon,p.sun,p.earth),[p.horizon,p.sun.az,p.sun.el,p.earth.az,p.earth.el])
  const offset=Math.hypot(p.viewpoint.eastM??0,p.viewpoint.northM??0),atTarget=offset<=.5&&!p.viewpoint.airborne
  const activityTarget=activity==='sun'?p.sun:activity==='earth'?p.earth:{az:hotspots[0].az,el:hotspots[0].el}
  const aim=lookTarget({heading:p.heading,pitch:p.pitch},activityTarget)
  const activityName=activity==='sun'?'Sun direction':activity==='earth'?'Earth direction':'Highest skyline'
  const activityOn=(tool==='activities'||(immersive&&guided))&&!journey.canRestore
  useEffect(()=>{
    if(!activityOn||!aim.centred||completed.includes(activity)||(activity==='skyline'&&!atTarget))return
    const timer=setTimeout(()=>setCompleted(old=>old.includes(activity)?old:[...old,activity]),1200)
    return()=>clearTimeout(timer)
  },[activityOn,aim.centred,activity,completed,atTarget])
  const nearby=useMemo(()=>p.sites.filter(s=>s.slug!==p.site.slug).map(site=>({site,...siteSeparation(p.site,site)})).sort((a,b)=>a.distanceM-b.distanceM),[p.site,p.sites])
  const selectedTarget=nearby.find(s=>s.site.slug===target)??nearby[0]
  const targetSpot:Hotspot|null=selectedTarget?{id:'target',label:`Bearing to ${selectedTarget.site.name}`,az:selectedTarget.bearing,
    el:horizonAt(p.horizon,selectedTarget.bearing),distanceM:selectedTarget.distanceM,source:LOLA_SOURCE,
    description:`${distance(selectedTarget.distanceM)} along a reference lunar sphere. Marker indicates a bearing, not a visible object or a safe traverse.`}:null
  const markers=tool==='measure'&&targetSpot?[targetSpot]:hotspots
  const selected=hotspots.find(h=>h.id===active)??hotspots[0]
  const pose:VisitPose={heading:p.heading,pitch:p.pitch,fov:p.fov}
  const exhibit=surfaceMission(p.site,p.missions),seenExhibit=p.records.some(r=>r.kind==='object'&&r.id.includes(':lander:'))
  const exhibitAz=objectBearing('lander',p.viewpoint),exhibitRange=Math.hypot(OUTPOST_POSITION.eastM-(p.viewpoint.eastM??0),OUTPOST_POSITION.northM-(p.viewpoint.northM??0))
  const exhibitPoint=projectVisit(exhibitAz,Math.atan2((exhibit?4.1:3.1)-(p.viewpoint.eyeHeightM??1.7),Math.max(1,exhibitRange))*180/Math.PI,pose,size.width/size.height)
  const visitObject=(object:SurfaceObject,index?:number)=>{p.onSurfaceObject(object,index);p.onFace(objectBearing(object,p.viewpoint),object==='lander'||object==='payload'?1:-8)}
  const hour=Math.floor(p.row)
  const crossingJourney=eventJourney(p.row,crossings.sun?.hours??null,p.sunRows.length-1)
  const path=useMemo(()=>visitSunPath(p.sunRows,hour,p.horizon),[p.sunRows,hour,p.horizon])
  const segments=pathOn?projectedSunSegments(path,pose,size.width/size.height):[]
  const ticks=Array.from({length:9},(_,i)=>Math.floor(p.heading/15)*15+(i-4)*15)
  const fmtEta=(c:{hours:number}|null)=>!c?'Outside cache':c.hours>=48?`${(c.hours/24).toFixed(1)} d`:`${c.hours.toFixed(1)} h`
  const focus=(spot:Hotspot)=>{setActive(spot.id);p.onFace(spot.az,spot.el+2)}
  const toggle=(next:Exclude<Tool,null>)=>{setTool(t=>t===next?null:next);if(next==='sun')setPathOn(true)}
  const jumpSunset=()=>{
    if(!crossings.sunset)return
    const row=Math.min(p.sunRows.length-1,p.row+crossings.sunset.hours+0.05)
    p.onTime(row);p.onFace(sampleSky(p.sunRows,row).az)
  }
  const watchCrossing=()=>{
    if(!crossingJourney)return
    p.onResetViewpoint();setPathOn(true)
    const sky=sampleSky(p.sunRows,crossingJourney.eventRow)
    p.onFace(sky.az,sky.el)
    journey.start(crossingJourney.startRow,crossingJourney.endRow,`Sun ${sunUp?'setting':'rising'}`)
    setTool(null)
  }
  const story=useMemo(()=>buildSiteStory(p.site,p.duty,p.horizon,p.sites),[p.site,p.duty,p.horizon,p.sites])
  const reading=p.fieldResult?.reading?.siteSlug===p.site.slug?p.fieldResult.reading:null
  const exportFieldNotes=()=>{
    const notes=fieldNotebook(p.site.slug,p.fieldFlags,p.lastInspection,{datasetId:p.datasetId,model:MODEL_VERSION,sceneUTC:p.epoch.toISOString(),exportedUTC:new Date().toISOString()})
    const url=URL.createObjectURL(new Blob([JSON.stringify(notes,null,2)],{type:'application/json'})),link=document.createElement('a')
    link.href=url;link.download=`chader-buri-${p.site.slug}-field-notes.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const fieldAction=(action:'inspect'|'flag')=>{setExpeditionMode(null);setTool(null);setFieldMode('inspect');p.onField(action)}
  const taskSteps=expeditionProgress({...p,flags:p.fieldFlags})
  useEffect(()=>{if(p.assignment&&!p.assignment.completion&&taskSteps.length===4&&taskSteps.every(s=>s.done))p.onAssignment({...p.assignment,completion:captureAssignmentCompletion(p.assignment,expeditionInputs({...p,flags:p.fieldFlags}),{inspection:p.lastInspection,flags:p.fieldFlags,photos:p.photos})})},[p.assignment,taskSteps,p.lastInspection,p.fieldFlags,p.photos,p.viewpoint,p.equipment,p.comparisonCount,p.onAssignment])
  const openExpedition=(mode:ExpeditionMode)=>{p.onCloseSurfaceObject();setFieldMode(null);setGuided(false);setTool(null);setExpeditionMode(mode)}
  const openCompanion=()=>{p.onCloseSurfaceObject();setFieldMode(null);setGuided(false);setTool(null);setExpeditionMode(null);setBriefOpen(false);setControlsExpanded(false);p.onOpenCompanion()}
  const findDirection=(target:'sun'|'earth'|'skyline')=>{setGuided(true);setActivity(target);setFieldMode(null);setExpeditionMode(null);setTool(null)}
  useEffect(()=>{if(p.guideEntry&&p.guide&&!p.guide.ended&&entrySeen.current!==p.guideEntry){entrySeen.current=p.guideEntry;setImmersive(true);setFieldMode(null);setTool(null);setExpeditionMode('journey')}},[p.guideEntry,p.guide])
  const startGuide=()=>{if(p.guide?.ended)p.onGuide({...p.guide,ended:false});if(!p.guide){const originRow=Math.round(p.row);p.onGuide({originRow,step:0,compared:false,source:{datasetId:p.datasetIndex.datasetId,model:p.datasetIndex.model.version}});p.onTime(originRow)}openExpedition('journey')}
  const endGuide=()=>{journey.keep();if(p.guide)p.onTime(p.guide.originRow);p.onGuide(p.guide?.story?{...p.guide,ended:true}:null);openExpedition('menu')}
  const compareDecision=(row:number)=>{journey.keep();p.onTime(row);p.onDecisionCompare(row)}
  const locateTarget=()=>{p.onHighlightTarget(true);if(offset>.5&&p.viewpoint.lat!==undefined&&p.viewpoint.lonEast!==undefined)p.onFace(siteSeparation({lat:p.viewpoint.lat,lonEast:p.viewpoint.lonEast},p.site).bearing,-3)}
  const assessmentLabel=<><MapPin size={12}/><span>Assessment: landing target<small>Analysis {p.horizon.observerHeightAboveGroundM??0} m · camera {offset.toFixed(1)} m away · eye {(p.viewpoint.eyeHeightM??ASTRONAUT_EYE_HEIGHT_M).toFixed(1)} m above feet</small></span></>
  return <div ref={root} className="visit-interface pointer-events-none absolute inset-0 z-20" data-immersive={immersive} data-visor={immersive&&p.visorOn?'on':'off'} data-controls={compact?'compact':'expanded'} onBlurCapture={()=>setControlActivity(v=>v+1)} aria-label="Lunar surface exploration">
    {immersive&&p.surfacePreferences.astronautView&&<div className="surface-visor" aria-hidden="true"/>}
    {immersive&&p.visor}
    {compact&&<div className="surface-calm-bar pointer-events-auto"><span><strong>{p.site.name}</strong><small>{p.epoch.toISOString().slice(0,16).replace('T',' ')} UTC / scene</small></span><button className="tool-button" aria-expanded={false} onClick={()=>setControlsExpanded(true)}>Field controls</button><button className="tool-button surface-calm-light" aria-label="Terrain light" aria-pressed={p.light} onClick={()=>p.onLight(!p.light)}><Flashlight size={16}/></button><button className="surface-calm-target" aria-label="Assessment location: landing target" onClick={()=>{setControlsExpanded(true);openExpedition('assessment')}}>Assessment: landing target</button></div>}
    {immersive&&!expeditionMode&&!fieldMode&&!p.surfaceSelection&&p.surfaceFocus&&<button className="surface-interaction-hint pointer-events-auto" onClick={()=>p.onSurfaceObject(p.surfaceFocus!.object,p.surfaceFocus!.payloadIndex)}><kbd>E</kbd><span>{p.surfaceFocus.label}<small>{p.surfaceFocus.distanceM.toFixed(1)} m / {p.surfaceFocus.object==='panel'||p.surfaceFocus.object==='antenna'?'drag to orient':'click to inspect'}</small></span></button>}
    <div className="visit-experience-bar pointer-events-auto"><span className="visit-session">{immersive?<><strong>{p.site.name}</strong><span className="surface-session-meta"><time>{p.epoch.toISOString().slice(0,16).replace('T',' ')} UTC / scene</time>{p.surfacePreferences.quietHud&&<button className="surface-hide-controls" onClick={()=>setControlsExpanded(false)}>Hide controls</button>}</span></>:'Interactive terrain / cached-date simulation'}</span><div><button className="tool-button visit-light-button" aria-label="Terrain light" aria-pressed={p.light} title="Artificial exploration lighting. Sunlight, visibility and mission results are unchanged." onClick={()=>p.onLight(!p.light)}><Flashlight size={14}/><span>Light {p.light?'on':'off'}<small>Display only</small></span></button><button className="tool-button" title="The restrained field interface: map, Sun & Earth, time, journal and Chader Buri" onClick={()=>p.onSurfacePreferences({...p.surfacePreferences,fieldMode:true})}>Field view</button>{immersive&&<button className="tool-button" onClick={nativeFullscreen}>Full screen</button>}<button className="tool-button" onClick={toggleImmersive}><Maximize size={14}/>{immersive?'Show instruments':'Enter immersive view'}</button></div></div>
    {immersive&&fullscreenNote&&<p className="visit-fullscreen-note" role="status">{fullscreenNote}</p>}
    {immersive&&<nav className="visit-field-actions pointer-events-auto" aria-label="Astronaut exploration tools">
      <button onClick={()=>fieldAction('inspect')}><ScanLine size={14}/>Inspect <kbd>E</kbd></button>
      <button onClick={()=>fieldAction('flag')}><Flag size={14}/>Plant flag <kbd>F</kbd></button>
      <button disabled={p.photoBusy} onClick={p.onCapture} title="Take a photograph; open the journal in Tools"><Camera size={14}/>{p.photoBusy?'Capturing…':`Photo ${p.photos.length}`} <kbd>P</kbd></button>
      <button aria-expanded={!!expeditionMode} onClick={()=>expeditionMode?setExpeditionMode(null):openExpedition('menu')}><SlidersHorizontal size={14}/>Tools {p.assignment?`${taskSteps.filter(s=>s.done).length}/4`:''}</button>
    </nav>}
    {immersive&&<button className="visit-assessment-badge pointer-events-auto" aria-label="Assessment location: landing target" onClick={()=>openExpedition('assessment')}>{assessmentLabel}</button>}
    {p.photoError&&<p className="visit-photo-notice" role="alert">{p.photoError}</p>}
    {immersive&&!journey.canRestore&&!p.surfaceSelection&&!p.surfaceFocus&&exhibitPoint&&exhibitPoint.x>.04&&exhibitPoint.x<.96&&exhibitPoint.y>.28&&exhibitPoint.y<.8&&<button className="surface-landmark" style={{left:exhibitPoint.x*100+'%',top:exhibitPoint.y*100+'%'}} onClick={()=>visitObject('lander')}><ScanLine size={13}/>{exhibit?'Inspect mission exhibit':'Explore field station'}</button>}
    {immersive&&briefOpen&&!expeditionMode&&!fieldMode&&!p.surfaceSelection&&!journey.canRestore&&<section className="surface-brief" aria-label="Field mission briefing"><header>Chader Buri · Field notes<button aria-label="Dismiss field briefing" onClick={()=>setBriefOpen(false)}><X size={14}/></button></header><strong>You’ve reached the surface.</strong><p>Look around the landing site. You can inspect the lander or try pointing a solar panel toward the Sun.</p><button className="tool-button" onClick={openCompanion}>Ask Chader Buri <ArrowRight size={14}/></button><button className="luna-brief-secondary" onClick={()=>visitObject(seenExhibit?'panel':'lander')}>{seenExhibit?'Try the solar panel':'Begin exploration'}</button></section>}
    {p.surfaceSelection&&<SurfaceInteraction selection={p.surfaceSelection} site={p.site} missions={p.missions} equipment={p.equipment} sun={sampleSky(p.sunRows,p.row)} earth={sampleSky(p.earthRows,p.row)} horizon={p.horizon} onEquipment={p.onEquipment} onSelect={visitObject} onClose={p.onCloseSurfaceObject} onCompare={p.onCompareEquipment} panelMissionComparison={p.panelMissionComparison} canCompare={p.row+14*24<=p.sunRows.length-1}/>}
    {expeditionMode&&<ExpeditionPanel {...p} onMissionExhibit={()=>visitObject('lander')} onSampleExplore={(selection,face)=>{if(selection)setSceneMission(null);setSampleScene(selection);if(face&&selection){const point=sampleBearing(selection.samples[selection.selected].terrain,p.viewpoint,p.horizon.siteHeightM);if(point)p.onFace(point.az,point.el)}}} guideProducts={guideProducts[p.site.slug]??pendingRobustness()} mode={expeditionMode} onMode={openExpedition} onClose={()=>setExpeditionMode(null)} flags={p.fieldFlags} sun={sampleSky(p.sunRows,p.row)} earth={sampleSky(p.earthRows,p.row)} comparisonCovered={p.row+14*24<=p.sunRows.length-1} onFind={findDirection} onWatchSun={()=>{setExpeditionMode(null);watchCrossing()}} crossingAvailable={!!crossingJourney&&!journey.journey} onNotes={()=>{setExpeditionMode(null);setFieldMode('notes')}} onStartGuide={startGuide} onEndGuide={endGuide} onDecisionCompare={compareDecision} onRepairCompare={(scenarios,note)=>{journey.keep();p.onTime(p.guide?.originRow??scenarios[0].row);p.onRepairCompare(scenarios,note)}} onLocateTarget={locateTarget} onReturnFace={(az,el)=>{journey.keep();if(p.guide)p.onTime(p.guide.originRow);p.onResetViewpoint();p.onFace(az,el)}} preview={{row:p.row,running:!!journey.journey,progress:journey.progress,canRestore:journey.canRestore,stop:journey.stop,restore:journey.restore,keep:journey.keep}} onPreviewDecision={(window,label,scenario)=>{sampleScene?.close();setSceneMission(scenario??null);p.onResetViewpoint();setPathOn(window.showSunPath??true);const sky=sampleSky(window.target==='earth'?p.earthRows:p.sunRows,window.eventRow);p.onFace(sky.az,sky.el);journey.start(window.startRow,window.endRow,label)}}/>}
    {sceneMission&&journey.canRestore&&<MissionConsequence scenario={sceneMission} row={p.row} sun={p.guideEphemeris.sun} earth={p.guideEphemeris.earth} horizon={p.horizon}/>}
    {sampleScene&&sampleScene.slug===p.site.slug&&<><div className="sample-bearing-note pointer-events-auto">Sample bearings / {sampleScene.selected+1} selected <button aria-label="Hide sample bearings" onClick={()=>sampleScene.close()}>Close</button><small>Indicative positions; terrain can occlude them. Target assessment stays fixed.</small></div>{sampleScene.samples.map((sample,i)=>{const bearing=sampleBearing(sample.terrain,p.viewpoint,p.horizon.siteHeightM),pos=bearing?projectVisit(bearing.az,bearing.el,pose,size.width/size.height):null;if(!pos||pos.x<.03||pos.x>.97||pos.y<.2||pos.y>.85)return null;return <button key={i} className="sample-bearing pointer-events-auto" data-selected={sampleScene.selected===i} data-pass={sample.pass} style={{left:pos.x*100+'%',top:pos.y*100+'%'}} aria-label={`Scene sample ${i+1}, ${sample.pass?'passes':'misses'} sampled requirements`} onClick={()=>sampleScene.select(i)}>{i+1} {sample.pass?'✓':'×'}</button>})}</>}
    <p className="visit-material-note">LOLA relief / illustrative soil, rocks & exhibits</p>
    {fieldMode&&<section className="visit-field-card pointer-events-auto" aria-label={fieldMode==='notes'?'Field notebook':'Terrain inspection'}><header><span>{fieldMode==='notes'?'Field notebook':'Terrain probe · DEM'}</span><button aria-label="Close field tool" onClick={()=>setFieldMode(null)}><X size={16}/></button></header>
      {fieldMode==='inspect'?<>
        <h3>{p.fieldResult?.action==='flag'?'Survey flag':'Ground under the reticle'}</h3>
        <p>{p.fieldResult?.message??'Aim down and press E to inspect the loaded terrain.'}</p>
        {reading&&<><dl><dt>Latitude / longitude</dt><dd>{reading.lat.toFixed(5)}° / {reading.lonEast.toFixed(5)}° E</dd><dt>DEM datum elevation</dt><dd>{reading.elevationM.toFixed(1)} m</dd><dt>Rendered facet slope</dt><dd>{reading.slopeDeg.toFixed(1)}°</dd><dt>Ray range / DEM pixels</dt><dd>{reading.rangeM.toFixed(1)} m / {reading.resolutionM} m</dd></dl><p className="visit-field-scope">Slope comes from the rendered DEM mesh. Grains, rocks, composition and safe routes are not measured.</p></>}
        <button className="tool-button" onClick={()=>fieldAction('inspect')}>Inspect again · E</button><button className="tool-button" onClick={()=>setFieldMode('notes')}>Open field notebook</button>
      </>:<>
        <h3>{p.fieldFlags.length?'Your survey points':'Start a lunar survey'}</h3><span className="visit-count">{p.fieldFlags.length} of {MAX_FIELD_FLAGS} flags saved</span>
        {p.fieldFlags.length===0?<div className="visit-empty-state"><Flag size={22}/><strong>No survey points yet</strong><p>Aim at the ground and press F while standing to mark a point. Use Inspect to read the loaded terrain.</p></div>:<ol>{p.fieldFlags.map((entry,i)=><li key={entry.id}><strong>Flag {i+1}</strong><span>{(visitorDistance(p.viewpoint,entry)??0).toFixed(1)} m from you / {entry.slopeDeg.toFixed(1)}° facet</span><small>{new Date(parseRowT(p.sunRows[0].t).getTime()+entry.sceneRow*3600000).toISOString().slice(0,16).replace('T',' ')} UTC scene</small></li>)}</ol>}
        <p className="visit-field-scope">Your most recent {MAX_FIELD_FLAGS} survey flags across sites. Saved with your expedition journal when device storage is available.</p><p className="archive-status" role="status">{p.archiveStatus}</p>
        <div className="visit-action-group"><button className="tool-button" onClick={()=>fieldAction('inspect')}><ScanLine size={14}/>Inspect terrain</button><button className="tool-button" disabled={!p.fieldFlags.length&&!p.lastInspection} onClick={exportFieldNotes}><Download size={14}/>Export field notes</button>{p.fieldFlags.length>0&&<button className="visit-text-button" onClick={p.onClearFlags}>Clear this site's flags</button>}</div>
      </>}
    </section>}
    {(activityOn||immersive)&&<div className="visit-aim" data-centred={activityOn&&aim.centred} aria-hidden="true"><i/><i/><span/></div>}
    {activityOn&&<section className="visit-activity-guide pointer-events-auto" aria-label="Exploration activity"><button className="visit-free-explore" aria-label="Explore freely" onClick={()=>{setGuided(false);setTool(null)}}><X size={12}/></button><span>{completed.length}/3 directions explored</span><strong>{completed.includes(activity)?'✓ '+activityName+' explored':'Locate: '+activityName}</strong><p>{completed.includes(activity)?'Choose another direction or keep exploring.':activity==='skyline'&&!atTarget?'Return to the landing target for this skyline check.':aim.centred?'Hold the view steady to inspect.':`${Math.abs(aim.horizontal)>3?`Turn ${aim.horizontal>=0?'right':'left'} ${Math.abs(aim.horizontal).toFixed(0)}°`:'Bearing aligned'} · ${Math.abs(aim.vertical)>3?`look ${aim.vertical>=0?'up':'down'} ${Math.abs(aim.vertical).toFixed(0)}°`:'height aligned'}`}</p>{completed.includes(activity)&&completed.length<3&&<button onClick={()=>setActivity((['sun','earth','skyline'] as const).find(id=>!completed.includes(id))!)}>Next direction →</button>}</section>}
    <svg className="visit-sky-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      {segments.map((s,i)=><polyline key={i} points={s.points.map(v=>`${v.x*size.width},${v.y*size.height}`).join(' ')} fill="none" stroke={s.visible?'#efc66d':'#8d9aae'} strokeWidth="2" strokeDasharray={s.visible?'5 5':'2 7'} opacity={s.visible?0.8:0.5}/>) }
      {pathOn&&path.filter((_,i)=>i>0&&i%12===0).map(point=>{
        const pos=projectVisit(point.az,point.el,pose,size.width/size.height)
        if(!pos||pos.x<0.05||pos.x>0.95||pos.y<0.2||pos.y>0.8)return null
        return <g key={point.row} fill={point.visible?'#efc66d':'#9aa7b9'}><circle cx={pos.x*size.width} cy={pos.y*size.height} r="2.5"/><text x={pos.x*size.width+5} y={pos.y*size.height-8} fontSize="10" fontFamily="monospace">+{point.row-hour} h</text></g>
      })}
    </svg>
    {hotspotsOn&&!expeditionMode&&!p.surfaceSelection&&!p.surfaceFocus&&markers.map((spot,i)=>{
      const pos=projectVisit(spot.az,spot.el,pose,size.width/size.height)
      if(!pos||pos.x<0.06||pos.x>0.94||pos.y<0.32||pos.y>0.74)return null
      // Keep HUD and touch targets separate. Nearby bearings may overlap, so stagger labels.
      if(!immersive&&size.width>=768&&pos.x*size.width<390&&pos.y*size.height<340)return null
      return <button key={spot.id} className={`visit-hotspot pointer-events-auto ${active===spot.id?'is-active':''}`} style={{left:`${pos.x*100}%`,top:`${pos.y*100}%`}}
        aria-label={`Explore ${spot.label}`} title={spot.label} onClick={()=>{setActive(spot.id);setTool(tool==='measure'?'measure':'explore')}}>
        <span className="hotspot-dot"><MapPin size={13}/></span><span className="hotspot-label" style={{transform:`translateY(${i%2?22:-26}px)`}}>{spot.label}{!atTarget?' · target bearing':''}</span>
      </button>
    })}
    {immersive&&!fieldMode&&tool==='explore'&&<section className="visit-discovery pointer-events-auto" aria-label="Inspect terrain bearing"><header><span>In the field</span><button aria-label="Close inspection" onClick={()=>setTool(null)}><X size={16}/></button></header><h3>{selected.label}</h3><p>{selected.description}</p>{!atTarget&&<p>Cached skyline at the landing target. Your viewpoint is {offset.toFixed(0)} m away.</p>}<button className="tool-button" onClick={()=>focus(selected)}>Face this bearing</button><a href={selected.source} target="_blank" rel="noreferrer">Source ↗</a></section>}
    <section className="visit-hud pointer-events-auto" aria-label="Surface mission HUD">
      <div className="visit-hud-title"><div><p className="eyebrow"><span className="visit-status-dot"/> Lunar surface · 360°</p><h2>{p.site.name}</h2><time className="visit-epoch" dateTime={p.epoch.toISOString()}>{p.epoch.toISOString().slice(0,16).replace('T',' ')} UTC</time></div><button className="tool-button" aria-label="Return to orbit" title="Return to orbit (Esc)" onClick={p.onExit}><ArrowLeft size={14}/><span>Orbit</span></button></div>
      <button className="visit-assessment-inline" aria-label="Assessment location: landing target" onClick={()=>openExpedition('assessment')}>{assessmentLabel}</button>
      <div className="visit-telemetry">
        <div><span><Compass size={11}/> Heading</span><strong>{Math.round(p.heading).toString().padStart(3,'0')}° <small>{p.pitch>=0?'↑':'↓'}{Math.abs(p.pitch).toFixed(0)}°</small></strong></div>
        <div><span><Sun size={11}/> Sun at target</span><strong className={sunUp?'text-sun':'text-inkdim'}>{signed(p.sun.el)} <small>{sunUp?'clear':'masked'}</small></strong></div>
        <div><span><Radio size={11}/> Earth at target</span><strong className={earthUp?'text-earth':'text-inkdim'}>{earthUp?'Visible':'Masked'}</strong></div>
      </div>
      {offset>.5&&<p className="visit-offset-note">Viewpoint {offset.toFixed(1)} m from target · conditions above remain at the landing coordinate.</p>}
      <nav className="visit-tool-tabs" aria-label="Surface tools">{([['activities','Activities'],['sun','Time'],['explore','Landmarks'],['measure','Measure'],['details','Details']] as const).map(([key,label])=><button key={key} aria-expanded={tool===key} onClick={()=>toggle(key)}>{label}</button>)}</nav>
      {tool&&<div key={tool} className="visit-tool-card">
        <header><span className="eyebrow">{tool==='activities'?'Explore with a purpose':tool==='explore'?'Exploration hotspots':tool==='sun'?'Watch conditions change':tool==='measure'?'Mission context':'Site & sources'}</span><button aria-label="Close surface tool" onClick={()=>setTool(null)}><X size={14}/></button></header>
        {tool==='activities'&&<>
          <p>Drag to look around. Centre each direction in the reticle and hold for a moment.</p>
          <p className="visit-activity-inline">{completed.length}/3 explored · {activityName}<br/>{completed.includes(activity)?'Direction explored':activity==='skyline'&&!atTarget?'Return to the target for this skyline check.':aim.centred?'Hold the view steady':`Turn ${aim.horizontal>=0?'right':'left'} ${Math.abs(aim.horizontal).toFixed(0)}° · look ${aim.vertical>=0?'up':'down'} ${Math.abs(aim.vertical).toFixed(0)}°`}</p>
          <div className="visit-activity-list">{([['sun','Locate the Sun'],['earth','Locate Earth'],['skyline','Inspect the highest skyline']] as const).map(([id,label])=><button key={id} aria-pressed={activity===id} onClick={()=>setActivity(id)}>{completed.includes(id)?<Check size={15}/>:<Compass size={15}/>}<span>{label}</span></button>)}</div>
          <button className="tool-button" onClick={()=>{if(activity==='skyline')p.onResetViewpoint();p.onFace(activityTarget.az,activityTarget.el)}}>{activity==='skyline'&&!atTarget?'Return to target & guide view':'Guide my view'}</button>
          <p>{activity==='sun'?`At the landing coordinate, the Sun centre is ${sunUp?'clear of':'masked by'} the terrain.`:activity==='earth'?`At the landing coordinate, Earth is ${earthUp?'visible above':'masked by'} the terrain. Visibility alone does not establish a radio service.`:hotspots[0].description}</p>
          <button className="visit-text-button" onClick={()=>setCompleted([])}>Restart activities</button>
        </>}
        {tool==='explore'&&<>
          <p className="visit-hint">Select a bearing to inspect the measured skyline.</p>
          <div className="visit-hotspot-list">{hotspots.map(h=><button key={h.id} aria-pressed={h.id===active} onClick={()=>focus(h)}><Mountain size={13}/><span>{h.label}</span><code>{h.az.toFixed(0)}° ↗</code></button>)}</div>
          <h3>{selected.label}</h3><p>{selected.description}</p><a href={selected.source} target="_blank" rel="noreferrer">LOLA data source ↗</a>
          <label className="visit-check"><input type="checkbox" checked={hotspotsOn} onChange={e=>setHotspotsOn(e.target.checked)}/> Show bearing markers</label>
        </>}
        {tool==='sun'&&<>
          <button className="primary-action" disabled={!crossingJourney} onClick={watchCrossing}>Watch the next Sun {sunUp?'set':'rise'} <span>→</span></button>
          <button className="tool-button mt-2" disabled={p.row+24>p.sunRows.length-1} onClick={()=>{p.onResetViewpoint();p.onFace(p.sun.az,p.sun.el);journey.start(p.row,p.row+24,'One Earth day on the Moon');setTool(null)}}>Watch the next 24 hours</button>
          <p>Returns the viewpoint to the target for a 12-second journey through cached predictions. Reduced-motion settings jump to the end. You can stop or restore the starting UTC date.</p>
          <label className="visit-check"><input type="checkbox" checked={pathOn} onChange={e=>setPathOn(e.target.checked)}/> Show next {Math.max(0,(path.at(-1)?.row??hour)-hour)} hours of Sun path</label>
          <p>At the landing target, gold dashes mean the Sun centre clears the cached terrain mask; grey dots mean masked. Hourly predictions; no extrapolation.</p>
          <dl className="visit-facts"><dt>Sun {sunUp?'sets':'rises'}</dt><dd>{fmtEta(crossings.sun)}</dd><dt>Earth {earthUp?'sets':'rises'}</dt><dd>{fmtEta(crossings.earth)}</dd><dt>Next sunset · UTC</dt><dd>{crossings.sunset?.atUTC??'Outside cache'}</dd></dl>
          <button className="primary-action" disabled={!crossings.sunset} onClick={jumpSunset}>View next sunset <span>↗</span></button>
          <button className="tool-button mt-2" onClick={()=>p.onFace(p.sun.az,p.sun.el)}>Face the Sun · {p.sun.az.toFixed(0)}°</button>
          <a href={HORIZONS_SOURCE} target="_blank" rel="noreferrer">JPL Horizons source ↗</a>
        </>}
        {tool==='measure'&&<>
          <dl className="visit-facts"><dt>Camera offset from target</dt><dd>{offset.toFixed(1)} m</dd><dt>Camera latitude / longitude</dt><dd>{p.viewpoint.lat?.toFixed(4)??p.site.lat.toFixed(4)}° / {p.viewpoint.lonEast?.toFixed(4)??p.site.lonEast.toFixed(4)}° E</dd><dt>Sampled camera ground</dt><dd>{p.viewpoint.groundM===undefined?'Unavailable':p.viewpoint.groundM.toFixed(1)+' m datum'}</dd></dl>
          <label className="visit-field">Reference destination<select aria-label="Measurement destination" value={selectedTarget?.site.slug??''} onChange={e=>setTarget(e.target.value)}>{nearby.map(n=><option key={n.site.slug} value={n.site.slug}>{n.site.name}</option>)}</select></label>
          {selectedTarget&&<><dl className="visit-facts"><dt>Surface arc</dt><dd>{distance(selectedTarget.distanceM)}</dd><dt>Initial bearing</dt><dd>{selectedTarget.bearing.toFixed(1)}°</dd><dt>Datum height difference</dt><dd>{selectedTarget.site.siteHeightM!=null&&p.site.siteHeightM!=null?`${(selectedTarget.site.siteHeightM-p.site.siteHeightM).toFixed(0)} m`:'Unavailable'}</dd></dl><p>Distance along a reference lunar sphere, not a rover route. Slope, hazards and traversability are not evaluated.</p><button className="tool-button" onClick={()=>targetSpot&&p.onFace(targetSpot.az,targetSpot.el+2)}>Face destination bearing ↗</button></>}
          <button className="tool-button mt-2" aria-pressed={p.scaleBearing!==null} onClick={()=>p.onScale(p.scaleBearing===null?p.heading:null)}><Ruler size={13}/>{p.scaleBearing===null?'Place 2 m scale ahead':'Remove scale reference'}</button>
          <p>The optional ruler stands 20 m from the observer on sampled ground. It is an illustrative size reference.</p>
        </>}
        {tool==='details'&&<>
          <NasaImagery slug={p.site.slug}/>
          <p>{p.site.note}</p><dl className="visit-facts"><dt>Location</dt><dd>{p.site.lat.toFixed(4)}°, {p.site.lonEast.toFixed(4)}° E</dd><dt>Datum elevation</dt><dd>{p.horizon.siteHeightM.toFixed(0)} m</dd><dt>Elevation pixels</dt><dd>{p.terrain?.resolutionM??'—'} m</dd><dt>Field of view</dt><dd>{p.fov.toFixed(0)}°</dd></dl>
          <p>Measured LOLA relief; illustrative surface colour and display lighting. Eye height {ASTRONAUT_EYE_HEIGHT_M} m above the walking or jumping viewpoint; visibility uses the cached observer horizon at the landing target. The DEM does not resolve individual rocks.</p>
          <label className="visit-check"><input type="checkbox" checked={p.contrast} onChange={e=>p.onContrast(e.target.checked)}/> Enhance surface contrast · display only</label>
          <p className="visit-hint">Drag or swipe to look · scroll to change lens · focus the terrain and use arrow keys to look, + / − to zoom.</p>
          <a href={LOLA_SOURCE} target="_blank" rel="noreferrer">LOLA terrain data ↗</a><a href={HORIZONS_SOURCE} target="_blank" rel="noreferrer">JPL geometry ↗</a>
          {p.missions.filter(m=>m.siteSlug===p.site.slug).map(m=><article key={m.name}><h3>{m.name} · {m.status}</h3><p>{m.note}</p>{m.sourceUrls?.map(url=><a key={url} href={url} target="_blank" rel="noreferrer">Mission source ↗</a>)}</article>)}
          <details><summary>Site facts & measured bearings</summary><p>{story.tag}</p>{story.facts.map((f,i)=><p key={i}>{f}</p>)}{story.look.map((l,i)=><div key={i}><button className="tool-button" onClick={()=>p.onFace(l.dir,horizonAt(p.horizon,l.dir)+2)}>{l.label} · {l.dir.toFixed(1)}° ↗</button><p>{l.text}</p></div>)}{story.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}</details>
        </>}
      </div>}
      <div className="visit-data-status" role="status">{p.terrain?.error?'Terrain unavailable · retry by returning to orbit':!p.terrain?.source||p.terrain.loading?'Refining measured terrain…':`LOLA · ${p.terrain.resolutionM} m pixels`}<span>Analysis {p.horizon.observerHeightAboveGroundM??0} m · {p.viewpoint.crouched?'crouched':'eye '+ASTRONAUT_EYE_HEIGHT_M+' m'}</span></div>
    </section>
    <details className="visit-move pointer-events-auto" open={movesOpen} onToggle={e=>setMovesOpen(e.currentTarget.open)}><summary><Footprints size={15}/>Walk & jump <span>{p.viewpoint.airborne?`↑${(p.viewpoint.heightAboveGroundM??0).toFixed(1)} m`:`${offset.toFixed(0)} m`}</span></summary>
      <output className="visit-motion-state" aria-live="off">{p.viewpoint.airborne?`${(p.viewpoint.verticalMps??0)>0?'Rising':'Descending'} · ${(p.viewpoint.heightAboveGroundM??0).toFixed(1)} m above ground`:p.viewpoint.crouched?'Crouched':p.viewpoint.walking?'Walking':'Grounded'} · {LUNAR_GRAVITY_MPS2} m/s²</output>
      <div className="visit-move-pad"><WalkButton label="Walk forward" forward={1} right={0} onWalk={p.onWalk} onStep={p.onStep}><ArrowUp size={19}/></WalkButton><WalkButton label="Walk left" forward={0} right={-1} onWalk={p.onWalk} onStep={p.onStep}><ArrowLeft size={19}/></WalkButton><button aria-label="Return viewpoint to landing target" onClick={p.onResetViewpoint}><MapPin size={17}/></button><WalkButton label="Walk right" forward={0} right={1} onWalk={p.onWalk} onStep={p.onStep}><ArrowRight size={19}/></WalkButton><WalkButton label="Walk backward" forward={-1} right={0} onWalk={p.onWalk} onStep={p.onStep}><ArrowDown size={19}/></WalkButton></div>
      <button className="visit-jump-action" aria-label="Jump in lunar gravity" disabled={!!p.viewpoint.airborne||!p.terrain?.source} onClick={p.onJump}><ArrowUp size={15}/>{p.viewpoint.airborne?'In flight…':'Jump'}<kbd>Space</kbd></button>
      <button className="visit-jump-action" aria-label={p.viewpoint.crouched?'Stand up':'Crouch'} aria-pressed={!!p.viewpoint.crouched} disabled={!!p.viewpoint.airborne} onClick={()=>p.onCrouch(!p.viewpoint.crouched)}>{p.viewpoint.crouched?'Stand up':'Crouch'}<kbd>C</kbd></button>
      <p>Hold arrows / WASD to walk. Tap arrows for 1 m. Space / Jump to hop.</p><p>{WALK_SPEED_MPS} m/s · {EXPLORATION_RADIUS_M} m radius. Illustrative movement; mission forecasts stay at the target.</p>{p.viewpoint.movementBlocked&&<p role="status">Movement stopped at the exploration boundary or unavailable ground.</p>}
    </details>
    {expeditionMode!=='journey'&&(journey.journey||journey.canRestore)&&<div className="visit-journey pointer-events-auto" role="status"><strong>{journey.journey?journey.journey.label:'Time preview · '+p.epoch.toISOString().slice(0,16).replace('T',' ')+' UTC'}</strong>{journey.journey&&<><progress max={1} value={journey.progress}/><button onClick={journey.stop}>Stop time journey</button></>}<button onClick={journey.restore}>Restore starting date</button><button onClick={journey.keep}>Keep this date</button></div>}
    <div className="visit-navigation pointer-events-auto"><button className="tool-button" onClick={()=>p.onFace(p.sun.az,p.sun.el)}><Sun size={13}/> Sun</button><button className="tool-button" onClick={()=>p.onFace(p.earth.az,p.earth.el)}><Radio size={13}/> Earth</button><button className="tool-button" onClick={()=>p.onFace(0,0)}><Compass size={13}/> North</button></div>
    <div className="visit-compass" aria-label={`Heading ${Math.round(p.heading)} degrees, pitch ${p.pitch.toFixed(0)} degrees`}>
      <div className="visit-compass-track">{ticks.map(b=><span key={b} style={{left:`${50+(b-p.heading)}%`}}><i/>{CARDINALS[((b%360)+360)%360]??'·'}</span>)}<b className="visit-compass-needle"/></div>
      <p>{Math.round(p.heading).toString().padStart(3,'0')}° · {p.pitch.toFixed(0)}° pitch · {p.fov.toFixed(0)}° lens {pathOn?'· Sun path enabled':''}</p>
    </div>
  </div>
}
