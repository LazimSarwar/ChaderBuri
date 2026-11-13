import { newGlanceVisitKey } from './consoleGlanceStore'
import { CompassStrip } from './CompassStrip'
import { MissionStrip } from './MissionStrip'
import { viewLightingText } from './surfacePresentation'
import { nowRow } from './siteRanking'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Camera, Clock3, Compass as CompassIcon, Ellipsis, Globe2, LayoutDashboard, Map as MapIcon, Menu, MessageCircle, MousePointer2, NotebookPen, Pause, ScanLine, Square, Sun as SunIcon, X } from 'lucide-react'
import type { SiteVisitProps } from '../SiteVisit'
import { SurfaceInteraction } from '../SurfaceInteraction'
import { horizonAt } from '../data'
import { sampleSky } from '../lib/science'
import { nextHorizonCrossing } from '../lib/attribution'
import { surfaceMission, OUTPOST_POSITION, EQUIPMENT_POSITIONS, type SurfaceSelection } from '../lib/surfaceMission'
import { EXPLORATION_RADIUS_M, viewpointCoordinates } from '../lib/surfaceExplorer'
import { ASTRONAUT_EYE_HEIGHT_M } from '../lib/astronautMotion'
import { captureAssignmentCompletion, equipmentAssessment, MAX_JOURNAL_PHOTOS, photoMetadata } from '../lib/expedition'
import { expeditionInputs, expeditionProgress } from '../ExpeditionPanel'
import { ExpeditionAssignmentReview } from '../ExpeditionAssignmentReview'
import type { CompanionContext } from '../lib/lunarCompanion'
import type { LunarCompanionSession } from '../useLunarCompanion'
import { MODEL_VERSION } from '../modelIdentity'
import { useScreenDigest } from '../lib/screenDigest'
import type { ScreenDigestItem } from '../lib/contracts'
import type { GuideAction } from '../lib/guideAction'
import type { ReactionScene } from '../lib/buriReactions'
import { useReducedMotion } from '../useReducedMotion'
import { approachPoint, bearingFromTo, bodyState, distanceText, formatEta, formatSimUTC, localOffsetM, relativeDirectionText } from './fieldMath'
import { formatLatLon, noteId, type FieldNote } from './fieldNotes'
import { fieldPlaces, type MarkerInput } from './fieldPlaces'
import { FIELD_SCREEN, readSurfaceScreen } from './fieldDigest'
import { antennaBearing, antennaWalkTarget, antennaDistanceM, objectiveDoneCount, objectiveLine, objectiveStage, objectiveSteps, objectiveSummaryText, OBJECTIVE_TITLE, type ObjectiveInput, type ObjectiveLine } from './fieldObjective'
import { useFieldObjective } from './useFieldObjective'
import { ObjectiveCard } from './ObjectiveCard'
import { askDigestItems, askSubject, askSuggestions, type AskValues } from './fieldAsk'
import { AskBubble } from './AskBubble'
import { groupTools, NARROW_TOOLS_MAX_WIDTH } from './fieldTools'
import { useFieldNotes } from './useFieldNotes'
import type { BuriPoint, FieldBridge, FieldMarker, HighlightObject, MissionLink } from './useFieldBridge'
import { ArrivalCard } from './ArrivalCard'
import { ActivityCard, type ActivityAction, type ActivityStep } from './ActivityCard'
import { arrangeSurfaces, arrivalFacts, completeActivity, demProductText, eventTargetRow, fieldEvents, journeyDigest, newJourney, nextActivities, panelTurned, recordDone, sunlightConclusion, sunlightStage, whatChanged, activityTitle, SUNLIGHT_SOURCE, TIME_SOURCE, type ActivityId, type FieldEvent, type JourneyState, type OverlayMode, type PanelReading, type SkySnapshot } from './fieldJourney'
import { TerrainMap } from './TerrainMap'
import { SunEarthPanel } from './SunEarthPanel'
import { TimePanel } from './TimePanel'
import { FieldJournal } from './FieldJournal'
import { PauseMenu } from './PauseMenu'
import { FieldCompanion, speechAvailable, type CompanionLine } from './FieldCompanion'
import type { VisitPoseStore } from './visitPoseStore'
import { useQuantizedPose, useVisitFocus } from './useVisitPose'
import { type DecisionMode } from './MissionDecisions'
import { RoutePlanner, ExcursionStatus, LocalSkyText } from './RoutePlanner'
import { useExcursion, LANDER_APPROACH } from './useExcursion'
import { localSky } from './routeAnalysis'
import type { ExplorationProposal } from './missionSession'
import { EXCURSION_SCREEN } from './missionDecisionDigest'
import type { Constraints } from '../architect/solver'
import { JumpButton, TouchJoystick } from './TouchControls'
import { OverlayLegend } from './OverlayLegend'
import { activityCue, CUE_POINT_MS } from '../lib/characterController'
import './field.css'
import './field-travel.css'
import './exploration-journey.css'
import './exploration-finish.css'
import { missionPlanningRow } from './explorationJourney'
import './field-visor-layout.css'
import './decision-review.css'

const HeadsetPreview = lazy(() => import('./HeadsetPreview'))
const SpaceWeather = lazy(() => import('../SpaceWeather').then(m => ({ default: m.SpaceWeather })))

export type FieldContext = {
  poseStore?: VisitPoseStore
  bridge: FieldBridge
  missionLink: MissionLink | null
  onBackToMission: () => void
  playing: boolean
  onTogglePlay: () => void
  speed: number
  onSpeed: (secondsPerSecond: number) => void
  arrivalRow: number | null
  startMs: number
  totalHours: number
  analysisObserverHeightM: number
  guideMode: 'icon' | 'chat' | 'tour'
  onAskBuri: () => void
  onGuideAction: (action: GuideAction) => string
  reactionScene: ReactionScene
  reactions: boolean
  /** The Mission Visor, rendered when the visitor turns it on in the field menu. */
  visor: ReactNode
  /** Chader Buri's conversation and scene context, for "Ask about this" (one request through the same pipeline). */
  companion?: LunarCompanionSession
  companionContext?: CompanionContext
  /** Opens the dashboard's site conditions for this site at a scene row (the mission plan is left unchanged). */
  onOpenPlanning?: (row: number) => void
  /** Read-only snapshot of a linked plan. Scene navigation never edits that plan. */
  missionConstraints?: Constraints
  missionBasis?: string
  missionRow?: number
  realtime?: boolean
  onNow?: () => void
  onVisitAlternative?: (slug: string, row: number, constraints: Constraints) => void
  onArrival?: (row: number, constraints: Constraints) => void
  onProposal?: (proposal: ExplorationProposal | null) => void
  onAskProposal?: (question: string) => void
  onHeadsetState?: (open: boolean) => void
  onSetup?: () => void
  onHelp?: () => void
}
type Tool = 'map' | 'sky' | 'time' | 'journal' | 'weather' | 'review'
const TOOL_TITLE: Record<Tool, string> = { map: 'Terrain map', sky: 'Sun & Earth', time: 'Time', journal: 'Field journal', weather: 'Space weather', review: 'Field assignment review' }
const TOOL_TIP: Record<Tool, string> = {
  review: 'Complete a scout or power assignment, then compare example landing dates and record the reason for your choice.',
  weather: 'These are recent NASA space-weather reports with their own UTC dates, separate from the simulation clock.',
  map: 'This is the rendered LOLA terrain around the landing point. Choose a place, or click the map, to walk there.',
  sky: 'The Sun and Earth are measured against the skyline at the landing point. Turn to face either one from here.',
  time: 'Moving time slides the Sun and Earth along their real paths. Where you stand stays the same.',
  journal: 'Your photos, notes and markers stay on this device. Add a note while it is fresh.',
}
/** The one question each tool answers, shown under its title. */
const TOOL_QUESTION: Record<Tool, string> = {
  review: 'What did you observe, and which example landing date would you choose?',
  weather: 'What has NASA recently reported about activity on the Sun?',
  map: 'Where am I, and what shape is the ground around me?',
  sky: 'Where are the Sun and Earth, and does the skyline hide them?',
  time: 'What changes as the Sun and Earth move?',
  journal: 'What have I recorded here, and where?',
}
const OBJECT_NAME: Record<SurfaceSelection['object'], string> = { lander: 'Lander', payload: 'Payload', panel: 'Solar panel', antenna: 'Antenna' }
const OBJECT_KIND: Record<SurfaceSelection['object'], string> = { lander: 'illustrative mission asset', payload: 'illustrative payload', panel: 'illustrative solar panel experiment', antenna: 'illustrative antenna experiment' }
const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => { const m = window.matchMedia(query), on = () => setMatch(m.matches); on(); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [query])
  return match
}
const useCoarsePointer = () => useMedia('(pointer: coarse)')

/**
 * Publishes measured layout edges as CSS variables on the HUD so cards stack below the status card and compass
 * and stop above the captions, whatever the text size or wrapping: --f-left-top (below the status card and
 * mission note), --f-centre-top (below the compass) and --f-companion-top (height taken by the captions).
 */
function useHudLayout(visorOn: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const hud = ref.current
    if (!hud || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const measure = () => {
      frame = 0
      const box = hud.getBoundingClientRect()
      const bottomOf = (sel: string) => { const e = hud.querySelector(sel); return e ? e.getBoundingClientRect().bottom - box.top : 0 }
      // Read every rectangle before writing CSS variables. Interleaving them forced repeated synchronous layouts
      // while walking changed captions/objectives. Measurements and the resulting offsets stay identical.
      const status = bottomOf('.field-status'), corner = bottomOf('.field-corner'), noteBottom = bottomOf('.field-mission-note'), centre = bottomOf('.field-compass')
      const left = Math.max(status, noteBottom)
      const note = hud.querySelector('.field-mission-note')
      const noteHeight = note ? note.getBoundingClientRect().height + 8 : 0
      const comp = hud.querySelector('.field-companion'), compTop = comp ? box.bottom - comp.getBoundingClientRect().top : 0
      const decisionBottom = bottomOf('.decision-shortcuts')
      const objectiveBottom = decisionBottom ? Math.max(decisionBottom, bottomOf('.field-objective'), bottomOf('.excursion-status')) : 0
      const toolsTop = hud.querySelector('.field-strip')?.getBoundingClientRect().top
      const movementTops = [...hud.querySelectorAll('.field-joystick,.field-jump')].flatMap(e => { const r = e.getBoundingClientRect(); return r.height > 0 ? [r.top] : [] })
      const instrumentFloor = Math.min(toolsTop ?? box.bottom, ...movementTops)
      let changed = false
      const write = (key: string, value: number) => { const px = `${Math.ceil(value)}px`; if (hud.style.getPropertyValue(key) !== px) { hud.style.setProperty(key, px); changed = true } }
      write('--f-band-bottom', Math.max(status, corner))
      if (toolsTop !== undefined) write('--f-tools-top', toolsTop - box.top)
      write('--f-instruments-bottom', instrumentFloor - box.top)
      write('--f-note-height', noteHeight)
      if (left) write('--f-left-top', left + 8)
      if (centre) write('--f-centre-top', centre + 8)
      if (decisionBottom) {
        write('--f-decision-bottom', decisionBottom + 8)
        write('--f-decision-nav-bottom', decisionBottom)
        write('--f-objective-bottom', objectiveBottom + 8)
      }
      write('--f-companion-top', compTop)
      // These offsets can move a measured block without resizing it (for example the navigation below a
      // wrapped status card). Re-measure once the writes have taken effect; unchanged offsets stop the cycle.
      if (changed) schedule()
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    // Resize callbacks run after layout and before paint: measure right there, so a viewport change never shows a
    // frame with stale offsets (frames can be slow while the scene renders).
    const resize = new ResizeObserver(() => { if (frame) { cancelAnimationFrame(frame); frame = 0 } measure() })
    const watched = new Set<Element>()
    const watch = () => {
      for (const e of watched) if (!hud.contains(e)) { resize.unobserve(e); watched.delete(e) }
      for (const sel of ['.field-top', '.field-status', '.field-corner', '.field-mission-note', '.field-compass', '.field-companion', '.mission-strip-context', '.decision-shortcuts', '.field-objective', '.excursion-status', '.field-strip', '.field-joystick', '.field-jump']) {
        const e = hud.querySelector(sel); if (e && !watched.has(e)) { watched.add(e); resize.observe(e) }
      }
      schedule()
    }
    // Elements mount and unmount (captions, mission note); pick up new ones and re-measure, at most once a frame.
    // Context banners move the controls without resizing the controls themselves.
    const selectors = '.field-top,.field-status,.field-corner,.field-mission-note,.field-compass,.field-companion,.mission-strip-context,.decision-shortcuts,.field-objective,.excursion-status,.field-strip,.field-joystick,.field-jump'
    const mutations = new MutationObserver(records => {
      // Compass text and time counters do not change the measured blocks. ResizeObserver owns size changes.
      if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element && (n.matches(selectors) || n.querySelector(selectors))))) watch()
    })
    resize.observe(hud)
    mutations.observe(hud, { childList: true, subtree: true })
    watch()
    return () => { resize.disconnect(); mutations.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [visorOn])
  return ref
}

