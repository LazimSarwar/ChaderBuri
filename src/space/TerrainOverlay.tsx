import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import { useSurfaceFrame } from './useSurfaceFrame'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { EQUIPMENT_POSITIONS, OUTPOST_POSITION } from '../lib/surfaceMission'
import { BURI_POSITION } from './BuriFigure'
import {
  alongBearing, clampRadius, contourCrossings, contourStepFor, CONTOUR_WEIGHT, demLabel, formatDistance, formatElevation, HUD_SURFACES, LABEL_PRIORITY,
  labelOpacity, labelScale, lineOfSightClear, OVERLAY_INK, OVERLAY_LINE_PX, OVERLAY_RAMP, reliefStats, ringsWithin, screenBounds, slopeDeg, SLOPE_BANDS_DEG,
  trianglesWithin, type OverlayMode, type ReliefStats, type TerrainOverlayInfo,
} from '../lib/overlayMath'
import { overlaySampler, toScreen, usePreRender, type OverlaySampler } from './overlayShared'
import { hudBlocks, LabelLayer, placeLabels, useLabelNodes, type LabelBlock, type LabelPlacement, type LabelSlot } from './overlayLabels'

export type TerrainOverlaySettings = { mode: OverlayMode; radiusM?: number; contourStepM?: number }
export type { TerrainOverlayInfo }

const MODE: Record<Exclude<OverlayMode, 'off'>, number> = { contours: 1, slope: 2, elevation: 3 }
// One palette for every mode: line inks (minor, index, under-stroke, ring, north) then the shared sequential ramp.
const PALETTE = [OVERLAY_INK.minor, OVERLAY_INK.index, OVERLAY_INK.halo, OVERLAY_INK.ring, OVERLAY_INK.north, ...OVERLAY_RAMP]
const MAX_MARKS = 6
const px = (v: number) => v.toFixed(2)
/** Hardware the labels keep off (illustrative footprint used for screen space only; no reading is attached). */
const LANDER = { footM: 2, bodyM: 1.3, topM: 4.1 }, BURI_BOX = { footM: .4, bodyM: .4, topM: 1.6 }

const vertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vM; varying vec3 vN;
void main(){
  // Exactly the terrain's own transform, so the overlay lands on the same depth as the measured ground.
  vM=position*${LUNAR_RADIUS_M.toFixed(1)};vN=normal;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  #include <logdepthbuf_vertex>
}`
const fragmentShader = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec2 uEye; uniform float uBase; uniform float uRadius; uniform float uMode; uniform float uStep; uniform vec2 uRange;
uniform float uOpacity; uniform float uLineWeight; uniform vec4 uRings; uniform vec3 uPal[${PALETTE.length}];
uniform vec4 uMarks[${MAX_MARKS}]; uniform vec3 uMarkColor[${MAX_MARKS}]; uniform int uMarkCount;
varying vec3 vM; varying vec3 vN;
// Anti-aliased line of about px pixels around d = 0 (fw = screen derivative of the measured quantity).
float lineAA(float d,float fw,float px){return 1.0-smoothstep(max(px*.5-.5,0.0)*fw,(px*.5+.5)*fw,d);}
vec3 over(vec3 base,float a,vec3 c,float b){return mix(base,c,b/max(a+b-a*b,1e-4));}
// The shared sequential ramp (uPal[5..9]) at t in [0, 1].
vec3 ramp(float t){t=clamp(t,0.0,1.0)*4.0;return t<1.0?mix(uPal[5],uPal[6],t):t<2.0?mix(uPal[6],uPal[7],t-1.0):t<3.0?mix(uPal[7],uPal[8],t-2.0):mix(uPal[8],uPal[9],t-3.0);}
void main(){
  #include <logdepthbuf_fragment>
  vec2 p=vM.xz-uEye; float r=length(p);
  // Height above the reference sphere from the drawn DEM surface (the mesh frame is tangent at the patch centre).
  float h=uBase+vM.y+dot(vM.xz,vM.xz)/(2.0*(${LUNAR_RADIUS_M.toFixed(1)}+uBase));
  // Every screen derivative is taken here, before any discard, branch or loop (loops below have constant bounds and
  // no early exits), which keeps the shader valid and quick to compile on ANGLE/Direct3D.
  // px: metres per pixel on the ground here.
  float v=h/uStep,v5=v/5.0,fv=fwidth(v),f5=fwidth(v5),fr=fwidth(r),px=max(fwidth(vM.x),fwidth(vM.z));
  if(r>uRadius) discard;
  vec3 col=vec3(0.0); float a=0.0;
  // One colour logic: elevation runs the ramp continuously, slope steps through the same five colours.
  if(uMode>2.5){
    col=ramp((h-uRange.x)/max(uRange.y-uRange.x,.05)); a=.3;
  }else if(uMode>1.5){
    // Slope of the DEM surface from its vertex normals (each the mean of the facets between neighbouring samples).
    float s=degrees(acos(clamp(normalize(vN).y,-1.0,1.0)));
    float b=smoothstep(${SLOPE_BANDS_DEG[0]}.0-.4,${SLOPE_BANDS_DEG[0]}.0+.4,s)+smoothstep(${SLOPE_BANDS_DEG[1]}.0-.4,${SLOPE_BANDS_DEG[1]}.0+.4,s)
      +smoothstep(${SLOPE_BANDS_DEG[2]}.0-.4,${SLOPE_BANDS_DEG[2]}.0+.4,s)+smoothstep(${SLOPE_BANDS_DEG[3]}.0-.4,${SLOPE_BANDS_DEG[3]}.0+.4,s);
    // Gentle on near-level ground (the regolith stays visible), a little stronger as the facets steepen.
    col=ramp(b/4.0); a=.26+.025*b;
  }
  // Contours in every mode: a dark under-stroke, then a light core (index contours wider and brighter). Widths are in
  // screen pixels so lines stay readable with distance; minor lines give way where they would crowd closer than ~4 px.
  float dm=abs(fract(v+.5)-.5),dj=abs(fract(v5+.5)-.5);
  float mVis=1.0-smoothstep(.16,.3,fv),jVis=1.0-smoothstep(.2,.38,f5);
  float halo=max(lineAA(dm,fv,${px(OVERLAY_LINE_PX.minorHalo)})*mVis*.75,lineAA(dj,f5,${px(OVERLAY_LINE_PX.indexHalo)})*jVis)*.5*uLineWeight;
  col=over(col,a,uPal[2],halo); a=a+halo-a*halo;
  float minor=lineAA(dm,fv,${px(OVERLAY_LINE_PX.minor)})*mVis*.8,major=lineAA(dj,f5,${px(OVERLAY_LINE_PX.index)})*jVis;
  float la=max(minor,major)*uLineWeight;
  col=over(col,a,major>=minor?uPal[1]:uPal[0],la); a=a+la-a*la;
  float dash=step(.42,fract(atan(p.y,p.x)*r/2.4));
  // Scale rings (dashed, constant pixel width, same under-stroke) around the visitor; unused rings have radius 0.
  for(int i=0;i<4;i++){
    float on=dash*step(.5,uRings[i]),d=abs(r-uRings[i]);
    float hl=lineAA(d,fr,${px(OVERLAY_LINE_PX.ringHalo)})*on*.45; col=over(col,a,uPal[2],hl); a=a+hl-a*hl;
    float l=lineAA(d,fr,${px(OVERLAY_LINE_PX.ring)})*on*.85; col=over(col,a,uPal[3],l); a=a+l-a*l;
  }
  // North chevron on the ground, 6.5 to 10 m north of the visitor (north is -z in the mesh frame).
  vec2 q=vec2(p.x,-p.y); float w=(10.0-q.y)*.3;
  float tri=step(6.5,q.y)*step(q.y,10.0)*smoothstep(w,w-.12,abs(q.x));
  float edge=tri*(1.0-smoothstep(w-.28,w-.12,abs(q.x))*step(6.75,q.y)*step(q.y,9.6));
  float nA=max(tri*.22,edge*.85); col=over(col,a,uPal[4],nA); a=a+nA-a*nA;
  // Landmark rings on the ground (the landing point also gets a centre dot), with the same under-stroke.
  for(int i=0;i<${MAX_MARKS};i++){
    float d=length(vM.xz-uMarks[i].xy),on=step(float(i)+.5,float(uMarkCount));
    float hl=lineAA(abs(d-uMarks[i].z),px,4.0)*.4*on; col=over(col,a,uPal[2],hl); a=a+hl-a*hl;
    float l=max(lineAA(abs(d-uMarks[i].z),px,1.8)*.9,(1.0-smoothstep(uMarks[i].z*.25,uMarks[i].z*.25+px,d))*.7*uMarks[i].w)*on;
    col=over(col,a,uMarkColor[i],l); a=a+l-a*l;
  }
  // Fade with distance and keep the ground at the visitor's feet clear.
  a*=uOpacity*(1.0-smoothstep(uRadius*.7,uRadius,r))*smoothstep(.8,2.4,r);
  if(a<.004) discard;
  gl_FragColor=vec4(col,a);
  #include <colorspace_fragment>
}`

