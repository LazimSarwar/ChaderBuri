import { useCallback, useMemo, useRef, useState } from 'react'
import { createQualityStore } from './qualityStore'
import type { TerrainSampler } from './terrainGrid'
import { newJourney, type JourneyState, type OverlayMode, type QualityReport } from './fieldJourney'
import { effectiveMotionScale, type SurfacePreferences } from '../lib/surfacePolish'
import { useReducedMotion } from '../useReducedMotion'
import type { TerrainOverlayInfo } from '../lib/overlayMath'

export type MissionLink = { slug: string; row: number; siteName: string; landingUTC: string; source: 'plan' | 'compare' }
export type GoToState = 'walking' | 'arrived' | 'blocked' | 'cancelled'
export type GoToTarget = { id: number; eastM: number; northM: number; label: string }

/** What the field interface asks the scene to show (props the world and overlay layers read; all optional there). */
export type HighlightObject = 'lander' | 'antenna' | 'panel' | null
export type FieldMarker = { id: string; eastM: number; northM: number; label: string; kind: 'photo' | 'note' | 'flag' | 'landing' | 'route' }
export type BuriPoint = 'sun' | 'earth' | 'skyline' | 'lander' | 'antenna' | 'panel' | null
/**
 * Chader Buri's in-scene cue from the field state: where she points (short-lived, once per activity step or "Show me"),
 * whether she is speaking (read aloud or a fresh caption), whether she is addressed, and what she keeps facing.
 */
export type BuriCue = { pointAt: BuriPoint; speaking: boolean; attentive: boolean; lookAt: BuriPoint }
export type FieldSceneExtras = {
  highlightObject: HighlightObject
  terrainOverlay: { mode: OverlayMode; radiusM?: number; contourStepM?: number }
  fieldMarkers: FieldMarker[]
  routeLine?: { eastM: number; northM: number }[]
  buri: BuriCue
}
const NO_EXTRAS: FieldSceneExtras = { highlightObject: null, terrainOverlay: { mode: 'off' }, fieldMarkers: [], buri: { pointAt: null, speaking: false, attentive: false, lookAt: null } }
const sameExtras = (a: FieldSceneExtras, b: FieldSceneExtras) => a.highlightObject === b.highlightObject && a.terrainOverlay.mode === b.terrainOverlay.mode
  && JSON.stringify(a.routeLine ?? []) === JSON.stringify(b.routeLine ?? [])
  && a.buri.pointAt === b.buri.pointAt && a.buri.speaking === b.buri.speaking && a.buri.attentive === b.buri.attentive && a.buri.lookAt === b.buri.lookAt
  && a.fieldMarkers.length === b.fieldMarkers.length && a.fieldMarkers.every((m, i) => { const n = b.fieldMarkers[i]; return m.id === n.id && m.label === n.label && Math.abs(m.eastM - n.eastM) < 0.05 && Math.abs(m.northM - n.northM) < 0.05 })

/**
 * The link between the field interface and the 3D scene: the DEM sampler the scene reports,
 * guided walks (goTo / onGoTo), pointer lock, the paused state, the scene extras the field asks for
 * (highlight, overlay, markers, Chader Buri's cue), the scene's quality report, and the field journey
 * (kept here so a trip to the dashboard and back resumes it). App owns one bridge and passes
 * `scene` (plus `display(prefs)`) to SpaceScene and `field` to the field interface.
 */
