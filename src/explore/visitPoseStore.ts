import type { VisitPose } from '../lib/visit'
import type { SurfaceFocus } from '../lib/surfacePolish'

/** Presentation telemetry only. The scene remains the owner of movement and ground calculations. */
export type VisitPoseStore = ReturnType<typeof createVisitPoseStore>

export function createVisitPoseStore() {
  let snapshot: VisitPose | null = null
  const listeners = new Set<() => void>()
  let focus: SurfaceFocus | null = null
  const focusListeners = new Set<() => void>()
  const publishFocus = (next: SurfaceFocus | null) => {
    if (focus === next || (focus && next && focus.object === next.object && focus.payloadIndex === next.payloadIndex && focus.label === next.label && focus.distanceM === next.distanceM)) return
    focus = next ? { ...next } : null
    for (const listener of [...focusListeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    getFocusSnapshot: () => focus,
    publishFocus,
    subscribeFocus(listener: () => void) {
      focusListeners.add(listener)
      return () => { focusListeners.delete(listener) }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** True only on entry/exit: App needs those transitions, not every mouse or walking update. */
    publish(pose: VisitPose | null) {
      if (!pose) publishFocus(null)
      const surfaceChanged = (snapshot === null) !== (pose === null)
      if (snapshot === pose || (snapshot && pose &&
        Object.keys({ ...snapshot, ...pose }).every(key => snapshot![key as keyof VisitPose] === pose[key as keyof VisitPose]))) return false
      snapshot = pose ? { ...pose } : null
      for (const listener of [...listeners]) listener()
      return surfaceChanged
    },
  }
}
