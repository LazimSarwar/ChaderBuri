import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as T from 'three'
import { useSurfaceFrame } from './useSurfaceFrame'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { formatDistance, HUD_SURFACES, labelScale } from '../lib/overlayMath'
import { overlaySampler, toScreen, usePreRender, type OverlaySampler } from './overlayShared'
import { hudBlocks, LabelLayer, placeLabels, useLabelNodes, type LabelBlock, type LabelPlacement, type LabelSlot } from './overlayLabels'

export type FieldMarkerKind = 'photo' | 'note' | 'flag' | 'landing' | 'route'
export type FieldMarker = { id: string; eastM: number; northM: number; label: string; kind: FieldMarkerKind }

export const MARKER_COLOURS: Record<FieldMarkerKind, string> = { photo: '#8fdcff', note: '#c9b8ff', flag: '#ffd28a', landing: '#9fe3b0', route: '#80dcf6' }
const KIND_NAME: Record<FieldMarkerKind, string> = { photo: 'Photo', note: 'Note', flag: 'Flag', landing: 'Landing', route: 'Route' }
/** Labels show within this distance (or while hovered); pins dim beyond FAR_M. */
export const MARKER_LABEL_M = 16
const FAR_M = 30
const POLE = 1.25

/**
 * Journal photos, notes and flags as small pins standing on the measured DEM at their east/north offsets. They carry
 * the visitor's own annotation only: no reading is attached to illustrative rocks or equipment. Click selects.
 */
export function FieldMarkers({ runtime, clock, moon, markers, onSelect }: {
  runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData
  markers: FieldMarker[]
  onSelect?: (id: string) => void
}) {
  const root = useSurfaceFrame(runtime, clock, moon, 0, 0)
  const get = useThree(s => s.get), invalidate = useThree(s => s.invalidate)
  const nodes = useLabelNodes(), pins = useRef(new Map<string, PinParts>()), hovered = useRef<string | null>(null)
  const sampler = useRef<OverlaySampler | null>(null), placed = useRef(''), hud = useRef({ at: -1e9, blocks: [] as LabelBlock[] })
  useEffect(() => { placed.current = ''; invalidate() }, [markers, invalidate])
  useEffect(() => () => { if (hovered.current) document.body.style.cursor = '' }, [])

  const markerKey=useMemo(()=>markers.map(m=>`${m.id}:${m.eastM}:${m.northM}`).join(','),[markers])
  const world=useMemo(()=>new T.Vector3(),[])
  usePreRender(camera => {
    const node = root.current
    sampler.current = overlaySampler(runtime, sampler.current)
    const s = sampler.current
    if (!node?.visible || !s) { placeLabels(nodes.current, []); return }
    const h0 = s.sample(0, 0)
    if (h0 === null) return
    // Stand each pin on the DEM (only when the markers or the visit target change).
    const key = `${s.key}|${markerKey}`
    if (key !== placed.current) {
      placed.current = key
      for (const m of markers) {
        const pin = pins.current.get(m.id)?.group, h = s.sample(m.eastM, m.northM)
        if (!pin) continue
        pin.visible = h !== null
        if (h !== null) pin.position.set(m.eastM, h - h0, -m.northM)
      }
    }
    const visitor = runtime.visitOffset, size = get().size, out: LabelPlacement[] = [], screen = { x: 0, y: 0 }
    for (const m of markers) {
      const parts = pins.current.get(m.id), pin = parts?.group
      if (!parts || !pin?.visible) continue
      const d = Math.hypot(m.eastM - visitor.eastM, m.northM - visitor.northM), near = 1 - Math.min(1, Math.max(0, (d - MARKER_LABEL_M) / (FAR_M - MARKER_LABEL_M)))
      // Subtle at distance, readable near, and out of the way when you stand beside it (a pin a metre or two away
      // would otherwise fill the foreground): its ring stays, the pole and head fade.
      const beside = Math.min(1, Math.max(.1, (d - 1.5) / 3.5))
      pin.scale.setScalar(hovered.current === m.id ? 1.15 : 1)
      parts.head.opacity = (.5 + .5 * near) * beside
      parts.pole.opacity = (.35 + .4 * near) * beside
      parts.ring.opacity = .25 + .35 * near
      if (d > (m.kind === 'route' ? 250 : MARKER_LABEL_M) && hovered.current !== m.id) continue
      world.set(0, POLE + .28, 0); pin.localToWorld(world)
      if (!toScreen(world, camera, size.width, size.height, screen)) continue
      out.push({ id: m.id, x: screen.x, y: screen.y, opacity: hovered.current === m.id ? 1 : m.kind === 'route' ? Math.max(.6, 1 - d / 625) : Math.min(1, 1.4 - d / MARKER_LABEL_M * .6), scale: labelScale(d), priority: hovered.current === m.id ? 9 : m.kind === 'route' ? 7 : 5, text: `${m.label} · ${formatDistance(d)}` })
    }
    // Never over the HUD panels.
    placeLabels(nodes.current, out, hudBlocks(hud.current, get().gl.domElement, HUD_SURFACES), size)
  })

  const click = (id: string) => (e: ThreeEvent<MouseEvent>) => { if (runtime.dragged || e.delta > 3) return; e.stopPropagation(); onSelect?.(id) }
  const over = (id: string) => (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); hovered.current = id; document.body.style.cursor = 'pointer'; invalidate() }
  const out = (id: string) => () => { if (hovered.current === id) { hovered.current = null; document.body.style.cursor = ''; invalidate() } }
  const slots = useMemo<LabelSlot[]>(() => markers.map(m => ({ id: m.id, content: <span className="ovl-marker" style={{ '--pin': MARKER_COLOURS[m.kind] } as React.CSSProperties}><em>{KIND_NAME[m.kind]}</em><span data-text>{m.label}</span></span> })), [markers])
  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false}>
    {markers.map(m => <Pin key={m.id} marker={m} register={parts => { if (parts) pins.current.set(m.id, parts); else pins.current.delete(m.id) }} onClick={click(m.id)} onOver={over(m.id)} onOut={out(m.id)} />)}
    <LabelLayer nodes={nodes} slots={slots} />
  </group>
}

