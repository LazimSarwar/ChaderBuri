import { useEffect, useRef } from 'react'
import { suitAudio } from './suitSound'
import type { VisitPose } from './lib/visit'
import type { VisitPoseStore } from './explore/visitPoseStore'

/** Turns surface movement into sound heard inside the helmet. Renders nothing. */
export function SuitAudio({ enabled, landed, pose: fallbackPose, poseSource }: { enabled: boolean; landed: boolean; pose: VisitPose | null; poseSource?: VisitPoseStore }) {
  const prev = useRef<{ steps: number; airborne: boolean; fallMps: number } | null>(null)
  useEffect(() => { suitAudio.setEnabled(enabled) }, [enabled])
  useEffect(() => () => suitAudio.setEnabled(false), [])
  useEffect(() => {
    suitAudio.setBreathing(enabled && landed)
    return () => suitAudio.setBreathing(false)
  }, [enabled, landed])
  useEffect(() => {
    const update = () => {
    const pose = poseSource?.getSnapshot() ?? fallbackPose
    if (!pose || !landed || !enabled) { prev.current = null; return }
    const before = prev.current, steps = pose.trailSteps ?? 0, airborne = !!pose.airborne
    if (before) {
      if (steps > before.steps && !airborne) suitAudio.step()
      if (!before.airborne && airborne) suitAudio.jump()
      if (before.airborne && !airborne) suitAudio.land(before.fallMps)
    }
    prev.current = { steps, airborne, fallMps: airborne ? Math.min(before?.airborne ? before.fallMps : 0, pose.verticalMps ?? 0) : 0 }
    }
    update(); return poseSource?.subscribe(update)
  }, [poseSource, fallbackPose, landed, enabled])
  return null
}
