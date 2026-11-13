import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import { LUNAR_GRAVITY_MPS2, MAX_MOTION_DELTA_S, WALK_SPEED_MPS } from '../lib/astronautMotion'
import { attitudeAt, type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import { useReducedMotion } from '../useReducedMotion'
import { updateLiveInstances } from './instanceUpdates'

// Fewer grains on lower-spec devices; all of them share one instanced draw call.
const lowSpec = typeof navigator !== 'undefined' && ((navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4)
const MAX_GRAINS = lowSpec ? 360 : 720
const SHEET_RATE = lowSpec ? 140 : 280 // grains per second at full plume-surface interaction
type Grain = { x: number; y: number; z: number; vx: number; vy: number; vz: number; ground: number; size: number; alive: boolean; ox: number; oz: number; range: number }

/**
 * Regolith kicked up by bootsteps and landings. In vacuum there is no drag and no
 * billowing cloud: each clump flies a clean parabola under lunar gravity and drops
 * straight back, the way it does in Apollo footage. Clump sizes are enlarged so they
 * stay visible; the motion, not the grain size, is the physical part.
 * Local frame: x east, y metres above the mean radius, z = -north (as the trail).
 */
export function LunarDust({ runtime, clock, moon, enabled }: { runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData; enabled: boolean }) {
  const root = useRef<T.Group>(null), mesh = useRef<T.InstancedMesh>(null), invalidate = useThree(s => s.invalidate), reduced = useReducedMotion()
  const grains = useMemo<Grain[]>(() => Array.from({ length: MAX_GRAINS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: 0, size: 0, alive: false, ox: 0, oz: 0, range: Infinity })), [])
  const geometry = useMemo(() => new T.DodecahedronGeometry(1, 0), [])
  const last = useRef({ steps: -1, airborne: false, fall: 0, east: 0, north: 0, cursor: 0, sheet: 0, burst: 0 })
  const scratch = useMemo(() => ({ object: new T.Object3D(), basis: new T.Quaternion(), matrix: new T.Matrix4() }), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // carry: the boot's own horizontal speed, so a walking kick throws dust ahead of the visitor.
  const spawn = (count: number, x: number, y: number, z: number, dirX: number, dirZ: number, spread: number, speed: [number, number], tilt: [number, number], carry: number) => {
    const state = last.current
    for (let i = 0; i < count; i++) {
      const g = grains[state.cursor]; state.cursor = (state.cursor + 1) % MAX_GRAINS
      const heading = Math.atan2(dirX, dirZ) + (Math.random() - .5) * spread, v = speed[0] + Math.random() * (speed[1] - speed[0]), up = tilt[0] + Math.random() * (tilt[1] - tilt[0])
      g.x = x + (Math.random() - .5) * .12; g.z = z + (Math.random() - .5) * .12; g.y = y + .02; g.ground = y
      g.vx = Math.sin(heading) * Math.cos(up) * v + dirX * carry; g.vz = Math.cos(heading) * Math.cos(up) * v + dirZ * carry; g.vy = Math.sin(up) * v
      g.size = .004 + Math.random() * .011; g.alive = true; g.ox = g.x; g.oz = g.z; g.range = Infinity
    }
  }
  /** Engine exhaust scouring the surface: a low-angle radial sheet, fast and far, still ballistic. */
  const spawnRadial = (count: number, x: number, y: number, z: number, speed: [number, number], tilt: [number, number], range: number) => {
    const state = last.current
    for (let i = 0; i < count; i++) {
      const g = grains[state.cursor]; state.cursor = (state.cursor + 1) % MAX_GRAINS
      const angle = Math.random() * Math.PI * 2, r = .6 + Math.random() * 1.6, v = speed[0] + Math.random() * (speed[1] - speed[0]), up = tilt[0] + Math.random() * (tilt[1] - tilt[0])
      g.x = x + Math.sin(angle) * r; g.z = z + Math.cos(angle) * r; g.y = y + .03; g.ground = y
      g.vx = Math.sin(angle) * Math.cos(up) * v; g.vz = Math.cos(angle) * Math.cos(up) * v; g.vy = Math.sin(up) * v
      g.size = .005 + Math.random() * .012; g.alive = true; g.ox = x; g.oz = z; g.range = range
    }
  }

  useFrame((_, delta) => {
    const node = root.current, instances = mesh.current, anchor = runtime.visitAnchor
    if (!node || !instances) return
    node.visible = enabled && !reduced && runtime.visit && runtime.terrainReady && !!anchor && !!runtime.visitLook
    const state = last.current
    if (!node.visible || !anchor || !runtime.visitLook) { state.steps = -1; return }

    scratch.basis.setFromRotationMatrix(scratch.matrix.makeBasis(anchor.east, anchor.up, anchor.north.clone().negate()))
    const q = attitudeAt(moon, clock.current.row)
    node.position.copy(anchor.up).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
    node.quaternion.copy(q).multiply(scratch.basis)

    const offset = runtime.visitOffset, astronaut = runtime.astronaut
    const moveEast = offset.eastM - state.east, moveNorth = offset.northM - state.north, moved = Math.hypot(moveEast, moveNorth)
    const carry = astronaut.airborne ? 0 : Math.min(WALK_SPEED_MPS * 1.15, moved / Math.max(delta, 1e-3))
    const yaw = runtime.visitLook.yaw, dirX = moved > 1e-4 ? moveEast / moved : Math.sin(yaw), dirZ = moved > 1e-4 ? -moveNorth / moved : -Math.cos(yaw)
    const nominal = { lat: Math.asin(anchor.up.y) * 180 / Math.PI, lonEast: Math.atan2(-anchor.up.z, anchor.up.x) * 180 / Math.PI }
    const groundAt = () => { const p = viewpointCoordinates(nominal, offset); return runtime.terrainStore?.bestHeight(p.lat, p.lonEast) ?? astronaut.feetM }
    // Bootstep: a forward kick from the trailing foot.
    if (state.steps >= 0 && runtime.trailStepCount > state.steps && !astronaut.airborne) {
      const ground = groundAt()
      if (ground != null) {
        const side = runtime.trailStepCount % 2 ? -.1 : .1
        spawn(24, offset.eastM + dirZ * -side + dirX * .25, ground, -offset.northM + dirX * side + dirZ * .25, dirX, dirZ, 1.1, [.5, 1.9], [.3, .95], carry)
      }
    }
    // Landing: a ring thrown outward, stronger for a faster fall.
    if (state.airborne && !astronaut.airborne) {
      const ground = astronaut.feetM ?? groundAt(), force = Math.min(1.5, Math.max(.6, Math.abs(state.fall) / 1.8))
      if (ground != null) spawn(44, offset.eastM, ground, -offset.northM, dirX, dirZ, Math.PI * 2, [.5 * force, 1.8 * force], [.15, .75], 0)
    }
    state.fall = astronaut.airborne ? Math.min(state.fall, astronaut.verticalMps) : 0
    state.steps = runtime.trailStepCount; state.airborne = astronaut.airborne; state.east = offset.eastM; state.north = offset.northM

    // Landing: the plume blows a radial sheet while low over the pad, then one burst at contact.
    const emitter = runtime.dustEmitter, burst = runtime.dustBurst
    if (emitter || (burst && burst.id !== state.burst)) {
      const pad = viewpointCoordinates(nominal, { eastM: (emitter ?? burst)!.eastM, northM: (emitter ?? burst)!.northM }), padGround = runtime.terrainStore?.bestHeight(pad.lat, pad.lonEast)
      if (padGround != null) {
        if (emitter) { state.sheet += SHEET_RATE * emitter.strength * Math.min(delta, MAX_MOTION_DELTA_S); const n = Math.floor(state.sheet); state.sheet -= n; if (n) spawnRadial(n, emitter.eastM, padGround, -emitter.northM, [7, 24], [.015, .12], 55) }
        if (burst && burst.id !== state.burst) { state.burst = burst.id; spawnRadial(burst.count, burst.eastM, padGround, -burst.northM, [2, 9], [.07, .45], 40) }
      }
    }
    const dt = Math.min(delta, MAX_MOTION_DELTA_S), object = scratch.object
    let count = 0
    for (const g of grains) {
      if (!g.alive) continue
      g.x += g.vx * dt; g.z += g.vz * dt; g.y += g.vy * dt - .5 * LUNAR_GRAVITY_MPS2 * dt * dt; g.vy -= LUNAR_GRAVITY_MPS2 * dt
      if (g.y <= g.ground || Math.hypot(g.x - g.ox, g.z - g.oz) > g.range) { g.alive = false; continue }
      object.position.set(g.x, g.y, g.z); object.scale.setScalar(g.size); object.rotation.set(g.x * 9, g.y * 7, g.z * 5); object.updateMatrix()
      instances.setMatrixAt(count++, object.matrix)
    }
    // A zero-count instanced mesh still has its attributes processed by WebGLObjects. Keep it out of the
    // render list entirely when empty, and upload only the live prefix when grains are actually visible.
    // The same matrices, order, grain count and ballistic integration are retained.
    updateLiveInstances(instances, count)
    if (count) invalidate()
  })

  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false}>
    <instancedMesh ref={node => { mesh.current = node; if (node) node.instanceMatrix.setUsage(T.DynamicDrawUsage) }} args={[geometry, undefined, MAX_GRAINS]} frustumCulled={false} castShadow>
      {/* Faint fill keeps clumps readable under the artificial display light; sunlight does the rest. */}
      <meshStandardMaterial color="#b8b3a8" emissive="#6e6a61" emissiveIntensity={.5} roughness={1} metalness={0} flatShading />
    </instancedMesh>
  </group>
}
