import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as T from 'three'
import type { Line2 } from 'three-stdlib'
import { useSurfaceFrame } from './useSurfaceFrame'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import {
  aimElevation, appearStep, attentionPose, BURI_NEAR_M, frameBearing, guideArc, idleHover, isAttentive, isSpeaking, pointingTarget, skyDirection,
  speakingCadence, type CharacterState, type PointTarget, type Vec3,
} from '../lib/characterController'
import { useGroundContacts } from './SurfaceContact'
import { EQUIPMENT_POSITIONS, OUTPOST_POSITION } from '../lib/surfaceMission'
import { useReducedMotion } from '../useReducedMotion'
import { radialTexture } from './surfaceTextures'
/** Where she waits: beside the lander, in view from the standing spot. Local metres east/north. */
export const BURI_POSITION = { eastM: 4.6, northM: -.2 }
const HEIGHT = 1.45, WIDTH = HEIGHT * 640 / 960
/** She stands on a small projector puck; the image starts just above its lens. */
const LIFT = .07
const BEAM = '#8fd3ff'
/** Hardware she can point at: offsets from her, and a sensible aim height on each (metres). */
const OBJECTS: Record<'lander' | 'antenna' | 'panel', { eastM: number; northM: number; aimM: number }> = {
  lander: { ...OUTPOST_POSITION, aimM: 1.9 },
  antenna: { ...EQUIPMENT_POSITIONS.antenna, aimM: 1.2 },
  panel: { ...EQUIPMENT_POSITIONS.panel, aimM: .8 },
}
const SKY_REACH_M = 34
/** The emitter's own ground point, read from the rendered DEM mesh so its light lies on the drawn facet. */
const CENTRE = [[0, 0]] as const
const UP = new T.Vector3(0, 1, 0)
const ARC_SEGMENTS = 40
/** Stable seed data for the arc line (drei rebuilds its geometry when these identities change). */
const ARC_SEED: [number, number, number][] = [[0, 0, 0], [0, .01, 0]]
const ARC_SEED_COLOURS: [number, number, number][] = [[1, 1, 1], [1, 1, 1]]

export type BuriTargets = { sun: { az: number; el: number }; earth: { az: number; el: number }; skyline: { az: number; el: number } }
export type BuriPresence = {
  /** Point at a sky direction or a piece of hardware; null stops pointing; undefined follows her state. */
  pointAt?: PointTarget | null
  /** Speaking cue (emitter pulse and rim cadence); defaults to her talking state. */
  speaking?: boolean
  /** The visitor is near her or asking: she turns fully toward them. */
  attentive?: boolean
  /** What she attends to when not pointing or addressed (the open card's object or the activity's target). */
  lookAt?: PointTarget | null
  /** False dematerialises her (she stays mounted); default true. */
  visible?: boolean
}

/**
 * Writes arc points and colours into the line's existing segment buffers (allocating them once), so re-aiming never
 * leaves orphaned GPU buffers behind (LineGeometry.setPositions/setColors allocate new ones on every call).
 */
function writeArc(geometry: Line2['geometry'], points: number[], colours: number[]) {
  const segments = points.length / 3 - 1
  const start = geometry.getAttribute('instanceStart') as T.InterleavedBufferAttribute | undefined
  const colour = geometry.getAttribute('instanceColorStart') as T.InterleavedBufferAttribute | undefined
  if (!start || !colour || start.data.array.length !== segments * 6 || colour.data.array.length !== segments * 6) {
    geometry.setPositions(points); geometry.setColors(colours); return
  }
  const p = start.data.array as Float32Array, c = colour.data.array as Float32Array
  for (let i = 0; i < segments; i++) for (let k = 0; k < 6; k++) { p[i * 6 + k] = points[i * 3 + k]; c[i * 6 + k] = colours[i * 3 + k] }
  start.data.needsUpdate = true; colour.data.needsUpdate = true
  geometry.computeBoundingBox(); geometry.computeBoundingSphere()
}

/** Vertical fade for the projection beam (alpha map reads green). */
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 128, 0, 0)
  grad.addColorStop(0, 'rgb(255,255,255)'); grad.addColorStop(.12, 'rgb(150,150,150)'); grad.addColorStop(.6, 'rgb(40,40,40)'); grad.addColorStop(1, 'rgb(0,0,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128)
  return new T.CanvasTexture(c)
}

/**
 * Her artwork drawn as a companion projection: unchanged colours, a cool inner edge glow, faint scanlines and a
 * slow sweep (static under reduced motion), slight translucency, and a brightness matched to the lit scene
 * (tone mapped like everything else) instead of a full-white sticker. `uAppear` builds the image from the lens up
 * behind a thin scan edge (materialise) and takes it back down (dematerialise); `uSpeak` lifts the rim while she talks.
 */
