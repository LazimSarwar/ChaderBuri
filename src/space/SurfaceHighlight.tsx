import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import { useSurfaceFrame } from './useSurfaceFrame'
import { visitTerrainSampler } from './terrainSampler'

/**
 * Restrained selection and "locate this" cues for the illustrative surface objects: a rim (fresnel) glow drawn
 * over an object's own surfaces, a thin ring traced on the rendered DEM facets around it, and an optional slim
 * vertical beacon that stays a couple of pixels wide at any distance. Presentation only.
 */

const rimVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;varying vec3 vV;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=-mv.xyz;gl_Position=projectionMatrix*mv;
#include <logdepthbuf_vertex>
}`
const rimFragment = `
#include <logdepthbuf_pars_fragment>
uniform vec3 color;uniform float strength;varying vec3 vN;varying vec3 vV;
void main(){
#include <logdepthbuf_fragment>
float facing=abs(dot(normalize(vN),normalize(vV)));float rim=pow(1.0-facing,3.0);
gl_FragColor=vec4(color*strength*(rim+.06),1.0);
}`
/** Additive rim pass; it re-draws an object's own triangles at equal depth, so it never shows through anything. */
export function rimMaterial(color: T.ColorRepresentation, strength: number) {
  return new T.ShaderMaterial({
    vertexShader: rimVertex, fragmentShader: rimFragment,
    uniforms: { color: { value: new T.Color(color) }, strength: { value: strength } },
    transparent: true, depthWrite: false, depthFunc: T.LessEqualDepth, blending: T.AdditiveBlending,
  })
}

const noRaycast = () => {}
/**
 * Keep a rim overlay on every mesh under `target` (re-checked each frame, so parts created later are covered),
 * and remove it when the target changes. Skips decorative, focus-ignored, instanced and helper parts.
 */
export function useRim(target: T.Object3D | null, material: T.Material) {
  const added = useRef(new Map<T.Mesh, T.Mesh>())
  // Rim overlays are created on the first focus, so their program used to link mid-turn: a production trace and a
  // per-object probe measured 33–65 ms freezes, over a second while the clock ran. A hidden, never-drawn stand-in
  // lets the shader warm-up (which reveals hidden parts for its traversal) link it in the background first.
  const scene = useThree(s => s.scene)
  useEffect(() => {
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
    g.setAttribute('normal', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    const stand = new T.Mesh(g, material)
    stand.visible = false; stand.frustumCulled = false; stand.raycast = noRaycast
    stand.userData = { rimOverlay: true, focusIgnore: true, decorative: true }
    scene.add(stand)
    return () => { scene.remove(stand); g.dispose() }
  }, [scene, material])
  const clear = () => { for (const [mesh, overlay] of added.current) mesh.remove(overlay); added.current.clear() }
  useEffect(() => clear, [target])
  useFrame(() => {
    if (!target) return
    target.traverse(o => {
      const mesh = o as T.Mesh
      if (!mesh.isMesh || (mesh as T.InstancedMesh).isInstancedMesh || added.current.has(mesh) || mesh.userData.rimOverlay) return
      for (let p: T.Object3D | null = mesh; p && p !== target.parent; p = p.parent) if (p.userData.focusIgnore || p.userData.decorative || p instanceof T.ArrowHelper) return
      const geometry = mesh.geometry as T.BufferGeometry
      if (!geometry?.getAttribute('normal')) return
      const overlay = new T.Mesh(geometry, material)
      overlay.raycast = noRaycast; overlay.renderOrder = mesh.renderOrder + 1; overlay.frustumCulled = mesh.frustumCulled
      overlay.userData = { rimOverlay: true, focusIgnore: true, decorative: true }
      mesh.add(overlay); added.current.set(mesh, overlay)
    })
  })
}

/** Find the group that carries `userData.surfaceObject === id` (and payloadIndex when given). */
export function findSurfaceObject(scene: T.Object3D, id: string, payloadIndex?: number) {
  let found: T.Object3D | null = null
  scene.traverse(o => { if (!found && o.userData.surfaceObject === id && (payloadIndex === undefined || o.userData.payloadIndex === payloadIndex)) found = o })
  return found as T.Object3D | null
}

const SEGMENTS = 72
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 128, 0, 0)
  grad.addColorStop(0, 'rgb(255,255,255)'); grad.addColorStop(.25, 'rgb(150,150,150)'); grad.addColorStop(1, 'rgb(0,0,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128)
  return new T.CanvasTexture(c)
}

/**
 * A ground ring (and optional beacon) at an east/north offset from the visit target. The ring follows the
 * rendered DEM facets (one ray per vertex, cast once per placement), lifted a few centimetres.
 */
export function GroundCue({ runtime, clock, moon, at, radius, color, opacity, pulse = false, beacon = 0 }: {
  runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData
  at: { eastM: number; northM: number } | null; radius: number; color: string; opacity: number
  /** Pulse the ring and beacon softly (the canvas redraws at about 15 Hz while it pulses). */
  pulse?: boolean
  /** Beacon height in metres (0 = none). */
  beacon?: number
}) {
  const root = useSurfaceFrame(runtime, clock, moon, at?.eastM ?? 0, at?.northM ?? 0), { camera, invalidate } = useThree()
  const ring = useRef<T.Mesh>(null), beam = useRef<T.Mesh>(null), placed = useRef(''), lastPulse = useRef(0)
  const geometry = useMemo(() => {
    // Three loops of vertices: a soft inner fade, the bright edge, and its outer edge.
    const g = new T.BufferGeometry(), count = (SEGMENTS + 1) * 3, alpha = [0, 1, 0]
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3))
    const colours = new Float32Array(count * 4)
    for (let i = 0; i <= SEGMENTS; i++) for (let k = 0; k < 3; k++) colours.set([1, 1, 1, alpha[k]], (i * 3 + k) * 4)
    g.setAttribute('color', new T.BufferAttribute(colours, 4))
    const index: number[] = []
    for (let i = 0; i < SEGMENTS; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 1, c = a + 3, d = c + 1; index.push(a, c, b, b, c, d) }
    g.setIndex(index)
    return g
  }, [])
  const materials = useMemo(() => ({
    ring: new T.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, side: T.DoubleSide, toneMapped: false }),
    beam: new T.MeshBasicMaterial({ color, alphaMap: beamTexture(), transparent: true, opacity: opacity * .55, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false }),
  }), [color, opacity])
  useEffect(() => () => { geometry.dispose() }, [geometry])
  useEffect(() => () => { materials.ring.dispose(); materials.beam.alphaMap?.dispose(); materials.beam.dispose() }, [materials])
  const beamGeometry = useMemo(() => new T.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, .5, 0), [])
  useEffect(() => () => beamGeometry.dispose(), [beamGeometry])
  useFrame(() => {
    const node = root.current, a = runtime.visitAnchor, store = runtime.terrainStore
    if (!node) return
    if (!at) { node.visible = false; return }
    if (!node.visible || !a || !store) return
    // Trace the ring over the DEM once per placement (target, radius, anchor), a few centimetres up.
    const key = `${at.eastM}/${at.northM}/${radius}/${a.up.x}/${a.up.y}/${runtime.terrainMesh?.geometry.uuid}`
    if (placed.current !== key) {
      const sample = visitTerrainSampler(store, { lat: Math.asin(a.up.y) * 180 / Math.PI, lonEast: Math.atan2(-a.up.z, a.up.x) * 180 / Math.PI }), centre = sample(at.eastM, at.northM)
      if (centre == null) return
      const position = geometry.getAttribute('position') as T.BufferAttribute
      for (let i = 0; i <= SEGMENTS; i++) {
        const angle = i / SEGMENTS * Math.PI * 2;[radius - .32, radius - .03, radius + .03].forEach((r, k) => {
          const e = Math.sin(angle) * r, n = Math.cos(angle) * r, h = sample(at.eastM + e, at.northM + n) ?? centre
          position.setXYZ(i * 3 + k, e, h - centre - .025 + .05, -n)
        })
      }
      position.needsUpdate = true; geometry.computeBoundingSphere(); placed.current = key
    }
    const now = performance.now(), wave = pulse ? .5 + .5 * Math.sin(now / 1000 * Math.PI * 2 / 1.8) : 1
    materials.ring.opacity = opacity * (pulse ? .45 + .55 * wave : 1)
    if (beam.current) {
      // Keep the beacon about two pixels wide whatever the distance.
      const lens = camera as T.PerspectiveCamera, distanceM = camera.position.distanceTo(node.getWorldPosition(new T.Vector3())) * LUNAR_RADIUS_M
      // The beacon is for finding the object from afar; close by it would only cut through the view, so fade it out.
      const near = Math.min(1, Math.max(0, (distanceM - 6) / 6))
      beam.current.visible = beacon > 0 && near > 0
      const width = Math.max(.025, distanceM * Math.tan((lens.fov * Math.PI / 180) / 2) * 2 / Math.max(1, window.innerHeight) * 1.1)
      beam.current.scale.set(width, beacon, width)
      materials.beam.opacity = opacity * .55 * near * (pulse ? .55 + .45 * wave : 1)
    }
    if (pulse && now - lastPulse.current > 66) { lastPulse.current = now; setTimeout(() => invalidate(), 66) }
  })
  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false} userData={{ focusIgnore: true, decorative: true }}>
    <mesh ref={ring} geometry={geometry} material={materials.ring} renderOrder={3} frustumCulled={false} userData={{ focusIgnore: true }} />
    <mesh ref={beam} geometry={beamGeometry} material={materials.beam} renderOrder={3} visible={false} userData={{ focusIgnore: true }} />
  </group>
}