type PinParts = { group: T.Group; head: T.MeshBasicMaterial; pole: T.MeshBasicMaterial; ring: T.MeshBasicMaterial }
function Pin({ marker, register, onClick, onOver, onOut }: {
  marker: FieldMarker; register: (parts: PinParts | null) => void
  onClick: (e: ThreeEvent<MouseEvent>) => void; onOver: (e: ThreeEvent<PointerEvent>) => void; onOut: () => void
}) {
  const colour = MARKER_COLOURS[marker.kind]
  const parts = useMemo(() => ({
    head: new T.MeshBasicMaterial({ color: colour, transparent: true, toneMapped: false }),
    pole: new T.MeshBasicMaterial({ color: '#d7e3ea', transparent: true, opacity: .7 }),
    ring: new T.MeshBasicMaterial({ color: colour, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
    hit: new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
  }), [colour])
  useEffect(() => () => { parts.head.dispose(); parts.pole.dispose(); parts.ring.dispose(); parts.hit.dispose() }, [parts])
  const decor = { focusIgnore: true, decorative: true }
  return <group visible={false} ref={g => register(g ? { group: g, head: parts.head, pole: parts.pole, ring: parts.ring } : null)} userData={{ fieldMarker: marker.id }}>
    <mesh position={[0, .02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={parts.ring} renderOrder={2} userData={decor}><ringGeometry args={[.17, .22, 28]} /></mesh>
    <mesh position={[0, POLE / 2, 0]} material={parts.pole} userData={decor}><cylinderGeometry args={[.011, .011, POLE, 6]} /></mesh>
    <mesh position={[0, POLE + .08, 0]} material={parts.head} userData={decor}><octahedronGeometry args={[.085, 0]} /></mesh>
    {/* A generous invisible hit volume so the thin pin is easy to click. */}
    <mesh position={[0, (POLE + .2) / 2, 0]} material={parts.hit} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut} userData={{ fieldMarker: marker.id, focusIgnore: true }}><cylinderGeometry args={[.32, .32, POLE + .2, 8]} /></mesh>
  </group>
}
