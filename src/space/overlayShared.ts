import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as T from 'three'
import type { TerrainDataset, TerrainStore } from './terrain'
import { visitTerrainSampler, type TerrainSampler } from './terrainSampler'
import type { Runtime } from './SpaceScene'

type PreRender = (camera: T.Camera) => void
const hooks = new WeakMap<T.Scene, { set: Set<PreRender>; previous: T.Scene['onBeforeRender'] }>()

/**
 * Runs `callback` inside the renderer, after every useFrame and matrix update of the frame and before drawing, so
 * screen-space labels use this frame's camera (useFrame callbacks of children can run before the visit camera moves).
 * It is called only on frames the app renders anyway.
 */
export function usePreRender(callback: PreRender) {
  const scene = useThree(s => s.scene), latest = useRef(callback)
  latest.current = callback
  useEffect(() => {
    let entry = hooks.get(scene)
    if (!entry) {
      const set = new Set<PreRender>(), previous = scene.onBeforeRender
      entry = { set, previous }
      hooks.set(scene, entry)
      scene.onBeforeRender = function (...args: Parameters<T.Object3D['onBeforeRender']>) {
        previous.apply(this, args)
        for (const run of set) run(args[2])
      }
    }
    const run: PreRender = camera => latest.current(camera)
    entry.set.add(run)
    return () => {
      const current = hooks.get(scene)
      if (!current) return
      current.set.delete(run)
      if (!current.set.size) { scene.onBeforeRender = current.previous; hooks.delete(scene) }
    }
  }, [scene])
}

export type OverlaySampler = { key: string; sample: TerrainSampler; dataset: TerrainDataset; site: { lat: number; lonEast: number } }

/**
 * The DEM the rendered terrain patch is built from at the visit target (the dataset LunarTerrain's buildPatch
 * chooses for a standing visitor, falling back to the global grid exactly as its vertices do), read through the
 * existing east/north sampler. Overlay values therefore match the drawn ground. Null until a visit has terrain.
 */
export function overlaySampler(runtime: Runtime, previous: OverlaySampler | null): OverlaySampler | null {
  const store = runtime.terrainStore, a = runtime.visitAnchor
  if (!runtime.visit || !runtime.terrainReady || !store || !a) return null
  const site = { lat: Math.asin(Math.max(-1, Math.min(1, a.up.y))) * 180 / Math.PI, lonEast: Math.atan2(-a.up.z, a.up.x) * 180 / Math.PI }
  const key = `${a.up.x}/${a.up.y}/${a.up.z}`
  if (previous?.key === key) return previous
  const dataset = store.choose(site.lat, site.lonEast, Math.max(2, Math.max(1, runtime.eyeHeightM)))
  const global = store.manifest.datasets.find(d => d.key === 'global')
  const datasets = global && global !== dataset ? [dataset, global] : [dataset]
  // Same east/north -> lat/lon mapping as the map and walking code; only the dataset order is pinned.
  const view = { manifest: { ...store.manifest, datasets }, height: (d: TerrainDataset, lat: number, lon: number) => store.height(d, lat, lon) } as unknown as TerrainStore
  return { key, sample: visitTerrainSampler(view, site), dataset, site }
}

/** Screen position (CSS px) of a world point, or null when it is behind the camera. */
export function toScreen(world: T.Vector3, camera: T.Camera, width: number, height: number, out: { x: number; y: number }) {
  const v = world.clone().applyMatrix4(camera.matrixWorldInverse)
  if (v.z > -1e-12) return null
  v.applyMatrix4(camera.projectionMatrix)
  out.x = (v.x * .5 + .5) * width
  out.y = (-v.y * .5 + .5) * height
  return out
}
