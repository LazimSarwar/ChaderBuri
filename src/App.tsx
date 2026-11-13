import { Departure } from './MoonWalk'
import {ChaderBuriGuide,type GuideMode} from './ChaderBuriGuide'
import { SuitAudio } from './SuitAudio'
import { panelQuestion } from './lib/guideQuestions'
import { readScreen } from './lib/screenDigest'
import { nextRiseHours } from './lib/nextRise'
import type {GuideAction} from './lib/guideAction'
import { decodeJourney,encodeJourney } from './lib/decisionStory'
import { initialWorkspacePanel, startsInSolarSystem, toggleWorkspacePanel, hasWorkspaceDrawer, WORKSPACE_TOOLS, type WorkspacePanel } from './lib/workspace.ts'
import { SiteSelection } from './SiteSelection'
import type { VisitPose } from './lib/visit'
import { sampleSky } from './lib/science.ts'
import { type SiteBundle } from './lib/siteProducts.ts'
import { loadPredictionIndex, indexedOptions, type PredictionIndex } from './lib/predictionIndex.ts'
import { ProgressiveSites, type SiteLoadState } from './lib/progressiveSites.ts'
import './terrain-tools.css'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SimClock } from './Moon'
import { SceneBoundary } from './SceneBoundary'
import { GraphicsFailurePanel } from './GraphicsFailurePanel'
import { classifyFailure, MAX_SCENE_RETRIES, type GraphicsFailure } from './lib/graphicsFailure'
import { probeGraphics } from './space/graphicsProbe'
import { WorkspaceBar } from './WorkspaceBar'
import { DashboardHeader, DashPageHead, MissionBar } from './DashboardHeader'
import { useMissionSummary } from './lib/missionSummary'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
/** "14 Nov 2026 12:00" in UTC, the same form the mission plan uses. */
const fmtMissionUTC = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`
import './dashboard.css'
import './mission-assistance.css'
import './orbit-workspace.css'
import './mission-journey.css'
import { EvidencePanel } from './EvidencePanel'
import { Ribbon } from './Ribbon'
import { Inspector } from './Inspector'
import { Blink } from './Blink'
import { SiteVisit } from './SiteVisit'
import { MissionVisor } from './MissionVisor'
import { useFieldBridge, type MissionLink } from './explore/useFieldBridge'
import type { FieldContext } from './explore/FieldInterface'
import { findArrivalRow } from './explore/fieldMath'
import { createVisitPoseStore } from './explore/visitPoseStore'
import { missionSnapshot, resolveSurfaceMission, type ExplorationMission, type ExplorationProposal } from './explore/missionSession'
import { examplePanelComparison, missionPanelComparison, missionPanelUnavailable, selectedPanelMission, type PanelMissionComparison } from './explore/panelComparison'
import { readSurfaceScreen } from './explore/fieldDigest'
import { LandingHud } from './LandingHud'
import { powerGroup, type VisorInputs } from './lib/visorData'
import type { LandingStage } from './space/LandingSequence'
import { characterState, TALK_MS, POINT_MS } from './lib/characterController'
import { useExpeditionArchive } from './useExpeditionArchive'
import { useLunarCompanion } from './useLunarCompanion'
import type { CompanionContext } from './lib/lunarCompanion'
import { useMissionGuide } from './useMissionGuide'
import { scenarioKey, type MissionState } from './lib/guideBriefs'
import { askAbout, useBriefs, useCompareFocus } from './lib/guideDesk'
import { setDataSnapshot } from './lib/evidence'
import { parseSurfacePreferences,type SurfacePreferences,type SurfaceFocus } from './lib/surfacePolish'
import { appendRecord,type ExpeditionRecord } from './lib/expeditionArchive'
import { surfaceMission,type SurfaceSelection,type SurfaceObject } from './lib/surfaceMission'
import { MODEL_VERSION } from './modelIdentity'
import type { VisitStep } from './lib/surfaceExplorer'
import { appendFlag,type FieldReading,type FieldResult,type FieldRequest } from './lib/fieldwork'
import { DEFAULT_EQUIPMENT,MAX_JOURNAL_PHOTOS,type JournalPhoto,type Equipment,type Assignment } from './lib/expedition'
import type { DecisionGuide } from './lib/explorationDecision'
import { SitesPanel, type Layers } from './SitesPanel'
import { MissionArchitect } from './architect/MissionArchitect'
import { buildSeries, type Constraints } from './architect/solver'
import { REFERENCE, referenceConstraints, referenceHook, referenceRow } from './architect/reference'
import type { Scn } from './architect/ScenarioCompare'
import type { FairSeed } from './MissionCompare'
import { ExplainContext, Glossary } from './Explain'
import { clamp, fmtClock, fmtUTC, parseRowT } from './lib/sim'
import { missionLanded, sunVerdict } from './data'
import type { FlyRequest, SpaceOptions } from './space/ephemeris'
import type { TerrainView } from './space/LunarTerrain'
import {
  horizonAt,
  loadDuty,
  loadEphemeris,
  loadHorizon,
  loadMissions,
  loadSites,
  type Duty,
  type Ephemeris,
  type Horizon,
  type Mission,
  type Site,
} from './data'

type EphPair = Record<'sun' | 'earth', Ephemeris>
const MoonScene = lazy(() => import('./Moon').then(m => ({ default: m.MoonScene })))
const SpaceNavigator = lazy(() => import('./space/SpaceNavigator').then(m => ({default: m.SpaceNavigator})))
const Validation = lazy(() => import('./Validation').then(m => ({ default: m.Validation })))
const MissionCompare = lazy(() => import('./MissionCompare').then(m => ({ default: m.MissionCompare })))
const ViabilityMap = lazy(() => import('./ViabilityMap').then(m => ({ default: m.ViabilityMap })))
const GuidedMissionSetup = lazy(() => import('./GuidedMissionSetup').then(m => ({ default: m.GuidedMissionSetup })))
const MissionGuidePage = lazy(() => import('./MissionGuidePage').then(m => ({ default: m.MissionGuidePage })))
const SpaceWeather = lazy(() => import('./SpaceWeather').then(m => ({ default: m.SpaceWeather })))

type State = {
  catalog: Site[]
  index: PredictionIndex
  sites: Site[]
  missions: Mission[]
  eph: Record<string, EphPair>
  horizons: Record<string, Horizon>
  duty: Record<string, Duty>
  startMs: number
  totalHours: number
}

export default function App({guidedLaunch=false}:{guidedLaunch?:boolean}) {
  // 3D failure state. A browser with no WebGL 2 at all gets the explanation at once and no scene is mounted;
  // otherwise the scene reports its own failures (error boundary, context lost and not restored, data load).
  // (The probe result is the evidence here, so the record carries its text without a meaningless stack.)
  const [graphicsFailure,setGraphicsFailure]=useState<GraphicsFailure|null>(()=>{const probe=probeGraphics();return probe.webgl2?null:classifyFailure('WebGL 2 is unavailable in this browser (probe: no WebGL 2 context)',probe)})
  const graphicsUnavailable=!!graphicsFailure
  const [sceneAttempt,setSceneAttempt]=useState(0),[sceneRetries,setSceneRetries]=useState(0)
  const sceneFailed=useCallback((error:unknown,componentStack?:string)=>{
    // Keep the first failure (the cause); re-probe so "unavailable" is decided by evidence, not by the message.
    setGraphicsFailure(current=>current??{...classifyFailure(error,probeGraphics(true)),...(!(error instanceof Error&&error.stack)&&componentStack?{stack:componentStack.trim().split(/\r?\n/).slice(0,6).join(' | ')}:{})})
  },[])
  // Bounded retry: the failed scene is already unmounted (its WebGL context disposed); a new one mounts in low
  // quality without multisampling. Never automatic, and only while WebGL itself is still available.
  const retryScene=()=>{
    const probe=probeGraphics(true)
    if(!probe.webgl2){setGraphicsFailure(classifyFailure('WebGL 2 is unavailable in this browser (probe: no WebGL 2 context)',probe));return}
    setSceneRetries(n=>n+1);setSceneAttempt(n=>n+1);setGraphicsFailure(null)
  }
  const companion=useLunarCompanion()
  const [guideMode,setGuideMode]=useState<GuideMode>(guidedLaunch?'tour':'icon')
  const [plannerGuide,setPlannerGuide]=useState<{tool:'energy'|'calendar';id:number}|null>(null)
  const [catalogSearch,setCatalogSearch]=useState('')
  const [catalogTab,setCatalogTab]=useState<'sites'|'missions'>('sites')
  // "Ask Chader Buri about this": opens her chat with a question that is sent once (one request).
  const [buriSeed,setBuriSeed]=useState<{id:number;text:string}|null>(null)
  const askBuri=(text:string)=>{setBuriSeed({id:Date.now(),text});changeGuide('chat')}
  const changeGuide=(mode:GuideMode)=>{
    if(mode==='chat')stopPlayback()
    setGuideMode(mode)
  }
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [siteSlug, setSiteSlug] = useState<string | null>(null)
  const [uiRow, setUiRow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [realtime, setRealtime] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [speed, setSpeed] = useState(600)
  const [layers, setLayers] = useState<Layers>({
    labels: true,
    craters: false,
    graticule: false,
    sunPath: false,
    smoothMoon: false,
  })
  const [missionIdx, setMissionIdx] = useState<number | null>(null)
  const [startInOverview] = useState(()=>startsInSolarSystem(window.location.search,window.location.hash,guidedLaunch))
  const overviewHeading=useRef<HTMLHeadingElement>(null)
  const entryFocused=useRef(false)
  useEffect(()=>{
    if(!state||!startInOverview||entryFocused.current)return
    let observer:MutationObserver|undefined
    const focusEntry=()=>{
      const heading=overviewHeading.current
      if(!heading||heading.closest('[inert]')||document.querySelector('.moon-opening'))return
      // Do not steal focus if the visitor has already chosen a control.
      if(document.activeElement===document.body)heading.focus({preventScroll:true})
      entryFocused.current=true
      observer?.disconnect()
    }
    focusEntry()
    if(!entryFocused.current){observer=new MutationObserver(focusEntry);observer.observe(document.body,{childList:true,subtree:true})}
    return()=>observer?.disconnect()
  },[!!state,startInOverview])
  const [fly, setFly] = useState<FlyRequest | null>(()=>startInOverview?{body:'Sun',overview:true,instant:true,key:0}:null)
  const [bodyFocus, setBodyFocus] = useState(startInOverview?'Solar system':'Moon')
  const [spaceOptions, setSpaceOptions] = useState<SpaceOptions>({orbits: startInOverview, names: true, enhanced: true, deepSky: true, inspectionLight: false, terrainContrast: true})
  const [panel,setPanel] = useState<WorkspacePanel>(()=>initialWorkspacePanel(window.location.search,window.location.hash))
  const architectOpen = panel === 'plan', evidenceOpen = panel === 'evidence', compareOpen = panel === 'compare'
  const [plannerVisited,setPlannerVisited]=useState(false)
  const missionSummary=useMissionSummary()
  // The mission plan is the dashboard's source of truth (its summary shows on every page), so it loads with the dashboard.
  useEffect(()=>{if(hasWorkspaceDrawer(panel))setPlannerVisited(true)},[panel])
  const [compareB,setCompareB] = useState<string|undefined>()
  const [visitPending,setVisitPending] = useState(false)
  const [arrival,setArrival] = useState<number|null>(null)
  const [scaleBearing,setScaleBearing] = useState<number|null>(null)
  const drawerOpen = hasWorkspaceDrawer(panel)
  const closePanel = () => {selectionRequest.current++;setPendingSite(null);if(visitPending)exitVisit();setPanel(null)}
  const openSupport = (page: 'setup' | 'guide' | 'weather') => { stopPlayback(); changeGuide('icon'); setPanel(page) }
  useEffect(()=>{
    const onHash=()=>{if(window.location.hash==='#/validation')setPanel('validation')}
    window.addEventListener('hashchange',onHash)
    return()=>window.removeEventListener('hashchange',onHash)
  },[])
  const [terrainView,setTerrainView]=useState<TerrainView|null>(null)
  const [loadWarning,setLoadWarning]=useState<string|null>(null)
  const [siteLoads,setSiteLoads]=useState<Record<string,SiteLoadState>>({})
  const [pendingSite,setPendingSite]=useState<Site|null>(null)
  const loaderRef=useRef<ProgressiveSites|null>(null)
  const selectionRequest=useRef(0)
  const [missionWindow, setMissionWindow] = useState<{ slug: string; startRow: number; endRow: number } | null>(
    null,
  )
  // surface-visit mode: non-null while the observer stands on a site
  const [visitLook, setVisitLook] = useState<VisitPose | null>(null)
  const [visitPoseStore] = useState(createVisitPoseStore)
  const [visitStep,setVisitStep]=useState<VisitStep|null>(null)
  // Field interface: the scene bridge (DEM sampler, guided walks, pointer lock, pause) and the dashboard mission a visit came from.
  const fieldBridge=useFieldBridge()
  const [missionLink,setMissionLink]=useState<MissionLink|null>(null)
  const [fieldMission,setFieldMission]=useState<ExplorationMission|null>(null)
  const [fieldProposal,setFieldProposal]=useState<ExplorationProposal|null>(null)
  const [headsetPreviewOn,setHeadsetPreviewOn]=useState(false)
  const [fieldRequest,setFieldRequest]=useState<FieldRequest|null>(null),[fieldResult,setFieldResult]=useState<FieldResult|null>(null),[fieldFlags,setFieldFlags]=useState<FieldReading[]>([])
  const [fieldInspections,setFieldInspections]=useState<Record<string,FieldReading>>({})
  const [photos,setPhotos]=useState<JournalPhoto[]>([]),photoStore=useRef<JournalPhoto[]>([])
  photoStore.current=photos
  useEffect(()=>()=>{photoStore.current.forEach(p=>URL.revokeObjectURL(p.imageUrl))},[])
  const [photoRequest,setPhotoRequest]=useState(0),[photoBusy,setPhotoBusy]=useState(false),[photoError,setPhotoError]=useState('')
  const [trailVisible,setTrailVisible]=useState(false)
  const [surfaceEquipment,setSurfaceEquipment]=useState<Record<string,Equipment>>({})
  const [assignments,setAssignments]=useState<Record<string,Assignment|null>>({})
  const [surfaceSelection,setSurfaceSelection]=useState<SurfaceSelection|null>(null)
  const [surfaceFocus,setSurfaceFocus]=useState<SurfaceFocus|null>(null)
  const [surfacePreferences,setSurfacePreferences]=useState<SurfacePreferences>(()=>{try{return parseSurfacePreferences(JSON.parse(localStorage.getItem('landsight-surface-view-v1')??'null'))}catch{return parseSurfacePreferences(null)}})
  const onVisitPose = useCallback((pose: VisitPose | null) => {
    const surfaceChanged = visitPoseStore.publish(pose)
    // Field telemetry is consumed by the HUD/visor/audio leaves. Keep the classic view's behaviour.
    if (surfaceChanged || !surfacePreferences.fieldMode) setVisitLook(pose)
    if (surfaceChanged && pose) {
      setVisitPending(false)
      setPanel(current => current === 'selection' ? null : current)
    }
  }, [visitPoseStore, surfacePreferences.fieldMode])
  const onVisitFocus = useCallback((focus: SurfaceFocus | null) => {
    visitPoseStore.publishFocus(focus)
    if (!surfacePreferences.fieldMode) setSurfaceFocus(focus)
  }, [visitPoseStore, surfacePreferences.fieldMode])
  useEffect(() => { if (!visitLook) visitPoseStore.publish(null) }, [!!visitLook, visitPoseStore])
  useEffect(() => {
    if (!surfacePreferences.fieldMode) {
      const pose = visitPoseStore.getSnapshot()
      if (pose) setVisitLook(pose)
      setSurfaceFocus(visitPoseStore.getFocusSnapshot())
    }
  }, [surfacePreferences.fieldMode, visitPoseStore])
  useEffect(()=>{try{localStorage.setItem('landsight-surface-view-v1',JSON.stringify(surfacePreferences))}catch{}},[surfacePreferences])
  const [expeditionRecords,setExpeditionRecords]=useState<ExpeditionRecord[]>([])
  const journal=useExpeditionArchive({slugs:state?.catalog.map(s=>s.slug)??[],photos,flags:fieldFlags,inspections:fieldInspections,records:expeditionRecords,equipment:surfaceEquipment,setPhotos,setFlags:setFieldFlags,setInspections:setFieldInspections,setRecords:setExpeditionRecords,setEquipment:setSurfaceEquipment})
  const [equipmentComparisons,setEquipmentComparisons]=useState<Record<string,number>>({})
  const [decisionGuides,setDecisionGuides]=useState<Record<string,DecisionGuide|null>>({})
  const [guideEntry,setGuideEntry]=useState<{slug:string;id:number}|null>(null)
  const restoredGuides=useRef(false),[guidesReady,setGuidesReady]=useState(false)
  const [highlightAssessment,setHighlightAssessment]=useState(false)
  const explorationConstraints=useMemo(referenceConstraints,[])
  // Beginner layer: captions under the decision numbers, and a glossary that
  // any underlined term opens. Persisted per browser; off by default so the
  // expert view stays unchanged.
  const [explain, setExplain] = useState(() => { try { return localStorage.getItem('landsight.explain') === '1' } catch { return false } })
  const [glossary, setGlossary] = useState<string | null>(null)
  const explainCtx = useMemo(() => ({ explain, define: (id?: string) => {setGlossary(id ?? 'all');setPanel('glossary')} }), [explain])
  useEffect(() => { try { localStorage.setItem('landsight.explain', explain ? '1' : '0') } catch { /* private mode */ } }, [explain])
  // The hook on the first screen: the reference mission and its twin one week
  // later, evaluated live so the card quotes the data, never a remembered result.
  const [compareSeed, setCompareSeed] = useState<{ key: number; scns: Scn[];note?:string;preserveMission?:boolean } | null>(null)
  // Fair comparison seed (Compare page) and a site + landing handed back to the mission plan.
  const [fairSeed,setFairSeed]=useState<FairSeed|null>(null)
  const [planSelect,setPlanSelect]=useState<{key:number;slug:string;row:number;constraints?:Constraints}|null>(null)
  const [setupDraft,setSetupDraft]=useState<MissionState|null>(null)
  // Chader Buri's mission jobs: explain, locate, compare and act (with Undo) on the selected mission.
  const missionGuide=useMissionGuide({sites:state?.sites??[],eph:state?.eph??{},horizons:state?.horizons??{},startMs:state?.startMs??0,mission:missionSummary,
    apply:s=>setPlanSelect({key:Date.now(),slug:s.slug,row:s.row,constraints:s.c}),
    compare:seed=>{setFairSeed({key:Date.now(),...seed});setPanel('compare')},openPlan:()=>setPanel('plan'),screen:panel})
  // The data snapshot every evidence panel names (dataset, model, coverage, observer height).
  if(state)setDataSnapshot({datasetId:state.index.datasetId,model:state.index.model.version,observerHeightM:state.index.analysisObserverHeightM,coverageStart:state.index.coverage.start,coverageEnd:state.index.coverage.stop})
  // Any new explanation opens her chat so it is seen.
  const briefs=useBriefs()
  const compareFocus=useCompareFocus()
  // Site conditions on the dashboard follow your mission by default; the 3D scene is the other choice.
  const [conditionsOn,setConditionsOn]=useState<'mission'|'scene'>('mission')
  useEffect(()=>{if(briefs.length)changeGuide('chat')},[briefs.at(-1)?.id])
  const hook = useMemo(() => {
    const e = state?.eph[REFERENCE.slug], h = state?.horizons[REFERENCE.slug]
    if (!state || !e || !h) return null
    try { return referenceHook(buildSeries(REFERENCE.slug, e.sun.rows, e.earth.rows, h), state.startMs) } catch { return null }
  }, [state])
  const openHook = () => {
    if (!hook) return
    setCompareSeed({ key: Date.now(), scns: [
      { id: 0, slug: REFERENCE.slug, row: hook.rowA, c: referenceConstraints() },
      { id: 1, slug: REFERENCE.slug, row: hook.rowB, c: referenceConstraints() },
    ] })
    setPanel('plan')
  }
  const openQuickComparison=()=>{
    // One comparison page for sites and dates: the fair one, with the mission plan's lander for both options.
    if(!state||state.sites.length<2)return
    clock.current.playing=false;clock.current.realtime=false;setPlaying(false);setRealtime(false)
    setFairSeed({key:Date.now(),mode:'sites',slug:missionSummary?.slug??siteSlug??undefined,row:missionSummary?.row});setPanel('compare')
  }


  const clock = useRef<SimClock>({ row: 0, playing: false, speed: 600, direction: 1 })
  const stateRef = useRef<State | null>(null)
  stateRef.current = state
  const siteSlugRef = useRef<string | null>(null)
  siteSlugRef.current = siteSlug
  const selectSiteRef = useRef<(slug: string) => void>(() => {})

  // The selected site opens first. Other indexed sites join the same workspace
  // through a bounded queue; no slow background request gates the first scene.
  useEffect(() => {
    const abort=new AbortController();let active=true,initialized=false
    const bootstrapTimer=setTimeout(()=>{if(active&&!initialized){abort.abort();loaderRef.current?.stop();setError('Startup timed out. Retry on a working connection.')}},30000)
    void (async()=>{
      try {
        const index=await loadPredictionIndex({signal:abort.signal})
        const shared=new URLSearchParams(window.location.search)
        if((shared.get('dataset')&&shared.get('dataset')!==index.datasetId)||(shared.get('model')&&shared.get('model')!==index.model.version))setLoadWarning('This link used a different data or model snapshot. Results are recalculated with the currently loaded products; inspect the export for the original snapshot.')
        const [catalog,missions]=await Promise.all([
          loadSites(indexedOptions(index,'/data/sites.json',abort.signal)),
          loadMissions(indexedOptions(index,'/data/missions.json',abort.signal)).catch(()=>[] as Mission[]),
        ])
        const params=new URLSearchParams(window.location.search)
        // "Explore with Chader Buri" arrives at Malapert Massif unless the link names a site.
        const preferred=catalog.find(s=>s.slug===params.get('site'))??(guidedLaunch?catalog.find(s=>s.slug==='malapert-massif'):undefined)??catalog[0]
        const startMs=Date.parse(index.coverage.start),totalHours=index.coverage.samples
        const publish=(bundle:SiteBundle)=>{
          if(!active)return
          const slug=bundle.site.slug
          if(!initialized){
            initialized=true
            clearTimeout(bootstrapTimer)
            if(slug!==preferred.slug)setLoadWarning(`${preferred.name} could not load; opened ${bundle.site.name}. Unavailable sites can be retried.`)
            else if(!missions.length)setLoadWarning('Mission history is unavailable. Supported site predictions and planning remain available.')
            let row=clamp((Date.now()-startMs)/3_600_000,0,totalHours-1)
            const t=Number(params.get('t'));if(params.has('t')&&Number.isFinite(t)&&t>=0)row=clamp(t,0,totalHours-1)
            clock.current.row=row;setUiRow(row);setSiteSlug(slug)
            if(guidedLaunch){
              // Arrive when the Sun and Earth both stand above the measured horizon (searching up to 45 days ahead),
              // preferring a time when the Sun is at least 5° clear of the skyline so the ground is lit.
              const clear=findArrivalRow(bundle.eph.sun.rows,bundle.eph.earth.rows,bundle.horizon,row,{preferSunClearanceDeg:5})
              if(clear!==null){row=clear;clock.current.row=row;setUiRow(row)}
              setVisitPending(true)
              const ridge=Math.max(...bundle.horizon.profile)
              setFly({body:'Moon',lat:bundle.site.lat,lon:bundle.site.lonEast,visit:true,
                visitHeading:bundle.horizon.profile.indexOf(ridge),visitPitch:Math.min(15,Math.max(-5,ridge-2)),key:Date.now()})
            }
            if(!startInOverview&&!guidedLaunch&&!params.has('t')&&!['plan','evidence'].includes(params.get('view')??'')){
              clock.current.playing=true;clock.current.speed=3600;clock.current.direction=1;setPlaying(true);setSpeed(3600)
            }
            if(params.get('c')==='1'&&catalog.some(s=>s.slug===params.get('b')))setCompareB(params.get('b')!)
            setState({catalog,index,sites:[bundle.site],missions,eph:{[slug]:bundle.eph},horizons:{[slug]:bundle.horizon},duty:{[slug]:bundle.duty},startMs,totalHours})
          }else setState(previous=>{
            if(!previous)return previous
            const eph={...previous.eph,[slug]:bundle.eph}
            return {...previous,eph,horizons:{...previous.horizons,[slug]:bundle.horizon},duty:{...previous.duty,[slug]:bundle.duty},sites:catalog.filter(s=>!!eph[s.slug])}
          })
        }
        const loader=new ProgressiveSites(catalog,async site=>{
          const options={index,signal:abort.signal}
          const [eph,horizon,duty]=await Promise.all([loadEphemeris(site.slug,options),loadHorizon(site.slug,options),loadDuty(site.slug,options)])
          return {site,eph,horizon,duty}
        },index,publish,(slug,status)=>{if(active)setSiteLoads(old=>({...old,[slug]:status}))})
        loaderRef.current=loader
        let firstError:unknown
        for(const candidate of [preferred,...catalog.filter(s=>s.slug!==preferred.slug)]){
          try{await loader.request(candidate.slug);break}catch(error){firstError=error}
        }
        if(!initialized)throw firstError??new Error('No supported site could be loaded')
        if(active)loader.prefetch()
      }catch(error){if(active)setError(abort.signal.aborted?'Startup timed out. Retry on a working connection.':String(error));clearTimeout(bootstrapTimer)}
    })()
    return()=>{active=false;clearTimeout(bootstrapTimer);abort.abort();loaderRef.current?.stop();loaderRef.current=null}
  }, [])

  // simulation clock
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now
      const st = state
      if (st && clock.current.realtime) {
        clock.current.row = clamp((Date.now() - st.startMs) / 3_600_000, 0, st.totalHours - 1)
      } else if (st && clock.current.playing) {
        clock.current.row +=
          (dt * clock.current.speed * clock.current.direction) / 3600
        if (clock.current.row >= st.totalHours - 1) {
          clock.current.row = st.totalHours - 1
          clock.current.playing = false
          setPlaying(false)
        }
        if (clock.current.row <= 0) {
          clock.current.row = 0
          clock.current.playing = false
          setPlaying(false)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])

  const fieldUiTiming = useRef({ active: false, last: 0 })
  fieldUiTiming.current.active = !!visitLook && surfacePreferences.fieldMode && panel === null
  useEffect(() => {
    const id = setInterval(() => {
      const timing = fieldUiTiming.current, now = performance.now()
      // The 3D clock remains continuous. Surface text only needs 1 Hz in Now mode, 4 Hz in fast playback.
      // Dashboard and orbital UI retain their existing 80 ms refresh; direct time changes are immediate.
      const interval = timing.active ? clock.current.realtime ? 1000 : 250 : 80
      if (now - timing.last < interval) return
      timing.last = now
      setUiRow(clock.current.row)
    }, 80)
    return () => clearInterval(id)
  }, [])

  const setRow = (r: number) => {
    if (!state) return
    clock.current.realtime = false
    setRealtime(false)
    clock.current.row = clamp(r, 0, state.totalHours - 1)
    setUiRow(clock.current.row)
  }
  // Stable callbacks for the memoised time ribbon: on the surface the App re-renders on every pose report, and the
  // ribbon (hundreds of hour cells) would otherwise re-render each time although nothing it shows has changed.
  const setRowLatest=useRef(setRow);setRowLatest.current=setRow
  const ribbonSetRow=useCallback((r:number)=>setRowLatest.current(r),[])
  const clearMissionWindow=useCallback(()=>setMissionWindow(null),[])

  // keep the URL in sync (bucketed so playback doesn't spam replaceState)
  const lastUrlRef = useRef('')
  useEffect(() => {
    if (!state || !siteSlug) return
    const p = new URLSearchParams(window.location.search)
    p.set('site', siteSlug)
    p.set('t', String(Math.round(uiRow * 3600) / 3600))
    if (compareOpen) {
      p.set('c', '1')
      if (compareB) p.set('b', compareB)
    } else { p.delete('c'); p.delete('b') }
    if (panel && panel !== 'selection') p.set('view',panel)
    else p.delete('view')
    const hash = panel === 'validation' ? '#/validation' : window.location.hash === '#/validation' ? '' : window.location.hash
    const url = `${window.location.pathname}?${p.toString()}${hash}`
    if (url !== lastUrlRef.current) {
      lastUrlRef.current = url
      window.history.replaceState(null, '', url)
    }
  }, [state, siteSlug, uiRow, compareB, panel])
  const togglePlay = () => {
    clock.current.realtime = false
    setRealtime(false)
    clock.current.playing = !clock.current.playing
    setPlaying(clock.current.playing)
  }
  const changeSpeed = (v: number) => {
    clock.current.speed = v
    setSpeed(v)
  }
  const orbitPlayback = (speed: number) => {
    clock.current.realtime = false
    clock.current.speed = speed
    clock.current.direction = 1
    // Choosing a camera view must not start a paused simulation.
    setRealtime(false);setSpeed(speed);setReverse(false)
  }
  const toggleReverse = () => {
    clock.current.direction = clock.current.direction === 1 ? -1 : 1
    setReverse(clock.current.direction === -1)
  }
  const goLive = () => {
    if (!state) return
    const hour = (Date.now() - state.startMs) / 3_600_000
    const covered = hour >= 0 && hour <= state.totalHours - 1
    setRow(clamp(hour, 0, state.totalHours - 1))
    clock.current.realtime = covered
    clock.current.playing = false
    setPlaying(false)
    setRealtime(covered)
  }


  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(guideMode==='tour')return
      if(e.key==='Escape'&&document.querySelector('[data-guide-open]'))return
      if(e.key==='Escape' && !architectOpen){if(panel)closePanel();else if(visitLook)exitVisit();return}
      // On the surface the scene owns the keys (walk, jump, look, photo); dashboard shortcuts wait for the dashboard.
      if(visitLook&&!hasWorkspaceDrawer(panel))return
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)) return
      if (panel === 'validation') return
      if (e.key === 'a' || e.key === 'A') {
        setPanel(p=>toggleWorkspacePanel(p,'plan'))
        return
      }
      // the Architect is a full overlay: keep scene shortcuts from firing behind it
      if (architectOpen || evidenceOpen) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowRight') setRow(clock.current.row + 1)
      else if (e.code === 'ArrowLeft') setRow(clock.current.row - 1)
      else if (e.key === 'n' || e.key === 'N') goLive()
      else if (e.key === 'r' || e.key === 'R') toggleReverse()
      else if (e.key === 'm' || e.key === 'M') { /* view mode removed */ }
      else if (/^[1-9]$/.test(e.key)) {
        const s = state?.sites[Number(e.key) - 1]
        if (s) selectSiteRef.current(s.slug)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, panel, !!visitLook, guideMode])

  const site = state?.sites.find((s) => s.slug === siteSlug) ?? null
  const horizon = siteSlug ? state?.horizons[siteSlug] ?? null : null

  // smooth-Moon comparison mode: swap the LOLA mask for a flat horizon so
  // verdicts show what a featureless sphere would predict
  const effHorizon = useMemo(
    () =>
      horizon && layers.smoothMoon
        ? { ...horizon, profile: new Array(360).fill(0) as number[] }
        : horizon,
    [horizon, layers.smoothMoon],
  )

  const duty = siteSlug ? state?.duty[siteSlug] ?? null : null
  const eph = siteSlug ? state?.eph[siteSlug] ?? null : null
  const focusMission = missionIdx !== null ? state?.missions[missionIdx] ?? null : null
  // Mission Visor: the site's hourly series (real terrain horizon, never the smooth-Moon display
  // layer) and the touchdown hour that starts the reference mission.
  const visorSeries = useMemo(() => site && eph && horizon ? buildSeries(site.slug, eph.sun.rows, eph.earth.rows, horizon) : null, [site?.slug, eph, horizon])
  const [touchdown, setTouchdown] = useState<{ slug: string; row: number } | null>(null)
  // Landing simulation stage reported by the scene: pending (waiting for terrain), descent, done.
  const [landingStage, setLandingStage] = useState<'idle' | LandingStage>('idle')
  const landing = landingStage === 'pending' || landingStage === 'descent'
  const landedNow = !!visitLook && !landing
  // In the field view the arrival tour hands over to the field companion's small caption once you stand on the
  // surface: the tour card would otherwise cover the field display. The flight and landing narration are unchanged.
  const fieldModeOn = surfacePreferences.fieldMode
  useEffect(() => { if (guideMode === 'tour' && fieldModeOn && landedNow && !pendingSite) setGuideMode('icon') }, [guideMode, fieldModeOn, landedNow, pendingSite])
  useEffect(() => {
    if (!visitLook) { setTouchdown(null); setLandingStage(s => s === 'idle' ? s : 'idle'); return }
    if (!landedNow || !site) return
    setTouchdown(t => t?.slug === site.slug ? t : { slug: site.slug, row: uiRow })
  }, [landedNow, !!visitLook, site?.slug])
  // When her latest reply arrived, so her bubble and pointing fade on their own.
  const [replyAt, setReplyAt] = useState(0), [, setCharacterTick] = useState(0)
  useEffect(() => { if (companion.turns.length) setReplyAt(Date.now()) }, [companion.turns.length])
  useEffect(() => {
    if (!replyAt) return
    const timers = [TALK_MS, POINT_MS].map(ms => setTimeout(() => setCharacterTick(n => n + 1), ms + 60))
    return () => timers.forEach(clearTimeout)
  }, [replyAt])

  const inspectSurfaceObject=(object:SurfaceObject,payloadIndex?:number)=>{
    if(!site||!state)return
    setSurfaceSelection(previous=>({siteSlug:site.slug,object,payloadIndex,id:Math.max(Date.now(),(previous?.id??0)+1)}))
    if(object==='panel'||object==='antenna')setSurfaceEquipment(all=>({...all,[site.slug]:{...(all[site.slug]??DEFAULT_EQUIPMENT),[object]:true}}))
    const mission=surfaceMission(site,state.missions),label=object==='payload'?(mission?.payloads?.[payloadIndex??0]?.name??'Survey instrument'):object==='lander'?(mission?.vehicle??'Concept field station'):object==='panel'?'Solar panel experiment':'Earth pointing experiment'
    setExpeditionRecords(records=>appendRecord(records,{id:`object:${site.slug}:${object}:${payloadIndex??0}`,siteSlug:site.slug,kind:'object',label,sceneUTC:new Date(state.startMs+clock.current.row*3600000).toISOString(),recordedUTC:new Date().toISOString(),datasetId:state.index.datasetId,model:MODEL_VERSION}))
  }
  useEffect(()=>{
    if(!journal.ready||!visitLook||!site||!state)return
    setExpeditionRecords(records=>{const id=`visit:${site.slug}`;return records.some(r=>r.id===id)?records:appendRecord(records,{id,siteSlug:site.slug,kind:'visit',label:`Visited ${site.name}`,sceneUTC:new Date(state.startMs+clock.current.row*3600000).toISOString(),recordedUTC:new Date().toISOString(),datasetId:state.index.datasetId,model:MODEL_VERSION})})
  },[journal.ready,!!visitLook,site?.slug])
  useEffect(()=>{
    if(!state||!journal.ready)return
    for(const run of Object.values(assignments)){if(!run?.completion)continue
      const id=`assignment:${run.siteSlug}:${run.startedUTC}`
      setExpeditionRecords(records=>records.some(r=>r.id===id)?records:appendRecord(records,{id,siteSlug:run.siteSlug,kind:'assignment',label:run.kind==='scout'?'Scout field tasks completed':'Power field tasks completed',sceneUTC:new Date(state.startMs+(run.decisionRow??0)*3600000).toISOString(),recordedUTC:run.completion!.atUTC,datasetId:state.index.datasetId,model:MODEL_VERSION}))
    }
  },[assignments,journal.ready])

  // selecting a site clears mission focus; selecting a mission focuses the map,
  // and follows through to the site analysis when the mission has one
  const stopPlayback = () => {
    clock.current.playing=false;clock.current.realtime=false
    setPlaying(false);setRealtime(false)
  }
  const selectSite = (slug: string) => {
    const selected=state?.catalog.find(s=>s.slug===slug)
    if(!selected)return
    const token=++selectionRequest.current
    stopPlayback();setVisitPending(false);setScaleBearing(null);setPanel('selection');setMissionIdx(null)
    const apply=()=>{if(token!==selectionRequest.current)return;setPendingSite(null);setSiteSlug(slug);setFly({body:'Moon',lat:selected.lat,lon:selected.lonEast,key:Date.now()})}
    if(state?.eph[slug])apply()
    else {setPendingSite(selected);void loaderRef.current?.request(slug).then(apply).catch(()=>{if(token===selectionRequest.current){setPendingSite(null);setLoadWarning(`${selected.name} could not load. Choose it again to retry; the current site remains available.`)}})}
  }
  selectSiteRef.current=selectSite
  // Inside the dashboard, choosing a site opens its conditions without leaving the dashboard.
  const showSiteInDashboard=(slug:string,then:WorkspacePanel='conditions')=>{
    if(visitLook){selectSite(slug);return}
    setConditionsOn('scene') // a site chosen from Sites or the Atlas is shown as itself, at the scene time
    const selected=state?.catalog.find(s=>s.slug===slug)
    if(!selected)return
    const token=++selectionRequest.current
    const apply=()=>{if(token!==selectionRequest.current)return;setPendingSite(null);setSiteSlug(slug);setPanel(then)}
    if(state?.eph[slug])apply()
    else {setPendingSite(selected);void loaderRef.current?.request(slug).then(apply).catch(()=>{if(token===selectionRequest.current){setPendingSite(null);setLoadWarning(`${selected.name} could not load. Choose it again to retry; the current site remains available.`)}})}
  }
  const handleLayers=(l:Layers)=>setLayers(l)
  const flyToBody=(name:string)=>{
    selectionRequest.current++;setPendingSite(null);setMissionLink(null)
    setPanel(null);setVisitPending(false)
    setFly({body:name.charAt(0).toUpperCase()+name.slice(1).toLowerCase(),key:Date.now()})
  }
  // "Visit this site in 3D" from the mission plan or Compare: stand on the surface at that site and landing time,
  // remembering the mission so the field interface can return to the unchanged plan.
  const visitMission=(slug:string,startRow:number,endRow:number,source:MissionLink['source'],constraints?:Constraints)=>{
    const selected=state?.catalog.find(s=>s.slug===slug)
    if(!state||!selected)return
    const row=Math.max(0,Math.min(state.totalHours-1,Math.round(startRow)))
    setMissionWindow({slug,startRow,endRow})
    void visitWithGuide(slug,row,missionSnapshot(slug,row,constraints??missionSummary?.constraints??{...explorationConstraints,missionDays:(endRow-startRow)/24},'Snapshot of your dashboard mission'))
    setMissionLink({slug,row,siteName:selected.name,landingUTC:fmtMissionUTC(new Date(state.startMs+row*3600000)),source})
  }
  const previewMission=(slug:string,startRow:number,endRow:number)=>{
    const selected=state?.sites.find(s=>s.slug===slug)
    if(!selected)return
    selectionRequest.current++;stopPlayback();setPendingSite(null);setMissionIdx(null);setVisitPending(false);setScaleBearing(null)
    setSiteSlug(slug);setRow(startRow);setMissionWindow({slug,startRow,endRow})
    setFly({body:'Moon',lat:selected.lat,lon:selected.lonEast,key:Date.now()})
  }
  const discover=(heading?:number,pitch?:number)=>{
    if(!site || pendingSite || (focusMission && focusMission.siteSlug!==site.slug))return
    stopPlayback()
    // A measured surface visit always uses the actual terrain horizon.
    if(layers.smoothMoon)setLayers(l=>({...l,smoothMoon:false}))
    if(!visitLook){setPanel('selection');setVisitPending(true);setMissionLink(null)}
    setFly({body:'Moon',lat:site.lat,lon:site.lonEast,visit:true,visitHeading:heading,visitPitch:pitch,key:Date.now()})
  }
  const visitWithGuide=async(slug:string,row:number,snapshot:ExplorationMission|null=null)=>{
    if(!state)return
    setFieldMission(snapshot);setFieldProposal(null)
    const selected=state.catalog.find(s=>s.slug===slug)
    if(!selected||!Number.isInteger(row)||row<0||row>=state.totalHours)return
    const token=++selectionRequest.current
    stopPlayback();setMissionIdx(null);setPanel('selection');setPendingSite(selected);setVisitPending(true);setSurfaceSelection(null);setMissionLink(null)
    try{
      if(!state.eph[slug])await loaderRef.current?.request(slug)
      if(token!==selectionRequest.current)return
      setPendingSite(null);setSiteSlug(slug);setRow(row);setLayers(l=>({...l,smoothMoon:false}))
      setFly({body:'Moon',lat:selected.lat,lon:selected.lonEast,visit:true,key:Date.now()})
    }catch{if(token===selectionRequest.current){setPendingSite(null);setVisitPending(false);setLoadWarning('The requested site could not load. Your current site remains available.')}}
  }
  const beginDecisionJourney=async(slug:string,guide:DecisionGuide)=>{
    if(!state)return
    const selected=state.catalog.find(s=>s.slug===slug)
    if(!selected||guide.originRow<0||guide.originRow>=state.totalHours-1)return
    const token=++selectionRequest.current
    stopPlayback();setMissionIdx(null);setPanel('selection');setPendingSite(selected);setVisitPending(true);setMissionLink(null)
    try{
      if(!state.eph[slug])await loaderRef.current?.request(slug)
      if(token!==selectionRequest.current)return
      setPendingSite(null);setSiteSlug(slug);setRow(guide.originRow);setLayers(l=>({...l,smoothMoon:false}))
      setDecisionGuides(all=>({...all,[slug]:{...guide,ended:false}}));setGuideEntry({slug,id:Date.now()})
      setFly({body:'Moon',lat:selected.lat,lon:selected.lonEast,visit:true,key:Date.now()})
    }catch{if(token===selectionRequest.current){setPendingSite(null);setVisitPending(false);setLoadWarning('The worked mission could not load. Select the site to retry.')}}
  }
  useEffect(()=>{
    if(!state||restoredGuides.current)return
    restoredGuides.current=true
    const has=(slug:string)=>state.catalog.some(s=>s.slug===slug),saved:Record<string,DecisionGuide|null>={}
    try{const raw=localStorage.getItem('landsight-decision-journeys-v1');if(raw&&raw.length<150000){for(const value of Object.values(JSON.parse(raw)).slice(0,24)){const decoded=decodeJourney(typeof value==='string'?value:null,has);if(decoded&&decoded.guide.originRow<state.totalHours-1)saved[decoded.slug]=decoded.guide}}}catch{}
    const linked=new URLSearchParams(window.location.search).get('journey')
    if(linked){const decoded=decodeJourney(linked,has);if(decoded){saved[decoded.slug]={...decoded.guide,ended:false};void beginDecisionJourney(decoded.slug,decoded.guide);if(decoded.guide.source&&(decoded.guide.source.datasetId!==state.index.datasetId||decoded.guide.source.model!==state.index.model.version))setLoadWarning('This journey was recorded with another data/model snapshot. Inputs are restored; results are recalculated with the current snapshot.')}else setLoadWarning('This decision link is invalid or unsupported; it was not applied.')}
    setDecisionGuides(saved);setGuidesReady(true)
  },[state?.index.datasetId])
  useEffect(()=>{if(!guidesReady)return;try{localStorage.setItem('landsight-decision-journeys-v1',JSON.stringify(Object.fromEntries(Object.entries(decisionGuides).filter(([,g])=>g).map(([slug,g])=>[slug,encodeJourney(slug,g!)]))))}catch{}},[decisionGuides,guidesReady])
  // Leaving the surface (or a flight between sites) ends any guided walk and the field menu's pause.
  useEffect(()=>{if(!visitLook)fieldBridge.reset()},[!!visitLook])
  const exitVisit=()=>{
    selectionRequest.current++;setPendingSite(null);setFieldProposal(null);setFieldMission(null)
    setSurfaceSelection(null);setVisitLook(null);setVisitPending(false);setScaleBearing(null);setPanel('selection');setMissionLink(null);fieldBridge.reset()
    setFly({body:'Moon',lat:site?.lat,lon:site?.lonEast,key:Date.now()})
  }
  const selectMission=(idx:number|null)=>{
    const m=idx!==null?state?.missions[idx]:null
    setMissionIdx(idx);stopPlayback();setVisitPending(false)
    const token=++selectionRequest.current;setPendingSite(null)
    if(m?.siteSlug && state?.catalog.some(s=>s.slug===m.siteSlug)){
      if(state.eph[m.siteSlug])setSiteSlug(m.siteSlug)
      else {setPendingSite(state.catalog.find(s=>s.slug===m.siteSlug)!);void loaderRef.current?.request(m.siteSlug).then(()=>{if(token===selectionRequest.current){setPendingSite(null);setSiteSlug(m.siteSlug!)}}).catch(()=>{if(token===selectionRequest.current){setPendingSite(null);setLoadWarning('Mission predictions could not load. Select the mission again to retry.')}})}
    }
    if(m){setPanel('selection');setFly({body:'Moon',lat:m.lat??undefined,lon:m.lonEast??undefined,key:Date.now()})}
  }

  const flownSlugs = useMemo(() => {
    const m = new Map<string, string>()
    state?.missions.forEach((mi) => {
      if (mi.siteSlug && missionLanded(mi)) m.set(mi.siteSlug, mi.name)
    })
    return m
  }, [state])
  const mission = useMemo(
    () => state?.missions.find((m) => m.siteSlug === siteSlug && missionLanded(m)) ?? null,
    [state, siteSlug],
  )


  useEffect(()=>{
    if(error||graphicsUnavailable){setGuideMode('icon');setVisitPending(false)}
  },[error,graphicsUnavailable])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-danger">
        Mission data could not be loaded. Check your connection and reload.
        <br />
        {error}
      </div>
    )
  }
  if (!state || !site || !horizon || !duty || !eph) {
    if(guidedLaunch)return <Departure/>
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-sun" />
        <p className="text-xs uppercase tracking-[0.25em] text-inkdim">Loading mission data</p>
      </div>
    )
  }

  const sun = sampleSky(eph.sun.rows, uiRow)
  const earth = sampleSky(eph.earth.rows, uiRow)
  const realLit = sun.el > horizonAt(horizon, sun.az)
  const realDte = earth.el > horizonAt(horizon, earth.az)
  const sunV = sunVerdict(sun.el, horizonAt(effHorizon, sun.az), sun.radiusDeg)
  const dte = earth.el > horizonAt(effHorizon, earth.az)
  const simDate = new Date(parseRowT(eph.sun.rows[0].t).getTime() + uiRow * 3_600_000)

  const runGuideAction=(action:GuideAction):string=>{
    const missionResult=missionGuide.run(action)
    if(missionResult!==null)return missionResult
    const {kind,value}=action
    if(graphicsUnavailable&&['tour','surface','visit','sun','earth','skyline'].includes(kind))return 'The 3D view is unavailable. You can still explore the atlas and the site instruments.'
    if(kind==='searchSites'||kind==='searchMissions'){
      setCatalogTab(kind==='searchSites'?'sites':'missions');setCatalogSearch(value);setPanel('sites')
      return value?'Showing matches for “'+value+'”.':'Showing the full list.'
    }
    if(kind==='visit'||kind==='surface'||kind==='tour'){
      const dest=kind==='visit'?state.catalog.find(s=>s.slug===value):site
      if(!dest)return 'That site is unavailable.'
      if(kind==='tour')changeGuide('tour')
      if(dest.slug!==site.slug||!visitLook||pendingSite)void visitWithGuide(dest.slug,Math.min(Math.round(uiRow),state.totalHours-1))
      else {stopPlayback();setPanel(null)}
      return 'Exploring '+dest.name+'.'
    }
    if(kind==='sun'||kind==='earth'||kind==='skyline'){
      if(pendingSite)return 'Wait for the selected site to finish loading.'
      const peak=Math.max(...horizon.profile)
      const bearing=kind==='skyline'?horizon.profile.indexOf(peak):kind==='sun'?sun.az:earth.az
      const elevation=kind==='skyline'?peak:kind==='sun'?sun.el:earth.el
      stopPlayback();setMissionIdx(null);setPanel(null);setVisitPending(!visitLook);setLayers(l=>({...l,smoothMoon:false}))
      setFly({body:'Moon',lat:site.lat,lon:site.lonEast,visit:true,guidedTurn:true,visitHeading:bearing,visitPitch:elevation,key:Date.now()})
      return 'Turning toward the '+kind+'.'
    }
    if(kind==='advance'){
      const next=Math.round(uiRow)+Number(value)
      if(next<0||next>=state.totalHours)return 'That time is outside the available predictions.'
      stopPlayback();setRow(next);return 'Scene time set to '+new Date(state.startMs+next*3600000).toISOString().slice(0,16).replace('T',' ')+' UTC.'
    }
    if(kind==='orbit'){setVisitLook(null);flyToBody('Moon');return 'Returning to lunar orbit.'}
    if(kind==='play'){clock.current.realtime=false;clock.current.playing=true;clock.current.direction=1;setRealtime(false);setReverse(false);setPlaying(true);return 'Time is moving. Watch the light and shadows shift.'}
    if(kind==='pause'){stopPlayback();return 'Time paused.'}
    if(kind==='close'){if(!panel)return 'Nothing is open; you are looking at the scene.';closePanel();return 'Closed the dashboard.'}
    if(kind==='explain'){const on=value!=='off';setExplain(on);return on?'Explain mode is on: labels use plain language.':'Explain mode is off.'}
    if(kind==='photo'||kind==='jump'||kind==='flag'){
      if(!visitLook||pendingSite)return 'Stand on the surface first. Ask me to take you to a site.'
      if(drawerOpen)setPanel(null)
      if(kind==='photo'){setPhotoBusy(true);setPhotoError('');setPhotoRequest(r=>r+1);return 'Taking a photograph for your journal.'}
      if(kind==='jump'){setVisitStep(s=>({id:(s?.id??0)+1,forward:0,right:0,jump:true}));return 'Jumping in lunar gravity.'}
      setFieldRequest(r=>({id:(r?.id??0)+1,action:'flag'}));return 'Planting a survey flag here.'
    }
    if(kind==='energy'||kind==='calendar'){
      setPlannerGuide(old=>({tool:kind,id:(old?.id??0)+1}));setPanel('plan')
      return kind==='energy'?'Opened the energy and footprint instruments.':'Opened the landing calendar.'
    }
    if(kind==='compareWindows'){openQuickComparison();return state.sites.length>=2?'Opened landing-window comparison.':'Comparison sites are still loading.'}
    if(kind==='glossary')setGlossary('all')
    // Mission actions were handled above by missionGuide.run; what remains are dashboard sections.
    setPanel(kind as WorkspacePanel)
    return 'Opened '+(WORKSPACE_TOOLS.find(([key])=>key===kind)?.[1]??kind)+'.'
  }
  const selectionSite = focusMission && focusMission.siteSlug !== site.slug ? null : site
  // On the mission plan and Compare, Chader Buri reads the selected mission, not the 3D scene.
  const guideOnMission=drawerOpen&&(panel==='plan'||panel==='compare'||panel==='guide'||(panel==='conditions'&&conditionsOn==='mission'&&!visitLook))&&!!missionSummary
  // Site conditions for the mission: its own site at its landing time, from the same data and calculations.
  const missionConditions=(()=>{
    const m=missionSummary
    if(!m||visitLook||conditionsOn!=='mission')return null
    const e=state.eph[m.slug],h=state.horizons[m.slug],s=state.catalog.find(x=>x.slug===m.slug)
    if(!e||!h||!s)return null
    const row=Math.max(0,Math.min(m.row,state.totalHours-1)),sunM=sampleSky(e.sun.rows,row),earthM=sampleSky(e.earth.rows,row)
    return {site:s,horizon:h,duty:state.duty[m.slug],sun:sunM,earth:earthM,sunRows:e.sun.rows,earthRows:e.earth.rows,epoch:new Date(parseRowT(e.sun.rows[0].t).getTime()+row*3_600_000),lit:sunM.el>horizonAt(h,sunM.az),dte:earthM.el>horizonAt(h,earthM.az)}
  })()
  // On Compare she also receives the two options on screen and explains them in place.
  const compareOnScreen=guideOnMission&&panel==='compare'&&compareFocus?{compare:compareFocus}:{}
  const loading = <p className="p-5 text-sm text-inkdim">Loading mission tools…</p>
  const onSurface=!!visitLook&&!pendingSite&&!landing
  const surfaceMissionContext=resolveSurfaceMission(site.slug,uiRow,fieldMission,companion.mission??explorationConstraints)
  const panelMission=selectedPanelMission(site.slug,uiRow,fieldMission,fieldProposal)
  const panelCoverageHours=Math.min(eph.sun.rows.length,eph.earth.rows.length)-1
  const openPanelComparison=(useMission:boolean)=>{
    const equipment=surfaceEquipment[site.slug]??DEFAULT_EQUIPMENT
    const result=useMission?(panelMission?missionPanelComparison(panelMission,equipment,panelCoverageHours):null):examplePanelComparison(site.slug,uiRow,equipment,panelCoverageHours,referenceConstraints())
    if(!result)return
    stopPlayback();setEquipmentComparisons(all=>({...all,[site.slug]:(all[site.slug]??0)+1}))
    setCompareSeed({key:Date.now(),scns:result.scenarios,note:result.note,preserveMission:true});setPanel('plan')
  }
  const panelMissionComparison:PanelMissionComparison|undefined=panelMission?{
    missionDays:panelMission.constraints.missionDays,arrivalUTC:fmtMissionUTC(new Date(state.startMs+panelMission.row*3600000))+' UTC',
    canCompare:missionPanelUnavailable(panelMission,panelCoverageHours)===null,
    unavailableReason:missionPanelUnavailable(panelMission,panelCoverageHours),onCompare:()=>openPanelComparison(true),
  }:undefined
  const visorInputs:VisorInputs={slug:site.slug,row:uiRow,touchdownRow:fieldMission?.slug===site.slug?fieldMission.row:touchdown?.slug===site.slug?touchdown.row:null,series:visorSeries,constraints:surfaceMissionContext.constraints,sun,earth,horizon,sunRows:eph.sun.rows,earthRows:eph.earth.rows,epoch:simDate}
  const landerStatus=onSurface?powerGroup(visorInputs).headline.status:'none'
  const lastTurn=companion.turns.at(-1),skylinePeak=Math.max(...horizon.profile)
  const buri=visitLook?{
    state:characterState({busy:companion.busy,reply:lastTurn?{message:lastTurn.reply.message,focus:lastTurn.reply.focus,at:replyAt}:null,line:null,now:Date.now()}),
    targets:{sun:{az:sun.az,el:sun.el},earth:{az:earth.az,el:earth.el},skyline:{az:horizon.profile.indexOf(skylinePeak),el:skylinePeak}},
    onSelect:()=>changeGuide('chat'),
    // Field view: where she points, whether her caption is showing and whether she is listening (optional scene props).
    ...(surfacePreferences.fieldMode?fieldBridge.buriCue:{}),
  }:undefined
  const nextRise=onSurface?nextRiseHours(site.slug,uiRow,eph.sun.rows,eph.earth.rows,horizon,simDate):{earth:null,sun:null}
  const reactionScene={nextEarthriseH:nextRise.earth,nextSunriseH:nextRise.sun,landed:onSurface,siteSlug:site.slug,siteName:site.name,airborne:!!visitLook?.airborne,trailSteps:visitLook?.trailSteps??0,trailDistanceM:visitLook?.trailDistanceM??0,photos:photos.filter(p=>p.siteSlug===site.slug).length,flags:fieldFlags.filter(f=>f.siteSlug===site.slug).length,earthUp:realDte,sunState:sunV}
  // What Chader Buri reads as her scene or mission; the field's "Ask about this" sends through the same context.
  const guideContext:CompanionContext=panel==='setup'&&setupDraft?{basis:'scene',slug:setupDraft.slug,row:setupDraft.row,constraints:setupDraft.c,datasetId:state.index.datasetId,model:state.index.model.version,view:{screen:'setup',search:''}}:visitLook&&!drawerOpen&&fieldProposal?{basis:'scene',slug:fieldProposal.slug,row:fieldProposal.row,constraints:fieldProposal.constraints,datasetId:state.index.datasetId,model:state.index.model.version,...(fieldProposal.compare?{compare:fieldProposal.compare}:{}),view:{screen:'surface',search:''}}:guideOnMission&&missionSummary?{basis:'mission',...compareOnScreen,slug:missionSummary.slug,row:missionSummary.row,constraints:missionSummary.constraints,datasetId:state.index.datasetId,model:state.index.model.version,view:{screen:panel??'plan',search:''}}:{basis:'scene',slug:site.slug,row:Math.min(Math.round(uiRow),state.totalHours-1),constraints:visitLook?surfaceMissionContext.constraints:companion.mission??explorationConstraints,datasetId:state.index.datasetId,model:state.index.model.version,view:{screen:visitLook&&!drawerOpen?'surface':panel??'orbit',search:panel==='sites'?catalogSearch:''}}
  // The field interface (default on the surface): clock, mission link, Chader Buri and the scene bridge.
  const fieldContext:FieldContext={poseStore:visitPoseStore,bridge:fieldBridge.field,missionLink,onBackToMission:()=>{if(missionLink){stopPlayback();setPanel(missionLink.source)}},
    missionConstraints:surfaceMissionContext.constraints,missionBasis:surfaceMissionContext.basis,missionRow:fieldMission?.slug===site.slug?fieldMission.row:touchdown?.slug===site.slug?touchdown.row:surfaceMissionContext.row,realtime,onNow:goLive,
    onProposal:proposal=>setFieldProposal(previous=>JSON.stringify(previous)===JSON.stringify(proposal)?previous:proposal),
    onAskProposal:askBuri,onHeadsetState:setHeadsetPreviewOn,onSetup:()=>openSupport('setup'),onHelp:()=>openSupport('guide'),
    onArrival:(row,c)=>{stopPlayback();setFieldMission(missionSnapshot(site.slug,row,c,surfaceMissionContext.basis));setFieldProposal(null);setRow(row)},
    onVisitAlternative:(slug,row,c)=>{stopPlayback();void visitWithGuide(slug,row,missionSnapshot(slug,row,c,surfaceMissionContext.basis==='Illustrative exploration mission'?'Illustrative exploration mission':'Same mission assumptions at the alternative site'))},
    // "Open in planning" from the journal: Site conditions for this site at the observation time. The mission plan is untouched; the header leads back to the surface.
    onOpenPlanning:row=>{stopPlayback();setRow(row);setConditionsOn('scene');setPanel('conditions')},
    playing,onTogglePlay:togglePlay,speed,onSpeed:changeSpeed,arrivalRow:touchdown?.slug===site.slug?touchdown.row:null,startMs:state.startMs,totalHours:state.totalHours,
    analysisObserverHeightM:horizon.observerHeightAboveGroundM??state.index.analysisObserverHeightM,guideMode,onAskBuri:()=>changeGuide('chat'),onGuideAction:runGuideAction,
    reactionScene,reactions:surfacePreferences.buriReactions,
    companion,companionContext:guideContext,
    visor:visitLook?<MissionVisor pose={visitLook} poseSource={surfacePreferences.fieldMode ? visitPoseStore : undefined} preferences={{...surfacePreferences,visor:surfacePreferences.fieldVisor}} onPreferences={v=>setSurfacePreferences({...v,visor:surfacePreferences.visor,fieldVisor:v.visor})} onMissionControl={()=>{stopPlayback();setPanel('plan')}} onAsk={askBuri} inputs={visorInputs}/>:null}
  const orbitalWorkspace=!drawerOpen&&!visitLook&&!visitPending
  const catalogProgress=state.sites.length<state.catalog.length?<div className={orbitalWorkspace?'orbit-loading-status pointer-events-auto':'catalog-load-status'} role="status">
    {orbitalWorkspace
      ? `${Object.values(siteLoads).some(s=>s==='loading')?'Preparing lunar sites':'Some lunar sites are unavailable'} · ${state.sites.length} of ${state.catalog.length} ready`
      : `${state.sites.length}/${state.catalog.length} sites ready · ${Object.values(siteLoads).some(s=>s==='loading')?'more predictions loading':'some predictions unavailable'}`}
    {Object.values(siteLoads).some(s=>s==='error')&&<button onClick={()=>{for(const [slug,status]of Object.entries(siteLoads))if(status==='error')void loaderRef.current?.request(slug).catch(()=>{})}}>Retry unavailable sites</button>}
  </div>:null
  return <div className="landsight-workspace relative h-full overflow-hidden bg-void" data-orbit={orbitalWorkspace} data-dashboard={drawerOpen} data-guiding={guideMode==='tour'&&!drawerOpen}>
    {visitLook&&landingStage==='descent'&&<LandingHud siteName={site.name}/>}
    <SuitAudio poseSource={surfacePreferences.fieldMode ? visitPoseStore : undefined} enabled={surfacePreferences.suitAudio&&!graphicsUnavailable} landed={onSurface} pose={visitLook}/>
    <ChaderBuriGuide onSetup={()=>openSupport('setup')} onHelp={()=>openSupport('guide')} showHelpLabel={orbitalWorkspace} seedQuestion={buriSeed} readScreen={()=>visitLook&&!drawerOpen?readSurfaceScreen():panel?readScreen(panel):readScreen('orbit')} scene={reactionScene} reactions={surfacePreferences.buriReactions&&!drawerOpen&&!(visitLook&&surfacePreferences.fieldMode)} mode={guideMode} onMode={changeGuide} sunState={sunV} earthClearance={earth.el-horizonAt(horizon,earth.az)} landed={onSurface} arriving={visitPending||landing} flightVisible={arrival!==null} context={guideContext} siteName={guideOnMission&&missionSummary?missionSummary.siteName:site.name} scenario={missionSummary?scenarioKey({slug:missionSummary.slug,row:missionSummary.row,c:missionSummary.constraints}):null} undo={{available:missionGuide.canUndo,run:missionGuide.undo}} session={companion} onAction={runGuideAction}
      onVisit={(slug,row)=>{void visitWithGuide(slug,row);changeGuide('icon')}} onFocus={kind=>runGuideAction({kind,value:''})}
      onGuide={()=>{changeGuide('icon');void beginDecisionJourney(site.slug,decisionGuides[site.slug]??{originRow:Math.round(uiRow),step:0,compared:false,source:{datasetId:state.index.datasetId,model:state.index.model.version}})}}/>
    {loadWarning&&<div className="absolute bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-sun/40 bg-void/95 px-3 py-2 text-xs text-sun">{loadWarning}<button className="ml-3 underline" onClick={()=>setLoadWarning(null)}>dismiss</button></div>}
    {!orbitalWorkspace&&catalogProgress}
    <div data-scene-viewport className="scene-viewport absolute inset-0 z-0">
      {!graphicsFailure&&<SceneBoundary key={sceneAttempt} onFailure={sceneFailed}><Suspense fallback={<p className="absolute right-8 top-40 text-xs text-inkdim">Loading solar system…</p>}>
        <MoonScene {...fieldBridge.scene} {...fieldBridge.display(surfacePreferences)} fieldGloves={!!visitLook&&surfacePreferences.fieldMode&&surfacePreferences.fieldGloves} pointerLook={!!visitLook&&surfacePreferences.fieldMode&&!drawerOpen} buri={buri} onLanding={setLandingStage} landerStatus={landerStatus} onGraphicsFailure={sceneFailed}{...(sceneRetries>0?{quality:'low' as const}:{})} surfacePreferences={surfacePreferences} onSurfaceFocus={onVisitFocus} surfaceInspectorOpen={!!surfaceSelection} activeSurfaceObject={surfaceSelection?.object??null} onSurfaceObject={inspectSurfaceObject} onEquipment={equipment=>setSurfaceEquipment(all=>({...all,[site.slug]:equipment}))} assessmentTarget={highlightAssessment} suspended={headsetPreviewOn} onTerrainView={setTerrainView} onArrival={setArrival} scaleBearing={scaleBearing} visitStep={visitStep} datasetId={state.index.datasetId} trailVisible={trailVisible} equipment={surfaceEquipment[site.slug]??DEFAULT_EQUIPMENT} photoRequest={photoRequest} onPhoto={photo=>{setPhotoBusy(false);setPhotoError('');setPhotos(previous=>{const next=[...previous,photo];next.slice(0,Math.max(0,next.length-MAX_JOURNAL_PHOTOS)).forEach(p=>URL.revokeObjectURL(p.imageUrl));return next.slice(-MAX_JOURNAL_PHOTOS)})}} onPhotoError={message=>{setPhotoBusy(false);setPhotoError(message)}} fieldRequest={fieldRequest} fieldFlags={fieldFlags.filter(f=>f.siteSlug===site.slug)} onFieldResult={result=>{setFieldResult(result);if(result.action==='inspect'&&result.reading)setFieldInspections(previous=>({...previous,[result.reading!.siteSlug]:result.reading!}));if(result.action==='flag'&&result.reading)setFieldFlags(flags=>appendFlag(flags,result.reading!))}} clock={clock} site={site} sites={state.catalog} onSelect={selectSite} layers={layers} sunRows={eph.sun.rows} missions={state.missions} onMission={selectMission} fly={fly} options={spaceOptions} onFocus={name=>{setBodyFocus(name);setTerrainView(null)}} onFly={flyToBody} focusMission={focusMission} onVisit={onVisitPose}/>
      </Suspense></SceneBoundary>}
    </div>
    <ExplainContext.Provider value={explainCtx}>
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-2.5 lg:p-3">
        <WorkspaceBar onSetup={()=>openSupport('setup')} onHelp={()=>openSupport('guide')} onWeather={()=>openSupport('weather')} orbit={orbitalWorkspace} compact={drawerOpen} clockStr={fmtClock(simDate)} dateStr={fmtUTC(simDate).split(' · ')[0]} sitesOpen={panel==='sites'} toolsOpen={drawerOpen&&panel!=='sites'} onExplore={closePanel} onSites={()=>setPanel(p=>toggleWorkspacePanel(p,'sites'))} onTools={()=>setPanel(p=>hasWorkspaceDrawer(p)&&p!=='sites'?null:missionSummary?'plan':'setup')} onEvidence={()=>setPanel('evidence')} onQuickCompare={openQuickComparison} compareReady={state.sites.length>=2} onCompare={()=>setPanel('compare')} onMap={()=>setPanel('atlas')} onGlossary={()=>{setGlossary('all');setPanel('glossary')}} explain={explain} onExplain={setExplain} onReverse={toggleReverse} reverse={reverse} onNow={goLive} realtime={realtime} playing={playing} onPlay={togglePlay} speed={speed} onSpeed={changeSpeed} blink={<Blink clock={clock} startMs={state.startMs} totalHours={state.totalHours} onEngage={()=>{clock.current.realtime=false;setRealtime(false);setPlaying(false)}}/>}/>
        {orbitalWorkspace&&catalogProgress}
        <main className="relative min-h-0 flex-1" aria-label="Solar system workspace">
          {graphicsFailure&&!drawerOpen&&<GraphicsFailurePanel failure={graphicsFailure} retriesLeft={MAX_SCENE_RETRIES-sceneRetries} onRetry={retryScene} onDashboard={()=>{changeGuide('icon');setPanel(missionSummary?'plan':'setup')}}/>}
          {!graphicsFailure&&!drawerOpen&&!visitLook&&!visitPending&&<Suspense fallback={null}><SpaceNavigator compact={panel==='selection'} focus={bodyFocus} row={uiRow} options={spaceOptions} onOptions={setSpaceOptions} onFly={flyToBody} onOverview={()=>{setPanel(null);setFly({body:'Sun',overview:true,key:Date.now()});setSpaceOptions(o=>({...o,orbits:true,enhanced:true}));orbitPlayback(864000)}} onEarthMoon={()=>{setPanel(null);setFly({body:'Earth',system:true,key:Date.now()});setSpaceOptions(o=>({...o,orbits:true,enhanced:true}));orbitPlayback(86400)}} onAtlas={()=>setPanel('atlas')} onSky={()=>{setPanel(null);setFly({body:'Moon',sky:true,key:Date.now()});setSpaceOptions(o=>({...o,enhanced:false,orbits:false}))}}/></Suspense>}
          {!graphicsFailure&&orbitalWorkspace&&panel===null&&fly?.overview&&<section className="orbit-intro pointer-events-auto" aria-label="Explore the solar system">
            <h1 ref={overviewHeading} tabIndex={-1}>Explore the solar system</h1>
            <p>{bodyFocus==='Solar system'?'Choose a body above, or drag and zoom to explore.':'Opening the full solar system…'}</p>
            <div><button onClick={()=>flyToBody('Moon')}>Explore the Moon <span aria-hidden="true">→</span></button><button onClick={()=>setPanel(missionSummary?'plan':'setup')}>Open dashboard</button></div>
          </section>}
          {!graphicsFailure&&panel===null&&!visitLook&&!visitPending&&bodyFocus==='Moon'&&!fly?.overview&&<section className="workspace-welcome pointer-events-auto">
            <p className="eyebrow">Chader Buri · Lunar landing</p><h1>Explore the Moon from orbit</h1>
            <p className="moon-orbit-context">Example visit: <strong>{site.name}</strong>. Visit its measured terrain below, or plan and compare landing sites in the dashboard.</p>
            <div className="welcome-choices">
              <button className="welcome-choice is-primary" onClick={()=>discover()} disabled={!!pendingSite}><span>Visit {site.name} in 3D<small>Stand on the surface · 360°</small></span><span aria-hidden="true">→</span></button>
              <button className="welcome-choice" onClick={()=>setPanel(missionSummary?'plan':'setup')}><span>Open the dashboard<small>Plan, compare and rank landing sites</small></span><span aria-hidden="true">→</span></button>
            </div>
            <div className="welcome-links">
              <button onClick={()=>{void beginDecisionJourney(REFERENCE.slug,decisionGuides[REFERENCE.slug]?.story?decisionGuides[REFERENCE.slug]!:{originRow:referenceRow(state.startMs),step:0,compared:false,source:{datasetId:state.index.datasetId,model:state.index.model.version}})}}>{decisionGuides[REFERENCE.slug]?.story?'Resume the guided example':'Guided example: one landing decision'}</button>
              <button disabled={state.sites.length<2} onClick={openQuickComparison}>{state.sites.length<2?'Loading comparison sites…':'Compare sites & dates'}</button>
              <button onClick={()=>setPanel('sites')}>Browse all sites</button>
              {hook&&<button onClick={openHook}>Try the 7-day delay example</button>}
            </div>
            <div className="welcome-conditions mt-3 flex gap-4 text-xs text-inkdim"><span>Sun {sunV}</span><span>Earth {dte?'visible':'masked'}</span></div>
          </section>}
          {!graphicsFailure&&panel==='selection'&&!visitLook&&<SiteSelection site={pendingSite??selectionSite} mission={focusMission} onCompare={selectionSite&&state.sites.length>=2?openQuickComparison:undefined} loading={!!pendingSite} pending={visitPending} progress={arrival} onSkip={()=>setFly(f=>f?{...f,instant:true,key:Date.now()}:f)} onVisit={()=>discover()} onDetails={()=>setPanel('conditions')} onSites={()=>setPanel('sites')} onClose={closePanel}/>}
        </main>
        {(drawerOpen||plannerVisited)&&<div className="dash pointer-events-auto" hidden={!drawerOpen} data-workspace-panel={panel??undefined} role="region" aria-label="Mission dashboard">
          {drawerOpen&&<DashboardHeader panel={panel as Exclude<WorkspacePanel,null|'selection'>} onPanel={setPanel} onClose={closePanel} onAsk={()=>panel==='plan'&&missionSummary?askAbout('verdict'):panel==='compare'?askAbout('compare'):askBuri(panelQuestion(panel))} onSurface={!!visitLook} onSetup={()=>openSupport('setup')} onCompare={()=>{if(panel!=='compare')openQuickComparison()}} compareReady={state.sites.length>=2} onExploreMission={missionSummary?()=>visitMission(missionSummary.slug,missionSummary.row,missionSummary.row+missionSummary.missionDays*24,'plan',missionSummary.constraints):undefined}/>}
          {drawerOpen&&!['setup','guide','weather'].includes(panel??'')&&<MissionBar sceneUTC={fmtMissionUTC(simDate)} onEdit={architectOpen?undefined:()=>setPanel('plan')} guideChange={missionGuide.canUndo&&missionGuide.change?{text:missionGuide.change.report,onUndo:()=>{missionGuide.undo()}}:null}/>}
          {drawerOpen&&!architectOpen&&<div key={['setup','guide','weather'].includes(panel??'')?panel:'dashboard'} className="dash-page" data-panel={panel}>
            {panel==='conditions'&&missionSummary&&!visitLook&&<div className="dash-basis" role="group" aria-label="Whose conditions this page shows">
              <span className="dash-basis-label">Showing conditions for</span>
              <button aria-pressed={!!missionConditions} onClick={()=>setConditionsOn('mission')}><strong>Your mission</strong><small>{missionSummary.siteName} · at landing, {missionSummary.landingUTC} UTC</small></button>
              <button aria-pressed={!missionConditions} onClick={()=>setConditionsOn('scene')}><strong>3D scene</strong><small>{site.name} · {simDate.toISOString().slice(0,16).replace('T',' ')} UTC</small></button>
            </div>}
            {panel==='conditions'&&visitLook&&missionSummary&&missionSummary.slug!==site.slug&&<p className="dash-site-note">This page shows <strong>{site.name}</strong>, where you are standing. Your mission is at <strong>{missionSummary.siteName}</strong>.</p>}
            {panel==='sites'&&<DashPageHead kicker="Sites" title="Landing sites & missions" text={`Every candidate south-pole site and the missions that flew or are planned there. The bars show how much of the time each site sees the Sun and the Earth across all cached data (${fmtMissionUTC(new Date(state.startMs)).slice(0,-6)} to ${fmtMissionUTC(new Date(state.startMs+(state.totalHours-1)*3600000)).slice(0,-6)} UTC). Choose a site to see its conditions.`}/>}
            {panel==='compare'&&<DashPageHead kicker="Compare" title="Compare two options fairly" text="Two sites on the same dates, or one site on two dates. The lander, mission length and requirements stay exactly the same for both, so every difference comes from that one change."/>}
            {panel==='sites'&&<SitesPanel search={catalogSearch} onSearch={setCatalogSearch} tab={catalogTab} onTab={setCatalogTab} sites={state.catalog} duty={state.duty} siteSlug={site.slug} onSite={showSiteInDashboard} flownSlugs={flownSlugs} missions={state.missions} missionIdx={missionIdx} onMission={selectMission} layers={layers} onLayers={handleLayers} collapsed={false} onToggleCollapse={closePanel}/>}
            {panel==='conditions'&&missionConditions&&<div className="h-full overflow-y-auto p-4"><Inspector key={'mission-'+missionConditions.site.slug} epoch={missionConditions.epoch} site={missionConditions.site} horizon={missionConditions.horizon} smoothMoon={false} terrainDelta={{lit:missionConditions.lit,dte:missionConditions.dte}} duty={missionConditions.duty} sun={missionConditions.sun} earth={missionConditions.earth} sunRowsAll={missionConditions.sunRows} earthRowsAll={missionConditions.earthRows} mission={null} focusMission={null} timeBasis="mission"/></div>}
            {panel==='conditions'&&!missionConditions&&<div className="h-full overflow-y-auto p-4"><Inspector epoch={simDate} site={site} horizon={effHorizon!} smoothMoon={layers.smoothMoon} terrainDelta={{lit:realLit,dte:realDte}} duty={duty} sun={sun} earth={earth} sunRowsAll={eph.sun.rows} earthRowsAll={eph.earth.rows} mission={mission} focusMission={focusMission} onDiscover={selectionSite?()=>discover():undefined}/></div>}
            {evidenceOpen&&<EvidencePanel index={state.index} eph={state.eph} horizons={state.horizons} site={site} ephemeris={eph.sun} horizon={horizon} onClose={closePanel} onValidation={()=>setPanel('validation')} onExploreReference={()=>{setPanel(null);setFly({body:'Moon',lat:-89.45267485051343,lon:-137.14865265000893,terrain:true,key:Date.now()})}}/>}
            {compareOpen&&<Suspense fallback={loading}><MissionCompare key={fairSeed?.key??0} sites={state.sites} eph={state.eph} horizons={state.horizons} startMs={state.startMs} mission={missionSummary} sceneSlug={site.slug} sceneRow={Math.round(uiRow)} seed={fairSeed} defaultB={compareB} onSiteB={setCompareB} datasetIndex={state.index} onUse={(slug,row,c)=>{setPlanSelect({key:Date.now(),slug,row,constraints:c});setPanel('plan')}} onVisit={(slug,row,end,c)=>visitMission(slug,row,end,'compare',c)} onAdvanced={scns=>{setCompareSeed({key:Date.now(),scns,preserveMission:true,note:'Copied from Compare with the same equipment and requirements. Change any option here to compare different equipment.'});setPanel('plan')}}/></Suspense>}
            {panel==='atlas'&&<Suspense fallback={loading}><ViabilityMap embedded sites={state.sites} eph={state.eph} horizons={state.horizons} currentSlug={site.slug} initialRow={uiRow} onOpenSite={showSiteInDashboard} onClose={closePanel}/></Suspense>}
            {panel==='validation'&&<Suspense fallback={loading}><Validation backLabel="Back to sources" sites={state.sites} missions={state.missions} eph={state.eph} horizons={state.horizons} duty={state.duty} onBack={()=>setPanel('evidence')}/></Suspense>}
            {panel==='setup'&&<Suspense fallback={loading}><GuidedMissionSetup embedded onDraft={setSetupDraft} sites={state.sites} eph={state.eph} horizons={state.horizons} startMs={state.startMs} totalHours={state.totalHours} totalSiteCount={state.catalog.length} initialRow={missionSummary?.row??Math.round(uiRow)} onApply={mission=>{stopPlayback();setPlanSelect({key:Date.now(),slug:mission.slug,row:mission.row,constraints:mission.c});setPanel('plan');changeGuide('icon')}} onClose={()=>setPanel('plan')} onAsk={askBuri}/></Suspense>}
            {panel==='guide'&&<Suspense fallback={loading}><MissionGuidePage onNavigate={setPanel} onAsk={askBuri}/></Suspense>}
            {panel==='weather'&&<section className="mission-weather-page"><button className="dash-btn" onClick={()=>setPanel('plan')}>Back to mission plan</button><h1>Solar activity &amp; space weather</h1><p>Recent reports from NASA DONKI help you understand activity on the Sun. Check each report’s date and the last update. These current reports are separate from your simulated arrival and the site comparison.</p><Suspense fallback={loading}><SpaceWeather sceneUTC={simDate.toISOString()}/></Suspense><button className="dash-btn" onClick={()=>askBuri(panelQuestion('weather'))}>Explain these reports</button></section>}
            {panel==='glossary'&&<Glossary focus={glossary??'all'} onClose={closePanel}/>}
          </div>}
          {(architectOpen||plannerVisited)&&<div className="dash-plan" hidden={!architectOpen}><MissionArchitect guideRequest={plannerGuide} active={architectOpen} sites={state.sites} eph={state.eph} horizons={state.horizons} startMs={state.startMs} currentSlug={site.slug} sceneRow={uiRow} onPreviewMission={previewMission} onOpenWindow={(slug,row,end)=>visitMission(slug,row,end,'plan')} onClose={closePanel} compareSeed={compareSeed} datasetIndex={state.index} totalSiteCount={state.catalog.length} onCompareSites={seed=>{setFairSeed({key:Date.now(),mode:'sites',...seed});setPanel('compare')}} selectRequest={planSelect}/></div>}
        </div>}
        {visitLook&&!drawerOpen&&!landing&&<SiteVisit field={fieldContext} visorOn={surfacePreferences.visor} visor={<MissionVisor pose={visitLook} poseSource={surfacePreferences.fieldMode ? visitPoseStore : undefined} preferences={surfacePreferences} onPreferences={setSurfacePreferences} onMissionControl={()=>{stopPlayback();setPanel('plan')}} onAsk={askBuri}
          inputs={visorInputs}/>} guidedArrival={guideMode==='tour'}onOpenCompanion={()=>changeGuide('chat')} surfaceFocus={surfaceFocus} surfacePreferences={surfacePreferences} onSurfacePreferences={setSurfacePreferences} archiveStatus={journal.status} records={expeditionRecords.filter(r=>r.siteSlug===site.slug)} surfaceSelection={surfaceSelection?.siteSlug===site.slug?surfaceSelection:null} onSurfaceObject={inspectSurfaceObject} onCloseSurfaceObject={()=>setSurfaceSelection(null)} guideEntry={guideEntry?.slug===site.slug?guideEntry.id:0} onRepairCompare={(scns,note)=>{stopPlayback();setCompareSeed({key:Date.now(),scns,note,preserveMission:true});setPanel('plan')}} datasetIndex={state.index} guideEphemeris={eph} decisionConstraints={explorationConstraints} guide={decisionGuides[site.slug]??null} onGuide={run=>setDecisionGuides(all=>({...all,[site.slug]:run}))} onHighlightTarget={setHighlightAssessment} onDecisionCompare={row=>{stopPlayback();setCompareSeed({key:Date.now(),scns:[{id:0,slug:site.slug,row,c:referenceConstraints()},{id:1,slug:site.slug,row:row+7*24,c:referenceConstraints()}],preserveMission:true,note:'Exploration decision: the same illustrative 14-day reference lander at the nominal target, on the guide/assignment starting date and seven days later. 3.08 m² tracking panel, 28%, 1,200 W load, 10 kWh storage. Thermal and RF excluded; inspect separate footprint and height results beside each verdict. Visitor movement does not relocate the horizon.'});setPanel('plan')}} site={site} duty={duty} sites={state.catalog} row={uiRow} onTime={row=>{stopPlayback();setRow(row)}} onStep={(forward,right)=>setVisitStep(s=>({id:(s?.id??0)+1,forward,right}))} onWalk={(forward,right)=>setVisitStep(s=>({id:(s?.id??0)+1,forward,right,walk:true}))} onJump={()=>setVisitStep(s=>({id:(s?.id??0)+1,forward:0,right:0,jump:true}))} onResetViewpoint={()=>setVisitStep(s=>({id:(s?.id??0)+1,forward:0,right:0,reset:true}))} viewpoint={visitLook} photos={photos.filter(p=>p.siteSlug===site.slug)} photoBusy={photoBusy} photoError={photoError} onCapture={()=>{setPhotoBusy(true);setPhotoError('');setPhotoRequest(r=>r+1)}} onPhotoNote={(id,note)=>setPhotos(ps=>ps.map(p=>p.id===id?{...p,note:note.slice(0,280)}:p))} onRemovePhoto={id=>setPhotos(ps=>{ps.filter(p=>p.id===id).forEach(p=>URL.revokeObjectURL(p.imageUrl));return ps.filter(p=>p.id!==id)})} trailVisible={trailVisible} onTrailVisible={setTrailVisible} onCrouch={crouch=>setVisitStep(s=>({id:(s?.id??0)+1,forward:0,right:0,crouch}))} equipment={surfaceEquipment[site.slug]??DEFAULT_EQUIPMENT} onEquipment={equipment=>setSurfaceEquipment(all=>({...all,[site.slug]:equipment}))} assignment={assignments[site.slug]??null} onAssignment={assignment=>setAssignments(all=>({...all,[site.slug]:assignment}))} comparisonCount={equipmentComparisons[site.slug]??0} onCompareEquipment={()=>openPanelComparison(false)} panelMissionComparison={panelMissionComparison} lastInspection={fieldInspections[site.slug]??null} datasetId={state.index.datasetId} fieldResult={fieldResult} fieldFlags={fieldFlags.filter(f=>f.siteSlug===site.slug)} onField={action=>setFieldRequest(r=>({id:(r?.id??0)+1,action}))} onClearFlags={()=>setFieldFlags(flags=>flags.filter(f=>f.siteSlug!==site.slug))} scaleBearing={scaleBearing} onScale={setScaleBearing} contrast={spaceOptions.terrainContrast??false} onContrast={enabled=>setSpaceOptions(o=>({...o,terrainContrast:enabled}))} light={spaceOptions.inspectionLight} onLight={enabled=>setSpaceOptions(o=>({...o,inspectionLight:enabled}))} horizon={effHorizon!} sun={sun} earth={earth} sunRows={eph.sun.rows} earthRows={eph.earth.rows} epoch={simDate} heading={visitLook.heading} pitch={visitLook.pitch} fov={visitLook.fov} terrain={terrainView} missions={state.missions} onFace={(dir,pitch)=>discover(dir,pitch)} onExit={exitVisit}/>}
        <div className="ribbon-container" role={orbitalWorkspace?'region':undefined} aria-label={orbitalWorkspace?`Lunar timeline for ${site.name}`:undefined}>
          {orbitalWorkspace&&<p className="orbit-timeline-context">Lunar site: <strong>{site.name}</strong> · predicted sunlight &amp; Earth visibility</p>}
          <Ribbon sunRows={eph.sun.rows} earthRows={eph.earth.rows} horizon={effHorizon!} row={uiRow} setRow={ribbonSetRow} missionWindow={missionWindow&&missionWindow.slug===siteSlug?missionWindow:null} onClearWindow={clearMissionWindow}/>
        </div>
      </div>
    </ExplainContext.Provider>
  </div>
}