type Landmark = { id: string; label: string; eastM: number; northM: number; topM: number; colour: string }
const RING_LABEL_LIFT = .15

/**
 * Picture-2 style spatial terrain overlay, drawn as a second pass over the rendered DEM patch (the same geometry and
 * transform, transparent, no depth writes), so it drapes exactly on the measured ground and is occluded by rocks and
 * hardware without z-fighting under the logarithmic depth buffer. Values (heights, slope, contours) come only from
 * the DEM; illustrative rocks and equipment get no readings. Labels are one DOM layer placed before each drawn frame.
 */
export function TerrainOverlay({ runtime, clock, moon, settings, equipment, buri, onInfo }: {
  runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData
  settings: TerrainOverlaySettings
  equipment?: { panel: boolean; antenna: boolean }
  /** Show Chader Buri as a landmark. */
  buri?: boolean
  onInfo?: (info: TerrainOverlayInfo | null) => void
}) {
  const mode = settings.mode === 'off' ? 'contours' : settings.mode
  const radiusM = clampRadius(settings.radiusM), stepOverride = settings.contourStepM
  const root = useSurfaceFrame(runtime, clock, moon, 0, 0)
  const get = useThree(s => s.get), invalidate = useThree(s => s.invalidate), scene = useThree(s => s.scene)
  const nodes = useLabelNodes()
  const landmarks = useMemo<Landmark[]>(() => [
    { id: 'landing', label: 'Landing point', eastM: 0, northM: 0, topM: .5, colour: '#9fe3b0' },
    { id: 'lander', label: 'Lander', eastM: OUTPOST_POSITION.eastM, northM: OUTPOST_POSITION.northM, topM: 3.6, colour: '#8fdcff' },
    ...(buri ? [{ id: 'buri', label: 'Chader Buri', eastM: BURI_POSITION.eastM, northM: BURI_POSITION.northM, topM: 2.05, colour: '#c9b8ff' }] : []),
    ...(equipment?.panel ? [{ id: 'panel', label: 'Solar panel', eastM: EQUIPMENT_POSITIONS.panel.eastM, northM: EQUIPMENT_POSITIONS.panel.northM, topM: 1.5, colour: '#ffd28a' }] : []),
    ...(equipment?.antenna ? [{ id: 'antenna', label: 'Antenna', eastM: EQUIPMENT_POSITIONS.antenna.eastM, northM: EQUIPMENT_POSITIONS.antenna.northM, topM: 1.9, colour: '#ffd28a' }] : []),
  ], [buri, equipment?.panel, equipment?.antenna])
  const rings = useMemo(() => ringsWithin(radiusM), [radiusM])

  const { mesh, uniforms, placeholder } = useMemo(() => {
    const uniforms = {
      uEye: { value: new T.Vector2() }, uBase: { value: 0 }, uRadius: { value: 120 }, uMode: { value: 1 }, uStep: { value: 1 },
      uRange: { value: new T.Vector2(0, 1) }, uOpacity: { value: 1 }, uLineWeight: { value: 1 }, uRings: { value: new T.Vector4() },
      uPal: { value: PALETTE.map(c => new T.Color(c)) },
      uMarks: { value: Array.from({ length: MAX_MARKS }, () => new T.Vector4()) },
      uMarkColor: { value: Array.from({ length: MAX_MARKS }, () => new T.Color()) }, uMarkCount: { value: 0 },
    }
    const material = new T.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, depthTest: true, depthFunc: T.LessEqualDepth, side: T.DoubleSide, toneMapped: false })
    // Shares the terrain's position/normal attributes (same GPU buffers) with its own small index of the
    // triangles under the disc, so only that footprint is drawn again.
    const placeholder = new T.BufferGeometry()
    const mesh = new T.Mesh(placeholder, material)
    mesh.name = 'terrain-overlay'
    mesh.renderOrder = 3
    mesh.visible = false
    mesh.raycast = () => {}
    mesh.userData = { focusIgnore: true, decorative: true }
    // Its world matrix is copied from the terrain mesh each frame (see the pre-render hook).
    mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false
    return { mesh, uniforms, placeholder }
  }, [])
  useEffect(() => () => {
    mesh.removeFromParent(); (mesh.material as T.Material).dispose()
    // Detach the terrain's attributes first: disposing must free only our index buffer, never the terrain's.
    placeholder.deleteAttribute('position'); placeholder.deleteAttribute('normal'); placeholder.dispose()
  }, [mesh, placeholder])
  const footprint = useRef({ source: null as T.BufferGeometry | null, eastM: NaN, northM: NaN, radiusM: 0, index: null as T.BufferAttribute | null })

  const sampler = useRef<OverlaySampler | null>(null)
  const cache = useRef({ statsKey: '', stats: null as ReliefStats | null, step: 1, h0: 0, losKey: '', los: new Map<string, boolean>(), contours: [] as { id: string; eastM: number; northM: number; level: number }[], info: '' })
  useEffect(() => { cache.current.statsKey = ''; cache.current.losKey = ''; invalidate() }, [mode, radiusM, stepOverride, landmarks, invalidate])
  const hud = useRef({ at: -1e9, blocks: [] as LabelBlock[] })
  const onInfoRef = useRef(onInfo); onInfoRef.current = onInfo
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; onInfoRef.current?.(null) } }, [])

  // Attach to the current terrain mesh (it is rebuilt as tiles refine) before the frame's matrices update.
  useFrame(() => {
    const terrain = runtime.terrainMesh
    if (!terrain) return
    // A direct child of the scene (not of the terrain's group hierarchy), so its renderOrder places it before later
    // full-view passes that clear depth or change the lens (the near-field glove pass); it still draws with exactly the
    // terrain's transform, copied before every frame.
    if (mesh.parent !== scene) { mesh.removeFromParent(); scene.add(mesh) }
    const source = terrain.geometry as T.BufferGeometry, f = footprint.current, v = runtime.visitOffset
    const position = source.getAttribute('position'), normal = source.getAttribute('normal'), index = source.getIndex()
    if (!position || !normal || !index) return
    // Re-select the triangles under the disc when the terrain is rebuilt or its buffers are swapped,
    // or after 10 m of walking. Sharing a stale (disposed) terrain buffer would draw nothing.
    const swapped = f.source !== source || placeholder.getAttribute('position') !== position || placeholder.getAttribute('normal') !== normal || f.index !== index
    if (swapped || f.radiusM !== radiusM || Math.hypot(v.eastM - f.eastM, v.northM - f.northM) > 10) {
      const picked = trianglesWithin(position.array, index.array, LUNAR_RADIUS_M, v.eastM, -v.northM, radiusM + 12)
      if (swapped || (placeholder.getIndex()?.count ?? 0) < picked.length) {
        // One index buffer per terrain patch, sized for the whole patch and partly filled (no per-walk allocation).
        placeholder.setAttribute('position', position); placeholder.setAttribute('normal', normal)
        placeholder.setIndex(new T.BufferAttribute(new Uint32Array(index.count), 1))
        placeholder.boundingSphere = source.boundingSphere
      }
      const target = placeholder.getIndex()!
      ;(target.array as Uint32Array).set(picked)
      target.clearUpdateRanges(); target.addUpdateRange(0, picked.length); target.needsUpdate = true
      placeholder.setDrawRange(0, picked.length)
      Object.assign(f, { source, eastM: v.eastM, northM: v.northM, radiusM, index })
    }
  })

  usePreRender(camera => {
    const node = root.current, c = cache.current, look = runtime.visitLook
    sampler.current = overlaySampler(runtime, sampler.current)
    const s = sampler.current
    if (!node?.visible || !look || !s || !runtime.terrainMesh) { mesh.visible = false; placeLabels(nodes.current, []); return }
    const sample = s.sample, visitor = runtime.visitOffset
    // Relief of the disc around the visitor: refreshed after 3 m of walking or a settings change.
    const statsKey = `${s.key}|${Math.round(visitor.eastM / 3)}|${Math.round(visitor.northM / 3)}|${radiusM}|${stepOverride ?? ''}`
    if (statsKey !== c.statsKey) {
      const h0 = sample(0, 0)
      if (h0 === null) { mesh.visible = false; placeLabels(nodes.current, []); return }
      c.statsKey = statsKey; c.h0 = h0
      c.stats = reliefStats(sample, visitor.eastM, visitor.northM, radiusM, 25)
      c.step = contourStepFor(c.stats.min, c.stats.max, stepOverride)
      const info: TerrainOverlayInfo = {
        mode, product: demLabel(s.dataset), source: s.dataset.source, credit: s.dataset.credit, spacingM: s.dataset.spacingM, radiusM,
        contourStepM: c.step, minM: c.stats.known ? +c.stats.min.toFixed(1) : null, maxM: c.stats.known ? +c.stats.max.toFixed(1) : null,
        coverage: c.stats.total ? +(c.stats.known / c.stats.total).toFixed(2) : 0,
        slopeHereDeg: (() => { const v = slopeDeg(sample, visitor.eastM, visitor.northM, Math.max(1, s.dataset.spacingM)); return v === null ? null : +v.toFixed(1) })(),
        coarse: s.dataset.spacingM > radiusM / 4,
      }
      const text = JSON.stringify(info)
      // Reported outside the render pass; only when something in it changed.
      if (text !== c.info) { c.info = text; setTimeout(() => { if (!alive.current) return; onInfoRef.current?.(info); invalidate() }, 0) }
    }
    const stats = c.stats!, h0 = c.h0
    uniforms.uEye.value.set(visitor.eastM, -visitor.northM)
    uniforms.uBase.value = h0
    uniforms.uRadius.value = radiusM
    uniforms.uMode.value = MODE[mode]
    uniforms.uLineWeight.value = CONTOUR_WEIGHT[mode]
    uniforms.uStep.value = c.step
    uniforms.uRange.value.set(stats.known ? stats.min : h0 - 1, stats.known ? stats.max : h0 + 1)
    uniforms.uRings.value.set(...([10, 25, 50, 100].map(r => rings.includes(r as typeof rings[number]) ? r : 0) as [number, number, number, number]))
    landmarks.slice(0, MAX_MARKS).forEach((l, i) => { uniforms.uMarks.value[i].set(l.eastM, -l.northM, l.id === 'landing' ? 1.1 : .75, l.id === 'landing' ? 1 : 0); uniforms.uMarkColor.value[i].set(l.colour) })
    uniforms.uMarkCount.value = Math.min(MAX_MARKS, landmarks.length)
    mesh.matrixWorld.copy(runtime.terrainMesh.matrixWorld)
    mesh.visible = true

    // Labels.
    const size = get().size, lens = camera as T.PerspectiveCamera
    const yaw = look.yaw * 180 / Math.PI
    const hfov = 2 * Math.atan(Math.tan((lens.fov ?? 42) * Math.PI / 360) * size.width / Math.max(1, size.height)) * 180 / Math.PI
    const side = Math.min(14, hfov * .3)
    const hereGround = sample(visitor.eastM, visitor.northM) ?? h0
    const eye = { eastM: visitor.eastM, northM: visitor.northM, h: hereGround + runtime.eyeHeightM }
    const losKey = `${statsKey}|${Math.round(visitor.eastM * 2)}|${Math.round(visitor.northM * 2)}|${Math.round(yaw / 8)}|${runtime.crouched}`
    const fresh = losKey !== c.losKey
    if (fresh) {
      c.losKey = losKey; c.los.clear(); c.contours = []
      // Index contours are labelled in every mode (the lines are drawn in every mode).
      for (const [k, bearing] of [yaw - side * .45, yaw + side * .45].entries()) {
        const profile: { distM: number; h: number | null }[] = []
        for (let d = 12; d <= radiusM * .8; d += 1.5) { const p = alongBearing(visitor.eastM, visitor.northM, bearing, d); profile.push({ distM: d, h: sample(p.eastM, p.northM) }) }
        contourCrossings(profile, c.step, 5, 14, 2).forEach((x, i) => { const p = alongBearing(visitor.eastM, visitor.northM, bearing, x.distM); c.contours.push({ id: `contour-${k * 2 + i}`, ...p, level: x.level }) })
      }
    }
    const visible = (id: string, eastM: number, northM: number, h: number) => {
      if (!c.los.has(id)) c.los.set(id, lineOfSightClear(sample, eye, { eastM, northM, h }))
      return c.los.get(id)!
    }
    const world = new T.Vector3(), screen = { x: 0, y: 0 }, out: LabelPlacement[] = []
    const project = (eastM: number, northM: number, h: number) => {
      world.set(eastM, h - h0, -northM)
      node.localToWorld(world)
      return toScreen(world, camera, size.width, size.height, screen) ? { x: screen.x, y: screen.y } : null
    }
    const onScreen = (s: { x: number; y: number } | null) => !!s && s.x > -80 && s.x < size.width + 80 && s.y > -40 && s.y < size.height + 60
    const place = (id: string, eastM: number, northM: number, lift: number, priority: number, opacity: number, text?: string, los = true, alts: { eastM: number; northM: number }[] = [], owner?: string) => {
      const ground = sample(eastM, northM)
      if (ground === null || opacity <= 0) return
      const h = ground + lift
      if (los && !visible(id, eastM, northM, h)) return
      const at = project(eastM, northM, h)
      if (!at || !onScreen(at)) return
      const distance = Math.hypot(eastM - visitor.eastM, northM - visitor.northM)
      const others = alts.map(a => { const g = sample(a.eastM, a.northM); return g === null ? null : project(a.eastM, a.northM, g + lift) }).filter((s): s is { x: number; y: number } => onScreen(s))
      out.push({ id, ...at, opacity, scale: labelScale(distance), priority, text, alts: others, owner })
    }
    // Rings: on the right of the view, else the left, else a little nearer the centre line.
    for (const r of rings) {
      const at = (b: number) => alongBearing(visitor.eastM, visitor.northM, b, r), p = at(yaw + side)
      place(`ring-${r}`, p.eastM, p.northM, RING_LABEL_LIFT, LABEL_PRIORITY.ring, labelOpacity(r, radiusM) * .95, undefined, false, [at(yaw - side), at(yaw + side * .6), at(yaw - side * .6)])
    }
    const north = alongBearing(visitor.eastM, visitor.northM, 0, 11.2)
    place('north', north.eastM, north.northM, .05, LABEL_PRIORITY.north, 1, undefined, false)
    for (const l of landmarks) {
      const d = Math.hypot(l.eastM - visitor.eastM, l.northM - visitor.northM)
      if (d < 1.2) continue
      place(`mark-${l.id}`, l.eastM, l.northM, l.topM, LABEL_PRIORITY.landmark, labelOpacity(d, radiusM), formatDistance(d), true, [], l.id)
    }
    for (const x of c.contours) place(x.id, x.eastM, x.northM, .08, LABEL_PRIORITY.contour, labelOpacity(Math.hypot(x.eastM - visitor.eastM, x.northM - visitor.northM), radiusM), formatElevation(x.level))
    // Keep labels off the lander, Chader Buri and the HUD panels (each keeps its own pin).
    const blocks: LabelBlock[] = [...hudBlocks(hud.current, get().gl.domElement, HUD_SURFACES)]
    // A frustum around the hardware: legs' footprint at the ground, the narrower body at the top (8 bearings each).
    const box = (id: string, eastM: number, northM: number, b: { footM: number; bodyM: number; topM: number }) => {
      const g = sample(eastM, northM); if (g === null) return
      const corners: ({ x: number; y: number } | null)[] = []
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, c = Math.cos(a), sn = Math.sin(a); corners.push(project(eastM + c * b.footM, northM + sn * b.footM, g), project(eastM + c * b.bodyM, northM + sn * b.bodyM, g + b.topM)) }
      if (corners.some(s => !s)) return
      const rect = screenBounds(corners, 4); if (rect) blocks.push({ ...rect, owner: id })
    }
    box('lander', OUTPOST_POSITION.eastM, OUTPOST_POSITION.northM, LANDER)
    if (buri) box('buri', BURI_POSITION.eastM, BURI_POSITION.northM, BURI_BOX)
    placeLabels(nodes.current, out, blocks, size)
  })

  const slots = useMemo<LabelSlot[]>(() => [
    ...rings.map(r => ({ id: `ring-${r}`, className: 'ovl-ring', content: `${r} m` })),
    { id: 'north', className: 'ovl-north', content: 'N' },
    ...landmarks.map(l => ({ id: `mark-${l.id}`, content: <span className="ovl-pin" style={{ '--pin': l.colour } as React.CSSProperties}><i /><b>{l.label}</b><span data-text /></span> })),
    ...[0, 1, 2, 3].map(i => ({ id: `contour-${i}`, className: 'ovl-contour', content: <span data-text /> })),
  ], [rings, landmarks])
  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false}>
    <LabelLayer nodes={nodes} slots={slots} />
  </group>
}