function projectionMaterial(texture: T.Texture) {
  const size = (texture.image as { width?: number; height?: number }) ?? {}
  const uniforms = {
    uTime: { value: 0 }, uLevel: { value: .68 }, uRim: { value: new T.Color(BEAM) }, uRimGain: { value: 1 },
    uTexel: { value: new T.Vector2(3 / (size.width || 640), 3 / (size.height || 960)) }, uAppear: { value: 0 }, uSpeak: { value: 0 },
  }
  const material = new T.MeshBasicMaterial({ map: texture, transparent: true, opacity: .88, alphaTest: .35, side: T.DoubleSide, depthWrite: false })
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = 'uniform float uTime;uniform float uLevel;uniform vec3 uRim;uniform float uRimGain;uniform vec2 uTexel;uniform float uAppear;uniform float uSpeak;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
      float buriNear=min(min(texture2D(map,vMapUv+vec2(uTexel.x,0.0)).a,texture2D(map,vMapUv-vec2(uTexel.x,0.0)).a),min(texture2D(map,vMapUv+vec2(0.0,uTexel.y)).a,texture2D(map,vMapUv-vec2(0.0,uTexel.y)).a));
      float buriRim=clamp((sampledDiffuseColor.a-buriNear)*2.5,0.0,1.0);
      float buriEdge=uAppear*1.12-.06+.006*sin(vMapUv.x*90.0);
      float buriShown=1.0-smoothstep(buriEdge-.015,buriEdge+.015,vMapUv.y);
      float buriBand=exp(-pow((vMapUv.y-buriEdge)*55.0,2.0))*step(uAppear,.999);
      if(buriShown+buriBand*sampledDiffuseColor.a<.02) discard;`)
      .replace('#include <opaque_fragment>', `float buriScan=.95+.05*sin(vMapUv.y*520.0-uTime*3.0);
      float buriSweep=exp(-pow((fract(uTime*.07)*1.4-.2-vMapUv.y)*12.0,2.0));
      outgoingLight=outgoingLight*uLevel*buriScan*buriShown+uRim*(buriRim*(1.1+.9*uSpeak)*uRimGain*buriShown+buriSweep*.06*buriShown+buriBand*1.6)+uRim*(.03+.03*uSpeak)*buriShown;
      diffuseColor.a*=mix(.55,1.0,smoothstep(0.0,.06,vMapUv.y))*(.93+.07*buriScan)*max(buriShown,buriBand*.9);
      #include <opaque_fragment>`)
  }
  return { material, uniforms }
}

/**
 * Chader Buri standing on the surface: a camera-facing projection of her artwork from a small emitter puck, so she
 * always looks exactly like the character elsewhere in the app. The texture loads the first time she is seen.
 * Motion advances only on frames the app draws anyway; only bounded transitions (materialising, the pointing arc
 * drawing out) request a few extra frames. Reduced motion makes all of it static.
 */
