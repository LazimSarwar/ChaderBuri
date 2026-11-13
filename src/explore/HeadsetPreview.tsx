import { consoleGlanceStore, glanceForVisit, type ConsoleGlance } from './consoleGlanceStore'
import { VRGlance } from './VRGlance'
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as T from 'three'
import type { TerrainSampler } from './terrainGrid'
import { xrTerrain } from './xrTerrain'
import { loadSpace } from '../space/ephemeris'
import './headset-preview.css'

type Props = { visitKey: string; siteName: string; sampler: TerrainSampler | null; centre: { eastM: number; northM: number }; resolutionM: number; sun: { az: number; el: number }; earth: { az: number; el: number }; source: string; epoch: string; onClose: () => void; objective?: string }
const direction = (az: number, el: number, range: number): [number, number, number] => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return [range * Math.cos(e) * Math.sin(a), range * Math.sin(e), -range * Math.cos(e) * Math.cos(a)] }
export default function HeadsetPreview(p: Props) {
  const [supported, setSupported] = useState<boolean | null>(null), [error, setError] = useState(''), [renderer, setRenderer] = useState<T.WebGLRenderer | null>(null), [running, setRunning] = useState(false), [earthTexture, setEarthTexture] = useState<string | null>(null)
  const glanceSnapshot=useSyncExternalStore(consoleGlanceStore.subscribe,consoleGlanceStore.getSnapshot,consoleGlanceStore.getSnapshot)
  const glance=useMemo(()=>glanceForVisit(glanceSnapshot,p.visitKey,p.siteName),[glanceSnapshot,p.visitKey,p.siteName])
  const session = useRef<XRSession | null>(null), dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    if (!navigator.xr || !window.isSecureContext) { setSupported(false); return }
    void navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (alive) setSupported(ok) }).catch(() => { if (alive) setSupported(false) })
    return () => { alive = false }
  }, [])
  useEffect(() => { if (supported) void loadSpace().then(data => setEarthTexture(data.bodies.find(b => b.name === 'Earth')?.texture ?? null)) }, [supported])
  useEffect(() => { const before = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { before?.focus(); void session.current?.end().catch(() => {}) } }, [])
  const patch = useMemo(() => p.sampler ? xrTerrain(p.sampler, p.centre, p.resolutionM) : null, [p.sampler, p.centre.eastM, p.centre.northM, p.resolutionM])
  const enter = async () => {
    if (!navigator.xr || !renderer || !patch) return
    setError('')
    try {
      const next = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] })
      session.current = next; next.addEventListener('end', () => { session.current = null; setRunning(false) }, { once: true })
      renderer.xr.setReferenceSpaceType('local-floor'); await renderer.xr.setSession(next); setRunning(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'The headset session could not start.'); if (session.current) { await session.current.end().catch(() => {}); session.current = null } }
  }
  return <div className="headset-preview pointer-events-auto" ref={dialog} role="dialog" aria-modal="true" aria-label="Headset terrain preview" onKeyDown={e => {
    if (e.key === 'Escape' && !running) { e.preventDefault(); e.stopPropagation(); p.onClose() }
    if (e.key === 'Tab') { const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []), first = controls[0], last = controls.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
  }}>
    <header><h2>Headset terrain preview</h2><button onClick={async () => { await session.current?.end().catch(() => {}); p.onClose() }}>Close headset preview</button></header>
    <div className="headset-description"><p>Metre-scale terrain, stereo head tracking and controller-select teleportation. Main exploration is paused while this view is open.</p><p>{p.source} · {p.epoch}. Terrain and sky directions are reconstructed; this is not live imagery. Distant terrain, operational hazards and suit systems are not assessed in this preview.</p>
      {supported === null ? <p role="status">Checking headset support…</p> : !supported ? <p role="status">Immersive VR is unavailable in this browser or on this device. Use a compatible WebXR headset/browser over HTTPS or localhost. Desktop and phone exploration remain available.</p> : !patch ? <p role="status">Loaded terrain is required before starting a headset session.</p> : <><button disabled={!renderer || running} onClick={() => void enter()}>{running ? 'Headset session active' : 'Enter VR terrain preview'}</button><p>Point a controller at known ground and press Select to teleport. Use your headset’s system control to exit. Select the floating readout to cycle through glance, timeline and ranking. Only the local terrain patch is represented; physical headset validation is pending.</p></>}
      {error && <p role="alert">{error}</p>}
    </div>
    {supported && patch && <div className="headset-canvas"><Canvas camera={{ position: [0, 1.7, 0], near: .05, far: 2000 }} dpr={1} gl={{ antialias: false }} onCreated={({ gl }) => { gl.xr.enabled = true; gl.xr.setFramebufferScaleFactor(.7); setRenderer(gl) }}><Suspense fallback={null}><MeterWorld glance={glance} objective={p.objective ?? 'Free exploration'} patch={patch} sun={p.sun} earth={p.earth} earthTexture={earthTexture} /></Suspense></Canvas></div>}
  </div>
}
function Earth({ texture, at }: { texture: string; at: [number, number, number] }) {
  const map = useLoader(T.TextureLoader, texture)
  return <mesh position={at}><sphereGeometry args={[5, 24, 16]} /><meshBasicMaterial map={map} /></mesh>
}
function MeterWorld({ patch, sun, earth, earthTexture, glance, objective }: { patch: NonNullable<ReturnType<typeof xrTerrain>>; sun: Props['sun']; earth: Props['earth']; earthTexture: string | null; glance: ConsoleGlance; objective: string }) {
  const [glanceMode,setGlanceMode]=useState(0),glancePanel=useRef<T.Mesh>(null)
  const ground = useRef<T.Mesh>(null), { gl, scene, invalidate } = useThree(), ray = useMemo(() => new T.Raycaster(), []), marker = useRef<T.Mesh>(null), base = useRef<XRReferenceSpace | null>(null)
  const geometry = useMemo(() => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(patch.positions, 3)); g.setIndex(patch.indices); g.computeVertexNormals(); return g }, [patch])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => {
    const controllers = [gl.xr.getController(0), gl.xr.getController(1)], lines: T.Line[] = []
    const resetSpace = () => { base.current = null }
    gl.xr.addEventListener('sessionstart', resetSpace)
    const hit = (controller: T.XRTargetRaySpace) => { if (!ground.current) return null; ray.setFromXRController(controller); return ray.intersectObject(ground.current, false)[0]?.point ?? null }
    const handlers = controllers.map(controller => {
      const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 0, -4)]), new T.LineBasicMaterial({ color: '#80dcf6' })); controller.add(line); lines.push(line); scene.add(controller)
      const select = () => {
        ray.setFromXRController(controller);if(glancePanel.current&&ray.intersectObject(glancePanel.current,false).length){setGlanceMode(mode=>(mode+1)%3);invalidate();return}
        const point = hit(controller), space = gl.xr.getReferenceSpace()
        if (!point || !space || Math.hypot(point.x, point.z) > patch.extentM - 2 || typeof XRRigidTransform === 'undefined') return
        base.current ??= space
        gl.xr.setReferenceSpace(base.current.getOffsetReferenceSpace(new XRRigidTransform({ x: -point.x, y: -point.y, z: -point.z })))
        invalidate()
      }
      controller.addEventListener('select', select)
      return () => { controller.removeEventListener('select', select); controller.remove(line); scene.remove(controller) }
    })
    return () => { gl.xr.removeEventListener('sessionstart', resetSpace); handlers.forEach(fn => fn()); lines.forEach(l => { l.geometry.dispose(); (l.material as T.Material).dispose() }) }
  }, [gl, scene, ray, patch.extentM, invalidate])
  useFrame(() => {
    if (!marker.current || !ground.current || !gl.xr.isPresenting) return
    ray.setFromXRController(gl.xr.getController(0)); const point = ray.intersectObject(ground.current, false)[0]?.point
    marker.current.visible = !!point
    if (point) { marker.current.position.copy(point); marker.current.position.y += .04 }
  })
  return <><VRGlance value={glance} objective={objective} mode={glanceMode} panelRef={glancePanel} /><color attach="background" args={['#000']} /><ambientLight intensity={.03} /><directionalLight position={direction(sun.az, sun.el, 300)} intensity={2} /><mesh ref={ground} geometry={geometry}><meshStandardMaterial color="#888781" roughness={1} flatShading /></mesh><mesh position={direction(sun.az, sun.el, 300)}><sphereGeometry args={[1.4, 12, 8]} /><meshBasicMaterial color="#fff4d8" /></mesh>{earthTexture && <Earth texture={earthTexture} at={direction(earth.az, earth.el, 300)} />}<mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.3, .4, 24]} /><meshBasicMaterial color="#80dcf6" side={T.DoubleSide} /></mesh></>
}