/** The restrained field interface for a surface visit: open centre, compass, clock, a small tool strip and Chader Buri. */
export function FieldInterface({ field: f, ...input }: SiteVisitProps & { field: FieldContext }) {
  const [glanceVisit] = useState(newGlanceVisitKey)
  const glanceVisitKey = `${glanceVisit}/${input.site.slug}`
  const pose = useQuantizedPose(f.poseStore, input.viewpoint)
  const surfaceFocus = useVisitFocus(f.poseStore, input.surfaceFocus)
  const p = { ...input, viewpoint: pose, heading: pose.heading, pitch: pose.pitch, fov: pose.fov, surfaceFocus }
  const reactionScene = { ...f.reactionScene, airborne: !!pose.airborne, trailSteps: pose.trailSteps ?? 0, trailDistanceM: pose.trailDistanceM ?? 0 }
  const reduced = useReducedMotion(), touch = useCoarsePointer()
  const prefs = p.surfacePreferences, setPrefs = p.onSurfacePreferences
  const notes = useFieldNotes()
  const [tool, setTool] = useState<Tool | null>(null)
  const [journalTab, setJournalTab] = useState<'photos' | 'notes' | 'markers'>('photos')
  const [decision, setDecision] = useState<DecisionMode>(null)
  const [objectiveReveal, setObjectiveReveal] = useState(0)
  const [headsetOpen, setHeadsetOpen] = useState(false)
  useEffect(() => { f.onHeadsetState?.(headsetOpen); return () => f.onHeadsetState?.(false) }, [headsetOpen])
  const [groundCard, setGroundCard] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Every line she is asked to say, in order (several can arrive in one render; none is lost).
  const [lines, setLines] = useState<CompanionLine[]>([])
  const [moved, setMoved] = useState(false), movedRef = useRef(false)
  const vp = p.viewpoint, east = vp.eastM ?? 0, north = vp.northM ?? 0
  const eye = vp.eyeHeightM ?? ASTRONAUT_EYE_HEIGHT_M, fromLanding = Math.hypot(east, north)
  const paused = f.bridge.paused, goTo = f.bridge.goTo
  const missionConstraints = f.missionConstraints ?? p.decisionConstraints
  const routeEnvironment = { sampler: f.bridge.sampler, resolutionM: p.terrain?.resolutionM ?? 20, eyeHeightM: eye, row: p.row, sunRows: p.sunRows, earthRows: p.earthRows, horizon: p.horizon, maxRow: f.totalHours - 1 }
  const excursion = useExcursion({ slug: p.site.slug, datasetId: p.datasetId, model: MODEL_VERSION, environment: routeEnvironment, visitor: { eastM: east, northM: north }, travelledM: vp.trailDistanceM ?? 0, bridge: f.bridge, onTime: p.onTime, constraintsKey: JSON.stringify(missionConstraints), source: `${p.terrain?.source ?? 'Terrain loading'}; ${p.terrain?.resolutionM ?? '?'} m pixels` })
  const localPositionSky = useMemo(() => ({ sun: localSky(routeEnvironment, { eastM: east, northM: north }, p.row, 'sun'), earth: localSky(routeEnvironment, { eastM: east, northM: north }, p.row, 'earth') }), [Math.floor(east / 2), Math.floor(north / 2), Math.floor(p.row * 60), eye, f.bridge.sampler, p.terrain?.resolutionM, p.sunRows, p.earthRows, p.horizon])
  const previousExcursion = useRef(excursion.plan.phase)
  useEffect(() => {
    if (previousExcursion.current === excursion.plan.phase) return
    previousExcursion.current = excursion.plan.phase
    if (excursion.plan.phase === 'at-station') { setTool(null); setDecision('route') }
    else if (excursion.plan.phase === 'outbound' || excursion.plan.phase === 'returning') setDecision(null)
  }, [excursion.plan.phase])
  const sun = useMemo(() => sampleSky(p.sunRows, p.row), [p.sunRows, p.row]), earth = useMemo(() => sampleSky(p.earthRows, p.row), [p.earthRows, p.row])
  const sunState = bodyState('sun', sun.el, horizonAt(p.horizon, sun.az), sun.radiusDeg), earthState = bodyState('earth', earth.el, horizonAt(p.horizon, earth.az))
  const landerBearing = bearingFromTo(east, north, OUTPOST_POSITION.eastM, OUTPOST_POSITION.northM)
  const linked = f.missionLink && f.missionLink.slug === p.site.slug ? f.missionLink : null
  const missionArrivalRow = missionPlanningRow(f.missionRow ?? linked?.row ?? f.arrivalRow)
  const say = useCallback((key: string, text: string, offer?: CompanionLine['offer'], extra?: Pick<CompanionLine, 'kind' | 'group' | 'calculated' | 'brief'>) => setLines(ls => [...ls, { key: `${key}:${Date.now()}:${ls.length}`, text, offer, ...extra }].slice(-8)), [])
  const sayOnce = useRef(new Set<string>())
  const once = (key: string, text: string, offer?: CompanionLine['offer']) => { if (sayOnce.current.has(key)) return; sayOnce.current.add(key); say(key, text, offer) }
  // Where Chader Buri's figure points for a few seconds after a "Show me" action.
  const [pointAt, setPointAtState] = useState<{ at: BuriPoint; n: number }>({ at: null, n: 0 })
  const point = (at: BuriPoint) => setPointAtState(s => ({ at, n: s.n + 1 }))
  useEffect(() => { if (!pointAt.at) return; const t = setTimeout(() => setPointAtState(s => ({ ...s, at: null })), CUE_POINT_MS); return () => clearTimeout(t) }, [pointAt.n])
  const faceEarth = () => { p.onFace(earth.az, earth.el); point('earth') }, faceSun = () => { p.onFace(sun.az, sun.el); point('sun') }
  const narrow = useMedia(`(max-width: ${NARROW_TOOLS_MAX_WIDTH}px)`), phoneLayout = useMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1023px)')
  const hudRef = useHudLayout(prefs.fieldVisor)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activityReading, setActivityReading] = useState(false)
  const [missionMenu, setMissionMenu] = useState(false)
  const [helpExpanded, setHelpExpanded] = useState(false)
  useEffect(() => { f.bridge.setInputBlocked(missionMenu || tool === 'review' || (phoneLayout && helpExpanded)); return () => f.bridge.setInputBlocked(false) }, [missionMenu, tool, helpExpanded, phoneLayout, f.bridge.setInputBlocked])
  useEffect(() => { if (tool || moreOpen || paused || groundCard || p.surfaceSelection) setDecision(null) }, [tool, moreOpen, paused, groundCard, p.surfaceSelection])
  const moreButton = useRef<HTMLButtonElement>(null), moreSheet = useRef<HTMLElement>(null), moreWas = useRef(false)
  // The More sheet takes focus when it opens and gives it back to More when it closes (unless something else took it).
  useEffect(() => {
    const was = moreWas.current; moreWas.current = moreOpen
    if (moreOpen) { moreSheet.current?.querySelector<HTMLButtonElement>('.field-more-item:not([disabled])')?.focus(); return }
    if (!was) return
    const a = document.activeElement
    if (!a || a === document.body) moreButton.current?.focus({ preventScroll: true })
  }, [moreOpen])
  useEffect(() => { if (!narrow) setMoreOpen(false) }, [narrow])
  const [asking, setAsking] = useState(false)
  const [retire, setRetire] = useState<{ group: string; n: number } | null>(null)

  // ---- first objective: find Earth, then test the antenna ----------------------------
  const earthSkyline = horizonAt(p.horizon, earth.az)
  const assessment = useMemo(() => equipmentAssessment(p.equipment, sun, earth, horizonAt(p.horizon, sun.az), horizonAt(p.horizon, earth.az)), [p.equipment, sun, earth, p.horizon])
  const objectiveInput: ObjectiveInput = { heading: p.heading, earth: { az: earth.az, el: earth.el }, skylineEl: earthSkyline, visitor: { eastM: east, northM: north },
    antenna: { deployed: p.equipment.antenna, pointingErrorDeg: assessment.pointingErrorDeg, earthVisible: assessment.earthVisible } }
  const objective = useFieldObjective(p.site.slug, objectiveInput, p.epoch.toISOString())
  const stage = objectiveStage(objective.progress)
  // The field journey (kept by the bridge across a trip to the dashboard): the active activity and its readings.
  const slug = p.site.slug, journey: JourneyState = f.bridge.journeys[slug] ?? newJourney(), activity = journey.active
  const setJourney = (change: (j: JourneyState) => JourneyState) => f.bridge.setJourney(slug, change)
  // The Earth objective card shows while no other activity is running.
  const objectiveOn = !objective.progress.free && !activity
  const steps = objectiveSteps(objective.progress, objectiveInput)
  const openAntenna = () => { setToast(null); p.onSurfaceObject('antenna'); point('antenna') }

  // ---- tools, pause and keys ----------------------------------------------------------
  const wasPlaying = useRef(false)
  const openTool = (next: Tool) => {
    stopToRead()
    setHelpExpanded(false)
    setToast(null)
    setTool(current => current === next ? null : next); setGroundCard(false)
    if (p.surfaceSelection) p.onCloseSurfaceObject()
    once('tool:' + next, TOOL_TIP[next])
  }
  const openReview = () => {
    if (f.playing) f.onTogglePlay()
    setMissionMenu(false); setMoreOpen(false); setAsking(false); setArrival(false)
    openTool('review')
    setTool('review')
  }
  // Keep the existing assignment evidence when its four tasks finish in the default field view too.
  const assignmentSteps = expeditionProgress({ ...p, flags: p.fieldFlags })
  useEffect(() => {
    if (p.assignment && !p.assignment.completion && assignmentSteps.length === 4 && assignmentSteps.every(s => s.done)) {
      p.onAssignment({ ...p.assignment, completion: captureAssignmentCompletion(p.assignment, expeditionInputs({ ...p, flags: p.fieldFlags }), { inspection: p.lastInspection, flags: p.fieldFlags, photos: p.photos }) })
    }
  }, [p.assignment, assignmentSteps, p.lastInspection, p.fieldFlags, p.photos, p.viewpoint, p.equipment, p.comparisonCount, p.onAssignment])
  const reviewSheet = useRef<HTMLElement>(null)
  useEffect(() => {
    if (tool !== 'review') return
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => reviewSheet.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(frame)
      setTimeout(() => {
        if (reviewSheet.current?.dataset.tool === 'review') return
        const target = previous?.matches('button,a[href],input,textarea,select,[tabindex]') && !previous.closest('.field-pause,.field-sheet') && document.contains(previous) && previous.getClientRects().length ? previous : moreButton.current
        target?.focus({ preventScroll: true })
      }, 0)
    }
  }, [tool])
  const openPause = () => {
    if (f.playing) { wasPlaying.current = true; f.onTogglePlay() } else wasPlaying.current = false
    if (document.pointerLockElement) document.exitPointerLock?.()
    f.bridge.setPaused(true)
  }
  const resume = () => { f.bridge.setPaused(false); if (wasPlaying.current) { wasPlaying.current = false; if (!f.playing) f.onTogglePlay() } }
  const showVisor = () => setPrefs({ ...prefs, fieldVisor: true })
  // ---- arrival: once per site and visit (not repeated after a trip to the dashboard) ------------------
  const [arrival, setArrival] = useState(false), returning = useRef(f.bridge.welcomed.has(p.site.slug))
  useEffect(() => { if (tour || f.bridge.welcomed.has(slug)) return; f.bridge.welcomed.add(slug); setArrival(true) }, [f.guideMode === 'tour', slug])
  useEffect(() => { if (arrival && ((vp.trailDistanceM ?? 0) > 3 || fromLanding > 3)) setArrival(false) }, [arrival, Math.round(vp.trailDistanceM ?? 0), Math.round(fromLanding)])
  // When the arrival card closes with keyboard focus inside it, focus would fall to the page: hand it to the
  // objective card that takes the card's place (its current action, or its header).
  const arrivalHadFocus = useRef(false)
  useEffect(() => {
    if (arrival) { const track = () => { arrivalHadFocus.current = !!document.activeElement?.closest('.field-arrival') }; document.addEventListener('focusin', track); return () => document.removeEventListener('focusin', track) }
    if (!arrivalHadFocus.current) return
    arrivalHadFocus.current = false
    const frame = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const next = document.querySelector<HTMLElement>('.field-objective-action, .field-objective-head')
      next?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [arrival])
  // "Ask about this": the open card, inspected ground, open tool, what the reticle is on, or the objective step.
  // An activity in progress is what the visitor is asking about when nothing nearer is open.
  const subject = askSubject({ selection: p.surfaceSelection?.object ?? null, ground: groundCard && !p.surfaceSelection, tool: (tool === 'review' ? null : tool) ?? (activity === 'time' ? 'time' : activity === 'record' ? 'journal' : null),
    focus: p.surfaceFocus?.object ?? (activity === 'sunlight' ? 'panel' : null), objective: objectiveOn ? stage : null })
  const openAsk = () => {
    setHelpExpanded(false)
    stopToRead()
    if (!asking) p.onTime(p.row)
    setDecision(null)
    setMoreOpen(false)
    if (document.pointerLockElement) document.exitPointerLock?.()
    setAsking(a => !a)
  }
  const live = useRef({ tool, paused, missionMenu, helpExpanded, phoneLayout, decision, selection: !!p.surfaceSelection, groundCard, openTool, openPause, resume, onAsk: openAsk, close: p.onCloseSurfaceObject, visorOn: prefs.fieldVisor, showVisor, moreOpen, asking, arrival })
  live.current = { tool, paused, missionMenu, helpExpanded, phoneLayout, decision, selection: !!p.surfaceSelection, groundCard, openTool, openPause, resume, onAsk: openAsk, close: p.onCloseSurfaceObject, visorOn: prefs.fieldVisor, showVisor, moreOpen, asking, arrival }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.headset-preview')) return
      if (document.querySelector('[data-guide-open]')) return
      const s = live.current, typing = isTyping(e.target)
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        if (s.paused) s.resume()
        else if (s.missionMenu) setMissionMenu(false)
        else if (s.helpExpanded) setHelpExpanded(false)
        else if (s.decision) setDecision(null)
        else if (s.arrival) setArrival(false)
        else if (s.moreOpen) setMoreOpen(false)
        else if (s.asking) setAsking(false)
        else if (s.tool) setTool(null)
        else if (s.selection) s.close()
        else if (s.groundCard) setGroundCard(false)
        else s.openPause()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      // A focused Mission menu owns movement keys without opening the pause dialog.
      if ((s.missionMenu || (s.phoneLayout && s.helpExpanded)) && ('wasdpefcv '.includes(k) || e.key.startsWith('Arrow') || e.code === 'Space')) {
        e.stopPropagation()
        if (e.code !== 'Space' || !(e.target as Element | null)?.closest('button')) e.preventDefault()
        return
      }
      // While paused, keep walking, jumping and photo keys from reaching the scene.
      if (s.paused) { if ('wasdpefcv '.includes(k) || e.code === 'Space') e.stopPropagation(); return }
      if (e.repeat) return
      const tools: Record<string, Tool> = { m: 'map', o: 'sky', t: 'time', j: 'journal' }
      if (tools[k]) { e.preventDefault(); e.stopPropagation(); s.openTool(tools[k]) }
      else if (k === 'b') { e.preventDefault(); e.stopPropagation(); s.onAsk() }
      else if (k === 'v' && !s.visorOn) { e.preventDefault(); e.stopPropagation(); s.showVisor() }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [])
  // Leaving the visit or the page never leaves the scene paused.
  useEffect(() => () => f.bridge.setPaused(false), [])

  // ---- inspections ----------------------------------------------------------------------
  const firstResult = useRef(p.fieldResult)
  useEffect(() => {
    const r = p.fieldResult
    if (!r || r === firstResult.current) return
    if (r.action === 'inspect') { setGroundCard(true); setTool(null) }
    else if (r.reading) setToast(`Survey flag placed · ${formatLatLon(r.reading.lat, r.reading.lonEast)}`)
    else setToast(r.message)
  }, [p.fieldResult])
  useEffect(() => { if (p.surfaceSelection) { setTool(null); setGroundCard(false) } }, [p.surfaceSelection?.id])
  const inspect = () => { if (p.surfaceFocus) p.onSurfaceObject(p.surfaceFocus.object, p.surfaceFocus.payloadIndex); else p.onField('inspect') }
  const reading = p.fieldResult?.action === 'inspect' && p.fieldResult.reading?.siteSlug === p.site.slug ? p.fieldResult.reading : null
  const decorative = !!p.fieldResult && ('decorative' in p.fieldResult ? Boolean((p.fieldResult as { decorative?: unknown }).decorative) : /illustrative rock|decorative/i.test(p.fieldResult.message))

  // ---- notes, markers, places ----------------------------------------------------------
  const here = () => ({ eastM: east, northM: north, lat: vp.lat ?? null, lonEast: vp.lonEast ?? null })
  const addNote = (text: string, kind: FieldNote['kind'] = 'note', at = here(), sceneUTC = p.epoch.toISOString()) => { const id = noteId(); notes.add({ id, kind, siteSlug: p.site.slug, siteName: p.site.name, ...at, sceneUTC, createdUTC: new Date().toISOString(), text }); return id }
  const addMarker = (eastM: number, northM: number) => {
    const geo = viewpointCoordinates(p.site, { eastM, northM }), count = notes.notes.filter(n => n.kind === 'marker' && n.siteSlug === p.site.slug).length + 1
    addNote(`Marker ${count}`, 'marker', { eastM, northM, lat: geo.lat, lonEast: geo.lonEast })
    setToast(`Marker ${count} added · ${formatLatLon(geo.lat, geo.lonEast)}`)
  }
  const flagPositions = useMemo(() => Object.fromEntries(p.fieldFlags.map(fl => [fl.id, localOffsetM(p.site, fl.lat, fl.lonEast)])), [p.fieldFlags, p.site])
  const siteNotes = useMemo(()=>notes.notes.filter(n => n.siteSlug === p.site.slug),[notes.notes,p.site.slug])
  const markers = useMemo<MarkerInput[]>(()=>[
    ...siteNotes.slice(-12).map(n => ({ id: n.id, label: n.kind === 'marker' ? (n.text || 'Marker') : 'Note: ' + (n.text.slice(0, 24) || 'untitled'), eastM: n.eastM, northM: n.northM, kind: n.kind === 'marker' ? 'marker' as const : 'note' as const })),
    ...p.fieldFlags.map((fl, i) => ({ id: fl.id, label: `Survey flag ${i + 1}`, ...flagPositions[fl.id], kind: 'flag' as const })),
    ...p.photos.filter(ph => ph.pose.eastM !== undefined && ph.pose.northM !== undefined).map((ph, i) => ({ id: ph.id, label: `Photo ${i + 1} spot`, eastM: ph.pose.eastM!, northM: ph.pose.northM!, kind: 'photo' as const })),
  ],[siteNotes,p.fieldFlags,p.photos,JSON.stringify(flagPositions)])
  const places = fieldPlaces({ eastM: east, northM: north }, markers)
  // The same observations as markers in the 3D view (the overlay layer draws them; a pick opens the journal entry).
  const fieldMarkers = useMemo<FieldMarker[]>(()=>[{ id: 'landing', eastM: 0, northM: 0, label: 'Landing point', kind: 'landing' },
    ...excursion.plan.points.map((pt, i) => ({ id: `excursion-${i}`, eastM: pt.eastM, northM: pt.northM, label: pt.label, kind: 'route' as const })),
    ...markers.map(m => ({ id: m.id, eastM: m.eastM, northM: m.northM, label: m.label, kind: m.kind === 'photo' ? 'photo' as const : m.kind === 'flag' ? 'flag' as const : 'note' as const }))],[markers,excursion.plan.points])
  const lastPick = useRef(f.bridge.markerPick?.n ?? 0)
  useEffect(() => {
    const pick = f.bridge.markerPick
    if (!pick || pick.n === lastPick.current) return
    lastPick.current = pick.n
    if (pick.id.startsWith('excursion-')) { setTool(null); setDecision('route'); return }
    if (pick.id === 'landing') { setTool('map'); return }
    setTool('journal'); setGroundCard(false); if (p.surfaceSelection) p.onCloseSurfaceObject()
  }, [f.bridge.markerPick?.n])
  const rowOf = (iso: string) => Math.max(0, Math.min(f.totalHours - 1, (Date.parse(iso) - f.startMs) / 3_600_000))
  const openPlanning = (iso: string) => { if (f.onOpenPlanning) { setTool(null); f.onOpenPlanning(rowOf(iso)) } }
  const faceSpot = (t: { eastM: number; northM: number }) => p.onFace(bearingFromTo(east, north, t.eastM, t.northM), -6)
  const walkTo = (target: { eastM: number; northM: number; label: string; standoffM: number }) => {
    const point = approachPoint({ eastM: east, northM: north }, target, target.standoffM)
    f.bridge.requestGoTo({ eastM: point.eastM, northM: point.northM, label: target.label })
    if (touch) setTool(null)
  }
  const stopWalk = () => f.bridge.requestGoTo(null)
  const stopToRead = () => { stopWalk(); p.onWalk(0, 0); if (document.pointerLockElement) document.exitPointerLock?.() }
  // The antenna appears when it is set up; walking there sets it up so there is something to walk to.
  const walkToAntenna = () => {
    if (!p.equipment.antenna) p.onEquipment({ ...p.equipment, antenna: true })
    f.bridge.requestGoTo({ ...antennaWalkTarget({ eastM: east, northM: north }, earth.az), label: 'Antenna' })
    if (touch) setTool(null)
  }
  const lastWalk = useRef<number | null>(null)
  useEffect(() => {
    const w = f.bridge.walk
    if (!w || w.state === 'walking' || lastWalk.current === w.id) return
    lastWalk.current = w.id
    if (w.state === 'arrived') setToast('Arrived')
    else if (w.state === 'blocked') say('blocked', 'I can’t take you further that way. The exploration boundary is close, or the terrain data ends there.')
  }, [f.bridge.walk])

  // ---- photos ----------------------------------------------------------------------------
  const photoCount = useRef(p.photos.length)
  useEffect(() => {
    if (p.photos.length > photoCount.current) {
      const ph = p.photos[p.photos.length - 1]
      if (activity === 'record') setJourney(j => completeActivity({ ...j, record: { ...j.record, photoId: ph.id } }, 'record'))
      setToast(`Photo saved to journal · ${ph.siteName}, ${formatLatLon(ph.pose.lat, ph.pose.lonEast, 4)}, ${formatSimUTC(new Date(ph.sceneUTC))}`)
      once('photo', 'Lovely. It’s in your journal; press J to add a note while you remember why.')
    }
    photoCount.current = p.photos.length
  }, [p.photos.length])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t) }, [toast])

  // ---- companion lines -------------------------------------------------------------------
  const tour = f.guideMode === 'tour'
  const nextCrossing = (body: 'sun' | 'earth') => nextHorizonCrossing(body === 'sun' ? p.sunRows : p.earthRows, p.epoch, p.horizon, true)?.hours ?? null
  // The next time Earth / the Sun crosses the measured skyline: its rise while hidden, its set while up.
  const crossing = (body: 'sun' | 'earth', rising: boolean) => nextHorizonCrossing(body === 'sun' ? p.sunRows : p.earthRows, p.epoch, p.horizon, rising)?.hours ?? null
  const earthNextH = useMemo(() => crossing('earth', earthState !== 'above'), [p.row, p.earthRows, p.horizon, earthState])
  // Objective offers always run the latest actions (equipment, Earth position), even from an older caption.
  const act = useRef({ faceEarth, walkToAntenna, openAntenna, openTime: () => { openTool('time') } })
  act.current = { faceEarth, walkToAntenna, openAntenna, openTime: () => { if (tool !== 'time') openTool('time') } }
  const objectiveOffer = (o: ObjectiveLine['offer']): CompanionLine['offer'] =>
    o === 'face-earth' ? { label: 'Turn to face Earth', run: () => act.current.faceEarth() }
    : o === 'walk-antenna' ? { label: 'Walk there', run: () => act.current.walkToAntenna() }
    : o === 'open-antenna' ? { label: 'Open the antenna', run: () => act.current.openAntenna() }
    : o === 'open-time' ? { label: 'Open Time', run: () => act.current.openTime() } : undefined
  const objLine = objectiveOn ? objectiveLine(objective.progress, objectiveInput, p.site.name, earthNextH) : null
  const saidObjective = useRef<string | null>(null)
  useEffect(() => {
    if (tour || sayOnce.current.has('arrival')) return
    sayOnce.current.add('arrival')
    // Returning from the dashboard: the visitor already had the welcome; the cards carry the current step.
    if (returning.current) { saidObjective.current = objLine?.key ?? null; return }
    const sky = `${sunState === 'above' ? 'The Sun is above the skyline' : sunState === 'partial' ? 'The Sun is half hidden by the skyline' : 'The Sun is behind the terrain'} and ${earthState === 'above' ? 'Earth is in view' : 'Earth is behind the terrain for now'}.`
    // The arrival card shows the place, time and distances; her first line is the sky and the first job.
    if (objLine && objLine.key !== 'objective:done') { saidObjective.current = objLine.key; say(objLine.key, `${formatSimUTC(p.epoch)}. ${sky} ${objLine.text}`, objectiveOffer(objLine.offer), { kind: 'action', group: 'objective', calculated: true, brief: objLine.brief }) }
    else say('arrival', `Welcome to ${p.site.name}. ${sky}`, earthState === 'above' ? { label: 'Show me Earth', run: faceEarth } : undefined, { kind: 'action', group: 'arrival' })
  }, [tour])
  // A movement tip (ambient: it fades) if the visitor hasn't moved after a few seconds; kept apart from the welcome so a mode change can't cancel it.
  useEffect(() => {
    if (tour || sayOnce.current.has('first-move')) return
    const timer = setTimeout(() => {
      if (movedRef.current) return
      once('first-move', touch ? 'Drag the view to look around. The pad at bottom left walks you; Jump is on the right.' : 'Click the view to look around, then walk with W A S D. Space jumps — gently, this is one-sixth gravity.')
    }, 9000)
    return () => clearTimeout(timer)
  }, [tour])
  useEffect(() => {
    if (!movedRef.current && ((vp.trailDistanceM ?? 0) > 0.4 || fromLanding > 0.6)) { movedRef.current = true; setMoved(true) }
  }, [vp.trailDistanceM, fromLanding])
  // Her captions follow the objective: one line per step, which waits until the visitor acts or dismisses it.
  useEffect(() => {
    if (!objLine) {
      if (saidObjective.current) { saidObjective.current = null; setRetire(r => ({ group: 'objective', n: (r?.n ?? 0) + 1 })) }
      return
    }
    if (saidObjective.current === objLine.key || (!tour && !sayOnce.current.has('arrival'))) return
    saidObjective.current = objLine.key
    say(objLine.key, objLine.text, objectiveOffer(objLine.offer), { kind: 'action', group: 'objective', calculated: true, brief: objLine.brief })
  }, [objLine?.key, tour])
  // A persistent action caption must not retain another date's sky facts after Now/calendar/event jumps.
  const captionContext = useRef({ row: p.row, sun: sunState, earth: earthState })
  useEffect(() => {
    const previous = captionContext.current
    captionContext.current = { row: p.row, sun: sunState, earth: earthState }
    if (tour || !sayOnce.current.has('arrival') || (Math.abs(p.row - previous.row) <= 1.5 && previous.sun === sunState && previous.earth === earthState)) return
    const sky = `${sunState === 'below' ? 'The Sun is behind the terrain' : sunState === 'partial' ? 'The Sun is partly hidden' : 'The Sun is above the skyline'}; ${earthState === 'above' ? 'Earth is in view' : 'Earth is behind the terrain'}.`
    const at = `${formatSimUTC(p.epoch)}. ${sky}`
    if (objLine && objLine.key !== 'objective:done') say('objective:clock', `${at} ${objLine.text}`, objectiveOffer(objLine.offer), { kind: 'action', group: 'objective', calculated: true, brief: objLine.brief })
    else {
      if (objLine?.key === 'objective:done') setRetire(r => ({ group: 'objective', n: (r?.n ?? 0) + 1 }))
      say('arrival:clock', at, undefined, { kind: 'action', group: 'arrival', calculated: true })
    }
  }, [p.row, sunState, earthState, tour])
  const skyPrev = useRef({ sun: sunState, earth: earthState, row: p.row }), skyAt = useRef(0)
  useEffect(() => {
    const prev = skyPrev.current; skyPrev.current = { sun: sunState, earth: earthState, row: p.row }
    if (prev.sun === sunState && prev.earth === earthState) return
    // A jump in time explains itself ("what changed"): any earlier sky remark is out of date and none is added.
    // Otherwise a new remark replaces the older one of the same group.
    if (tour || Math.abs(p.row - prev.row) > 1.5 || Date.now() - skyAt.current < 20000) { setRetire(r => ({ group: 'sky', n: (r?.n ?? 0) + 1 })); return }
    if (prev.earth === 'above' && earthState === 'below') { skyAt.current = Date.now(); say('earth-set', `Earth has slipped behind the terrain. It rises again ${formatEta(nextCrossing('earth'))}.`, { label: 'Show me where', run: faceEarth }, { group: 'sky' }) }
    else if (prev.earth === 'below' && earthState === 'above') { skyAt.current = Date.now(); say('earth-rise', 'Earth is back above the skyline.', { label: 'Show me Earth', run: faceEarth }, { group: 'sky' }) }
    else if (prev.sun !== 'below' && sunState === 'below') { skyAt.current = Date.now(); say('sun-set', `The Sun is behind the terrain now. Sunrise ${formatEta(nextCrossing('sun'))}.`, { label: 'Find the Sun', run: faceSun }, { group: 'sky' }) }
  }, [sunState, earthState])
  const nearEdge = useRef(false)
  useEffect(() => {
    if (fromLanding >= EXPLORATION_RADIUS_M - 25 && !nearEdge.current) { nearEdge.current = true; say('edge', `We’re near the edge of the ${EXPLORATION_RADIUS_M} m exploration area. The landing point is ${distanceText(fromLanding)} behind us.`, { label: 'Walk back', run: () => walkTo({ eastM: 0, northM: 0, label: 'Landing point', standoffM: 0 }) }, { group: 'edge' }) }
    else if (fromLanding < EXPLORATION_RADIUS_M - 60) nearEdge.current = false
  }, [Math.round(fromLanding)])

  // ---- "Ask about this": only values already computed for this screen -------------------
  const mission = surfaceMission(p.site, p.missions)
  const payloadIndex = p.surfaceSelection?.object === 'payload' ? p.surfaceSelection.payloadIndex ?? 0 : p.surfaceFocus?.object === 'payload' ? p.surfaceFocus.payloadIndex ?? 0 : null
  const payload = payloadIndex !== null ? mission?.payloads?.[payloadIndex] : undefined
  const sunNextH = useMemo(() => asking ? crossing('sun', sunState === 'below') : null, [asking, p.row, p.sunRows, p.horizon, sunState])
  const visitorAt = { eastM: east, northM: north }
  const askValues: AskValues = {
    siteName: p.site.name, sceneUTC: formatSimUTC(p.epoch), heading: p.heading,
    earth: { az: earth.az, el: earth.el, skylineEl: earthSkyline, nextCrossingH: earthNextH },
    sun: { az: sun.az, el: sun.el, skylineEl: horizonAt(p.horizon, sun.az), state: sunState, nextCrossingH: sunNextH },
    distanceFromLandingM: fromLanding, explorationRadiusM: EXPLORATION_RADIUS_M,
    lander: { name: mission?.vehicle ?? 'Concept field station', mission: mission?.name ?? null, distanceM: Math.hypot(OUTPOST_POSITION.eastM - east, OUTPOST_POSITION.northM - north), bearingDeg: landerBearing },
    payload: payloadIndex !== null ? { name: payload?.name ?? 'Survey instrument', purpose: payload?.purpose ?? null } : null,
    antenna: { deployed: p.equipment.antenna, pointingErrorDeg: assessment.pointingErrorDeg, earthVisible: assessment.earthVisible, azDeg: p.equipment.antennaAz, elDeg: p.equipment.antennaEl, distanceM: antennaDistanceM(visitorAt), bearingDeg: antennaBearing(visitorAt) },
    panel: { deployed: p.equipment.panel, watts: assessment.watts, sunFraction: assessment.fraction, azDeg: p.equipment.panelAz, tiltDeg: p.equipment.panelTilt },
    ground: groundCard && reading ? { slopeDeg: reading.slopeDeg, elevationM: reading.elevationM, resolutionM: reading.resolutionM } : null,
    decorative: groundCard && decorative,
  }
  const askQuestions = asking ? askSuggestions(subject, askValues) : []

  // ---- activities: sunlight, another time, an observation ---------------------------------
  const lastRow = f.totalHours - 1
  const sunSkyline = horizonAt(p.horizon, sun.az)
  const panelNow: PanelReading = { sceneUTC: p.epoch.toISOString(), watts: assessment.watts, azDeg: p.equipment.panelAz, tiltDeg: p.equipment.panelTilt, sunFraction: assessment.fraction, sunElDeg: sun.el, skylineElDeg: sunSkyline }
  const panelRef = useRef(panelNow); panelRef.current = panelNow
  const facePanel = () => { p.onFace(bearingFromTo(east, north, EQUIPMENT_POSITIONS.panel.eastM, EQUIPMENT_POSITIONS.panel.northM), -10); point('panel') }
  const pointPanelAtSun = () => p.onEquipment({ ...p.equipment, panel: true, panelAz: sun.az, panelTilt: Math.max(0, Math.min(90, 90 - sun.el)) })
  // The first reading is taken when the panel stands; the second once it has been turned and settled.
  useEffect(() => { if (activity === 'sunlight' && p.equipment.panel && !journey.sunlight.before) setJourney(j => j.sunlight.before ? j : { ...j, sunlight: { before: panelRef.current, after: null } }) }, [activity, p.equipment.panel, !!journey.sunlight.before])
  const panelKey = `${assessment.watts.toFixed(1)}|${p.equipment.panelAz.toFixed(0)}|${p.equipment.panelTilt.toFixed(0)}`
  useEffect(() => {
    const b = journey.sunlight.before
    if (activity !== 'sunlight' || !b || journey.sunlight.after || !p.equipment.panel || !panelTurned(b, panelRef.current)) return
    const t = setTimeout(() => setJourney(j => j.sunlight.after || !j.sunlight.before ? j : completeActivity({ ...j, sunlight: { ...j.sunlight, after: panelRef.current } }, 'sunlight')), 1200)
    return () => clearTimeout(t)
  }, [panelKey, activity, !!journey.sunlight.before, !!journey.sunlight.after])
  const events = useMemo(() => fieldEvents(p.sunRows, p.earthRows, p.horizon, p.epoch, p.row, lastRow), [Math.floor(p.row * 12), p.sunRows, p.earthRows, p.horizon, lastRow])
  const snapNow = (): SkySnapshot => ({ row: p.row, epoch: p.epoch, sun: { el: sun.el, skylineEl: sunSkyline, state: sunState }, earth: { el: earth.el, skylineEl: earthSkyline, state: earthState }, panelW: p.equipment.panel ? assessment.watts : null })
  const jumpToEvent = (e: FieldEvent) => {
    const before = journey.time.before && journey.time.event ? journey.time.before : snapNow()
    const target = eventTargetRow(e, lastRow), sky = sampleSky(e.body === 'sun' ? p.sunRows : p.earthRows, target)
    setJourney(j => { const next = { ...j, time: { before, after: null, event: e.kind } }; return j.active === 'time' ? completeActivity(next, 'time') : next })
    p.onTime(target); p.onFace(sky.az, Math.max(-5, sky.el)); point(e.body)
  }
  const changed = journey.time.before && journey.time.event ? whatChanged(journey.time.before, snapNow()) : null
  const backBefore = journey.time.before && journey.time.event ? { row: journey.time.before.row, label: `Back to ${formatSimUTC(journey.time.before.epoch)}`, run: () => { p.onTime(journey.time.before!.row); setJourney(j => ({ ...j, time: { before: null, after: null, event: null } })) } } : null
  const recordItem = (() => {
    const ph = journey.record.photoId ? p.photos.find(x => x.id === journey.record.photoId) : null
    if (ph && ph.pose.eastM !== undefined && ph.pose.northM !== undefined) return { kind: 'photo', lat: ph.pose.lat, lonEast: ph.pose.lonEast, eastM: ph.pose.eastM, northM: ph.pose.northM, sceneUTC: ph.sceneUTC }
    const n = journey.record.noteId ? notes.notes.find(x => x.id === journey.record.noteId) : null
    return n ? { kind: 'note', lat: n.lat, lonEast: n.lonEast, eastM: n.eastM, northM: n.northM, sceneUTC: n.sceneUTC } : null
  })()
  const [recordDraft, setRecordDraft] = useState('')
  const startActivity = (id: ActivityId) => {
    setArrival(false)
    if (id === 'earth') { setJourney(j => ({ ...j, active: null })); objective.setFree(false); setObjectiveReveal(n => n + 1); return }
    setJourney(j => ({ ...j, active: id,
      ...(id === 'sunlight' ? { sunlight: { before: null, after: null } } : id === 'time' ? { time: { before: null, after: null, event: null } } : { record: { photoId: null, noteId: null } }) }))
    if (id === 'sunlight') { p.onSurfaceObject('panel'); facePanel() }
    if (id === 'time' && touch) setTool(null)
  }
  const leaveActivity = () => { setJourney(j => ({ ...j, active: null })); objective.setFree(true); setToast(null) }
  const nextIds = nextActivities(journey, objective.progress.aligned).map(a => a.id)
  const sunStage = sunlightStage(journey.sunlight)
  const activityCard: { title: string; steps: ActivityStep[]; action: ActivityAction | null; conclusion: { text: ReactNode; source: string } | null; more?: ActivityAction[]; children?: ReactNode } | null =
    activity === 'sunlight' ? {
      title: activityTitle('sunlight'),
      steps: [
        { id: 'deploy', label: 'Set up the example panel', done: !!journey.sunlight.before, current: sunStage === 'deploy', detail: journey.sunlight.before ? `First reading ${journey.sunlight.before.watts.toFixed(1)} W, facing bearing ${Math.round(journey.sunlight.before.azDeg)}° at ${journey.sunlight.before.tiltDeg.toFixed(0)}° tilt` : 'It stands beside the landing point. Setting it up takes the first reading.' },
        { id: 'orient', label: 'Turn it toward the Sun', done: !!journey.sunlight.after, current: sunStage === 'orient', detail: journey.sunlight.after ? `Second reading ${journey.sunlight.after.watts.toFixed(1)} W` : `Now ${assessment.watts.toFixed(1)} W. The Sun is ${relativeDirectionText(p.heading, sun.az)}, ${sun.el.toFixed(1)}° high. Drag the panel, use its card, or point it automatically.` },
        { id: 'read', label: 'Compare the two readings', done: !!journey.sunlight.after, current: false },
      ],
      action: sunStage === 'deploy' ? { label: 'Set up the panel', icon: SunIcon, run: () => { p.onSurfaceObject('panel'); facePanel() } }
        : sunStage === 'orient' ? { label: 'Point it at the Sun', icon: SunIcon, run: pointPanelAtSun } : null,
      conclusion: journey.sunlight.before && journey.sunlight.after ? { text: <><span className="field-line field-recorded-at">First reading: {journey.sunlight.before.sceneUTC ? formatSimUTC(new Date(journey.sunlight.before.sceneUTC)) : 'time not recorded'}. Second reading: {journey.sunlight.after.sceneUTC ? formatSimUTC(new Date(journey.sunlight.after.sceneUTC)) : 'time not recorded'}.</span>{journey.sunlight.before.sceneUTC && journey.sunlight.after.sceneUTC && Math.abs(Date.parse(journey.sunlight.after.sceneUTC) - Date.parse(journey.sunlight.before.sceneUTC)) > 60_000 && <span className="field-line">These readings use different simulation times. Both pointing and lighting can contribute to the change.</span>}<span>{sunlightConclusion({ before: journey.sunlight.before, after: journey.sunlight.after })}</span></>, source: SUNLIGHT_SOURCE } : null,
      more: journey.sunlight.after ? [...(p.panelMissionComparison ? [{ label: 'Compare with my mission', icon: LayoutDashboard, run: p.panelMissionComparison.onCompare, disabled: !p.panelMissionComparison.canCompare }] : []), { label: 'Compare example panel over 14 days', icon: LayoutDashboard, run: p.onCompareEquipment, disabled: !(p.row + 14 * 24 <= p.sunRows.length - 1) }, { label: 'Find the panel', icon: CompassIcon, run: facePanel }] : [{ label: 'Find the panel', icon: CompassIcon, run: facePanel }],
    }
    : activity === 'time' ? {
      title: activityTitle('time'),
      steps: [
        { id: 'jump', label: 'Jump to a sky event', done: !!journey.time.event || journey.done.includes('time'), current: !journey.time.event && !journey.done.includes('time'), detail: journey.time.event ? `Now at ${formatSimUTC(p.epoch)}` : 'Each is calculated for the landing point. You can jump again at any time.' },
        { id: 'compare', label: 'See what changed', done: !!journey.time.event || journey.done.includes('time'), current: false },
      ],
      action: null,
      children: !journey.time.event ? <ul className="field-events">{events.map(e => <li key={e.kind}><button className="field-event" data-body={e.body} onClick={() => jumpToEvent(e)}>{e.body === 'sun' ? <SunIcon size={16} aria-hidden="true" /> : <Globe2 size={16} aria-hidden="true" />}<span><strong>{e.label}</strong><small>{formatEta(e.hours)} · {e.atUTC} UTC</small></span></button></li>)}
        {events.length === 0 && <li className="field-source">No sunrise, sunset, earthrise or earthset within the loaded predictions.</li>}</ul> : undefined,
      conclusion: changed ? { text: <>{changed.map(l => <span key={l} className="field-line">{l}</span>)}</>, source: TIME_SOURCE } : null,
      more: [...(backBefore ? [{ label: backBefore.label, icon: Clock3, run: backBefore.run }] : []), { label: 'Open Time', icon: Clock3, run: () => { if (tool !== 'time') openTool('time') } }],
    }
    : activity === 'record' ? {
      title: activityTitle('record'),
      steps: [
        { id: 'capture', label: 'Take a photo or write a note', done: recordDone(journey.record), current: !recordDone(journey.record), detail: recordDone(journey.record) ? (journey.record.photoId ? 'Photo saved' : 'Note saved') : 'Both keep your position and the simulation time.' },
        { id: 'marker', label: 'Find its marker', done: recordDone(journey.record), current: false, detail: 'On the terrain map, in the journal and in the view.' },
      ],
      action: recordDone(journey.record) ? null : { label: p.photoBusy ? 'Saving…' : 'Take a photo (P)', icon: Camera, run: p.onCapture, disabled: p.photoBusy },
      children: !recordDone(journey.record) ? <form className="field-inline-note" onSubmit={e => { e.preventDefault(); const t = recordDraft.trim(); if (!t) return; const id = addNote(t); setRecordDraft(''); setJourney(j => completeActivity({ ...j, record: { ...j.record, noteId: id } }, 'record')) }}>
        <label className="field-label" htmlFor="field-record-note">Or write what you see</label>
        <div className="field-ask-compose"><input id="field-record-note" type="text" maxLength={500} value={recordDraft} placeholder="The lander’s shadow reaches…" onChange={e => setRecordDraft(e.target.value)} /><button type="submit" className="field-button" disabled={!recordDraft.trim()}><NotebookPen size={14} aria-hidden="true" />Save</button></div>
      </form> : undefined,
      conclusion: recordItem ? { text: `Saved at ${formatLatLon(recordItem.lat, recordItem.lonEast)}, ${distanceText(Math.hypot(recordItem.eastM, recordItem.northM))} from the landing point, at ${formatSimUTC(new Date(recordItem.sceneUTC))}. Its marker is on the map, in the journal and in the view.`, source: 'Position from the rendered LOLA terrain; the scene is a simulation, not lunar photography.' } : null,
      more: recordItem ? [{ label: 'Open the journal', icon: NotebookPen, run: () => { if (tool !== 'journal') openTool('journal') } }, { label: 'Open in planning', icon: LayoutDashboard, run: () => openPlanning(recordItem.sceneUTC), disabled: !f.onOpenPlanning }] : undefined,
    }
    : null
  // ---- what the scene shows for the field: highlight, overlay, markers, Chader Buri's cue ------------
  const [overlay, setOverlay] = useState<OverlayMode>(() => f.bridge.extras.terrainOverlay.mode)
  const [speaking, setSpeaking] = useState(false)
  const highlight: HighlightObject = p.surfaceSelection && p.surfaceSelection.object !== 'payload' ? p.surfaceSelection.object
    : activity === 'sunlight' && !journey.sunlight.after ? 'panel'
    : objectiveOn && (stage === 'walk' || stage === 'point') ? 'antenna' : null
  const attentive = asking || !!f.companion?.busy
  // Chader Buri follows the activity: she points once per step (Earth to find, the antenna to walk to and point, the
  // panel then the Sun for sunlight; time events point from jumpToEvent) and keeps facing the open card's object or
  // the step's hardware. A fresh caption counts as speaking for a moment, as read-aloud speech does.
  const cue = activityCue({ objective: excursion.active ? null : objectiveOn ? stage : null, activity: excursion.active ? null : activity, sunlight: activity === 'sunlight' ? sunStage : null, selection: p.surfaceSelection?.object ?? null })
  // Once per step, and again when the arrival card closes and she is first in plain view.
  useEffect(() => { if (cue.point && !paused && !arrival) point(cue.point) }, [cue.key, arrival])
  const [captionTalk, setCaptionTalk] = useState(false), lastLine = lines.at(-1)?.key
  useEffect(() => { if (!lastLine || tour || paused) return; setCaptionTalk(true); const t = setTimeout(() => setCaptionTalk(false), 3500); return () => clearTimeout(t) }, [lastLine])
  useEffect(() => { f.bridge.setExtras({ highlightObject: highlight, terrainOverlay: { mode: overlay }, fieldMarkers, routeLine: excursion.plan.points.length ? [excursion.plan.origin, ...excursion.plan.points, LANDER_APPROACH] : [], buri: { pointAt: pointAt.at, speaking: speaking || (captionTalk && prefs.captions), attentive, lookAt: cue.look } }) }, [highlight, overlay, fieldMarkers, excursion.plan.points, excursion.plan.origin, pointAt.at, speaking, captionTalk, prefs.captions, attentive, cue.look, f.bridge.setExtras])
  useEffect(() => () => f.bridge.setExtras(null), [])

  // ---- what Chader Buri's chat can read ------------------------------------------------
  const digest: ScreenDigestItem[] = [
    { id: 'field-site', label: 'Site', value: p.site.name },
    { id: 'field-time', label: 'Simulation time', value: formatSimUTC(p.epoch), source: f.playing ? 'clock running' : 'clock paused' },
    { id: 'field-tool', label: 'Open field tool', value: decision ? `Mission ${decision}` : tool ? TOOL_TITLE[tool] : paused ? 'Field menu (paused)' : 'none' },
    { id: 'field-local-sun', label: 'Nearby Sun obstruction at walked position (estimate)', value: localPositionSky.sun.status },
    { id: 'field-local-earth', label: 'Nearby Earth obstruction at walked position (estimate)', value: localPositionSky.earth.status },
    { id: 'field-object', label: 'Selected object', value: p.surfaceSelection ? `${p.surfaceSelection.object} (${OBJECT_KIND[p.surfaceSelection.object]})` : p.surfaceFocus ? `looking at ${p.surfaceFocus.label}` : 'none' },
    ...(asking ? askDigestItems(subject, askValues) : []),
    ...(objectiveOn ? [{ id: 'field-objective', label: 'Field objective (illustrative antenna)', value: `${OBJECTIVE_TITLE}: ${objectiveDoneCount(objective.progress)} of 3 steps done${stage === 'done' ? '' : `; now: ${steps.find(s => s.current)?.label ?? ''}`}` }] : []),
    ...journeyDigest({ activity: activity ?? (objectiveOn ? 'earth' : null), activityStep: activityCard ? activityCard.steps.find(s => s.current)?.label ?? 'complete' : objectiveOn ? steps.find(s => s.current)?.label ?? 'complete' : null,
      panel: p.equipment.panel || activity === 'sunlight' ? { deployed: p.equipment.panel, watts: assessment.watts } : null, earthClearDeg: earth.el - earthSkyline, sunClearDeg: sun.el - sunSkyline, nextEvent: events[0] ?? null, overlay, markers: markers.length }),
    { id: 'field-distance', label: 'Distance from landing point', value: fromLanding.toFixed(0), unit: 'm' },
    { id: 'field-eye', label: 'Visitor eye height (camera)', value: eye.toFixed(1), unit: 'm' },
    { id: 'field-observer', label: 'Mission analysis observer height at landing point', value: String(f.analysisObserverHeightM), unit: 'm' },
    { id: 'field-sun', label: 'Sun at landing point', value: `${sunState} measured skyline`, status: sunState === 'above' ? 'ok' : sunState === 'partial' ? 'warn' : 'fail', source: 'JPL Horizons + LOLA horizon' },
    { id: 'field-earth', label: 'Earth at landing point', value: `${earthState} measured skyline`, status: earthState === 'above' ? 'ok' : 'fail', source: 'JPL Horizons + LOLA horizon' },
    ...(goTo ? [{ id: 'field-walk', label: 'Walking to', value: goTo.label }] : []),
    ...(linked ? [{ id: 'field-mission', label: 'Linked mission landing', value: `${linked.siteName} ${linked.landingUTC} UTC` }] : []),
  ]
  useScreenDigest(FIELD_SCREEN, digest, digest.map(d => d.value).join('|'))
  useScreenDigest(EXCURSION_SCREEN, decision === 'route' || excursion.active ? excursion.digest : null, JSON.stringify([decision, excursion.digest]))

  // ---- export ----------------------------------------------------------------------------
  const exportJournal = () => {
    const data = { schemaVersion: 1, kind: 'chader-buri-field-journal', site: { slug: p.site.slug, name: p.site.name, lat: p.site.lat, lonEast: p.site.lonEast },
      exportedUTC: new Date().toISOString(), sceneUTC: p.epoch.toISOString(), datasetId: p.datasetId, model: MODEL_VERSION,
      photos: p.photos.map(photoMetadata), notes: siteNotes, surveyFlags: p.fieldFlags, lastInspection: p.lastInspection,
      scope: 'Rendered simulation of LOLA relief with illustrative soil, rocks, lighting and equipment. Positions are relative to the landing point; slopes describe the rendered DEM facet. No rock composition, temperature or suit telemetry is measured.' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a')
    a.href = url; a.download = `chader-buri-${p.site.slug}-journal.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ---- compass ---------------------------------------------------------------------------
  const selectionLabel = (s: SurfaceSelection) => { const m = surfaceMission(p.site, p.missions); return s.object === 'payload' ? (m?.payloads?.[s.payloadIndex ?? 0]?.name ?? 'Survey instrument') : s.object === 'lander' ? (m?.vehicle ?? 'Concept field station') : s.object === 'panel' ? 'Solar panel experiment' : 'Earth pointing experiment' }
  const centreFree = !paused && !decision
  const strip: { id: string; label: string; short?: string; key: string; icon: typeof MapIcon; run: () => void; pressed?: boolean; disabled?: boolean }[] = [
    { id: 'map', label: 'Map', key: 'M', icon: MapIcon, run: () => openTool('map'), pressed: tool === 'map' },
    { id: 'sky', label: 'Sun & Earth', key: 'O', icon: CompassIcon, run: () => openTool('sky'), pressed: tool === 'sky' },
    { id: 'time', label: 'Time', key: 'T', icon: Clock3, run: () => openTool('time'), pressed: tool === 'time' },
    { id: 'photo', label: p.photoBusy ? 'Saving…' : 'Photo', key: 'P', icon: Camera, run: p.onCapture, disabled: p.photoBusy },
    { id: 'journal', label: 'Journal', key: 'J', icon: NotebookPen, run: () => openTool('journal'), pressed: tool === 'journal' },
    { id: 'inspect', label: p.surfaceFocus ? 'Inspect ' + OBJECT_NAME[p.surfaceFocus.object].toLowerCase() : 'Inspect the ground', short: 'Inspect', key: 'E', icon: ScanLine, run: inspect },
    { id: 'ask', label: subject.kind === 'site' ? 'Ask Chader Buri' : 'Ask about this', short: 'Ask', key: 'B', icon: MessageCircle, run: openAsk, pressed: asking },
    { id: 'menu', label: 'Menu', key: 'Esc', icon: Menu, run: openPause },
  ]
  const tools = groupTools(strip, narrow)
  const hint = touch ? 'Drag to look · pad to walk · Jump on the right' : f.bridge.pointerLocked ? 'Mouse look on · WASD to walk · Space jump · Esc releases the mouse' : 'Click to look · WASD to walk · Space jump'
  // Phones: one expanded information surface at a time; the others compact or wait (their state is kept).
  const inspectOpen = (!!p.surfaceSelection || groundCard) && !paused
  const helpReading = phoneLayout && helpExpanded && !objectiveOn && !activity && !asking && !paused && !missionMenu && !headsetOpen && !tool && !decision && !inspectOpen && !moreOpen
  const focusedReading = phoneLayout && (helpReading || missionMenu || !!tool || !!decision || inspectOpen || asking || moreOpen || headsetOpen || activityReading)
  const movementAvailable = !helpReading && !paused && !arrival && !missionMenu && !tool && !decision && !inspectOpen && !asking && !moreOpen && !headsetOpen && !activityReading && f.guideMode !== 'chat'
  useEffect(() => { if (!phoneLayout || paused || arrival || tool || decision || inspectOpen || asking || moreOpen || headsetOpen) setMissionMenu(false) }, [phoneLayout, paused, arrival, tool, decision, inspectOpen, asking, moreOpen, headsetOpen])
  const nextEarthrise = events.find(e => e.kind === 'earthrise')
  const earthBlocked = objectiveOn && stage === 'find' && !assessment.earthVisible
  // Let the landscape lead during travel; opening a tool brings the full interface back.
  const travelling = (!!vp.walking || !!goTo || f.bridge.pointerLocked) && !arrival && !paused && !tool && !inspectOpen && !asking && !moreOpen
  const surfaces = arrangeSurfaces({ pause: paused, ask: asking && !paused, more: moreOpen, inspect: inspectOpen, tool: !!tool, arrival, objective: true, caption: true }, phoneLayout)
  const captionsHidden = tool === 'review' || missionMenu || !!decision || excursion.active || (phoneLayout && surfaces.primary !== 'objective' && surfaces.primary !== 'caption' && surfaces.primary !== null)
  // The arrival card already states the first objective, so the objective card waits compact beside it.
  // Reading a tool takes priority over the expanded objective, on every screen size.
  const cardCompact = travelling || missionMenu || asking || arrival || !!decision || !!tool || inspectOpen || moreOpen
  const demProduct = demProductText(p.terrain?.source, p.terrain?.resolutionM)
  const facts = arrivalFacts({ siteName: p.site.name, lat: p.site.lat, lonEast: p.site.lonEast, heading: p.heading, landerDistanceM: askValues.lander.distanceM, landerBearingDeg: landerBearing, landerName: mission?.vehicle ?? 'Concept field station', epoch: p.epoch, radiusM: EXPLORATION_RADIUS_M })

  return <div ref={hudRef} className="visit-interface field-hud pointer-events-none absolute inset-0 z-20" data-reading={focusedReading || undefined} data-help-reading={helpReading || undefined} data-mission-menu={missionMenu || undefined} data-chat={f.guideMode === 'chat' || undefined} data-excursion={excursion.active || undefined} data-decision={decision ?? undefined} data-large-text={prefs.largeText} data-reduced={reduced} data-touch={touch} data-travelling={travelling || undefined} onClickCapture={event => { if (travelling && event.target instanceof Element && event.target.closest('.field-objective-head')) stopToRead() }} data-tool={tool ?? undefined} data-primary={surfaces.primary ?? undefined} data-phone={phoneLayout || undefined} aria-label="Lunar surface field interface">
    {prefs.helmetFrame && <div className="field-helmet" aria-hidden="true" />}
    {prefs.fieldVisor && f.visor}
    {headsetOpen && <Suspense fallback={<div className="field-sheet pointer-events-auto" role="status">Loading headset controls…</div>}><HeadsetPreview visitKey={glanceVisitKey} siteName={p.site.name} objective={excursion.active ? `Excursion: ${excursion.plan.objective}` : objectiveOn ? OBJECTIVE_TITLE : 'Free exploration'} sampler={f.bridge.sampler} centre={{ eastM: east, northM: north }} resolutionM={p.terrain?.resolutionM ?? 20} sun={sun} earth={earth} epoch={p.epoch.toISOString()} source={demProduct} onClose={() => setHeadsetOpen(false)} /></Suspense>}
    <header className="field-top">
      <div className="field-status pointer-events-auto">
        <strong>{p.site.name}</strong>
        <span><i className="field-dot" data-playing={f.playing} aria-hidden="true" /><time dateTime={p.epoch.toISOString()}>{formatSimUTC(p.epoch)}</time><button className="field-now" disabled={nowRow(Date.now(),f.startMs,p.datasetIndex.coverage.samples)===null} aria-pressed={!!f.realtime} onClick={f.onNow}>Now (UTC)</button><button className="field-weather-button" aria-label="Space weather" aria-pressed={tool==='weather'} onClick={()=>openTool('weather')}>Weather</button><small>{f.realtime ? 'Predicted for now · not live telemetry' : f.playing ? 'simulation · running' : 'simulation · paused'}</small></span>
      </div>
      <CompassStrip store={f.poseStore} fallback={input.viewpoint} sun={sun} earth={earth} highlight={highlight} />
      <div className="field-corner pointer-events-auto">
        <button className="field-icon-button is-framed has-caption" aria-label="Helmet lamp" aria-pressed={prefs.suitLamp} title={`Helmet lamp ${prefs.suitLamp ? 'on' : 'off'} · inspection light only; no solar power`} onClick={() => setPrefs({ ...prefs, suitLamp: !prefs.suitLamp })}><SunIcon size={15} /><span className="field-icon-caption">Lamp</span></button>
        <button className="field-icon-button is-framed has-caption" aria-label="Headset preview" title="Headset terrain preview" onClick={() => { stopToRead(); if (f.playing) f.onTogglePlay(); setHeadsetOpen(true) }}><span aria-hidden="true">VR</span></button>
        {linked && <button className="field-pill" onClick={f.onBackToMission}><ArrowLeft size={14} aria-hidden="true" />{linked.source === 'compare' ? 'Back to comparison' : 'Back to mission plan'}</button>}
        <button className="field-icon-button is-framed" aria-label="Pause and open the field menu (Esc)" title="Pause · Esc" onClick={openPause}><Pause size={16} /></button>
      </div>
    </header>
    {linked && <p className="field-mission-note">Mission at {linked.siteName} · landing {linked.landingUTC} UTC</p>}
    {!paused && !arrival && <MissionStrip onReview={openReview} menuOpen={missionMenu} onMenu={open => { if (open) { stopToRead(); setToast(null) } setMissionMenu(open) }} timeOpen={tool === 'time'} visitKey={glanceVisitKey} landingRow={missionArrivalRow ?? p.row} sampler={f.bridge.sampler} resolutionM={p.terrain?.resolutionM ?? 20} heightM={f.analysisObserverHeightM} groundSource={demProduct} onJump={p.onTime} onRecord={text => { addNote(text); setDecision(null); setJournalTab('notes'); setTool('journal'); setToast('Comparison saved in your field journal') }} mode={decision} onMode={mode => {
      if (mode) { stopToRead(); if (f.playing) f.onTogglePlay(); setTool(null); setGroundCard(false); setMoreOpen(false); setAsking(false); if (p.surfaceSelection) p.onCloseSurfaceObject() }
      if (mode === 'route') excursion.prepare()
      setDecision(mode)
    }} site={p.site} sites={p.sites} row={p.row} startMs={f.startMs} index={p.datasetIndex}
      constraints={missionConstraints} basis={f.missionBasis ?? 'Illustrative exploration mission'}
      onArrival={(row, c) => { excursion.cancel(); (f.onArrival ?? p.onTime)(row, c) }} onVisit={f.onVisitAlternative} onReturn={() => { stopToRead(); setDecision(null); excursion.returnNow() }} onAsk={f.onAskProposal} onProposal={f.onProposal}
      route={<RoutePlanner excursion={excursion} startMs={f.startMs} source={demProduct} onPhoto={p.onCapture} siteKind={p.site.kind} siteNote={p.site.note} observerHeightM={eye}
        map={<TerrainMap resolutionM={p.terrain?.resolutionM ?? 20} sampler={f.bridge.sampler} visitor={{ eastM: east, northM: north, heading: p.heading }} radiusM={EXPLORATION_RADIUS_M} places={places} walkTarget={goTo} onWalkTo={walkTo} onAddMarker={addMarker} overlay={overlay} onOverlay={setOverlay} demProduct={demProduct} overlayInfo={f.bridge.overlayInfo}
          route={{ points: [excursion.plan.origin, ...excursion.plan.points, LANDER_APPROACH], onAdd: excursion.addPoint, editing: !excursion.active && excursion.plan.phase !== 'complete' }} />} />} />}
    {!paused && !arrival && <ExcursionStatus excursion={excursion} onOpen={() => { stopToRead(); setTool(null); setDecision('route') }} />}
    {arrival && !paused && <ArrivalCard compact={phoneLayout} facts={facts} lighting={viewLightingText(sunState, prefs.suitLamp)} objective={objectiveOn && stage !== 'done' ? OBJECTIVE_TITLE : null} beginLabel={earthBlocked ? nextEarthrise ? 'Preview Earthrise' : 'Choose a time' : 'Begin'} condition={earthBlocked ? nextEarthrise ? 'Earth is behind the terrain. Preview Earthrise changes the simulation time.' : 'Earth is behind the terrain now. Open Time to choose another time, or explore at the current time.' : null} onBegin={objectiveOn && stage === 'find' ? earthBlocked ? nextEarthrise ? () => { stopToRead(); jumpToEvent(nextEarthrise); setToast('Earthrise preview · simulation time changed. Time lets you return to arrival.') } : () => act.current.openTime() : faceEarth : null} onDismiss={() => setArrival(false)} />}
    {/* The arrival card already introduces the objective; the objective card takes over once it closes. */}
    {objectiveOn && !paused && !arrival && <ObjectiveCard visitKey={glanceVisitKey} reveal={objectiveReveal} progress={objective.progress} steps={steps} narrow={phoneLayout} compact={cardCompact} onReadingChange={setActivityReading}
      earthHidden={!assessment.earthVisible} onFaceEarth={faceEarth} onWalk={walkToAntenna} onOpenAntenna={openAntenna} onOpenTime={() => act.current.openTime()}
      onReturnToArrival={missionArrivalRow !== null && Math.abs(p.row - missionArrivalRow) > .01 ? () => p.onTime(missionArrivalRow) : null}
      onCompare={() => { stopToRead(); setTool(null); setDecision('compare') }}
      onDecisionReview={openReview} onEarthLink={() => { stopToRead(); setTool(null); setDecision('link') }}
      onRecordObservation={() => { const recorded = objective.progress.summary; if (!recorded) return; addNote(`Antenna observation at ${recorded.sceneUTC}. ${objectiveSummaryText(recorded)} Nominal landing point; illustrative equipment.`, 'note', { eastM: 0, northM: 0, lat: p.site.lat, lonEast: p.site.lonEast }, recorded.sceneUTC); setJournalTab('notes'); setTool('journal'); setToast('Observation saved in your field journal') }}
      onCollapse={objective.setCollapsed} onRestart={objective.restart} next={nextIds} onActivity={startActivity}
      onFree={() => { objective.setFree(true); setToast(null) }} />}
    {activityCard && !paused && <ActivityCard key={activity} title={activityCard.title} steps={activityCard.steps} action={activityCard.action} conclusion={activityCard.conclusion} more={activityCard.more}
      next={nextIds} narrow={phoneLayout} compact={cardCompact} onReadingChange={setActivityReading} onActivity={startActivity} onFree={leaveActivity}>{activityCard.children}</ActivityCard>}
    {!paused && !touch && f.bridge.pointerLocked && moved && <p className="field-lock" role="status"><MousePointer2 size={13} aria-hidden="true" />Mouse look · <kbd>Esc</kbd> releases</p>}

    {centreFree && !arrival && !focusedReading && <div className="field-reticle" aria-hidden="true"><i /></div>}
    {centreFree && p.surfaceFocus && !p.surfaceSelection && <button className="field-prompt pointer-events-auto" onClick={inspect}>
      <span>{OBJECT_NAME[p.surfaceFocus.object]}{!phoneLayout && !touch && <> · {OBJECT_KIND[p.surfaceFocus.object]}</>}</span><small>{p.surfaceFocus.distanceM.toFixed(1)} m · {touch ? 'Tap to inspect' : <><kbd>E</kbd> inspect</>}</small>
    </button>}

    {/* The ground overlay legend takes the first free spot (placeLegend); the map sheet shows the same legend inline. */}
    <OverlayLegend variant="hud" mode={overlay} info={f.bridge.overlayInfo} product={demProduct} hidden={tool === 'map' || paused} />
    {toast && <p className="field-toast" role="status">{toast}</p>}
    {p.photoError && <p className="field-toast is-alert" role="alert">{p.photoError}</p>}
    {goTo && <div className="field-walking pointer-events-auto" role="status"><span>Walking to {goTo.label} · {distanceText(Math.hypot(goTo.eastM - east, goTo.northM - north))}</span><button className="field-chip" onClick={stopWalk}><Square size={12} aria-hidden="true" />Stop</button></div>}
    {!goTo && vp.movementBlocked && <p className="field-toast is-quiet" role="status">Stopped at the exploration boundary or where the terrain data ends.</p>}

    {tool && <section ref={reviewSheet} className="field-sheet pointer-events-auto" aria-labelledby="field-sheet-title" data-tool={tool}>
      <header><span><h2 id="field-sheet-title">{TOOL_TITLE[tool]}</h2><small className="field-tool-question">{TOOL_QUESTION[tool]}</small></span><button className="field-icon-button" aria-label={`Close ${TOOL_TITLE[tool]} (Esc)`} onClick={() => setTool(null)}><X size={16} /></button></header>
      <div className="field-sheet-body">
        {tool === 'review' && <><p>Review your field evidence and choose an example landing date. Your mission plan stays unchanged.</p><details><summary>What this review covers</summary><p>The reference lander at your assignment’s starting time and 7 days later. The antenna introduction is separate from these four-task assignments.</p></details><ExpeditionAssignmentReview {...p} flags={p.fieldFlags} steps={assignmentSteps} onDecisionCompare={row => { setTool(null); p.onDecisionCompare(row) }} /><button className="field-button" onClick={() => setTool(null)}>Continue field exploration</button></>}
        {tool === 'map' && <TerrainMap resolutionM={p.terrain?.resolutionM ?? 20} sampler={f.bridge.sampler} visitor={{ eastM: east, northM: north, heading: p.heading }} radiusM={EXPLORATION_RADIUS_M} places={places} walkTarget={goTo} onWalkTo={walkTo} onAddMarker={addMarker} overlay={overlay} onOverlay={setOverlay} demProduct={demProduct} overlayInfo={f.bridge.overlayInfo} />}
        {tool === 'sky' && <><div className="route-local-readings"><h3>At your walked position · estimate</h3><p>{eye.toFixed(1)} m observer height. Nearby loaded DEM only; the distant horizon is not relocated.</p><LocalSkyText name="Nearby Sun" value={localPositionSky.sun} /><LocalSkyText name="Nearby Earth" value={localPositionSky.earth} /></div><SunEarthPanel heading={p.heading} row={p.row} epoch={p.epoch} horizon={p.horizon} sunRows={p.sunRows} earthRows={p.earthRows} analysisObserverHeightM={f.analysisObserverHeightM} eyeHeightM={eye} missionLinked={!!linked} onFace={(az, el) => p.onFace(az, el)} /></>}
        {tool === 'time' && <TimePanel row={p.row} epoch={p.epoch} startMs={f.startMs} totalHours={f.totalHours} playing={f.playing} speed={f.speed} arrivalRow={f.arrivalRow} missionRow={missionArrivalRow} missionDays={missionConstraints?.missionDays ?? null} onTime={p.onTime} onTogglePlay={f.onTogglePlay} onSpeed={f.onSpeed}
          events={events} onEvent={jumpToEvent} changed={changed} onBackBefore={backBefore} />}
        {tool === 'weather' && <><Suspense fallback={<p role="status">Checking NASA reports…</p>}><SpaceWeather sceneUTC={p.epoch.toISOString()}/></Suspense><button className="field-button" onClick={()=>f.onAskProposal?.('Explain the NASA space-weather reports on screen in simple words. Read their UTC report and check times, separate from my mission date. Do not infer a local radiation dose or site-specific forecast.')}>Explain these reports</button></>}
        {tool === 'journal' && <FieldJournal key={journalTab} initialTab={journalTab} siteName={p.site.name} siteSlug={p.site.slug} photos={p.photos} maxPhotos={MAX_JOURNAL_PHOTOS} notes={notes.notes} notesSaved={notes.saved} flags={p.fieldFlags} lastInspection={p.lastInspection} archiveStatus={p.archiveStatus} visitor={{ eastM: east, northM: north }} flagPositions={flagPositions}
          onPhotoNote={p.onPhotoNote} onRemovePhoto={p.onRemovePhoto} onAddNote={text => { const id = addNote(text); if (activity === 'record') setJourney(j => completeActivity({ ...j, record: { ...j.record, noteId: id } }, 'record')) }} onUpdateNote={notes.update} onRemoveNote={notes.remove} onWalkTo={walkTo} onExport={exportJournal}
          onFace={faceSpot} onOpenPlanning={openPlanning} focus={f.bridge.markerPick} />}
      </div>
    </section>}

    {p.surfaceSelection && !paused && <div className="field-card-slot pointer-events-auto">
      <SurfaceInteraction selection={p.surfaceSelection} site={p.site} missions={p.missions} equipment={p.equipment} sun={sun} earth={earth} horizon={p.horizon} onEquipment={p.onEquipment} onSelect={(object, index) => p.onSurfaceObject(object, index)} onClose={p.onCloseSurfaceObject} onCompare={p.onCompareEquipment} canCompare={p.row + 14 * 24 <= p.sunRows.length - 1} panelMissionComparison={p.panelMissionComparison} />
      {objectiveOn && p.surfaceSelection.object === 'antenna' && (stage === 'point' || stage === 'walk') && <p className="field-card-objective" role="status"><strong>Objective · step {stage === 'walk' ? 2 : 3} of 3.</strong> {stage === 'walk' ? `Antenna spot: ${steps[1].detail}` : steps[2].detail}</p>}
      {objectiveOn && p.surfaceSelection.object === 'antenna' && stage === 'done' && <p className="field-card-objective is-done" role="status"><strong>Objective complete.</strong> The summary is in the objective card.</p>}
      <div className="field-card-foot"><span>{OBJECT_KIND[p.surfaceSelection.object]}</span><button className="field-chip" onClick={() => { addNote(`Inspected ${selectionLabel(p.surfaceSelection!)} (${OBJECT_KIND[p.surfaceSelection!.object]}).`); setToast('Added to your journal') }}><NotebookPen size={13} aria-hidden="true" />Add to journal</button></div>
    </div>}
    {groundCard && !p.surfaceSelection && !paused && <section className="visit-field-card field-ground-card pointer-events-auto" aria-label="Ground inspection">
      <header><span>Ground under the reticle · rendered DEM facet</span><button aria-label="Close ground inspection (Esc)" onClick={() => setGroundCard(false)}><X size={16} /></button></header>
      {decorative && <p className="field-illustrative"><strong>Illustrative rock — not a measured feature.</strong> Rocks are placed for scale and texture; the elevation model does not resolve individual rocks.</p>}
      <p>{p.fieldResult?.message}</p>
      {reading && <><dl>
        <dt>Latitude / longitude</dt><dd>{formatLatLon(reading.lat, reading.lonEast)}</dd>
        <dt>DEM datum elevation</dt><dd>{reading.elevationM.toFixed(1)} m</dd>
        <dt>Rendered facet slope</dt><dd>{reading.slopeDeg.toFixed(1)}°</dd>
        <dt>Range / DEM pixel size</dt><dd>{reading.rangeM.toFixed(1)} m / {reading.resolutionM} m</dd>
      </dl><p className="visit-field-scope">Slope comes from the rendered DEM mesh at this point ({demProduct}). It applies to this facet only and does not change with time. Composition, grain size, temperature and hazards are not measured.</p></>}
      <div className="field-row"><button className="field-button" onClick={() => p.onField('inspect')}>Inspect again · E</button>
        {reading && <button className="field-button" onClick={() => { addNote(`Ground inspection: rendered DEM facet slope ${reading.slopeDeg.toFixed(1)}°, DEM elevation ${reading.elevationM.toFixed(1)} m (${reading.resolutionM} m pixels) at ${formatLatLon(reading.lat, reading.lonEast)}.`, 'note', { ...here(), ...localOffsetM(p.site, reading.lat, reading.lonEast), lat: reading.lat, lonEast: reading.lonEast }); setToast('Inspection added to your journal') }}><NotebookPen size={14} aria-hidden="true" />Add to journal</button>}</div>
    </section>}

    {!moved && movementAvailable && <p className="field-hint">{hint}</p>}
    {touch && movementAvailable && <><TouchJoystick onWalk={p.onWalk} disabled={paused} /><JumpButton onJump={p.onJump} disabled={!p.terrain?.source} airborne={!!vp.airborne} /></>}

    <nav className="field-strip pointer-events-auto" aria-label="Field tools" data-narrow={narrow}>
      {tools.primary.map(b => <button key={b.id} className="field-tool" aria-label={b.label} aria-pressed={b.pressed} disabled={b.disabled} aria-keyshortcuts={b.key === 'Esc' ? 'Escape' : b.key} data-tip={`${b.label} · ${b.key}`} onClick={b.run}>
        <b.icon size={18} aria-hidden="true" /><span>{b.short ?? b.label}</span><kbd aria-hidden="true">{b.key}</kbd>
      </button>)}
      {tools.more.length > 0 && <button ref={moreButton} className="field-tool field-more-button" aria-expanded={moreOpen} aria-controls="field-more-sheet" aria-label={`More tools: ${tools.more.map(b => b.short ?? b.label).join(', ')}`} data-active={tools.more.some(b => b.pressed)} onClick={() => setMoreOpen(o => !o)}>
        <Ellipsis size={18} aria-hidden="true" /><span>More</span>
      </button>}
    </nav>
    {moreOpen && tools.more.length > 0 && <section ref={moreSheet} id="field-more-sheet" className="field-more pointer-events-auto" aria-labelledby="field-more-title">
      <header><h2 id="field-more-title">More tools</h2><button className="field-icon-button" aria-label="Close More tools (Esc)" onClick={() => setMoreOpen(false)}><X size={16} /></button></header>
      <div className="field-more-grid">
        {tools.more.map(b => <button key={b.id} className="field-more-item" aria-pressed={b.pressed} disabled={b.disabled} onClick={() => { setMoreOpen(false); b.run() }}>
          <b.icon size={18} aria-hidden="true" /><span>{b.label}</span>
        </button>)}
      </div>
    </section>}

    <FieldCompanion expanded={helpExpanded} onExpandedChange={setHelpExpanded} focused={helpReading} compact={!objectiveOn && !activity && !asking} lines={lines} retire={retire} captions={prefs.captions} readAloud={prefs.readAloud} reduced={reduced} quiet={tour || paused || missionMenu || asking || f.guideMode === 'chat'} reactionScene={reactionScene} reactions={f.reactions}
      walking={goTo?.label ?? null} onStopWalk={stopWalk} onFaceEarth={faceEarth} onFaceSun={faceSun} onOpenMap={() => openTool('map')} onAsk={openAsk} onGuideAction={f.onGuideAction} onCaptions={on => setPrefs({ ...prefs, captions: on })}
      onShowObjective={objectiveOn ? () => { stopToRead(); setDecision(null); setTool(null); setAsking(false); objective.setCollapsed(false); setObjectiveReveal(n => n + 1) } : undefined} objectiveLabel={`Steps · ${objectiveDoneCount(objective.progress)} of 3`}
      onReadAloud={on => setPrefs({ ...prefs, readAloud: on })} hidden={((captionsHidden || travelling) && !asking) || f.guideMode === 'chat'} onSpeaking={setSpeaking}
      onReveal={() => { stopToRead(); setDecision(null); setTool(null); setGroundCard(false); setMoreOpen(false); setArrival(false); if (p.surfaceSelection) p.onCloseSurfaceObject() }}>
      {asking && !paused && <AskBubble subject={subject} suggestions={askQuestions} session={f.companion} context={f.companionContext} sceneKey={JSON.stringify([p.site.slug, p.row])} onFreezeScene={() => p.onTime(p.row)} readScreen={readSurfaceScreen}
        onGuideAction={f.onGuideAction} onFocus={(body: 'sun' | 'earth') => body === 'earth' ? faceEarth() : faceSun()} onOpenChat={() => { setAsking(false); f.onAskBuri() }} onClose={() => setAsking(false)} />}
    </FieldCompanion>

    {paused && <PauseMenu siteName={p.site.name} prefs={prefs} reduced={reduced} speechAvailable={speechAvailable()} missionLink={linked} eyeHeightM={eye} analysisObserverHeightM={f.analysisObserverHeightM}
      objective={{ title: OBJECTIVE_TITLE, free: objective.progress.free || !!activity, onShow: () => { startActivity('earth'); resume() }, onHide: () => { setJourney(j => ({ ...j, active: null })); objective.setFree(true); resume() } }}
      activities={{ active: activity, done: [...journey.done, ...(objective.progress.aligned ? ['earth' as const] : [])], onStart: id => { resume(); startActivity(id) } }}
      qualityStore={f.bridge.qualityStore}
      onPrefs={setPrefs} onResume={resume} onReview={() => { wasPlaying.current = false; f.bridge.setPaused(false); openReview() }} onSetup={f.onSetup?()=>{resume();f.onSetup?.()}:undefined} onHelp={f.onHelp?()=>{resume();f.onHelp?.()}:undefined}
      onRecenter={target => { if (target === 'lander') { p.onFace(landerBearing, 0); point('lander') } else if (target === 'earth') faceEarth(); else faceSun(); resume() }}
      onReturnToLanding={() => { stopWalk(); p.onResetViewpoint(); resume() }}
      onBackToMission={() => { resume(); f.onBackToMission() }}
      onExit={() => { f.bridge.setPaused(false); p.onExit() }}
      onClassic={() => { resume(); setPrefs({ ...prefs, fieldMode: false }) }} />}
  </div>
}
