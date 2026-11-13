import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import { landingAt, LANDING, LANDING_DURATION, T_CONTACT, T_LANDED } from '../lib/landingProfile'
import { landingStore } from '../lib/landingStore'
import { OUTPOST_POSITION } from '../lib/surfaceMission'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import { ASTRONAUT_EYE_HEIGHT_M } from '../lib/astronautMotion'
import { localFrame, sitePosition } from '../data'
import { attitudeAt, type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import type { LanderState } from '../lib/contracts'
import { useReducedMotion } from '../useReducedMotion'
import { suitAudio } from '../suitSound'
import { landingFraming } from './arrivalFraming'

/** The lander at rest on its pad: identical to the exhibit before this sequence existed. */
export const LANDED_STATE: LanderState = { phase: 'landed', eastM: OUTPOST_POSITION.eastM, northM: OUTPOST_POSITION.northM, altM: 0, pitchDeg: 0, headingDeg: 0, legStance: 1, plume: 0, t: 0 }
export type LandingRun = { start: number | null; observer: { eastM: number; northM: number }; approachDeg: number; burst: boolean; fov: number }
export type LandingStage = 'pending' | 'descent' | 'done'

const RAD = Math.PI / 180
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }
const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const dir = (bearingDeg: number) => ({ e: Math.sin(bearingDeg * RAD), n: Math.cos(bearingDeg * RAD) })

/**
 * First view after landing, from the standing spot: the lander in frame for scale and purpose, turned a little
 * toward Earth (or else the Sun) when it is near the lander's bearing so the sky direction reads too, and the
 * horizon across the middle. Composition only: the arrival time, Sun and Earth directions are unchanged.
 * Earth is kept at least 14 degrees off centre so finding it stays the visitor's first task.
 */
export function arrivalLook(runtime: Runtime, moon: BodyData, row: number) {
  const lander = Math.atan2(OUTPOST_POSITION.eastM, OUTPOST_POSITION.northM), a = runtime.visitAnchor, moonAt = runtime.positions.get('Moon')
  let yaw = lander - 6 * RAD, pitch = -.03
  if (!a || !moonAt) return { yaw, pitch }
  const inverse = attitudeAt(moon, row).invert()
  const sky = (name: string) => { const p = runtime.positions.get(name); if (!p) return null; const v = p.clone().sub(moonAt).applyQuaternion(inverse).normalize(); return { az: Math.atan2(v.dot(a.east), v.dot(a.north)), el: Math.asin(Math.max(-1, Math.min(1, v.dot(a.up)))) } }
  for (const body of [sky('Earth'), sky('Sun')]) {
    if (!body || body.el < 0 || body.el > 28 * RAD) continue
    const diff = wrapRad(body.az - lander)
    if (Math.abs(diff) > 52 * RAD) continue
    const shift = Math.abs(diff) < 14 * RAD ? 0 : Math.max(-20 * RAD, Math.min(20 * RAD, diff - Math.sign(diff) * 14 * RAD))
    yaw = lander + shift; pitch = Math.max(-.03, Math.min(.12, body.el * .3))
    break
  }
  return { yaw, pitch }
}

/**
 * Time-compressed landing simulation played in the surface frame after the orbital approach.
 * Writes the one canonical lander transform (`runtime.lander`) and points the standing camera
 * at it from an observer point; walking and footprints are suspended until it hands back.
 */