export function useFieldBridge() {
  const reduced = useReducedMotion()
  const [sampler, setSampler] = useState<TerrainSampler | null>(null)
  const [goTo, setGoTo] = useState<GoToTarget | null>(null)
  const [walk, setWalk] = useState<{ id: number; state: GoToState } | null>(null)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [paused, setPaused] = useState(false)
  const [inputBlocked, setInputBlocked] = useState(false)
  const [extras, setExtrasState] = useState<FieldSceneExtras>(NO_EXTRAS)
  const [qualityStore] = useState(createQualityStore)
  const [markerPick, setMarkerPick] = useState<{ id: string; n: number } | null>(null)
  // What the ground overlay draws and from which DEM product/resolution (for the HUD legend); null while it is off.
  const [overlayInfo, setOverlayInfo] = useState<TerrainOverlayInfo | null>(null)
  const onTerrainOverlayInfo = useCallback((info: TerrainOverlayInfo | null) => setOverlayInfo(prev => JSON.stringify(prev) === JSON.stringify(info) ? prev : info), [])
  const [journeys, setJourneys] = useState<Record<string, JourneyState>>({})
  // Per visit: the arrival card and welcome have been shown for these sites (not repeated after the dashboard).
  const welcomed = useRef(new Set<string>())
  const nextId = useRef(1), goToRef = useRef<GoToTarget | null>(null)
  const onTerrainSampler = useCallback((sample: TerrainSampler | null) => setSampler(() => sample), [])
  const onGoTo = useCallback((id: number, state: GoToState) => {
    setWalk({ id, state })
    if (state !== 'walking' && goToRef.current?.id === id) { goToRef.current = null; setGoTo(null) }
  }, [])
  const requestGoTo = useCallback((target: { eastM: number; northM: number; label: string } | null) => {
    if (!target) {
      const current = goToRef.current
      if (current) setWalk({ id: current.id, state: 'cancelled' })
      goToRef.current = null; setGoTo(null)
      return
    }
    const id = nextId.current++, next = { id, ...target }
    goToRef.current = next
    setWalk({ id, state: 'walking' })
    setGoTo(next)
  }, [])
  const setExtras = useCallback((next: FieldSceneExtras | null) => setExtrasState(prev => { const n = next ?? NO_EXTRAS; return sameExtras(prev, n) ? prev : n }), [])
  const onQuality = useCallback((report: QualityReport) => qualityStore.publish(report), [qualityStore])
  const onMarkerSelect = useCallback((id: string) => setMarkerPick(p => ({ id, n: (p?.n ?? 0) + 1 })), [])
  const setJourney = useCallback((slug: string, change: (j: JourneyState) => JourneyState) => setJourneys(all => { const before = all[slug] ?? newJourney(), after = change(before); return after === before ? all : { ...all, [slug]: after } }), [])
  const reset = useCallback(() => { goToRef.current = null; setGoTo(null); setWalk(null); setPaused(false); setInputBlocked(false); setExtrasState(NO_EXTRAS); welcomed.current.clear() }, [])
  const scene = useMemo(() => ({
    onTerrainSampler, onGoTo, onPointerLock: setPointerLocked,
    goTo: goTo ? { id: goTo.id, eastM: goTo.eastM, northM: goTo.northM } : null,
    movementPaused: paused || inputBlocked,
    highlightObject: extras.highlightObject, terrainOverlay: extras.terrainOverlay, fieldMarkers: extras.fieldMarkers, routeLine: extras.routeLine, onMarkerSelect, onQuality, onTerrainOverlayInfo,
  }), [onTerrainSampler, onGoTo, goTo, paused, inputBlocked, extras, onMarkerSelect, onQuality, onTerrainOverlayInfo])
  /** Presentation settings for the scene: the quality choice and the motion strength (none with reduced motion). */
  const display = (prefs: Pick<SurfacePreferences, 'quality' | 'motionScale' | 'suitLamp' | 'fieldMode'>) => ({ quality: prefs.quality, motionScale: effectiveMotionScale(prefs, reduced), suitLamp: prefs.fieldMode && prefs.suitLamp })
  const field = { sampler, goTo, walk, requestGoTo, pointerLocked, paused, setPaused, setInputBlocked, extras, setExtras, qualityStore, markerPick, journeys, setJourney, welcomed: welcomed.current, overlayInfo: extras.terrainOverlay.mode === 'off' ? null : overlayInfo }
  return { scene, field, reset, display, buriCue: extras.buri }
}
export type FieldBridge = ReturnType<typeof useFieldBridge>['field']
