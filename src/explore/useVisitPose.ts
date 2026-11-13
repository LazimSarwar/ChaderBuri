import { useMemo, useSyncExternalStore } from 'react'
import type { VisitPose } from '../lib/visit'
import type { VisitPoseStore } from './visitPoseStore'
import type { SurfaceFocus } from '../lib/surfacePolish'

const emptySnapshot = () => null
const noSubscription = () => () => {}

export function useVisitPose(store: VisitPoseStore | undefined, fallback: VisitPose): VisitPose
export function useVisitPose(store: VisitPoseStore | undefined, fallback: VisitPose | null): VisitPose | null
export function useVisitPose(store: VisitPoseStore | undefined, fallback: VisitPose | null) {
  return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getSnapshot ?? emptySnapshot, emptySnapshot) ?? fallback
}

export function useVisitFocus(store: VisitPoseStore | undefined, fallback: SurfaceFocus | null) {
  const focus = useSyncExternalStore(store?.subscribeFocus ?? noSubscription, store?.getFocusSnapshot ?? emptySnapshot, emptySnapshot)
  // A null focus from the live store means the reticle moved off equipment; do not resurrect the fallback.
  return store ? focus : fallback
}

/** Stable selector: instrument sheets do not need sub-pixel camera changes. */
export function useQuantizedPose(store: VisitPoseStore | undefined, fallback: VisitPose): VisitPose {
  const selector = useMemo(() => {
    let prior: VisitPose | null = null, key = ''
    const get = () => {
      const p = store?.getSnapshot(); if (!p) return null
      const next = { ...p, eastM: Math.round((p.eastM ?? 0)*2)/2, northM: Math.round((p.northM ?? 0)*2)/2,
        heading: Math.round(p.heading/5)*5, pitch: Math.round(p.pitch/5)*5, fov: Math.round(p.fov),
        eyeHeightM: Math.round((p.eyeHeightM ?? 1.7)*10)/10, groundM: Math.round(p.groundM ?? 0),
        heightAboveGroundM: Math.round((p.heightAboveGroundM ?? 0)*10)/10, verticalMps: Math.round(p.verticalMps ?? 0),
        lat: undefined, lonEast: undefined, trailDistanceM: Math.round(p.trailDistanceM ?? 0) }
      // Quantise notification keys, never the coordinates/angles used by field measurements or activities.
      const k = JSON.stringify(next); if (k !== key) { key=k; prior={ ...p } }; return prior
    }
    const subscribe = (notify: () => void) => {
      if (!store) return () => {}
      let timer: ReturnType<typeof setTimeout> | undefined, last = 0, flags = ''
      const phase = () => { const p = store.getSnapshot(); return `${!!p}/${!!p?.walking}/${!!p?.airborne}/${!!p?.crouched}/${!!p?.movementBlocked}` }
      const emit = () => { timer = undefined; last = performance.now(); flags = phase(); notify() }
      const release = store.subscribe(() => {
        const elapsed = performance.now() - last
        if (phase() !== flags || elapsed >= 200) { clearTimeout(timer); emit() }
        else if (!timer) timer = setTimeout(emit, 200 - elapsed)
      })
      return () => { clearTimeout(timer); release() }
    }
    return { get, subscribe }
  }, [store])
  return useSyncExternalStore(selector.subscribe, selector.get, emptySnapshot) ?? fallback
}