export function LandingSequence({ runtime, clock, moon, enabled, onStage, motionScale = 1 }: { runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData; enabled: boolean; onStage?: (stage: LandingStage) => void
  /** Strength of the touchdown camera shake (0..1); reduced motion skips the sequence entirely. */
  motionScale?: number }) {
  const { camera, scene, invalidate } = useThree(), reduced = useReducedMotion()
  const look = useRef({ yaw: 0, pitch: 0, ready: false }), shadowLight = useRef<T.DirectionalLight | null>(null), shake = useRef(0)
  const nominal = () => { const a = runtime.visitAnchor!; return { lat: Math.asin(a.up.y) / RAD, lonEast: Math.atan2(-a.up.z, a.up.x) / RAD } }
  const groundAt = (eastM: number, northM: number) => { const p = viewpointCoordinates(nominal(), { eastM, northM }); return runtime.terrainReady ? runtime.terrainStore?.bestHeight(p.lat, p.lonEast) ?? null : null }

  const finish = () => {
    const run = runtime.landing
    runtime.landing = null; runtime.lander = { ...LANDED_STATE }; runtime.dustEmitter = null
    landingStore.telemetry = null; landingStore.skipRequested = false
    if (run?.start != null) {
      // Hand the camera back at the normal standing spot, facing the lander; start a clean trail.
      runtime.visitOffset = { eastM: 0, northM: 0 }
      runtime.trail = []; runtime.trailOrigin = null; runtime.trailRevision++; runtime.trailDistanceM = 0; runtime.trailStepCount = 0
      if (runtime.visitLook) runtime.visitLook = arrivalLook(runtime, moon, clock.current.row)
      const lens = camera as T.PerspectiveCamera; lens.fov = run.fov; lens.updateProjectionMatrix()
    }
    look.current.ready = false
    onStage?.('done'); invalidate()
  }

  /** Observer stands toward the Sun so the lander is front-lit; the lander crosses the view. */
  const setup = (run: LandingRun) => {
    const a = runtime.visitAnchor!, q = attitudeAt(moon, clock.current.row)
    const sun = runtime.positions.get('Sun')!.clone().sub(runtime.positions.get('Moon')!).applyQuaternion(q.clone().invert())
    const sunAz = Math.atan2(sun.dot(a.east), sun.dot(a.north)) / RAD
    for (const distance of [52, 44, 36]) for (const offset of [0, 30, -30, 60, -60, 90, -90]) {
      const d = dir(sunAz + offset), eastM = OUTPOST_POSITION.eastM + d.e * distance, northM = OUTPOST_POSITION.northM + d.n * distance
      if (groundAt(eastM, northM) == null) continue
      run.observer = { eastM, northM }; run.approachDeg = sunAz + offset + 110; run.fov = (camera as T.PerspectiveCamera).fov
      return true
    }
    return false
  }

  useFrame((_, delta) => {
    const run = runtime.landing
    if (!run) return
    if (!runtime.visit) { if (run.start !== null) finish(); return }
    if (!runtime.visitAnchor || !runtime.visitLook) return
    if (run.start === null) {
      // Skipped before the descent could start (terrain still loading): hand over at once instead of waiting.
      if (landingStore.skipRequested) { landingStore.skipRequested = false; runtime.landing = null; runtime.lander = { ...LANDED_STATE }; if (runtime.visitLook) runtime.visitLook = arrivalLook(runtime, moon, clock.current.row); onStage?.('done'); invalidate(); return }
      if (!enabled || reduced) { runtime.landing = null; runtime.lander = { ...LANDED_STATE }; if (runtime.visitLook) runtime.visitLook = arrivalLook(runtime, moon, clock.current.row); onStage?.('done'); return }
      // Wait for terrain and for the surface shader programs to finish linking, so the descent never stalls.
      if (!runtime.terrainReady || !runtime.shadersWarm) { invalidate(); return }
      if (!setup(run)) { runtime.landing = null; runtime.lander = { ...LANDED_STATE }; onStage?.('done'); return }
      run.start = performance.now(); onStage?.('descent')
      scene.traverse(o => { if (!shadowLight.current && o instanceof T.DirectionalLight && o.castShadow) shadowLight.current = o })
    }
    const now = performance.now()
    if (landingStore.skipRequested) { landingStore.skipRequested = false; run.start = now - LANDING_DURATION * 1000 }
    const t = (now - run.start) / 1000
    if (t >= LANDING_DURATION) { finish(); return }

    const p = landingAt(t), approach = dir(run.approachDeg)
    const pad = OUTPOST_POSITION, landerE = pad.eastM + approach.e * p.rangeM, landerN = pad.northM + approach.n * p.rangeM
    runtime.lander = { phase: p.phase, eastM: landerE, northM: landerN, altM: p.altM, pitchDeg: p.pitchDeg, headingDeg: (run.approachDeg + 180) % 360, legStance: p.legStance, plume: p.plume, t }
    // Plume-surface interaction: dust streams out radially below ~25 m, then one burst at contact.
    runtime.dustEmitter = p.plume > .05 && p.altM < 25 ? { eastM: pad.eastM, northM: pad.northM, strength: p.plume * (1 - p.altM / 25) } : null
    if (!run.burst && t >= T_CONTACT) { run.burst = true; shake.current = now; runtime.dustBurst = { id: now, eastM: pad.eastM, northM: pad.northM, count: 90 }; suitAudio.land(2.4) }

    // Camera: track the lander from the observer point, then walk to the standing spot beside it.
    const step = smooth((t - T_LANDED) / LANDING.tStepOut)
    const eyeE = run.observer.eastM * (1 - step), eyeN = run.observer.northM * (1 - step)
    runtime.visitOffset = { eastM: eyeE, northM: eyeN }
    const padGround = groundAt(pad.eastM, pad.northM) ?? 0, eyeGround = groundAt(eyeE, eyeN) ?? padGround
    const dx = landerE - eyeE, dn = landerN - eyeN, horizontal = Math.max(1, Math.hypot(dx, dn))
    const dz = padGround + p.altM + 1.3 - (eyeGround + ASTRONAUT_EYE_HEIGHT_M)
    const padDistance = Math.max(1, Math.hypot(pad.eastM - eyeE, pad.northM - eyeN))
    const framing = landingFraming(Math.atan2(padGround - eyeGround - ASTRONAUT_EYE_HEIGHT_M, padDistance), Math.atan2(dz, horizontal))
    const yawTarget = Math.atan2(dx, dn), pitchTarget = framing.pitch
    const k = look.current.ready ? 1 - Math.exp(-Math.min(delta, .05) * 5) : 1
    look.current.yaw += wrapRad(yawTarget - look.current.yaw) * k
    look.current.pitch += (pitchTarget - look.current.pitch) * k
    look.current.ready = true
    // Touchdown: a brief ground shake felt through the boots (scaled by motionScale), damped within a second.
    const since = (now - shake.current) / 1000, jolt = shake.current && since < .9 ? Math.max(0, Math.min(1, motionScale)) * .007 * Math.exp(-since * 5) : 0
    runtime.visitLook = { yaw: look.current.yaw + jolt * Math.sin(since * 71), pitch: look.current.pitch + jolt * 1.4 * Math.sin(since * 97 + 1) }
    // Keep the ground in view as context; a tight upward lens left the approach against an empty black sky.
    const lens = camera as T.PerspectiveCamera, distance = Math.hypot(horizontal, dz)
    const fov = run.fov * step + framing.fov * (1 - step)
    if (Math.abs(lens.fov - fov) > .05) { lens.fov = fov; lens.updateProjectionMatrix() }

    // Telemetry for the overlay, including where the lander is on screen.
    const a = runtime.visitAnchor, q = attitudeAt(moon, clock.current.row), point = viewpointCoordinates(nominal(), { eastM: landerE, northM: landerN })
    const frame = localFrame(sitePosition(point.lat, point.lonEast))
    const world = new T.Vector3(...frame.up).multiplyScalar(1 + (padGround + p.altM + 1.3) / LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
    const ndc = world.clone().project(camera), inView = ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1
    landingStore.telemetry = { ...p, screen: inView ? { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 } : null, distanceM: distance }
    void a
    if (shadowLight.current) shadowLight.current.shadow.needsUpdate = true
    invalidate()
  }, -1)
  return null
}