export function BuriFigure({ runtime, clock, moon, state, targets, onSelect, presence, motionScale = 1 }: {
  runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData; state: CharacterState
  targets: BuriTargets
  onSelect?: () => void
  presence?: BuriPresence
  /** The scene's motion scale; 0 makes everything static (as operating-system reduced motion does). */
  motionScale?: number
}) {
  const root = useSurfaceFrame(runtime, clock, moon, BURI_POSITION.eastM, BURI_POSITION.northM), body = useRef<T.Group>(null)
  const { camera, invalidate } = useThree(), osReduced = useReducedMotion(), [texture, setTexture] = useState<T.Texture | null>(null), requested = useRef(false)
  const reduced = osReduced || !(motionScale > 0)
  const projection = useMemo(() => texture ? projectionMaterial(texture) : null, [texture])
  const props = useMemo(() => {
    const glow = radialTexture([[0, 'rgba(160,215,255,.9)'], [.35, 'rgba(120,190,255,.35)'], [1, 'rgba(100,170,255,0)']]), beam = beamTexture()
    return {
    glow, beam,
    housing: new T.MeshStandardMaterial({ color: '#2b2f33', metalness: .7, roughness: .4 }),
    lens: new T.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: .85, toneMapped: false }),
    pool: new T.MeshBasicMaterial({ map: glow, color: '#ffffff', transparent: true, opacity: .34, blending: T.AdditiveBlending, depthWrite: false }),
    baseRing: new T.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: .3, blending: T.AdditiveBlending, depthWrite: false }),
    ripple: new T.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
    cone: new T.MeshBasicMaterial({ color: BEAM, alphaMap: beam, transparent: true, opacity: .13, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    reticle: new T.MeshBasicMaterial({ color: '#f1dfa6', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: T.DoubleSide }),
    glint: new T.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
    flare: new T.SpriteMaterial({ map: glow, color: BEAM, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
    }
  }, [])
  useEffect(() => () => { for (const v of Object.values(props)) v.dispose() }, [props])
  useEffect(() => () => projection?.material.dispose(), [projection])
  useEffect(() => () => { texture?.dispose() }, [texture])

  // Emitter base (puck, ground light, rings) lies on the rendered facet under her, not on a level plane through it.
  const contacts = useGroundContacts(runtime, root, CENTRE), contact = contacts[0] ?? null
  const base = useMemo(() => {
    if (!contact) return { position: new T.Vector3(), quaternion: new T.Quaternion() }
    const n = new T.Vector3(...contact.normal).normalize()
    return { position: new T.Vector3(...contact.position), quaternion: new T.Quaternion().setFromUnitVectors(UP, n.y > .5 ? n : UP) }
  }, [contact])
  const parts = useRef({ flare: null as T.Sprite | null, pool: null as T.Mesh | null, ripple: null as T.Mesh | null, cone: null as T.Group | null, reticle: null as T.Mesh | null, glint: null as T.Mesh | null, arc: null as Line2 | null })
  const anim = useRef({ last: 0, appear: 0, yaw: 0, yawReady: false, arcKey: '', arcDraw: 0, arcPoints: [] as number[], target: null as PointTarget | null, sky: false })
  const present = presence?.visible !== false
  const target = pointingTarget(state, presence?.pointAt)
  const speaking = isSpeaking(state, presence?.speaking), attentive = isAttentive(state, presence?.attentive), lookAt = presence?.lookAt ?? null
  const sunEl = targets.sun.el

  useFrame(() => {
    const node = root.current, a = anim.current, now = performance.now(), dt = a.last ? Math.min(.1, (now - a.last) / 1000) : 0
    a.last = now
    if (!node?.visible) return
    if (!requested.current) {
      requested.current = true
      new T.TextureLoader().load('/chader-buri-guide.webp', t => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; setTexture(t); invalidate() })
    }
    const t = reduced ? 0 : now / 1000
    // Materialise once the artwork is ready; dematerialise when hidden. Bounded, so it may request frames.
    const appearTarget: 0 | 1 = present && projection ? 1 : 0
    a.appear = appearStep(a.appear, appearTarget, dt, reduced)
    if (a.appear !== appearTarget) invalidate()
    const shown = a.appear
    // Readable in sunlight and in darkness: a little brighter image in sun, a stronger rim and ground light in shadow.
    const dark = 1 - T.MathUtils.smoothstep(sunEl, -1, 3)
    const cadence = speaking ? speakingCadence(t, reduced) : 0
    if (projection) {
      const u = projection.uniforms
      u.uTime.value = t
      u.uAppear.value = shown
      u.uLevel.value = .74 - .12 * dark
      u.uRimGain.value = .85 + .3 * dark
      u.uSpeak.value = speaking ? .35 + .65 * cadence : 0
    }
    props.lens.opacity = (.6 + .25 * shown) * (speaking ? .8 + .2 * cadence : 1)
    props.pool.opacity = shown * (.2 + .16 * dark + (speaking ? .08 * cadence : 0))
    props.baseRing.opacity = shown * (.22 + .14 * dark)
    props.cone.opacity = shown * (.09 + .06 * dark)
    // Lens glow: restrained in sunlight, a little stronger in shadow; it breathes with her voice only while speaking.
    props.flare.opacity = shown * (.35 + .3 * dark) * (speaking ? .85 + .3 * cadence : 1)
    const p = parts.current
    if (p.pool) p.pool.scale.setScalar(1 + .25 * dark)
    if (p.cone) p.cone.scale.set(.4 + .6 * Math.min(1, shown * 1.6), Math.min(1, shown * 1.4) || .001, .4 + .6 * Math.min(1, shown * 1.6))
    // Emitter pulse while speaking: a soft ring leaving the lens (static ring under reduced motion).
    if (p.ripple) {
      const phase = reduced ? .45 : (t * .62) % 1
      p.ripple.visible = speaking && shown > .5
      p.ripple.scale.setScalar(.35 + phase * 1.1)
      props.ripple.opacity = (reduced ? .28 : .42 * (1 - phase)) * shown
    }

    // Facing: toward the visitor about the vertical axis, plus a small turn toward what she attends to.
    const local = node.worldToLocal(camera.position.clone()), b = body.current
    const visitorBearing = frameBearing(local.x, local.z)
    const aimAt = (which: PointTarget): { aim: Vec3; sky: boolean } => {
      if (which === 'sun' || which === 'earth' || which === 'skyline') {
        // A body just under the skyline is shown at the skyline, never into the ground.
        const d = skyDirection(targets[which].az, aimElevation(targets[which].el))
        return { aim: { x: d.x * SKY_REACH_M, y: 1.05 + d.y * SKY_REACH_M, z: d.z * SKY_REACH_M }, sky: true }
      }
      const o = OBJECTS[which]
      return { aim: { x: o.eastM - BURI_POSITION.eastM, y: o.aimM, z: -(o.northM - BURI_POSITION.northM) }, sky: false }
    }
    let aim: Vec3 | null = null, sky = false
    if (target) ({ aim, sky } = aimAt(target))
    const look = !target && lookAt ? aimAt(lookAt).aim : null
    // Near or addressed: she faces the visitor; otherwise toward what she points at or attends to.
    const near = Math.hypot(local.x, local.z) < BURI_NEAR_M
    const offset = attentionPose({ visitorBearing, pointBearing: aim ? frameBearing(aim.x, aim.z) : null, lookBearing: look ? frameBearing(look.x, look.z) : null, attentive, near })
    if (b) {
      const face = Math.atan2(local.x, local.z), goal = face - offset * Math.PI / 180
      if (!a.yawReady || reduced) { a.yaw = goal; a.yawReady = true }
      else {
        const diff = Math.atan2(Math.sin(goal - a.yaw), Math.cos(goal - a.yaw))
        a.yaw += diff * (1 - Math.exp(-dt * 4))
        if (Math.abs(diff) > .004) invalidate()
      }
      b.rotation.y = a.yaw
      // A slight lean toward a pointed object or sky direction; gentle hover on drawn frames.
      const lean = aim ? Math.max(-1, Math.min(1, ((frameBearing(aim.x, aim.z) - visitorBearing + 540) % 360 - 180) / 60)) * .025 : 0
      b.rotation.z += (lean - b.rotation.z) * (reduced ? 1 : 1 - Math.exp(-dt * 4))
      b.position.y = idleHover(t, reduced)
    }

    // Pointing arc: from beside her, along a gentle curve to the object or out toward the sky direction.
    const arc = p.arc
    if (arc) {
      const on = !!aim && shown > .6
      const side = aim ? Math.sign(Math.sin((frameBearing(aim.x, aim.z) - visitorBearing) * Math.PI / 180)) || 1 : 1
      // "Hand" point: beside her at chest height, on the side of the target as the visitor sees her.
      const start = { x: Math.cos(a.yaw) * .3 * side * -1, y: 1.08, z: Math.sin(a.yaw) * .3 * side }
      const key = on && aim ? `${target}|${aim.x.toFixed(1)}|${aim.y.toFixed(1)}|${aim.z.toFixed(1)}|${start.x.toFixed(1)}|${start.z.toFixed(1)}` : ''
      if (key !== a.arcKey) {
        if (!a.arcKey || target !== a.target) a.arcDraw = 0
        a.arcKey = key; a.target = target; a.sky = sky
        if (on && aim) {
          const length = Math.hypot(aim.x - start.x, aim.y - start.y, aim.z - start.z)
          a.arcPoints = guideArc(start, aim, sky ? Math.min(1.2, length * .04) : .35 + length * .18, ARC_SEGMENTS)
          const colours: number[] = []
          for (let i = 0; i <= ARC_SEGMENTS; i++) { const f = i / ARC_SEGMENTS, k = sky ? Math.pow(1 - f, 1.6) : .55 + .45 * (1 - f); colours.push(.95 * k, .87 * k, .66 * k) }
          writeArc(arc.geometry, a.arcPoints, colours)
        }
      }
      arc.visible = on
      if (on) {
        a.arcDraw = reduced ? 1 : Math.min(1, a.arcDraw + dt / .6)
        if (a.arcDraw < 1) invalidate()
        arc.geometry.instanceCount = Math.max(1, Math.round(a.arcDraw * ARC_SEGMENTS))
      }
      // End reticle: a small ring at the object, or far out along the sky direction; a glint travels the arc.
      if (p.reticle) {
        p.reticle.visible = on && a.arcDraw >= 1
        if (on && aim && a.arcPoints.length) {
          const n = a.arcPoints.length
          p.reticle.position.set(a.arcPoints[n - 3], a.arcPoints[n - 2], a.arcPoints[n - 1])
          p.reticle.quaternion.copy(node.getWorldQuaternion(new T.Quaternion()).invert().multiply(camera.quaternion))
          p.reticle.scale.setScalar(sky ? 2.6 : 1)
          props.reticle.opacity = sky ? .55 : .8
        }
      }
      if (p.glint) {
        p.glint.visible = on && !reduced && a.arcPoints.length > 0
        if (p.glint.visible) {
          const f = (t * .45) % 1, i = Math.min(ARC_SEGMENTS, Math.floor(f * ARC_SEGMENTS * Math.min(1, a.arcDraw)))
          p.glint.position.set(a.arcPoints[i * 3], a.arcPoints[i * 3 + 1], a.arcPoints[i * 3 + 2])
          props.glint.opacity = .8 * (sky ? 1 - f : 1)
        }
      }
    }
  })
  const click = (e: ThreeEvent<MouseEvent>) => { if (runtime.dragged || e.delta > 3) return; e.stopPropagation(); onSelect?.() }
  const decor = { focusIgnore: true, decorative: true }
  const bubble = texture && present && (state.bubble || state.pose === 'listening')
  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false}>
    {/* Emitter base on the rendered DEM facet under her: a small dark puck with a lit lens ring, a soft cool light
        pool on the ground (stronger in shadow), a thin base ring and, while she speaks, a ripple. Lifted a few millimetres
        along the facet normal so it never fights the terrain under the logarithmic depth buffer. */}
    <group position={base.position} quaternion={base.quaternion}>
      <mesh position={[0, .022, 0]} castShadow receiveShadow material={props.housing} userData={decor}><cylinderGeometry args={[.13, .15, .045, 28]} /></mesh>
      <mesh position={[0, .046, 0]} rotation={[-Math.PI / 2, 0, 0]} material={props.lens} userData={decor}><ringGeometry args={[.07, .1, 32]} /></mesh>
      <mesh ref={m => { parts.current.pool = m }} position={[0, .012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} material={props.pool} userData={decor}><planeGeometry args={[1.6, 1.6]} /></mesh>
      <mesh position={[0, .014, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} material={props.baseRing} userData={decor}><ringGeometry args={[.36, .375, 48]} /></mesh>
      <mesh ref={m => { parts.current.ripple = m }} visible={false} position={[0, .016, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} material={props.ripple} userData={decor}><ringGeometry args={[.3, .33, 48]} /></mesh>
    </group>
    {/* Everything above the lens stands vertical from the puck's height. */}
    <group position={[0, base.position.y, 0]}>
      {/* Lens glow: a small soft point of light where the projection leaves the emitter. */}
      <sprite ref={m => { parts.current.flare = m }} position={[0, .08, 0]} scale={[.42, .42, 1]} material={props.flare} renderOrder={2} userData={decor} raycast={() => null} />
      {/* Faint projection beam widening up from the lens, fading with height (grows in as she materialises). */}
      <group ref={g => { parts.current.cone = g }} position={[0, .05, 0]}>
        <mesh position={[0, (HEIGHT + .1) / 2, 0]} renderOrder={1} material={props.cone} userData={decor}><cylinderGeometry args={[.5, .09, HEIGHT + .1, 36, 1, true]} /></mesh>
      </group>
      <group ref={body}>
        {projection && <mesh position={[0, LIFT + HEIGHT / 2, 0]} onClick={click} renderOrder={2} material={projection.material} userData={{ surfaceObject: 'buri' }}>
          <planeGeometry args={[WIDTH, HEIGHT]} />
        </mesh>}
        {bubble && <Html position={[0, LIFT + HEIGHT + .25, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <div className="buri-scene-bubble" data-pose={state.pose}>{state.pose === 'listening' ? <span className="buri-thinking" aria-label="Chader Buri is thinking"><i /><i /><i /></span> : state.bubble}</div>
        </Html>}
      </group>
    </group>
    {/* Pointing guide: thin fading arc, end reticle and a small travelling glint (static under reduced motion). */}
    <Line ref={l => { const line = l as unknown as Line2 | null; if (line && parts.current.arc !== line) { line.visible = false; line.raycast = () => {}; line.userData = decor } parts.current.arc = line }} points={ARC_SEED} vertexColors={ARC_SEED_COLOURS} lineWidth={1.8} transparent opacity={.9} depthWrite={false} />
    <mesh ref={m => { parts.current.reticle = m }} visible={false} material={props.reticle} userData={decor} raycast={() => null}><ringGeometry args={[.14, .17, 32]} /></mesh>
    <mesh ref={m => { parts.current.glint = m }} visible={false} material={props.glint} userData={decor} raycast={() => null}><sphereGeometry args={[.035, 10, 8]} /></mesh>
  </group>
}
